import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { FastifyRequest, FastifyReply } from 'fastify';
import { ConfigService } from '@nestjs/config';

/**
 * Logging interceptor that logs incoming requests and outgoing responses
 * with timing information and structured context
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);
  private readonly isProduction: boolean;
  private readonly sensitiveFields = [
    'password',
    'token',
    'secret',
    'authorization',
    'api_key',
    'apiKey',
    'ssn',
    'creditCard',
    'refreshToken',
  ];
  private readonly healthCheckPaths = [
    '/api/health',
    '/api/v1/health',
    '/health',
    '/api/healthz',
  ];

  constructor(private readonly configService: ConfigService) {
    this.isProduction = configService.get('NODE_ENV') === 'production';
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const response = context.switchToHttp().getResponse<FastifyReply>();
    const { method, url, ip, headers, body, query, params } = request;
    const userAgent = headers['user-agent'] || 'unknown';
    const requestPath = url.split('?')[0];

    // Skip logging for health check endpoints to reduce noise
    if (this.isHealthCheckRequest(requestPath)) {
      return next.handle();
    }

    // Extract user info if available
    const user = (request as any).user;
    const userId = user?.id;
    const userRole = user?.role;

    // Record start time
    const startTime = Date.now();

    // Log the incoming request
    this.logger.log(
      `Incoming Request: ${method} ${requestPath}`,
      {
        type: 'request',
        method,
        path: requestPath,
        query: this.maskSensitiveData(query),
        params: this.maskSensitiveData(params),
        body: body ? this.maskSensitiveData(body) : undefined,
        ip,
        userAgent,
        userId,
        userRole,
        requestId: headers['x-request-id'] || undefined,
        correlationId: headers['x-correlation-id'] || undefined,
      },
    );

    // Process the request and log the response
    return next.handle().pipe(
      tap({
        next: (data: any) => {
          this.logResponse(
            startTime,
            method,
            requestPath,
            response.statusCode,
            data,
            userId,
          );
        },
        error: (error: any) => {
          // Error logging is handled by exception filters, but we can log timing here
          const duration = Date.now() - startTime;
          this.logger.warn(
            `Request Failed: ${method} ${requestPath} - ${duration}ms`,
            {
              type: 'response',
              method,
              path: requestPath,
              statusCode: error.status || 500,
              duration,
              userId,
              error: error.name,
            },
          );
        },
      }),
    );
  }

  /**
   * Log response details with timing information
   */
  private logResponse(
    startTime: number,
    method: string,
    path: string,
    statusCode: number,
    data: any,
    userId?: string,
  ): void {
    const duration = Date.now() - startTime;
    const logContext = {
      type: 'response',
      method,
      path,
      statusCode,
      duration: `${duration}ms`,
      userId,
    };

    // Add response data in non-production environments if it's not too large
    if (!this.isProduction && data) {
      const maskedData = this.maskSensitiveData(data);
      const dataSize = JSON.stringify(maskedData).length;
      
      // Only include response data if it's not too large (< 10KB)
      if (dataSize < 10240) {
        logContext['responseData'] = maskedData;
      } else {
        logContext['responseSize'] = dataSize;
      }
    }

    // Log with appropriate level based on status code
    if (statusCode >= 500) {
      this.logger.error(`Response: ${method} ${path} - ${statusCode} - ${duration}ms`, logContext);
    } else if (statusCode >= 400) {
      this.logger.warn(`Response: ${method} ${path} - ${statusCode} - ${duration}ms`, logContext);
    } else if (duration > 1000) {
      // Log slow responses as warnings
      this.logger.warn(`Slow Response: ${method} ${path} - ${statusCode} - ${duration}ms`, logContext);
    } else {
      this.logger.log(`Response: ${method} ${path} - ${statusCode} - ${duration}ms`, logContext);
    }
  }

  /**
   * Check if the request is a health check request
   */
  private isHealthCheckRequest(path: string): boolean {
    return this.healthCheckPaths.some(healthPath => 
      path === healthPath || path.startsWith(`${healthPath}/`)
    );
  }

  /**
   * Mask sensitive data in objects
   */
  private maskSensitiveData(data: any): any {
    if (!data) return data;
    
    if (typeof data === 'string') {
      return data;
    }
    
    if (Array.isArray(data)) {
      return data.map(item => this.maskSensitiveData(item));
    }
    
    if (typeof data === 'object' && data !== null) {
      const masked = { ...data };
      
      for (const key of Object.keys(masked)) {
        if (this.sensitiveFields.some(field => 
          key.toLowerCase().includes(field.toLowerCase())
        )) {
          masked[key] = '[REDACTED]';
        } else if (typeof masked[key] === 'object' && masked[key] !== null) {
          masked[key] = this.maskSensitiveData(masked[key]);
        }
      }
      
      return masked;
    }
    
    return data;
  }
}
