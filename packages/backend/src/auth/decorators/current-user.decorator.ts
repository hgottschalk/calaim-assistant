import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { User } from '@prisma/client';

/**
 * Options for the CurrentUser decorator
 */
export interface CurrentUserOptions {
  /**
   * Whether to require a user to be present
   * If true and no user is found, an UnauthorizedException will be thrown
   * Default: true
   */
  required?: boolean;
}

/**
 * Extracts the current authenticated user from the request
 * 
 * @param options Configuration options for the decorator
 * @param ctx The execution context
 * @returns The current user or undefined if not present and not required
 * 
 * Usage:
 * ```typescript
 * // Get the current user (throws UnauthorizedException if not present)
 * @Get('profile')
 * getProfile(@CurrentUser() user: User) {
 *   return user;
 * }
 * 
 * // Get the current user or undefined if not present
 * @Get('optional-auth')
 * getOptionalAuth(@CurrentUser({ required: false }) user?: User) {
 *   return user ? `Hello ${user.firstName}` : 'Hello guest';
 * }
 * 
 * // Get specific user properties
 * @Get('welcome')
 * getWelcome(@CurrentUser('firstName') firstName: string) {
 *   return `Hello ${firstName}`;
 * }
 * ```
 */
export const CurrentUser = createParamDecorator(
  (data: string | CurrentUserOptions | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    
    // Extract options and property name
    let propertyName: string | undefined;
    let options: CurrentUserOptions = { required: true };
    
    if (typeof data === 'string') {
      propertyName = data;
    } else if (data && typeof data === 'object') {
      options = { ...options, ...data };
    }
    
    // Get the user from the request (set by JwtAuthGuard)
    const user = request.user;
    
    // Handle required flag
    if (!user && options.required) {
      throw new UnauthorizedException('User is required but not found in request');
    }
    
    // Return specific property if requested
    if (user && propertyName) {
      return user[propertyName];
    }
    
    // Return the entire user object
    return user;
  },
);

/**
 * Type-safe version of CurrentUser that specifies the return type
 * 
 * @template T The type of the user object or property
 * @param options Configuration options for the decorator
 * @returns The current user or property with the specified type
 * 
 * Usage:
 * ```typescript
 * // Get the typed user
 * @Get('profile')
 * getProfile(@CurrentUserTyped<User>() user: User) {
 *   return user;
 * }
 * 
 * // Get a typed user property
 * @Get('email')
 * getEmail(@CurrentUserTyped<string>('email') email: string) {
 *   return `Your email is ${email}`;
 * }
 * ```
 */
export function CurrentUserTyped<T = User>(): ParameterDecorator;
export function CurrentUserTyped<T = User>(propertyName: string): ParameterDecorator;
export function CurrentUserTyped<T = User>(options: CurrentUserOptions): ParameterDecorator;
export function CurrentUserTyped<T = User>(
  dataOrOptions?: string | CurrentUserOptions,
): ParameterDecorator {
  return CurrentUser(dataOrOptions as any) as ParameterDecorator;
}
