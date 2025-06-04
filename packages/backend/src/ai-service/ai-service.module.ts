import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { AiServiceService } from './ai-service.service';

/**
 * AI Service module that provides communication with the AI/NLP microservice
 * Handles document processing, entity extraction, and domain mapping
 */
@Global()
@Module({
  imports: [
    // Import ConfigModule to access environment variables
    ConfigModule,
    
    // Import HttpModule for API communication with AI service
    HttpModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        baseURL: configService.get<string>('AI_SERVICE_URL'),
        timeout: configService.get<number>('AI_SERVICE_TIMEOUT', 30000),
        maxRedirects: 5,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    }),
  ],
  providers: [
    // Main service for AI operations
    AiServiceService,
    
    // Provider for AI service configuration
    {
      provide: 'AI_SERVICE_CONFIG',
      useFactory: (configService: ConfigService) => {
        return {
          baseUrl: configService.get<string>('AI_SERVICE_URL', 'http://ai-service:8000'),
          timeout: configService.get<number>('AI_SERVICE_TIMEOUT', 30000),
          enableMock: configService.get<boolean>('ENABLE_MOCK_AI', false),
          maxRetries: configService.get<number>('AI_SERVICE_MAX_RETRIES', 3),
          confidenceThreshold: configService.get<number>('AI_CONFIDENCE_THRESHOLD', 0.6),
        };
      },
      inject: [ConfigService],
    },
  ],
  exports: [
    // Export AiServiceService for use in other modules
    AiServiceService,
    'AI_SERVICE_CONFIG',
  ],
})
export class AiServiceModule {}
