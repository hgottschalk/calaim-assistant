import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  RequestTimeoutException,
  SetMetadata,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, throwError } from 'rxjs';
import { timeout, catchError } from 'rxjs/operators';
import { FastifyRequest } from 'fastify';

/**
 * Metadata key for custom timeout values
 */
export const REQUEST_TIMEOUT_KEY = 'request_timeout';

/**
 * Decorator to set custom timeout for a specific route
 * @param timeoutMs Timeout in milliseconds
 */
export const SetTimeout = (timeoutMs: number) => SetMetadata(REQUEST_TIMEOUT_KEY, timeoutMs);

/**
 * Metadata key to disable timeout for specific routes
 */
export const DISABLE_TIMEOUT_KEY = 'disable_timeout';

/**
 * Decorator to disable timeout for long-running operations
 */
export const DisableTimeout = () => SetMetadata(DISABLE_TIMEOUT_KEY, true);

/**
 * Interceptor that applies request timeouts to all routes
 * Can be customized with SetTimeout decorator or disabled with DisableTimeout
 */
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TimeoutInterceptor.name);
  private readonly DEFAULT_TIMEOUT = 30000; // 30 seconds default timeout
  
  // Paths that are exempt from timeouts by default (like file uploads)
  private readonly EXEMPT_PATHS = [
    '/api/referrals/upload',
    '/api/v1/referrals/upload',
    '/api/files',
    '/api/v1/files',
  ];

  // Content types that indicate file uploads (exempt from timeout)
  private readonly UPLOAD_CONTENT_TYPES = [
    'multipart/form-data',
    'application/octet-stream',
  ];

  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') {
      return next.handle(); // Only apply to HTTP requests
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    
    // Check if timeout should be disabled for this route
    const disableTimeout = this.reflector.getAllAndOverride<boolean>(
      DISABLE_TIMEOUT_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Check if this is a file upload request
    const isUploadRequest = this.isFileUpload(request);
    
    // Check if the path is in the exempt list
    const isExemptPath = this.EXEMPT_PATHS.some(path => 
      request.url.startsWith(path)
    );

    // Skip timeout if disabled, exempt path, or file upload
    if (disableTimeout || isExemptPath || isUploadRequest) {
      return next.handle();
    }

    // Get custom timeout from metadata or use default
    const customTimeout = this.reflector.getAllAndOverride<number>(
      REQUEST_TIMEOUT_KEY,
      [context.getHandler(), context.getClass()],
    );
    
    const timeoutValue = customTimeout || this.DEFAULT_TIMEOUT;
    const methodName = context.getHandler().name;
    const className = context.getClass().name;

    return next.handle().pipe(
      timeout(timeoutValue),
      catchError(err => {
        if (err.name === 'TimeoutError') {
          const path = request.url;
          const method = request.method;
          
          this.logger.warn(
            `Request timeout (${timeoutValue}ms) exceeded for ${method} ${path}`,
            {
              path,
              method,
              handler: `${className}.${methodName}`,
              timeout: timeoutValue,
              requestId: request.headers['x-request-id'],
            },
          );
          
          return throwError(() => new RequestTimeoutException(
            `Request timeout of ${timeoutValue}ms exceeded`
          ));
        }
        return throwError(() => err);
      }),
    );
  }

  /**
   * Determine if the request is a file upload based on content-type or other indicators
   */
  private isFileUpload(request: FastifyRequest): boolean {
    const contentType = request.headers['content-type'] as string;
    
    if (!contentType) {
      return false;
    }
    
    return this.UPLOAD_CONTENT_TYPES.some(uploadType => 
      contentType.toLowerCase().includes(uploadType)
    );
  }
}
