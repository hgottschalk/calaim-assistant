import { Injectable, Logger } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { PubSub, Topic, Subscription } from '@google-cloud/pubsub';
import { lastValueFrom, timeout, catchError, of } from 'rxjs';
import { from } from 'rxjs';

/**
 * Health indicator for Google Cloud Pub/Sub service
 * Checks connectivity and verifies topics and subscriptions
 * Works with both GCP Pub/Sub and local emulator
 */
@Injectable()
export class PubSubHealthIndicator extends HealthIndicator {
  private readonly logger = new Logger(PubSubHealthIndicator.name);
  private readonly pubSubClient: PubSub;
  private readonly projectId: string;
  private readonly isEmulator: boolean;
  private readonly topicName: string = 'doc.jobs';
  private readonly subscriptionName: string = 'ai-service-sub';
  private readonly DEFAULT_TIMEOUT_MS = 5000; // 5 seconds timeout for health checks

  constructor(private readonly configService: ConfigService) {
    super();
    
    this.projectId = this.configService.get<string>('PUBSUB_PROJECT_ID', '');
    const emulatorHost = this.configService.get<string>('PUBSUB_EMULATOR_HOST');
    this.isEmulator = !!emulatorHost;
    
    // Override default topic and subscription names if provided in config
    const configTopicName = this.configService.get<string>('PUBSUB_TOPIC');
    const configSubscriptionName = this.configService.get<string>('PUBSUB_SUBSCRIPTION');
    
    if (configTopicName) {
      this.topicName = configTopicName;
    }
    
    if (configSubscriptionName) {
      this.subscriptionName = configSubscriptionName;
    }
    
    // Initialize Pub/Sub client
    this.pubSubClient = new PubSub({
      projectId: this.projectId,
    });
    
    // Log initialization
    if (this.isEmulator) {
      this.logger.log(`Initialized Pub/Sub client with emulator at ${emulatorHost}`);
    } else {
      this.logger.log(`Initialized Pub/Sub client for project ${this.projectId}`);
    }
  }

  /**
   * Check basic connectivity to Pub/Sub
   * @param key The key which will be used for the result object
   * @param options Optional settings for the health check
   * @returns HealthIndicatorResult with Pub/Sub connectivity status
   */
  async checkConnection(
    key: string,
    options: { timeout?: number } = {},
  ): Promise<HealthIndicatorResult> {
    const timeoutMs = options.timeout || this.DEFAULT_TIMEOUT_MS;
    
    try {
      // Use rxjs timeout operator to handle potential hanging connections
      const isConnected = await lastValueFrom(
        from(this.pingPubSub()).pipe(
          timeout(timeoutMs),
          catchError(error => {
            this.logger.error(`Pub/Sub connection error: ${error.message}`, error.stack);
            return of(false);
          })
        )
      );

      if (!isConnected) {
        throw new Error('Pub/Sub connection check failed');
      }

      return this.getStatus(key, true, { 
        projectId: this.projectId,
        isEmulator: this.isEmulator,
        responseTime: `<${timeoutMs}ms` 
      });
    } catch (error) {
      this.logger.error(
        `Pub/Sub health check failed: ${error.message}`,
        error.stack,
      );
      
      const status = this.getStatus(key, false, {
        message: `Pub/Sub connection failed: ${error.message}`,
        projectId: this.projectId,
        isEmulator: this.isEmulator,
      });
      
      throw new HealthCheckError(
        `${key} is not available`,
        status,
      );
    }
  }

  /**
   * Verify that required topics and subscriptions exist
   * @param key The key which will be used for the result object
   * @returns HealthIndicatorResult with topic/subscription verification status
   */
  async checkTopicsAndSubscriptions(key: string): Promise<HealthIndicatorResult> {
    try {
      // Check if the topic exists
      const topicExists = await this.verifyTopic(this.topicName);
      
      if (!topicExists) {
        throw new Error(`Topic '${this.topicName}' does not exist`);
      }
      
      // Check if the subscription exists
      const subscriptionExists = await this.verifySubscription(this.subscriptionName, this.topicName);
      
      if (!subscriptionExists) {
        throw new Error(`Subscription '${this.subscriptionName}' does not exist`);
      }
      
      return this.getStatus(key, true, {
        projectId: this.projectId,
        isEmulator: this.isEmulator,
        topic: this.topicName,
        subscription: this.subscriptionName,
      });
    } catch (error) {
      this.logger.error(
        `Pub/Sub topics/subscriptions check failed: ${error.message}`,
        error.stack,
      );
      
      const status = this.getStatus(key, false, {
        message: `Pub/Sub topics/subscriptions check failed: ${error.message}`,
        projectId: this.projectId,
        isEmulator: this.isEmulator,
      });
      
      throw new HealthCheckError(
        `${key} topics/subscriptions check failed`,
        status,
      );
    }
  }

  /**
   * Full health check that includes connectivity and topic/subscription verification
   * @param key The key which will be used for the result object
   * @returns HealthIndicatorResult with overall Pub/Sub health
   */
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      // First check basic connectivity
      const isConnected = await this.pingPubSub();
      
      if (!isConnected) {
        throw new Error('Pub/Sub connection check failed');
      }
      
      // Then verify topics and subscriptions
      const topicExists = await this.verifyTopic(this.topicName);
      const subscriptionExists = await this.verifySubscription(this.subscriptionName, this.topicName);
      
      if (!topicExists) {
        throw new Error(`Topic '${this.topicName}' does not exist`);
      }
      
      if (!subscriptionExists) {
        throw new Error(`Subscription '${this.subscriptionName}' does not exist`);
      }
      
      return this.getStatus(key, true, {
        projectId: this.projectId,
        isEmulator: this.isEmulator,
        topic: this.topicName,
        subscription: this.subscriptionName,
      });
    } catch (error) {
      this.logger.error(
        `Pub/Sub health check failed: ${error.message}`,
        error.stack,
      );
      
      const status = this.getStatus(key, false, {
        message: `Pub/Sub health check failed: ${error.message}`,
        projectId: this.projectId,
        isEmulator: this.isEmulator,
      });
      
      throw new HealthCheckError(
        `${key} is not healthy`,
        status,
      );
    }
  }

  /**
   * Basic ping test to check if Pub/Sub is responsive
   * @returns Promise<boolean> indicating if Pub/Sub is responsive
   */
  private async pingPubSub(): Promise<boolean> {
    try {
      // List topics with a limit of 1 as a simple connectivity test
      const [topics] = await this.pubSubClient.getTopics({ pageSize: 1 });
      return topics !== undefined;
    } catch (error) {
      this.logger.error(`Pub/Sub ping failed: ${error.message}`, error.stack);
      return false;
    }
  }

  /**
   * Verify that a topic exists
   * @param topicName Name of the topic to verify
   * @returns Promise<boolean> indicating if the topic exists
   */
  private async verifyTopic(topicName: string): Promise<boolean> {
    try {
      const topic = this.pubSubClient.topic(topicName);
      const [exists] = await topic.exists();
      
      if (!exists && this.isEmulator) {
        // In emulator, we can auto-create the topic if it doesn't exist
        await this.pubSubClient.createTopic(topicName);
        this.logger.log(`Created topic '${topicName}' in emulator`);
        return true;
      }
      
      return exists;
    } catch (error) {
      this.logger.error(`Topic verification failed: ${error.message}`, error.stack);
      return false;
    }
  }

  /**
   * Verify that a subscription exists
   * @param subscriptionName Name of the subscription to verify
   * @param topicName Name of the topic the subscription should be attached to
   * @returns Promise<boolean> indicating if the subscription exists
   */
  private async verifySubscription(subscriptionName: string, topicName: string): Promise<boolean> {
    try {
      const subscription = this.pubSubClient.subscription(subscriptionName);
      const [exists] = await subscription.exists();
      
      if (!exists && this.isEmulator) {
        // In emulator, we can auto-create the subscription if it doesn't exist
        const topic = this.pubSubClient.topic(topicName);
        await topic.createSubscription(subscriptionName);
        this.logger.log(`Created subscription '${subscriptionName}' for topic '${topicName}' in emulator`);
        return true;
      }
      
      if (exists) {
        // Verify that the subscription is attached to the expected topic
        const [metadata] = await subscription.getMetadata();
        const subscriptionTopic = metadata.topic;
        const expectedTopicName = `projects/${this.projectId}/topics/${topicName}`;
        
        if (subscriptionTopic !== expectedTopicName) {
          this.logger.warn(
            `Subscription '${subscriptionName}' exists but is attached to topic '${subscriptionTopic}' instead of '${expectedTopicName}'`
          );
          return false;
        }
      }
      
      return exists;
    } catch (error) {
      this.logger.error(`Subscription verification failed: ${error.message}`, error.stack);
      return false;
    }
  }

  /**
   * Create a topic if it doesn't exist
   * @param topicName Name of the topic to create
   * @returns Promise<Topic> The topic object
   */
  async createTopicIfNotExists(topicName: string): Promise<Topic> {
    try {
      const topic = this.pubSubClient.topic(topicName);
      const [exists] = await topic.exists();
      
      if (!exists) {
        this.logger.log(`Creating topic '${topicName}'...`);
        await this.pubSubClient.createTopic(topicName);
        this.logger.log(`Topic '${topicName}' created successfully`);
      } else {
        this.logger.log(`Topic '${topicName}' already exists`);
      }
      
      return topic;
    } catch (error) {
      this.logger.error(`Failed to create topic '${topicName}': ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Create a subscription if it doesn't exist
   * @param subscriptionName Name of the subscription to create
   * @param topicName Name of the topic to attach the subscription to
   * @returns Promise<Subscription> The subscription object
   */
  async createSubscriptionIfNotExists(subscriptionName: string, topicName: string): Promise<Subscription> {
    try {
      const topic = this.pubSubClient.topic(topicName);
      const subscription = this.pubSubClient.subscription(subscriptionName);
      const [exists] = await subscription.exists();
      
      if (!exists) {
        this.logger.log(`Creating subscription '${subscriptionName}' for topic '${topicName}'...`);
        await topic.createSubscription(subscriptionName);
        this.logger.log(`Subscription '${subscriptionName}' created successfully`);
      } else {
        this.logger.log(`Subscription '${subscriptionName}' already exists`);
      }
      
      return subscription;
    } catch (error) {
      this.logger.error(
        `Failed to create subscription '${subscriptionName}' for topic '${topicName}': ${error.message}`,
        error.stack
      );
      throw error;
    }
  }
}
