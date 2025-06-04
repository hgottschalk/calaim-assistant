import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

/**
 * Key for the metadata that stores required roles for a route
 * Used by RolesGuard to determine which roles can access the route
 */
export const ROLES_KEY = 'roles';

/**
 * Decorator that marks a route as requiring specific roles for access
 * 
 * @param roles One or more UserRole values required to access the route
 * 
 * Usage:
 * ```typescript
 * @Roles(UserRole.ADMIN)
 * @Get('admin-only')
 * adminOnlyRoute() {
 *   return 'Only admins can see this';
 * }
 * 
 * @Roles(UserRole.ADMIN, UserRole.SUPERVISOR)
 * @Get('management')
 * managementRoute() {
 *   return 'Admins and supervisors can see this';
 * }
 * ```
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
