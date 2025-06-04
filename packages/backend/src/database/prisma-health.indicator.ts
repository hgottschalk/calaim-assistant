import { Injectable, Logger } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { PrismaService } from './prisma.service';
import { timeout } from 'rxjs/operators';
import { lastValueFrom, from } from 'rxjs';

@Injectable()
export class PrismaHealthIndicator extends HealthIndicator {
  private readonly logger = new Logger(PrismaHealthIndicator.name);
  private readonly DEFAULT_TIMEOUT_MS = 5000; // 5 seconds timeout for health checks

  constructor(private readonly prismaService: PrismaService) {
    super();
  }

  /**
   * Checks if the Prisma database connection is healthy
   * @param key The key which will be used for the result object
   * @param options Optional settings for the health check
   * @returns HealthIndicatorResult with database status
   * @throws HealthCheckError if the database is not available
   */
  async isHealthy(
    key: string,
    options: { timeout?: number } = {},
  ): Promise<HealthIndicatorResult> {
    const timeoutMs = options.timeout || this.DEFAULT_TIMEOUT_MS;
    
    try {
      // Use rxjs timeout operator to handle potential hanging connections
      const isConnected = await lastValueFrom(
        from(this.prismaService.isHealthy()).pipe(
          timeout(timeoutMs)
        )
      );

      if (!isConnected) {
        this.logger.warn(`Database health check failed: Connection test returned false`);
        throw new Error('Database connection test failed');
      }

      return this.getStatus(key, true, { responseTime: `<${timeoutMs}ms` });
    } catch (error) {
      this.logger.error(
        `Database health check failed: ${error.message}`,
        error.stack,
      );
      
      const status = this.getStatus(key, false, {
        message: `Database connection failed: ${error.message}`,
        timeout: timeoutMs,
      });
      
      throw new HealthCheckError(
        `${key} is not available`,
        status,
      );
    }
  }

  /**
   * Performs a ping check on the database with a very simple query
   * @param key The key which will be used for the result object
   * @returns HealthIndicatorResult with ping status
   */
  async pingCheck(key: string): Promise<HealthIndicatorResult> {
    try {
      const startTime = Date.now();
      await this.prismaService.$queryRaw`SELECT 1`;
      const responseTime = Date.now() - startTime;
      
      return this.getStatus(key, true, { responseTime: `${responseTime}ms` });
    } catch (error) {
      this.logger.error(
        `Database ping check failed: ${error.message}`,
        error.stack,
      );
      
      return this.getStatus(key, false, {
        message: `Database ping failed: ${error.message}`,
      });
    }
  }

  /**
   * Attempts to reconnect to the database if the connection was lost
   * @param key The key which will be used for the result object
   * @returns HealthIndicatorResult with reconnection status
   */
  async reconnect(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.prismaService.reconnect();
      return this.getStatus(key, true, { reconnected: true });
    } catch (error) {
      this.logger.error(
        `Database reconnection failed: ${error.message}`,
        error.stack,
      );
      
      return this.getStatus(key, false, {
        message: `Database reconnection failed: ${error.message}`,
      });
    }
  }
}
