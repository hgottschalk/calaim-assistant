import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';

/**
 * JWT token payload interface
 */
interface JwtPayload {
  sub: string; // User ID
  email: string;
  role: string;
  iat?: number; // Issued at timestamp
  exp?: number; // Expiration timestamp
}

/**
 * JWT authentication strategy for Passport
 * Validates JWT tokens and fetches corresponding users
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      // Extract JWT from Authorization header with Bearer prefix
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      // Ignore token expiration (handled separately)
      ignoreExpiration: false,
      // Get secret key from configuration
      secretOrKey: configService.get<string>('JWT_SECRET'),
    });
  }

  /**
   * Validate the JWT payload and return the user
   * Called by Passport after token is verified
   * 
   * @param payload The decoded JWT payload
   * @returns The user object if validation succeeds
   * @throws UnauthorizedException if validation fails
   */
  async validate(payload: JwtPayload): Promise<any> {
    try {
      // Extract user ID from token payload
      const userId = payload.sub;
      
      if (!userId) {
        throw new UnauthorizedException('Invalid token payload: missing user ID');
      }

      // Find the user in the database
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          isActive: true,
          organizationId: true,
          title: true,
          licenseNumber: true,
          npi: true,
          lastLoginAt: true,
        },
      });

      // Check if user exists and is active
      if (!user) {
        this.logger.warn(`User not found for token with sub: ${userId}`);
        throw new UnauthorizedException('User not found');
      }

      if (!user.isActive) {
        this.logger.warn(`Inactive user attempted to authenticate: ${userId}`);
        throw new UnauthorizedException('User account is inactive');
      }

      // Verify that the token's email matches the user's email
      if (payload.email && payload.email !== user.email) {
        this.logger.warn(
          `Token email mismatch: ${payload.email} vs ${user.email} for user ${userId}`
        );
        throw new UnauthorizedException('Token email mismatch');
      }

      // Verify that the token's role matches the user's role
      if (payload.role && payload.role !== user.role) {
        this.logger.warn(
          `Token role mismatch: ${payload.role} vs ${user.role} for user ${userId}`
        );
        throw new UnauthorizedException('Token role mismatch');
      }

      // Update last login time
      await this.prisma.user.update({
        where: { id: userId },
        data: { lastLoginAt: new Date() },
      });

      // Return the user object to be stored in the request
      return user;
    } catch (error) {
      // Log the error (but don't expose details to client)
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      
      this.logger.error(`JWT validation error: ${error.message}`, error.stack);
      throw new UnauthorizedException('Authentication failed');
    }
  }
}
