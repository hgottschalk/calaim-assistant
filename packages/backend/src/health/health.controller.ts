import {
  Controller,
  Get,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HttpHealthIndicator,
  DiskHealthIndicator,
  MemoryHealthIndicator,
  HealthCheckResult,
} from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { PrismaHealthIndicator } from '../database/prisma-health.indicator';
import { StorageHealthIndicator } from './indicators/storage.health';
import { RedisHealthIndicator } from './indicators/redis.health';
import { AiServiceHealthIndicator } from './indicators/ai-service.health';
import { PubSubHealthIndicator } from './indicators/pubsub.health';
import { Public } from '../auth/decorators/public.decorator';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

/**
 * Health controller provides endpoints for monitoring application health
 * Used by Kubernetes probes and monitoring systems
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly health: HealthCheckService,
    private readonly http: HttpHealthIndicator,
    private readonly disk: DiskHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly db: PrismaHealthIndicator,
    private readonly storage: StorageHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    private readonly aiService: AiServiceHealthIndicator,
    private readonly pubsub: PubSubHealthIndicator,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Comprehensive health check that verifies all system dependencies
   * Used for overall system health monitoring
   */
  @Public()
  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Complete health check of all system components' })
  @ApiResponse({ status: 200, description: 'All systems operational' })
  @ApiResponse({ status: 503, description: 'One or more systems unavailable' })
  async check(): Promise<HealthCheckResult> {
    try {
      return await this.health.check([
        // System checks
        () => this.disk.checkStorage('storage', { path: '/', thresholdPercent: 90 }),
        () => this.memory.checkHeap('memory_heap', { thresholdPercent: 90 }),
        () => this.memory.checkRSS('memory_rss', { thresholdPercent: 90 }),

        // Database check
        () => this.db.isHealthy('database'),

        // Storage check
        () => this.storage.checkConnection('storage_service'),

        // Redis check (if configured)
        async () => {
          if (this.configService.get('REDIS_URL')) {
            return this.redis.isHealthy('redis');
          }
          return { redis: { status: 'ok', message: 'Redis not configured' } };
        },

        // AI Service check
        () => this.aiService.ping('ai_service'),

        // PubSub check
        () => this.pubsub.checkConnection('pubsub'),

        // External services
        async () => {
          const aiServiceUrl = this.configService.get('AI_SERVICE_URL');
          if (aiServiceUrl) {
            return this.http.pingCheck('ai_service_http', `${aiServiceUrl}/health`);
          }
          return { ai_service_http: { status: 'ok', message: 'AI Service URL not configured' } };
        },
      ]);
    } catch (error) {
      this.logger.error(`Health check failed: ${error.message}`, error.stack);
      throw new ServiceUnavailableException('Health check failed');
    }
  }

  /**
   * Liveness probe for Kubernetes
   * Checks if the application is running and responsive
   * Does not check external dependencies
   */
  @Public()
  @Get('live')
  @HealthCheck()
  @ApiOperation({ summary: 'Liveness probe for container orchestration' })
  @ApiResponse({ status: 200, description: 'Application is live' })
  @ApiResponse({ status: 503, description: 'Application is not responsive' })
  async liveness(): Promise<HealthCheckResult> {
    try {
      return await this.health.check([
        // Basic system checks
        () => this.memory.checkHeap('memory_heap', { thresholdPercent: 95 }),
        () => this.memory.checkRSS('memory_rss', { thresholdPercent: 95 }),
      ]);
    } catch (error) {
      this.logger.error(`Liveness check failed: ${error.message}`, error.stack);
      throw new ServiceUnavailableException('Liveness check failed');
    }
  }

  /**
   * Readiness probe for Kubernetes
   * Checks if the application is ready to receive traffic
   * Includes checks for critical dependencies
   */
  @Public()
  @Get('ready')
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness probe for container orchestration' })
  @ApiResponse({ status: 200, description: 'Application is ready to receive traffic' })
  @ApiResponse({ status: 503, description: 'Application is not ready' })
  async readiness(): Promise<HealthCheckResult> {
    try {
      return await this.health.check([
        // Database is critical for readiness
        () => this.db.pingCheck('database'),

        // Storage is critical for file operations
        () => this.storage.checkConnection('storage_service'),

        // Check if Redis is available (if configured)
        async () => {
          if (this.configService.get('REDIS_URL')) {
            return this.redis.pingCheck('redis');
          }
          return { redis: { status: 'ok', message: 'Redis not configured' } };
        },

        // PubSub basic connection check
        () => this.pubsub.checkConnection('pubsub'),
      ]);
    } catch (error) {
      this.logger.error(`Readiness check failed: ${error.message}`, error.stack);
      throw new ServiceUnavailableException('Readiness check failed');
    }
  }

  /**
   * Database-specific health check
   * Useful for monitoring database connectivity separately
   */
  @Public()
  @Get('db')
  @HealthCheck()
  @ApiOperation({ summary: 'Database health check' })
  @ApiResponse({ status: 200, description: 'Database is connected' })
  @ApiResponse({ status: 503, description: 'Database is unavailable' })
  async dbHealth(): Promise<HealthCheckResult> {
    try {
      return await this.health.check([
        () => this.db.isHealthy('database'),
      ]);
    } catch (error) {
      this.logger.error(`Database health check failed: ${error.message}`, error.stack);
      throw new ServiceUnavailableException('Database health check failed');
    }
  }

  /**
   * AI Service-specific health check
   * Useful for monitoring AI service connectivity separately
   */
  @Public()
  @Get('ai')
  @HealthCheck()
  @ApiOperation({ summary: 'AI Service health check' })
  @ApiResponse({ status: 200, description: 'AI Service is connected' })
  @ApiResponse({ status: 503, description: 'AI Service is unavailable' })
  async aiHealth(): Promise<HealthCheckResult> {
    try {
      return await this.health.check([
        () => this.aiService.isHealthy('ai_service'),
      ]);
    } catch (error) {
      this.logger.error(`AI Service health check failed: ${error.message}`, error.stack);
      throw new ServiceUnavailableException('AI Service health check failed');
    }
  }
}
