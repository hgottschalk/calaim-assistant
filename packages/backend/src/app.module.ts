import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { TerminusModule } from '@nestjs/terminus';
import { HttpModule } from '@nestjs/axios';

// Custom modules
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { PatientsModule } from './patients/patients.module';
import { ReferralsModule } from './referrals/referrals.module';
import { AssessmentsModule } from './assessments/assessments.module';
import { ProblemsModule } from './problems/problems.module';
import { CarePlansModule } from './care-plans/care-plans.module';
import { HealthModule } from './health/health.module';
import { StorageModule } from './storage/storage.module';
import { PubSubModule } from './pubsub/pubsub.module';
import { AiServiceModule } from './ai-service/ai-service.module';

// Filters, interceptors and guards
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TimeoutInterceptor } from './common/interceptors/timeout.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';

// Configuration validation
import * as Joi from 'joi';

@Module({
  imports: [
    // Configuration module with validation
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        NODE_ENV: Joi.string()
          .valid('development', 'production', 'test')
          .default('development'),
        PORT: Joi.number().default(8080),
        DATABASE_URL: Joi.string().required(),
        REDIS_URL: Joi.string().required(),
        JWT_SECRET: Joi.string().required(),
        JWT_EXPIRES_IN: Joi.string().default('1d'),
        STORAGE_ENDPOINT: Joi.string().required(),
        STORAGE_ACCESS_KEY: Joi.string().required(),
        STORAGE_SECRET_KEY: Joi.string().required(),
        STORAGE_BUCKET_REFERRALS: Joi.string().required(),
        STORAGE_BUCKET_PDFS: Joi.string().required(),
        CORS_ORIGINS: Joi.string().default('http://localhost:3000'),
        AI_SERVICE_URL: Joi.string().required(),
        PUBSUB_PROJECT_ID: Joi.string().required(),
        PUBSUB_EMULATOR_HOST: Joi.string().optional(),
      }),
      envFilePath: ['.env.local', '.env'],
    }),

    // Structured logging with Pino
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const nodeEnv = configService.get('NODE_ENV');
        return {
          pinoHttp: {
            level: nodeEnv !== 'production' ? 'debug' : 'info',
            transport: nodeEnv !== 'production'
              ? { target: 'pino-pretty' }
              : undefined,
            redact: ['req.headers.authorization', 'req.headers.cookie'],
            formatters: {
              level: (label) => {
                return { level: label };
              },
            },
            customProps: () => ({
              context: 'HTTP',
            }),
          },
        };
      },
    }),

    // Database connection with Prisma
    DatabaseModule,

    // Authentication module
    AuthModule,

    // Health checks
    HealthModule,
    TerminusModule,
    HttpModule,

    // Storage (Cloud Storage / MinIO)
    StorageModule,

    // Pub/Sub for async messaging
    PubSubModule,

    // AI Service integration
    AiServiceModule,

    // Feature modules
    UsersModule,
    PatientsModule,
    ReferralsModule,
    AssessmentsModule,
    ProblemsModule,
    CarePlansModule,
  ],
  controllers: [],
  providers: [
    // Global exception filters
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    
    // Global interceptors
    {
      provide: APP_INTERCEPTOR,
      useClass: TimeoutInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    
    // Global guards
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
