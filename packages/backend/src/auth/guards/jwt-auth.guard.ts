import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
  Logger,
  CanActivate,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { Observable } from 'rxjs';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

/**
 * Guard that protects routes with JWT authentication
 * Routes can be made public by using the @Public() decorator
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    super();
  }

  /**
   * Determines if the current request can activate the route
   * Checks for public routes and validates JWT token
   * 
   * @param context The execution context
   * @returns Boolean indicating if the request can proceed
   */
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    // Check if the route is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Allow access to public routes without authentication
    if (isPublic) {
      return true;
    }

    // For non-public routes, validate the JWT token
    return this.validateRequest(context);
  }

  /**
   * Validates the request by checking the JWT token
   * 
   * @param context The execution context
   * @returns Promise resolving to boolean indicating if request is valid
   */
  private async validateRequest(context: ExecutionContext): Promise<boolean> {
    try {
      // Use the parent AuthGuard's canActivate method to validate the token
      const result = await super.canActivate(context) as boolean;
      
      if (!result) {
        throw new UnauthorizedException('Invalid authentication token');
      }
      
      return result;
    } catch (error) {
      this.handleAuthError(error, context);
      return false;
    }
  }

  /**
   * Handle authentication errors with appropriate responses
   * 
   * @param error The error that occurred during authentication
   * @param context The execution context
   */
  private handleAuthError(error: any, context: ExecutionContext): void {
    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);
    const path = request.url;
    const method = request.method;
    
    // Log authentication failures with context but without sensitive data
    this.logger.warn(
      `Authentication failed for ${method} ${path}: ${error.message}`,
      {
        path,
        method,
        hasToken: !!token,
        errorType: error.name,
        errorMessage: error.message,
      },
    );

    // Determine the appropriate error message
    let message = 'Unauthorized';
    
    if (error.name === 'TokenExpiredError') {
      message = 'Authentication token has expired';
    } else if (error.name === 'JsonWebTokenError') {
      message = 'Invalid authentication token';
    } else if (error.name === 'NotBeforeError') {
      message = 'Authentication token not yet valid';
    }

    throw new UnauthorizedException(message);
  }

  /**
   * Extract JWT token from Authorization header
   * 
   * @param request The HTTP request object
   * @returns The token string or undefined if not found
   */
  private extractTokenFromHeader(request: any): string | undefined {
    const authHeader = request.headers.authorization;
    
    if (!authHeader) {
      return undefined;
    }
    
    const [type, token] = authHeader.split(' ');
    
    return type === 'Bearer' ? token : undefined;
  }

  /**
   * Override handleRequest to add custom error handling and user extraction
   * 
   * @param err Error object if authentication failed
   * @param user User object if authentication succeeded
   * @param info Additional info about the authentication
   * @param context The execution context
   * @returns The authenticated user
   */
  handleRequest(err: any, user: any, info: any, context: ExecutionContext): any {
    // If there's an error or no user, handle the authentication failure
    if (err || !user) {
      const error = err || new UnauthorizedException('User not found in token');
      this.handleAuthError(error, context);
    }
    
    // Return the authenticated user
    return user;
  }
}
