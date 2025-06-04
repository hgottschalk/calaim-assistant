import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import helmet from 'helmet';
import compression from 'compression';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  // Create the NestJS application with Fastify adapter for better performance
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { bufferLogs: true }
  );
  
  // Get configuration service
  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 8080);
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');
  const corsOrigins = configService.get<string>('CORS_ORIGINS', 'http://localhost:3000');
  
  // Use Pino logger
  app.useLogger(app.get(Logger));
  
  // Set global prefix for all routes
  app.setGlobalPrefix('api');
  
  // Enable API versioning
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });
  
  // Setup security middleware
  app.use(helmet());
  app.use(compression());
  
  // Configure CORS
  app.enableCors({
    origin: corsOrigins.split(','),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });
  
  // Set up global validation pipes
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );
  
  // Set up global exception filters
  app.useGlobalFilters(
    new AllExceptionsFilter(),
    new HttpExceptionFilter(),
  );
  
  // Set up Swagger documentation
  if (nodeEnv !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('CalAIM Assistant API')
      .setDescription('API documentation for the AI-Powered CalAIM Domain & Care Plan Assistant')
      .setVersion('1.0')
      .addBearerAuth()
      .addTag('auth', 'Authentication endpoints')
      .addTag('patients', 'Patient management')
      .addTag('referrals', 'Referral document management')
      .addTag('assessments', 'Assessment domains')
      .addTag('problems', 'Problem list management')
      .addTag('care-plans', 'Care plan generation')
      .addTag('health', 'Health check endpoints')
      .build();
    
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }
  
  // Start the server
  await app.listen(port, '0.0.0.0');
  console.log(`CalAIM Assistant API is running on: http://localhost:${port}/api`);
  console.log(`Environment: ${nodeEnv}`);
  
  // Graceful shutdown
  const signals = ['SIGTERM', 'SIGINT'];
  
  for (const signal of signals) {
    process.on(signal, async () => {
      console.log(`Received ${signal}, gracefully shutting down...`);
      await app.close();
      process.exit(0);
    });
  }
}

bootstrap().catch((err) => {
  console.error('Error starting CalAIM Assistant API:', err);
  process.exit(1);
});
