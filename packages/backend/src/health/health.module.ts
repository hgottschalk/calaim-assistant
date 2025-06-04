import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HttpModule } from '@nestjs/axios';
import { HealthController } from './health.controller';
import { DatabaseModule } from '../database/database.module';
import { StorageHealthIndicator } from './indicators/storage.health';
import { RedisHealthIndicator } from './indicators/redis.health';
import { AiServiceHealthIndicator } from './indicators/ai-service.health';
import { PubSubHealthIndicator } from './indicators/pubsub.health';
import { ConfigModule } from '@nestjs/config';

/**
 * Health module provides endpoints and indicators for monitoring
 * application health status and dependencies
 */
@Module({
  imports: [
    // Terminus provides health check framework
    TerminusModule,
    // HTTP module for checking external services
    HttpModule.registerAsync({
      useFactory: () => ({
        timeout: 5000,
        maxRedirects: 3,
      }),
    }),
    // Import database module to access PrismaHealthIndicator
    DatabaseModule,
    // Import config module for service URLs
    ConfigModule,
  ],
  controllers: [HealthController],
  providers: [
    StorageHealthIndicator,
    RedisHealthIndicator,
    AiServiceHealthIndicator,
    PubSubHealthIndicator,
  ],
  exports: [
    StorageHealthIndicator,
    RedisHealthIndicator,
    AiServiceHealthIndicator,
    PubSubHealthIndicator,
  ],
})
export class HealthModule {}
