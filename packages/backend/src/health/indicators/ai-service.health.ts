import { Injectable, Logger } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom, timeout, catchError, of } from 'rxjs';
import { AxiosError } from 'axios';

/**
 * Health indicator for the AI/NLP microservice
 * Checks connectivity and basic operations on the AI service
 */
@Injectable()
export class AiServiceHealthIndicator extends HealthIndicator {
  private readonly logger = new Logger(AiServiceHealthIndicator.name);
  private readonly aiServiceUrl: string;
  private readonly DEFAULT_TIMEOUT_MS = 5000; // 5 seconds timeout for health checks

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    super();
    this.aiServiceUrl = this.configService.get<string>('AI_SERVICE_URL', '');
    
    if (!this.aiServiceUrl) {
      this.logger.warn('AI Service URL not configured, health checks will be skipped');
    } else {
      this.logger.log(`AI Service URL configured: ${this.aiServiceUrl}`);
    }
  }

  /**
   * Check basic connectivity to AI service
   * @param key The key which will be used for the result object
   * @param options Optional settings for the health check
   * @returns HealthIndicatorResult with AI service connectivity status
   */
  async checkConnection(
    key: string,
    options: { timeout?: number } = {},
  ): Promise<HealthIndicatorResult> {
    const timeoutMs = options.timeout || this.DEFAULT_TIMEOUT_MS;
    
    // If AI service is not configured, return success with a note
    if (!this.aiServiceUrl) {
      return this.getStatus(key, true, { message: 'AI Service not configured' });
    }
    
    try {
      // Use rxjs timeout operator to handle potential hanging connections
      const isConnected = await lastValueFrom(
        this.httpService.get(`${this.aiServiceUrl}/health`, {
          timeout: timeoutMs,
        }).pipe(
          timeout(timeoutMs),
          catchError((error: AxiosError) => {
            this.logger.error(
              `AI Service connection error: ${error.message}`,
              error.stack,
            );
            return of({ status: false, error });
          })
        )
      );

      if (isConnected.status === false) {
        throw new Error(`AI Service connection failed: ${isConnected.error?.message || 'Unknown error'}`);
      }

      return this.getStatus(key, true, { 
        url: this.aiServiceUrl,
        responseTime: `<${timeoutMs}ms` 
      });
    } catch (error) {
      this.logger.error(
        `AI Service health check failed: ${error.message}`,
        error.stack,
      );
      
      const status = this.getStatus(key, false, {
        message: `AI Service connection failed: ${error.message}`,
        url: this.aiServiceUrl,
      });
      
      throw new HealthCheckError(
        `${key} is not available`,
        status,
      );
    }
  }

  /**
   * Perform a simple ping check on AI service
   * @param key The key which will be used for the result object
   * @returns HealthIndicatorResult with ping status
   */
  async ping(key: string): Promise<HealthIndicatorResult> {
    // If AI service is not configured, return success with a note
    if (!this.aiServiceUrl) {
      return this.getStatus(key, true, { message: 'AI Service not configured' });
    }
    
    try {
      const startTime = Date.now();
      const response = await lastValueFrom(
        this.httpService.get(`${this.aiServiceUrl}/health`).pipe(
          timeout(this.DEFAULT_TIMEOUT_MS),
          catchError((error: AxiosError) => {
            throw new Error(`AI Service ping failed: ${error.message}`);
          })
        )
      );
      
      const responseTime = Date.now() - startTime;
      
      return this.getStatus(key, true, { 
        responseTime: `${responseTime}ms`,
        url: this.aiServiceUrl,
        version: response.data?.version || 'unknown',
      });
    } catch (error) {
      this.logger.error(
        `AI Service ping check failed: ${error.message}`,
        error.stack,
      );
      
      const status = this.getStatus(key, false, {
        message: `AI Service ping failed: ${error.message}`,
        url: this.aiServiceUrl,
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
   * @returns HealthIndicatorResult with overall AI service health
   */
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    // If AI service is not configured, return success with a note
    if (!this.aiServiceUrl) {
      return this.getStatus(key, true, { message: 'AI Service not configured' });
    }
    
    try {
      // First check basic connectivity with ping
      const response = await lastValueFrom(
        this.httpService.get(`${this.aiServiceUrl}/health`).pipe(
          timeout(this.DEFAULT_TIMEOUT_MS),
          catchError((error: AxiosError) => {
            throw new Error(`AI Service health check failed: ${error.message}`);
          })
        )
      );
      
      // Check if the health endpoint returns expected status
      if (!response.data || response.data.status !== 'ok') {
        throw new Error('AI Service reported unhealthy status');
      }
      
      // Check if models are loaded (if that info is available)
      const modelsLoaded = response.data.models_loaded || true;
      if (!modelsLoaded) {
        throw new Error('AI Service models not loaded');
      }
      
      return this.getStatus(key, true, {
        url: this.aiServiceUrl,
        version: response.data.version || 'unknown',
        models: response.data.models || 'unknown',
      });
    } catch (error) {
      this.logger.error(
        `AI Service health check failed: ${error.message}`,
        error.stack,
      );
      
      const status = this.getStatus(key, false, {
        message: `AI Service health check failed: ${error.message}`,
        url: this.aiServiceUrl,
      });
      
      throw new HealthCheckError(
        `${key} is not healthy`,
        status,
      );
    }
  }

  /**
   * Check if the AI service can process documents
   * @param key The key which will be used for the result object
   * @returns HealthIndicatorResult with document processing capability status
   */
  async checkProcessingCapability(key: string): Promise<HealthIndicatorResult> {
    // If AI service is not configured, return success with a note
    if (!this.aiServiceUrl) {
      return this.getStatus(key, true, { message: 'AI Service not configured' });
    }
    
    try {
      // Check the readiness endpoint which should indicate if the service can process documents
      const response = await lastValueFrom(
        this.httpService.get(`${this.aiServiceUrl}/health/ready`).pipe(
          timeout(this.DEFAULT_TIMEOUT_MS),
          catchError((error: AxiosError) => {
            throw new Error(`AI Service readiness check failed: ${error.message}`);
          })
        )
      );
      
      // Check if the readiness endpoint returns expected status
      if (!response.data || response.data.status !== 'ready') {
        throw new Error('AI Service not ready to process documents');
      }
      
      return this.getStatus(key, true, {
        url: this.aiServiceUrl,
        canProcess: true,
        dependencies: response.data.dependencies || 'unknown',
      });
    } catch (error) {
      this.logger.error(
        `AI Service processing capability check failed: ${error.message}`,
        error.stack,
      );
      
      const status = this.getStatus(key, false, {
        message: `AI Service not ready to process documents: ${error.message}`,
        url: this.aiServiceUrl,
        canProcess: false,
      });
      
      throw new HealthCheckError(
        `${key} processing capability check failed`,
        status,
      );
    }
  }
}
