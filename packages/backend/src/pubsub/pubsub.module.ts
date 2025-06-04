import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PubSubService } from './pubsub.service';
import { PubSub } from '@google-cloud/pubsub';

/**
 * PubSub module that provides messaging services
 * Supports both Google Cloud Pub/Sub and local emulator
 */
@Global()
@Module({
  imports: [
    // Import ConfigModule to access environment variables
    ConfigModule,
  ],
  providers: [
    // Main service for PubSub operations
    PubSubService,
    
    // Factory provider for Google Cloud PubSub client
    {
      provide: 'PUBSUB_CLIENT',
      useFactory: (configService: ConfigService) => {
        const projectId = configService.get<string>('PUBSUB_PROJECT_ID');
        const emulatorHost = configService.get<string>('PUBSUB_EMULATOR_HOST');
        
        // Initialize PubSub client with emulator support
        return new PubSub({
          projectId,
          // No need to set emulator host explicitly as the env var is automatically detected
        });
      },
      inject: [ConfigService],
    },
    
    // Provider for PubSub configuration
    {
      provide: 'PUBSUB_CONFIG',
      useFactory: (configService: ConfigService) => {
        return {
          projectId: configService.get<string>('PUBSUB_PROJECT_ID', ''),
          isEmulator: !!configService.get<string>('PUBSUB_EMULATOR_HOST'),
          defaultTopic: configService.get<string>('PUBSUB_TOPIC', 'doc.jobs'),
          defaultSubscription: configService.get<string>('PUBSUB_SUBSCRIPTION', 'ai-service-sub'),
        };
      },
      inject: [ConfigService],
    },
  ],
  exports: [
    // Export PubSubService for use in other modules
    PubSubService,
    'PUBSUB_CLIENT',
    'PUBSUB_CONFIG',
  ],
})
export class PubSubModule {}
