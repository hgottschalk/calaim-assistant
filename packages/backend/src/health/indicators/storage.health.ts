import { Injectable, Logger } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { Storage } from '@google-cloud/storage';
import { lastValueFrom, timeout, catchError, of } from 'rxjs';
import { from } from 'rxjs';
import * as Minio from 'minio';

/**
 * Health indicator for storage services (GCS in production, MinIO in development)
 * Checks connectivity and basic operations on storage buckets
 */
@Injectable()
export class StorageHealthIndicator extends HealthIndicator {
  private readonly logger = new Logger(StorageHealthIndicator.name);
  private readonly storage: Storage | null = null;
  private readonly minioClient: Minio.Client | null = null;
  private readonly isGcs: boolean;
  private readonly referralBucket: string;
  private readonly pdfBucket: string;
  private readonly DEFAULT_TIMEOUT_MS = 5000; // 5 seconds timeout for health checks

  constructor(private readonly configService: ConfigService) {
    super();
    
    // Determine storage provider based on environment
    const storageEndpoint = this.configService.get<string>('STORAGE_ENDPOINT', '');
    this.isGcs = storageEndpoint.includes('googleapis.com') || 
                !this.configService.get<string>('STORAGE_ENDPOINT');
    
    // Get bucket names from config
    this.referralBucket = this.configService.get<string>('STORAGE_BUCKET_REFERRALS', 'referrals');
    this.pdfBucket = this.configService.get<string>('STORAGE_BUCKET_PDFS', 'pdfs');
    
    // Initialize appropriate client based on environment
    if (this.isGcs) {
      this.storage = new Storage();
      this.logger.log('Initialized Google Cloud Storage client for health checks');
    } else {
      // Initialize MinIO client for local development
      this.minioClient = new Minio.Client({
        endPoint: storageEndpoint.replace(/^https?:\/\//, ''),
        port: parseInt(new URL(storageEndpoint).port || '9000', 10),
        useSSL: storageEndpoint.startsWith('https'),
        accessKey: this.configService.get<string>('STORAGE_ACCESS_KEY', 'minio_admin'),
        secretKey: this.configService.get<string>('STORAGE_SECRET_KEY', 'minio_password'),
      });
      this.logger.log(`Initialized MinIO client for health checks: ${storageEndpoint}`);
    }
  }

  /**
   * Check basic connectivity to storage service
   * @param key The key which will be used for the result object
   * @param options Optional settings for the health check
   * @returns HealthIndicatorResult with storage connectivity status
   */
  async checkConnection(
    key: string,
    options: { timeout?: number } = {},
  ): Promise<HealthIndicatorResult> {
    const timeoutMs = options.timeout || this.DEFAULT_TIMEOUT_MS;
    
    try {
      // Use rxjs timeout operator to handle potential hanging connections
      const isConnected = await lastValueFrom(
        from(this.pingStorage()).pipe(
          timeout(timeoutMs),
          catchError(error => {
            this.logger.error(`Storage connection error: ${error.message}`, error.stack);
            return of(false);
          })
        )
      );

      if (!isConnected) {
        throw new Error('Storage connection check failed');
      }

      return this.getStatus(key, true, { 
        provider: this.isGcs ? 'Google Cloud Storage' : 'MinIO',
        responseTime: `<${timeoutMs}ms` 
      });
    } catch (error) {
      this.logger.error(
        `Storage health check failed: ${error.message}`,
        error.stack,
      );
      
      const status = this.getStatus(key, false, {
        message: `Storage connection failed: ${error.message}`,
        provider: this.isGcs ? 'Google Cloud Storage' : 'MinIO',
      });
      
      throw new HealthCheckError(
        `${key} is not available`,
        status,
      );
    }
  }

  /**
   * Check if buckets exist and are accessible
   * @param key The key which will be used for the result object
   * @returns HealthIndicatorResult with bucket access status
   */
  async checkBuckets(key: string): Promise<HealthIndicatorResult> {
    try {
      const bucketsExist = await this.verifyBuckets();
      
      if (!bucketsExist) {
        throw new Error('Required buckets not found or not accessible');
      }
      
      return this.getStatus(key, true, {
        provider: this.isGcs ? 'Google Cloud Storage' : 'MinIO',
        buckets: `${this.referralBucket}, ${this.pdfBucket}`,
      });
    } catch (error) {
      this.logger.error(
        `Bucket check failed: ${error.message}`,
        error.stack,
      );
      
      const status = this.getStatus(key, false, {
        message: `Bucket check failed: ${error.message}`,
        provider: this.isGcs ? 'Google Cloud Storage' : 'MinIO',
      });
      
      throw new HealthCheckError(
        `${key} buckets not accessible`,
        status,
      );
    }
  }

  /**
   * Full health check that includes connectivity and bucket verification
   * @param key The key which will be used for the result object
   * @returns HealthIndicatorResult with overall storage health
   */
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      // First check basic connectivity
      await this.pingStorage();
      
      // Then verify buckets
      const bucketsExist = await this.verifyBuckets();
      
      if (!bucketsExist) {
        throw new Error('Required buckets not found or not accessible');
      }
      
      // Try a basic operation - list files (limited to 1)
      await this.testListOperation();
      
      return this.getStatus(key, true, {
        provider: this.isGcs ? 'Google Cloud Storage' : 'MinIO',
        buckets: `${this.referralBucket}, ${this.pdfBucket}`,
      });
    } catch (error) {
      this.logger.error(
        `Storage health check failed: ${error.message}`,
        error.stack,
      );
      
      const status = this.getStatus(key, false, {
        message: `Storage health check failed: ${error.message}`,
        provider: this.isGcs ? 'Google Cloud Storage' : 'MinIO',
      });
      
      throw new HealthCheckError(
        `${key} is not healthy`,
        status,
      );
    }
  }

  /**
   * Basic ping test to check if storage service is responsive
   * @returns Promise<boolean> indicating if storage is responsive
   */
  private async pingStorage(): Promise<boolean> {
    try {
      if (this.isGcs && this.storage) {
        // For GCS, just list buckets with a limit of 1
        await this.storage.getBuckets({ maxResults: 1 });
      } else if (this.minioClient) {
        // For MinIO, list buckets
        await this.minioClient.listBuckets();
      } else {
        throw new Error('No storage client configured');
      }
      return true;
    } catch (error) {
      this.logger.error(`Storage ping failed: ${error.message}`, error.stack);
      return false;
    }
  }

  /**
   * Verify that required buckets exist and are accessible
   * @returns Promise<boolean> indicating if required buckets are accessible
   */
  private async verifyBuckets(): Promise<boolean> {
    try {
      if (this.isGcs && this.storage) {
        // Check both required buckets in GCS
        const [referralExists] = await this.storage.bucket(this.referralBucket).exists();
        const [pdfExists] = await this.storage.bucket(this.pdfBucket).exists();
        
        return referralExists && pdfExists;
      } else if (this.minioClient) {
        // Check both required buckets in MinIO
        const referralExists = await this.minioClient.bucketExists(this.referralBucket);
        const pdfExists = await this.minioClient.bucketExists(this.pdfBucket);
        
        return referralExists && pdfExists;
      }
      
      return false;
    } catch (error) {
      this.logger.error(`Bucket verification failed: ${error.message}`, error.stack);
      return false;
    }
  }

  /**
   * Test a basic list operation on the referral bucket
   * @returns Promise<void>
   */
  private async testListOperation(): Promise<void> {
    try {
      if (this.isGcs && this.storage) {
        // List files in GCS bucket (limit to 1)
        await this.storage.bucket(this.referralBucket).getFiles({ maxResults: 1 });
      } else if (this.minioClient) {
        // List objects in MinIO bucket (limit to 1)
        const objectStream = this.minioClient.listObjects(this.referralBucket, '', true);
        
        // Just consume one object to verify the operation works
        await new Promise<void>((resolve, reject) => {
          let objectFound = false;
          
          objectStream.on('data', () => {
            objectFound = true;
            objectStream.destroy(); // Stop after first object
            resolve();
          });
          
          objectStream.on('error', (err) => {
            reject(err);
          });
          
          objectStream.on('end', () => {
            // Empty bucket is still valid
            if (!objectFound) {
              resolve();
            }
          });
          
          // Set a timeout in case the stream hangs
          setTimeout(() => {
            objectStream.destroy();
            resolve(); // Consider it successful if it didn't error out
          }, 3000);
        });
      } else {
        throw new Error('No storage client configured');
      }
    } catch (error) {
      this.logger.error(`List operation failed: ${error.message}`, error.stack);
      throw error;
    }
  }
}
