import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Global exception filter that catches all unhandled exceptions
 * and returns standardized error responses
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);
  private readonly isProduction: boolean;

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly configService: ConfigService,
  ) {
    this.isProduction = configService.get('NODE_ENV') === 'production';
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    // Get HTTP adapter from host
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<FastifyRequest>();
    const response = ctx.getResponse<FastifyReply>();

    // Extract request information for logging
    const requestInfo = this.extractRequestInfo(request);

    // Determine appropriate HTTP status code and error message
    const { statusCode, message, error, stack } = this.getExceptionData(exception);

    // Log the error with context
    this.logException(exception, requestInfo, statusCode, stack);

    // Create standardized error response
    const responseBody = {
      statusCode,
      timestamp: new Date().toISOString(),
      path: requestInfo.path,
      error,
      message,
      // Include additional details in non-production environments
      ...(this.isProduction
        ? {}
        : {
            details: this.getErrorDetails(exception),
            stack: stack?.split('\n').map((line) => line.trim()),
          }),
    };

    // Send the response
    httpAdapter.reply(response, responseBody, statusCode);
  }

  /**
   * Extract useful information from the request for error logging
   */
  private extractRequestInfo(request: FastifyRequest): {
    method: string;
    path: string;
    ip: string;
    userAgent: string;
    userId?: string;
  } {
    return {
      method: request.method,
      path: request.url,
      ip: request.ip,
      userAgent: request.headers['user-agent'] as string,
      userId: (request.user as any)?.id,
    };
  }

  /**
   * Determine the appropriate HTTP status code and error message based on exception type
   */
  private getExceptionData(exception: unknown): {
    statusCode: number;
    message: string;
    error: string;
    stack?: string;
  } {
    // Default values
    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let error = 'Internal Server Error';
    let stack: string | undefined = undefined;

    // Handle different types of exceptions
    if (exception instanceof HttpException) {
      // NestJS HTTP exceptions
      statusCode = exception.getStatus();
      const response = exception.getResponse();
      message =
        typeof response === 'object' && 'message' in response
          ? Array.isArray(response.message)
            ? response.message.join(', ')
            : String(response.message)
          : String(response);
      error =
        typeof response === 'object' && 'error' in response
          ? String(response.error)
          : this.getHttpErrorName(statusCode);
      stack = exception.stack;
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // Prisma database errors
      statusCode = this.mapPrismaErrorToHttpStatus(exception);
      message = this.sanitizeDatabaseErrorMessage(exception.message);
      error = 'Database Error';
      stack = exception.stack;
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      // Prisma validation errors
      statusCode = HttpStatus.BAD_REQUEST;
      message = this.sanitizeDatabaseErrorMessage(exception.message);
      error = 'Validation Error';
      stack = exception.stack;
    } else if (exception instanceof Error) {
      // Generic errors
      message = this.sanitizeErrorMessage(exception.message);
      stack = exception.stack;
    } else if (typeof exception === 'string') {
      // String exceptions
      message = exception;
    }

    return { statusCode, message, error, stack };
  }

  /**
   * Map Prisma error codes to appropriate HTTP status codes
   */
  private mapPrismaErrorToHttpStatus(
    exception: Prisma.PrismaClientKnownRequestError,
  ): number {
    const errorCode = exception.code;

    // Map common Prisma error codes to HTTP status codes
    switch (errorCode) {
      case 'P2002': // Unique constraint violation
        return HttpStatus.CONFLICT;
      case 'P2025': // Record not found
        return HttpStatus.NOT_FOUND;
      case 'P2003': // Foreign key constraint violation
        return HttpStatus.BAD_REQUEST;
      case 'P2001': // Record does not exist
        return HttpStatus.NOT_FOUND;
      case 'P2014': // Required relation violation
        return HttpStatus.BAD_REQUEST;
      default:
        return HttpStatus.INTERNAL_SERVER_ERROR;
    }
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
      [HttpStatus.CONFLICT]: 'Conflict',
      [HttpStatus.UNPROCESSABLE_ENTITY]: 'Unprocessable Entity',
      [HttpStatus.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
      [HttpStatus.SERVICE_UNAVAILABLE]: 'Service Unavailable',
    };

    return statusMap[statusCode] || 'Unknown Error';
  }

  /**
   * Get detailed error information for non-production environments
   */
  private getErrorDetails(exception: unknown): unknown {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      return typeof response === 'object' ? response : { message: response };
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return {
        code: exception.code,
        meta: exception.meta,
        target: exception.meta?.target || undefined,
      };
    } else if (exception instanceof Error) {
      return {
        name: exception.name,
        message: exception.message,
      };
    }
    return { message: String(exception) };
  }

  /**
   * Sanitize database error messages to remove sensitive information
   */
  private sanitizeDatabaseErrorMessage(message: string): string {
    // In production, provide generic messages
    if (this.isProduction) {
      if (message.includes('Unique constraint')) {
        return 'A record with the provided information already exists';
      } else if (message.includes('Foreign key constraint')) {
        return 'Referenced record does not exist';
      } else if (message.includes('Record to update not found')) {
        return 'Record not found';
      }
      return 'A database error occurred';
    }

    // In development, mask potential sensitive values but keep context
    return message
      .replace(/\b(?:password|token|secret|key|auth)\b=\S+/gi, '$1=[REDACTED]')
      .replace(/\b(?:email|phone)\b=\S+@\S+/gi, '$1=[REDACTED]');
  }

  /**
   * Sanitize general error messages to remove sensitive information
   */
  private sanitizeErrorMessage(message: string): string {
    // In production, provide less detailed messages
    if (this.isProduction) {
      // Check for common error patterns and provide generic messages
      if (message.toLowerCase().includes('jwt') || message.toLowerCase().includes('token')) {
        return 'Authentication error';
      } else if (message.toLowerCase().includes('permission')) {
        return 'Permission denied';
      } else if (message.toLowerCase().includes('timeout')) {
        return 'Operation timed out';
      }
      return 'An error occurred';
    }

    // In development, mask potential sensitive data
    return message
      .replace(/\b(?:password|token|secret|key|auth)\b[:=]\s*["']?\S+["']?/gi, '$1=[REDACTED]')
      .replace(/\b(?:email|phone)\b[:=]\s*["']?\S+@\S+["']?/gi, '$1=[REDACTED]');
  }

  /**
   * Log the exception with appropriate level and context
   */
  private logException(
    exception: unknown,
    requestInfo: any,
    statusCode: number,
    stack?: string,
  ): void {
    const errorContext = {
      ...requestInfo,
      statusCode,
      timestamp: new Date().toISOString(),
    };

    // Determine log level based on status code
    if (statusCode >= 500) {
      // Server errors
      this.logger.error(
        `[${requestInfo.method}] ${requestInfo.path} - ${statusCode}: ${
          exception instanceof Error ? exception.message : String(exception)
        }`,
        stack,
        errorContext,
      );
    } else if (statusCode >= 400) {
      // Client errors
      this.logger.warn(
        `[${requestInfo.method}] ${requestInfo.path} - ${statusCode}: ${
          exception instanceof Error ? exception.message : String(exception)
        }`,
        errorContext,
      );
    } else {
      // Unexpected cases
      this.logger.debug(
        `[${requestInfo.method}] ${requestInfo.path} - ${statusCode}: ${
          exception instanceof Error ? exception.message : String(exception)
        }`,
        errorContext,
      );
    }
  }
}
