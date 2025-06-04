import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';
import { StorageController } from './storage.controller';
import { Storage } from '@google-cloud/storage';
import * as Minio from 'minio';

/**
 * Storage module that provides file storage services
 * Supports both Google Cloud Storage (production) and MinIO (development)
 */
@Global()
@Module({
  imports: [
    // Import ConfigModule to access environment variables
    ConfigModule,
  ],
  controllers: [StorageController],
  providers: [
    // Main service for storage operations
    StorageService,
    
    // Factory provider for Google Cloud Storage client
    {
      provide: 'STORAGE_CLIENT',
      useFactory: (configService: ConfigService) => {
        const storageEndpoint = configService.get<string>('STORAGE_ENDPOINT', '');
        const isGcs = storageEndpoint.includes('googleapis.com') || 
                     !configService.get<string>('STORAGE_ENDPOINT');
        
        if (isGcs) {
          // Initialize Google Cloud Storage client
          return new Storage();
        } else {
          // Initialize MinIO client for local development
          return new Minio.Client({
            endPoint: storageEndpoint.replace(/^https?:\/\//, ''),
            port: parseInt(new URL(storageEndpoint).port || '9000', 10),
            useSSL: storageEndpoint.startsWith('https'),
            accessKey: configService.get<string>('STORAGE_ACCESS_KEY', 'minio_admin'),
            secretKey: configService.get<string>('STORAGE_SECRET_KEY', 'minio_password'),
          });
        }
      },
      inject: [ConfigService],
    },
    
    // Provider for storage configuration
    {
      provide: 'STORAGE_CONFIG',
      useFactory: (configService: ConfigService) => {
        return {
          referralBucket: configService.get<string>('STORAGE_BUCKET_REFERRALS', 'referrals'),
          pdfBucket: configService.get<string>('STORAGE_BUCKET_PDFS', 'pdfs'),
          logsBucket: configService.get<string>('STORAGE_BUCKET_LOGS', 'logs'),
          isGcs: configService.get<string>('STORAGE_ENDPOINT', '').includes('googleapis.com') || 
                !configService.get<string>('STORAGE_ENDPOINT'),
          endpoint: configService.get<string>('STORAGE_ENDPOINT', ''),
          maxFileSize: parseInt(configService.get<string>('STORAGE_MAX_FILE_SIZE', '25000000')), // 25MB default
          allowedMimeTypes: configService.get<string>('STORAGE_ALLOWED_MIME_TYPES', 
            'application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,image/jpeg,image/png')
            .split(','),
          publicUrl: configService.get<string>('STORAGE_PUBLIC_URL', ''),
        };
      },
      inject: [ConfigService],
    },
  ],
  exports: [
    // Export StorageService for use in other modules
    StorageService,
    'STORAGE_CLIENT',
    'STORAGE_CONFIG',
  ],
})
export class StorageModule {}
