import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { ConfigService } from '@nestjs/config';

/**
 * Filter that catches HttpException instances and formats them consistently
 * Provides detailed formatting for validation errors
 */
@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);
  private readonly isProduction: boolean;

  constructor(private readonly configService: ConfigService) {
    this.isProduction = configService.get('NODE_ENV') === 'production';
  }

  catch(exception: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    const statusCode = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    // Extract request information for logging
    const requestInfo = {
      method: request.method,
      path: request.url,
      ip: request.ip,
      userAgent: request.headers['user-agent'] as string,
      userId: (request.user as any)?.id,
    };

    // Format the error response
    const errorResponse = this.formatErrorResponse(
      statusCode,
      exceptionResponse,
      request.url,
    );

    // Log the error with appropriate level
    this.logHttpError(statusCode, errorResponse, requestInfo, exception);

    // Send the response
    response.status(statusCode).send(errorResponse);
  }

  /**
   * Format error response based on exception type and content
   */
  private formatErrorResponse(
    statusCode: number,
    exceptionResponse: string | object,
    path: string,
  ): Record<string, any> {
    const timestamp = new Date().toISOString();
    const errorName = this.getHttpErrorName(statusCode);

    // Handle string responses
    if (typeof exceptionResponse === 'string') {
      return {
        statusCode,
        timestamp,
        path,
        error: errorName,
        message: exceptionResponse,
      };
    }

    // Handle object responses (including validation errors)
    const responseObj = exceptionResponse as Record<string, any>;
    
    // Format validation errors if present
    if (Array.isArray(responseObj.message) && responseObj.message.length > 0) {
      // This is likely a validation error from class-validator
      return {
        statusCode,
        timestamp,
        path,
        error: responseObj.error || errorName,
        message: this.isProduction 
          ? 'Validation failed' 
          : 'Validation failed. Check the errors field for details.',
        errors: this.formatValidationErrors(responseObj.message),
      };
    }

    // Handle general object responses
    return {
      statusCode,
      timestamp,
      path,
      error: responseObj.error || errorName,
      message: responseObj.message || 'An error occurred',
      ...(responseObj.details && !this.isProduction ? { details: responseObj.details } : {}),
    };
  }

  /**
   * Format validation errors from class-validator into a more user-friendly structure
   */
  private formatValidationErrors(
    validationErrors: any[],
  ): Record<string, string[]> {
    const formattedErrors: Record<string, string[]> = {};

    for (const error of validationErrors) {
      if (typeof error === 'string') {
        // Handle simple string errors
        formattedErrors['general'] = formattedErrors['general'] || [];
        formattedErrors['general'].push(error);
      } else if (error.property) {
        // Handle class-validator style errors
        const field = error.property;
        formattedErrors[field] = formattedErrors[field] || [];
        
        if (error.constraints) {
          // Add all constraint violation messages
          formattedErrors[field].push(...Object.values(error.constraints));
        } else {
          // Fallback message if constraints are missing
          formattedErrors[field].push('Invalid value');
        }

        // Handle nested validation errors
        if (error.children && error.children.length > 0) {
          const nestedErrors = this.formatValidationErrors(error.children);
          for (const [nestedField, messages] of Object.entries(nestedErrors)) {
            const fullPath = `${field}.${nestedField}`;
            formattedErrors[fullPath] = messages;
          }
        }
      }
    }

    return formattedErrors;
  }

  /**
   * Get HTTP error name based on status code
   */
  private getHttpErrorName(statusCode: number): string {
    const statusMap = {
      [HttpStatus.BAD_REQUEST]: 'Bad Request',
      [HttpStatus.UNAUTHORIZED]: 'Unauthorized',
      [HttpStatus.FORBIDDEN]: 'Forbidden',
      [HttpStatus.NOT_FOUND]: 'Not Found',
      [HttpStatus.METHOD_NOT_ALLOWED]: 'Method Not Allowed',
      [HttpStatus.NOT_ACCEPTABLE]: 'Not Acceptable',
      [HttpStatus.REQUEST_TIMEOUT]: 'Request Timeout',
      [HttpStatus.CONFLICT]: 'Conflict',
      [HttpStatus.GONE]: 'Gone',
      [HttpStatus.PAYLOAD_TOO_LARGE]: 'Payload Too Large',
      [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'Unsupported Media Type',
      [HttpStatus.UNPROCESSABLE_ENTITY]: 'Unprocessable Entity',
      [HttpStatus.TOO_MANY_REQUESTS]: 'Too Many Requests',
      [HttpStatus.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
      [HttpStatus.NOT_IMPLEMENTED]: 'Not Implemented',
      [HttpStatus.BAD_GATEWAY]: 'Bad Gateway',
      [HttpStatus.SERVICE_UNAVAILABLE]: 'Service Unavailable',
      [HttpStatus.GATEWAY_TIMEOUT]: 'Gateway Timeout',
    };

    return statusMap[statusCode] || 'Unknown Error';
  }

  /**
   * Log HTTP errors with appropriate level based on status code
   */
  private logHttpError(
    statusCode: number,
    errorResponse: Record<string, any>,
    requestInfo: Record<string, any>,
    exception: HttpException,
  ): void {
    const logContext = {
      ...requestInfo,
      statusCode,
      timestamp: errorResponse.timestamp,
    };

    const logMessage = `[${requestInfo.method}] ${requestInfo.path} - ${statusCode}: ${errorResponse.message}`;

    if (statusCode >= 500) {
      // Server errors are logged as errors
      this.logger.error(logMessage, exception.stack, logContext);
    } else if (statusCode >= 400 && statusCode < 404) {
      // Bad requests, unauthorized, and forbidden are logged as warnings
      this.logger.warn(logMessage, logContext);
    } else if (statusCode === 404) {
      // Not found is logged as debug to avoid noise
      this.logger.debug(logMessage, logContext);
    } else {
      // Other client errors
      this.logger.log(logMessage, logContext);
    }
  }
}
