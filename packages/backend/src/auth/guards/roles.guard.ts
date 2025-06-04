import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Guard that protects routes with role-based access control
 * Routes can specify required roles using the @Roles() decorator
 */
@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private reflector: Reflector) {}

  /**
   * Determines if the current request can activate the route based on user roles
   * 
   * @param context The execution context
   * @returns Boolean indicating if the user has the required roles
   */
  canActivate(context: ExecutionContext): boolean {
    // Check if the route is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Public routes don't need role checks
    if (isPublic) {
      return true;
    }

    // Get required roles from route metadata (handler or controller level)
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no roles are specified, allow access (but JWT guard may still block)
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    // Get the request and extract the user (set by JwtAuthGuard)
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // If no user is present, access is denied
    if (!user) {
      this.logAccessDenied(context, 'No authenticated user found');
      throw new ForbiddenException('Access denied: authentication required');
    }

    // If user has no role, access is denied
    if (!user.role) {
      this.logAccessDenied(context, `User ${user.id} has no role assigned`);
      throw new ForbiddenException('Access denied: no role assigned');
    }

    // Check if user has any of the required roles
    const hasRequiredRole = requiredRoles.includes(user.role);

    // Special case: ADMIN role has access to everything
    const isAdmin = user.role === UserRole.ADMIN;

    if (!hasRequiredRole && !isAdmin) {
      this.logAccessDenied(
        context,
        `User ${user.id} with role ${user.role} does not have required roles: ${requiredRoles.join(', ')}`
      );
      throw new ForbiddenException('Access denied: insufficient privileges');
    }

    // Log successful role-based access
    if (this.logger.isDebugEnabled()) {
      this.logger.debug(
        `Access granted to ${request.method} ${request.url} for user ${user.id} with role ${user.role}`
      );
    }

    return true;
  }

  /**
   * Log access denied events with context information
   * 
   * @param context The execution context
   * @param reason The reason access was denied
   */
  private logAccessDenied(context: ExecutionContext, reason: string): void {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    
    this.logger.warn(
      `Access denied to ${request.method} ${request.url}: ${reason}`,
      {
        userId: user?.id,
        userRole: user?.role,
        path: request.url,
        method: request.method,
        requiredRoles: this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
          context.getHandler(),
          context.getClass(),
        ]),
      }
    );
  }
}
