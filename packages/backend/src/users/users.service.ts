import { Injectable, Logger, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { User, UserRole, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';

/**
 * Service for managing users in the CalAIM Assistant application
 * Provides CRUD operations and specialized user management functions
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private readonly SALT_ROUNDS = 10;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new user in the system
   * 
   * @param data User creation data with plain text password
   * @returns The created user (without password)
   * @throws ConflictException if email already exists
   */
  async create(data: Prisma.UserCreateInput & { password: string }): Promise<Omit<User, 'passwordHash'>> {
    try {
      // Check if user with email already exists
      const existingUser = await this.findByEmail(data.email);
      
      if (existingUser) {
        throw new ConflictException(`User with email ${data.email} already exists`);
      }

      // Hash the password
      const passwordHash = await this.hashPassword(data.password);

      // Extract password from data and replace with hashed version
      const { password, ...userData } = data;

      // Create the user
      const user = await this.prisma.user.create({
        data: {
          ...userData,
          passwordHash,
        },
      });

      // Log user creation
      this.logger.log(`User created: ${user.id} (${user.email})`);

      // Return user without password hash
      const { passwordHash: _, ...userWithoutPassword } = user;
      return userWithoutPassword;
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      
      if (error.code === 'P2002' && error.meta?.target?.includes('email')) {
        throw new ConflictException(`User with email ${data.email} already exists`);
      }

      this.logger.error(`Failed to create user: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Find a user by their ID
   * 
   * @param id User ID
   * @param includePassword Whether to include the password hash in the result
   * @returns The user or null if not found
   */
  async findById(id: string, includePassword = false): Promise<User | null> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id },
      });

      if (!user) {
        return null;
      }

      // Remove password hash if not requested
      if (!includePassword && user.passwordHash) {
        const { passwordHash, ...userWithoutPassword } = user;
        return userWithoutPassword as User;
      }

      return user;
    } catch (error) {
      this.logger.error(`Failed to find user by ID ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Find a user by their email address
   * 
   * @param email User email
   * @param includePassword Whether to include the password hash in the result
   * @returns The user or null if not found
   */
  async findByEmail(email: string, includePassword = false): Promise<User | null> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { email },
      });

      if (!user) {
        return null;
      }

      // Remove password hash if not requested
      if (!includePassword && user.passwordHash) {
        const { passwordHash, ...userWithoutPassword } = user;
        return userWithoutPassword as User;
      }

      return user;
    } catch (error) {
      this.logger.error(`Failed to find user by email ${email}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Find all users with optional filtering, pagination, and sorting
   * 
   * @param params Query parameters for filtering, pagination, and sorting
   * @returns Array of users (without password hashes)
   */
  async findAll(params: {
    skip?: number;
    take?: number;
    cursor?: Prisma.UserWhereUniqueInput;
    where?: Prisma.UserWhereInput;
    orderBy?: Prisma.UserOrderByWithRelationInput;
    includeInactive?: boolean;
  }): Promise<Omit<User, 'passwordHash'>[]> {
    const { skip, take, cursor, where, orderBy, includeInactive = false } = params;

    try {
      // Apply default filter to exclude inactive users unless explicitly requested
      const filter = {
        ...where,
        ...(includeInactive ? {} : { isActive: true }),
      };

      const users = await this.prisma.user.findMany({
        skip,
        take,
        cursor,
        where: filter,
        orderBy,
      });

      // Remove password hashes from all users
      return users.map(user => {
        const { passwordHash, ...userWithoutPassword } = user;
        return userWithoutPassword;
      });
    } catch (error) {
      this.logger.error(`Failed to find users: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Count users with optional filtering
   * 
   * @param where Filter criteria
   * @param includeInactive Whether to include inactive users
   * @returns Count of matching users
   */
  async count(where?: Prisma.UserWhereInput, includeInactive = false): Promise<number> {
    try {
      // Apply default filter to exclude inactive users unless explicitly requested
      const filter = {
        ...where,
        ...(includeInactive ? {} : { isActive: true }),
      };

      return await this.prisma.user.count({ where: filter });
    } catch (error) {
      this.logger.error(`Failed to count users: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Update a user's information
   * 
   * @param id User ID
   * @param data Update data
   * @returns The updated user (without password hash)
   * @throws NotFoundException if user not found
   */
  async update(
    id: string,
    data: Partial<Prisma.UserUpdateInput> & { password?: string },
  ): Promise<Omit<User, 'passwordHash'>> {
    try {
      // Check if user exists
      const existingUser = await this.findById(id, true);
      
      if (!existingUser) {
        throw new NotFoundException(`User with ID ${id} not found`);
      }

      // Handle password update if provided
      let updateData: Prisma.UserUpdateInput = { ...data };
      
      if (data.password) {
        const passwordHash = await this.hashPassword(data.password);
        const { password, ...restData } = data;
        updateData = {
          ...restData,
          passwordHash,
        };
      }

      // Check email uniqueness if changing email
      if (data.email && data.email !== existingUser.email) {
        const userWithEmail = await this.findByEmail(data.email as string);
        if (userWithEmail) {
          throw new ConflictException(`Email ${data.email} is already in use`);
        }
      }

      // Update the user
      const updatedUser = await this.prisma.user.update({
        where: { id },
        data: updateData,
      });

      // Log user update
      this.logger.log(`User updated: ${updatedUser.id} (${updatedUser.email})`);

      // Return user without password hash
      const { passwordHash, ...userWithoutPassword } = updatedUser;
      return userWithoutPassword;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ConflictException) {
        throw error;
      }
      
      if (error.code === 'P2002' && error.meta?.target?.includes('email')) {
        throw new ConflictException(`Email ${data.email} is already in use`);
      }

      this.logger.error(`Failed to update user ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Soft delete a user by marking them as inactive
   * 
   * @param id User ID
   * @returns The deactivated user (without password hash)
   * @throws NotFoundException if user not found
   */
  async softDelete(id: string): Promise<Omit<User, 'passwordHash'>> {
    try {
      // Check if user exists
      const existingUser = await this.findById(id);
      
      if (!existingUser) {
        throw new NotFoundException(`User with ID ${id} not found`);
      }

      // Soft delete by marking as inactive
      const updatedUser = await this.prisma.user.update({
        where: { id },
        data: { isActive: false },
      });

      // Log user deactivation
      this.logger.log(`User deactivated: ${updatedUser.id} (${updatedUser.email})`);

      // Return user without password hash
      const { passwordHash, ...userWithoutPassword } = updatedUser;
      return userWithoutPassword;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error(`Failed to deactivate user ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Permanently delete a user from the database
   * 
   * @param id User ID
   * @returns The deleted user (without password hash)
   * @throws NotFoundException if user not found
   */
  async hardDelete(id: string): Promise<Omit<User, 'passwordHash'>> {
    try {
      // Check if user exists
      const existingUser = await this.findById(id);
      
      if (!existingUser) {
        throw new NotFoundException(`User with ID ${id} not found`);
      }

      // Hard delete the user
      const deletedUser = await this.prisma.user.delete({
        where: { id },
      });

      // Log user deletion
      this.logger.log(`User permanently deleted: ${deletedUser.id} (${deletedUser.email})`);

      // Return user without password hash
      const { passwordHash, ...userWithoutPassword } = deletedUser;
      return userWithoutPassword;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error(`Failed to delete user ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Reactivate a previously deactivated user
   * 
   * @param id User ID
   * @returns The reactivated user (without password hash)
   * @throws NotFoundException if user not found
   */
  async reactivate(id: string): Promise<Omit<User, 'passwordHash'>> {
    try {
      // Check if user exists (including inactive)
      const existingUser = await this.prisma.user.findUnique({
        where: { id },
      });
      
      if (!existingUser) {
        throw new NotFoundException(`User with ID ${id} not found`);
      }

      if (existingUser.isActive) {
        return { ...existingUser, passwordHash: undefined };
      }

      // Reactivate the user
      const updatedUser = await this.prisma.user.update({
        where: { id },
        data: { isActive: true },
      });

      // Log user reactivation
      this.logger.log(`User reactivated: ${updatedUser.id} (${updatedUser.email})`);

      // Return user without password hash
      const { passwordHash, ...userWithoutPassword } = updatedUser;
      return userWithoutPassword;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error(`Failed to reactivate user ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Change a user's password
   * 
   * @param id User ID
   * @param currentPassword Current password for verification
   * @param newPassword New password to set
   * @returns True if password was changed successfully
   * @throws NotFoundException if user not found
   * @throws BadRequestException if current password is incorrect
   */
  async changePassword(
    id: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<boolean> {
    try {
      // Find user with password hash
      const user = await this.prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          email: true,
          passwordHash: true,
        },
      });

      if (!user) {
        throw new NotFoundException(`User with ID ${id} not found`);
      }

      // Verify current password
      const isPasswordValid = await this.comparePasswords(currentPassword, user.passwordHash);
      
      if (!isPasswordValid) {
        throw new BadRequestException('Current password is incorrect');
      }

      // Hash new password
      const newPasswordHash = await this.hashPassword(newPassword);

      // Update user's password
      await this.prisma.user.update({
        where: { id },
        data: { passwordHash: newPasswordHash },
      });

      // Log password change (without exposing the password)
      this.logger.log(`Password changed for user: ${user.id} (${user.email})`);

      return true;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }

      this.logger.error(`Failed to change password for user ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Reset a user's password (admin function, no current password verification)
   * 
   * @param id User ID
   * @param newPassword New password to set
   * @returns True if password was reset successfully
   * @throws NotFoundException if user not found
   */
  async resetPassword(id: string, newPassword: string): Promise<boolean> {
    try {
      // Find user
      const user = await this.findById(id);
      
      if (!user) {
        throw new NotFoundException(`User with ID ${id} not found`);
      }

      // Hash new password
      const passwordHash = await this.hashPassword(newPassword);

      // Update user's password
      await this.prisma.user.update({
        where: { id },
        data: { passwordHash },
      });

      // Log password reset
      this.logger.log(`Password reset for user: ${user.id} (${user.email})`);

      return true;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error(`Failed to reset password for user ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Update a user's role
   * 
   * @param id User ID
   * @param role New role to assign
   * @returns The updated user (without password hash)
   * @throws NotFoundException if user not found
   */
  async updateRole(id: string, role: UserRole): Promise<Omit<User, 'passwordHash'>> {
    try {
      // Check if user exists
      const existingUser = await this.findById(id);
      
      if (!existingUser) {
        throw new NotFoundException(`User with ID ${id} not found`);
      }

      // Update the user's role
      const updatedUser = await this.prisma.user.update({
        where: { id },
        data: { role },
      });

      // Log role update
      this.logger.log(`Role updated for user ${updatedUser.id} (${updatedUser.email}): ${role}`);

      // Return user without password hash
      const { passwordHash, ...userWithoutPassword } = updatedUser;
      return userWithoutPassword;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error(`Failed to update role for user ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Find users by their organization ID
   * 
   * @param organizationId Organization ID
   * @param params Query parameters for filtering, pagination, and sorting
   * @returns Array of users in the organization (without password hashes)
   */
  async findByOrganization(
    organizationId: string,
    params: {
      skip?: number;
      take?: number;
      where?: Prisma.UserWhereInput;
      orderBy?: Prisma.UserOrderByWithRelationInput;
      includeInactive?: boolean;
    } = {},
  ): Promise<Omit<User, 'passwordHash'>[]> {
    const { skip, take, where, orderBy, includeInactive = false } = params;

    try {
      // Combine organization filter with other filters
      const filter = {
        ...where,
        organizationId,
        ...(includeInactive ? {} : { isActive: true }),
      };

      const users = await this.prisma.user.findMany({
        skip,
        take,
        where: filter,
        orderBy,
      });

      // Remove password hashes from all users
      return users.map(user => {
        const { passwordHash, ...userWithoutPassword } = user;
        return userWithoutPassword;
      });
    } catch (error) {
      this.logger.error(
        `Failed to find users by organization ${organizationId}: ${error.message}`,
        error.stack
      );
      throw error;
    }
  }

  /**
   * Validate user credentials for authentication
   * 
   * @param email User email
   * @param password Plain text password to verify
   * @returns The authenticated user (without password hash) or null if invalid
   */
  async validateUser(email: string, password: string): Promise<Omit<User, 'passwordHash'> | null> {
    try {
      // Find user with password hash
      const user = await this.prisma.user.findUnique({
        where: { email },
      });

      if (!user || !user.passwordHash || !user.isActive) {
        return null;
      }

      // Verify password
      const isPasswordValid = await this.comparePasswords(password, user.passwordHash);
      
      if (!isPasswordValid) {
        return null;
      }

      // Return user without password hash
      const { passwordHash, ...userWithoutPassword } = user;
      return userWithoutPassword;
    } catch (error) {
      this.logger.error(`Failed to validate user ${email}: ${error.message}`, error.stack);
      return null;
    }
  }

  /**
   * Hash a plain text password
   * 
   * @param password Plain text password
   * @returns Hashed password
   */
  private async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.SALT_ROUNDS);
  }

  /**
   * Compare a plain text password with a hashed password
   * 
   * @param plainPassword Plain text password
   * @param hashedPassword Hashed password to compare against
   * @returns Boolean indicating if passwords match
   */
  private async comparePasswords(plainPassword: string, hashedPassword: string): Promise<boolean> {
    return bcrypt.compare(plainPassword, hashedPassword);
  }
}
