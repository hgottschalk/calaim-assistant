import { Injectable, Logger } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';
import { lastValueFrom, timeout, catchError, of } from 'rxjs';
import { from } from 'rxjs';

/**
 * Health indicator for Redis service
 * Checks connectivity and basic operations on Redis
 */
@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  private readonly logger = new Logger(RedisHealthIndicator.name);
  private redisClient: RedisClientType | null = null;
  private readonly redisUrl: string;
  private isConnected = false;
  private readonly DEFAULT_TIMEOUT_MS = 3000; // 3 seconds timeout for health checks
  private readonly HEALTH_CHECK_KEY = 'calaim:health:check';

  constructor(private readonly configService: ConfigService) {
    super();
    
    this.redisUrl = this.configService.get<string>('REDIS_URL', '');
    
    // Don't create a client if no URL is provided
    if (!this.redisUrl) {
      this.logger.warn('Redis URL not configured, health checks will be skipped');
      return;
    }
    
    // Initialize Redis client
    this.initializeClient();
  }

  /**
   * Initialize the Redis client with proper error handling
   */
  private async initializeClient(): Promise<void> {
    try {
      this.redisClient = createClient({
        url: this.redisUrl,
        socket: {
          reconnectStrategy: (retries) => {
            // Exponential backoff with max 3 second delay
            const delay = Math.min(Math.pow(2, retries) * 100, 3000);
            return delay;
          },
        },
      });

      // Set up event handlers
      this.redisClient.on('error', (err) => {
        this.isConnected = false;
        this.logger.error(`Redis client error: ${err.message}`, err.stack);
      });

      this.redisClient.on('connect', () => {
        this.isConnected = true;
        this.logger.log('Redis client connected');
      });

      this.redisClient.on('reconnecting', () => {
        this.logger.log('Redis client reconnecting...');
      });

      this.redisClient.on('end', () => {
        this.isConnected = false;
        this.logger.log('Redis client disconnected');
      });

      // Connect to Redis
      await this.redisClient.connect();
    } catch (error) {
      this.isConnected = false;
      this.logger.error(`Failed to initialize Redis client: ${error.message}`, error.stack);
    }
  }

  /**
   * Check basic connectivity to Redis
   * @param key The key which will be used for the result object
   * @param options Optional settings for the health check
   * @returns HealthIndicatorResult with Redis connectivity status
   */
  async checkConnection(
    key: string,
    options: { timeout?: number } = {},
  ): Promise<HealthIndicatorResult> {
    const timeoutMs = options.timeout || this.DEFAULT_TIMEOUT_MS;
    
    // If Redis is not configured, return success with a note
    if (!this.redisUrl) {
      return this.getStatus(key, true, { message: 'Redis not configured' });
    }
    
    try {
      // Use rxjs timeout operator to handle potential hanging connections
      const isConnected = await lastValueFrom(
        from(this.pingRedis()).pipe(
          timeout(timeoutMs),
          catchError(error => {
            this.logger.error(`Redis connection error: ${error.message}`, error.stack);
            return of(false);
          })
        )
      );

      if (!isConnected) {
        throw new Error('Redis connection check failed');
      }

      return this.getStatus(key, true, { 
        url: this.maskRedisUrl(this.redisUrl),
        responseTime: `<${timeoutMs}ms` 
      });
    } catch (error) {
      this.logger.error(
        `Redis health check failed: ${error.message}`,
        error.stack,
      );
      
      const status = this.getStatus(key, false, {
        message: `Redis connection failed: ${error.message}`,
        url: this.maskRedisUrl(this.redisUrl),
      });
      
      throw new HealthCheckError(
        `${key} is not available`,
        status,
      );
    }
  }

  /**
   * Perform a simple ping check on Redis
   * @param key The key which will be used for the result object
   * @returns HealthIndicatorResult with ping status
   */
  async pingCheck(key: string): Promise<HealthIndicatorResult> {
    // If Redis is not configured, return success with a note
    if (!this.redisUrl) {
      return this.getStatus(key, true, { message: 'Redis not configured' });
    }
    
    try {
      const startTime = Date.now();
      const pingResult = await this.pingRedis();
      const responseTime = Date.now() - startTime;
      
      if (!pingResult) {
        throw new Error('Redis PING command failed');
      }
      
      return this.getStatus(key, true, { 
        responseTime: `${responseTime}ms`,
        url: this.maskRedisUrl(this.redisUrl),
      });
    } catch (error) {
      this.logger.error(
        `Redis ping check failed: ${error.message}`,
        error.stack,
      );
      
      const status = this.getStatus(key, false, {
        message: `Redis ping failed: ${error.message}`,
        url: this.maskRedisUrl(this.redisUrl),
      });
      
      throw new HealthCheckError(
        `${key} ping failed`,
        status,
      );
    }
  }

  /**
   * Full health check that includes connectivity and basic operations
   * @param key The key which will be used for the result object
   * @returns HealthIndicatorResult with overall Redis health
   */
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    // If Redis is not configured, return success with a note
    if (!this.redisUrl) {
      return this.getStatus(key, true, { message: 'Redis not configured' });
    }
    
    try {
      // First check basic connectivity with ping
      const pingResult = await this.pingRedis();
      
      if (!pingResult) {
        throw new Error('Redis PING command failed');
      }
      
      // Then test a basic set/get operation
      await this.testSetGetOperation();
      
      return this.getStatus(key, true, {
        url: this.maskRedisUrl(this.redisUrl),
        operations: 'PING, SET, GET',
      });
    } catch (error) {
      this.logger.error(
        `Redis health check failed: ${error.message}`,
        error.stack,
      );
      
      const status = this.getStatus(key, false, {
        message: `Redis health check failed: ${error.message}`,
        url: this.maskRedisUrl(this.redisUrl),
      });
      
      throw new HealthCheckError(
        `${key} is not healthy`,
        status,
      );
    }
  }

  /**
   * Attempt to reconnect to Redis if the connection was lost
   * @param key The key which will be used for the result object
   * @returns HealthIndicatorResult with reconnection status
   */
  async reconnect(key: string): Promise<HealthIndicatorResult> {
    // If Redis is not configured, return success with a note
    if (!this.redisUrl) {
      return this.getStatus(key, true, { message: 'Redis not configured' });
    }
    
    try {
      // Close existing connection if it exists
      if (this.redisClient && this.redisClient.isOpen) {
        await this.redisClient.quit();
      }
      
      // Reinitialize the client
      await this.initializeClient();
      
      // Verify connection with ping
      const pingResult = await this.pingRedis();
      
      if (!pingResult) {
        throw new Error('Redis reconnection failed');
      }
      
      return this.getStatus(key, true, { 
        reconnected: true,
        url: this.maskRedisUrl(this.redisUrl),
      });
    } catch (error) {
      this.logger.error(
        `Redis reconnection failed: ${error.message}`,
        error.stack,
      );
      
      const status = this.getStatus(key, false, {
        message: `Redis reconnection failed: ${error.message}`,
        url: this.maskRedisUrl(this.redisUrl),
      });
      
      throw new HealthCheckError(
        `${key} reconnection failed`,
        status,
      );
    }
  }

  /**
   * Basic ping test to check if Redis is responsive
   * @returns Promise<boolean> indicating if Redis is responsive
   */
  private async pingRedis(): Promise<boolean> {
    try {
      if (!this.redisClient || !this.redisClient.isOpen) {
        await this.initializeClient();
      }
      
      if (!this.redisClient) {
        return false;
      }
      
      const pong = await this.redisClient.ping();
      return pong === 'PONG';
    } catch (error) {
      this.logger.error(`Redis ping failed: ${error.message}`, error.stack);
      return false;
    }
  }

  /**
   * Test basic SET/GET operations on Redis
   * @returns Promise<void>
   */
  private async testSetGetOperation(): Promise<void> {
    try {
      if (!this.redisClient || !this.redisClient.isOpen) {
        throw new Error('Redis client not connected');
      }
      
      const testValue = `health-check-${Date.now()}`;
      
      // Set a test value with 10 second expiry
      await this.redisClient.set(this.HEALTH_CHECK_KEY, testValue, {
        EX: 10, // 10 second expiry
      });
      
      // Get the value back and verify it matches
      const retrievedValue = await this.redisClient.get(this.HEALTH_CHECK_KEY);
      
      if (retrievedValue !== testValue) {
        throw new Error(`SET/GET operation failed: expected "${testValue}" but got "${retrievedValue}"`);
      }
      
      // Clean up the test key
      await this.redisClient.del(this.HEALTH_CHECK_KEY);
    } catch (error) {
      this.logger.error(`Redis SET/GET operation failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Mask sensitive parts of Redis URL for logging
   * @param url The Redis URL to mask
   * @returns Masked Redis URL
   */
  private maskRedisUrl(url: string): string {
    try {
      // Don't process empty URLs
      if (!url) {
        return 'not configured';
      }
      
      // Create a URL object
      const parsedUrl = new URL(url);
      
      // Mask password if present
      if (parsedUrl.password) {
        parsedUrl.password = '***';
      }
      
      return parsedUrl.toString();
    } catch (error) {
      // If URL parsing fails, return a generic masked string
      return url.replace(/\/\/([^:]+):([^@]+)@/, '//\\1:***@');
    }
  }

  /**
   * Clean up resources when service is destroyed
   */
  async onModuleDestroy(): Promise<void> {
    if (this.redisClient && this.redisClient.isOpen) {
      try {
        await this.redisClient.quit();
        this.logger.log('Redis client disconnected gracefully');
      } catch (error) {
        this.logger.error(`Error disconnecting Redis client: ${error.message}`, error.stack);
      }
    }
  }
}
