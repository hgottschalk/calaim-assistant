import { SetMetadata } from '@nestjs/common';

/**
 * Key for the metadata that marks a route as public
 * Used by JwtAuthGuard to determine which routes should skip authentication
 */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Decorator that marks a route as public, exempting it from JWT authentication
 * 
 * Usage:
 * ```typescript
 * @Public()
 * @Get('health')
 * checkHealth() {
 *   return 'OK';
 * }
 * ```
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
