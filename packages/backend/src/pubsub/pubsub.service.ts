import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PubSub, Topic, Subscription, Message } from '@google-cloud/pubsub';

/**
 * Configuration for the PubSub service
 */
export interface PubSubConfig {
  projectId: string;
  isEmulator: boolean;
  defaultTopic: string;
  defaultSubscription: string;
}

/**
 * Options for publishing messages
 */
export interface PublishOptions {
  /**
   * Optional ordering key for ordered delivery
   */
  orderingKey?: string;
  
  /**
   * Optional attributes to attach to the message
   */
  attributes?: Record<string, string>;
}

/**
 * Options for subscribing to a topic
 */
export interface SubscriptionOptions {
  /**
   * Flow control settings for the subscription
   */
  flowControl?: {
    maxMessages?: number;
    allowExcessMessages?: boolean;
  };
  
  /**
   * Whether to use exactly-once delivery
   */
  exactlyOnceDelivery?: boolean;
  
  /**
   * Message ordering configuration
   */
  enableMessageOrdering?: boolean;
  
  /**
   * Retry policy for failed messages
   */
  retryPolicy?: {
    minimumBackoff?: { seconds: number };
    maximumBackoff?: { seconds: number };
  };
  
  /**
   * Dead letter topic for failed messages
   */
  deadLetterPolicy?: {
    deadLetterTopic: string;
    maxDeliveryAttempts: number;
  };
}

/**
 * Message handler function type
 */
export type MessageHandler = (
  message: Message,
  ackCallback: () => void,
  nackCallback: () => void,
) => Promise<void> | void;

/**
 * Service for interacting with Google Cloud Pub/Sub
 * Provides methods for publishing messages and subscribing to topics
 */
@Injectable()
export class PubSubService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PubSubService.name);
  private activeSubscriptions: Map<string, Subscription> = new Map();
  private topicCache: Map<string, Topic> = new Map();

  constructor(
    @Inject('PUBSUB_CLIENT') private readonly pubSubClient: PubSub,
    @Inject('PUBSUB_CONFIG') private readonly config: PubSubConfig,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Initialize PubSub service when module starts
   */
  async onModuleInit(): Promise<void> {
    try {
      this.logger.log(
        `Initializing PubSub service with project: ${this.config.projectId}, emulator: ${this.config.isEmulator}`
      );
      
      // Ensure default topic exists
      await this.createTopicIfNotExists(this.config.defaultTopic);
      
      // Log successful initialization
      this.logger.log('PubSub service initialized successfully');
    } catch (error) {
      this.logger.error(`Failed to initialize PubSub service: ${error.message}`, error.stack);
      // Don't throw here to allow the application to start even if PubSub is not available
    }
  }

  /**
   * Clean up subscriptions when module is destroyed
   */
  async onModuleDestroy(): Promise<void> {
    try {
      // Close all active subscriptions
      const closePromises = Array.from(this.activeSubscriptions.values()).map(
        (subscription) => {
          return new Promise<void>((resolve) => {
            subscription.removeAllListeners();
            subscription.close().then(() => resolve()).catch((err) => {
              this.logger.error(`Error closing subscription: ${err.message}`);
              resolve(); // Resolve anyway to continue cleanup
            });
          });
        }
      );
      
      await Promise.all(closePromises);
      this.activeSubscriptions.clear();
      this.logger.log('All PubSub subscriptions closed');
    } catch (error) {
      this.logger.error(`Error during PubSub cleanup: ${error.message}`, error.stack);
    }
  }

  /**
   * Publish a message to a topic
   * 
   * @param topicName Name of the topic (uses default if not provided)
   * @param data Message data (object will be JSON stringified)
   * @param options Publish options
   * @returns Message ID
   */
  async publish<T = any>(
    topicName: string = this.config.defaultTopic,
    data: T,
    options: PublishOptions = {},
  ): Promise<string> {
    try {
      // Get or create the topic
      const topic = await this.getTopic(topicName);
      
      // Convert data to Buffer
      const dataBuffer = this.serializeData(data);
      
      // Prepare publish options
      const publishOptions: { [key: string]: any } = {};
      
      if (options.orderingKey) {
        publishOptions.orderingKey = options.orderingKey;
      }
      
      // Publish the message
      const messageId = await topic.publish(dataBuffer, options.attributes || {}, publishOptions);
      
      this.logger.debug(`Published message to ${topicName} with ID: ${messageId}`);
      
      return messageId;
    } catch (error) {
      this.logger.error(
        `Failed to publish message to topic ${topicName}: ${error.message}`,
        error.stack
      );
      throw new InternalServerErrorException(`Failed to publish message: ${error.message}`);
    }
  }

  /**
   * Subscribe to a topic and process messages with a handler
   * 
   * @param topicName Name of the topic
   * @param subscriptionName Name of the subscription
   * @param handler Function to handle incoming messages
   * @param options Subscription options
   * @returns The subscription object
   */
  async subscribe(
    topicName: string = this.config.defaultTopic,
    subscriptionName: string = this.config.defaultSubscription,
    handler: MessageHandler,
    options: SubscriptionOptions = {},
  ): Promise<Subscription> {
    try {
      // Get or create the topic
      const topic = await this.getTopic(topicName);
      
      // Get or create the subscription
      const subscription = await this.getOrCreateSubscription(
        topic,
        subscriptionName,
        options
      );
      
      // Set up message handler
      subscription.on('message', async (message: Message) => {
        try {
          // Create acknowledgment callbacks
          const ackCallback = () => {
            message.ack();
            this.logger.debug(`Acknowledged message ${message.id} from ${subscriptionName}`);
          };
          
          const nackCallback = () => {
            message.nack();
            this.logger.debug(`Nacked message ${message.id} from ${subscriptionName}`);
          };
          
          // Process the message with the handler
          await Promise.resolve(handler(message, ackCallback, nackCallback));
        } catch (error) {
          this.logger.error(
            `Error processing message ${message.id} from ${subscriptionName}: ${error.message}`,
            error.stack
          );
          // Nack the message on error
          message.nack();
        }
      });
      
      // Set up error handler
      subscription.on('error', (error) => {
        this.logger.error(
          `Error in subscription ${subscriptionName}: ${error.message}`,
          error.stack
        );
      });
      
      // Store the active subscription for cleanup
      this.activeSubscriptions.set(subscriptionName, subscription);
      
      this.logger.log(`Subscribed to ${topicName} with subscription ${subscriptionName}`);
      
      return subscription;
    } catch (error) {
      this.logger.error(
        `Failed to subscribe to topic ${topicName} with subscription ${subscriptionName}: ${error.message}`,
        error.stack
      );
      throw new InternalServerErrorException(`Failed to subscribe: ${error.message}`);
    }
  }

  /**
   * Close a specific subscription
   * 
   * @param subscriptionName Name of the subscription to close
   * @returns Boolean indicating success
   */
  async closeSubscription(subscriptionName: string): Promise<boolean> {
    try {
      const subscription = this.activeSubscriptions.get(subscriptionName);
      
      if (!subscription) {
        this.logger.warn(`Subscription ${subscriptionName} not found or already closed`);
        return false;
      }
      
      // Remove all listeners and close the subscription
      subscription.removeAllListeners();
      await subscription.close();
      
      // Remove from active subscriptions
      this.activeSubscriptions.delete(subscriptionName);
      
      this.logger.log(`Closed subscription ${subscriptionName}`);
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to close subscription ${subscriptionName}: ${error.message}`,
        error.stack
      );
      return false;
    }
  }

  /**
   * Create a topic if it doesn't exist
   * 
   * @param topicName Name of the topic
   * @returns The topic object
   */
  async createTopicIfNotExists(topicName: string): Promise<Topic> {
    try {
      // Check if topic exists in cache
      if (this.topicCache.has(topicName)) {
        return this.topicCache.get(topicName);
      }
      
      // Get the topic reference
      const topic = this.pubSubClient.topic(topicName);
      
      // Check if the topic exists
      const [exists] = await topic.exists();
      
      if (!exists) {
        // Create the topic if it doesn't exist
        this.logger.log(`Creating topic: ${topicName}`);
        await this.pubSubClient.createTopic(topicName);
        this.logger.log(`Topic ${topicName} created successfully`);
      } else {
        this.logger.debug(`Topic ${topicName} already exists`);
      }
      
      // Cache the topic
      this.topicCache.set(topicName, topic);
      
      return topic;
    } catch (error) {
      this.logger.error(
        `Failed to create topic ${topicName}: ${error.message}`,
        error.stack
      );
      throw new InternalServerErrorException(`Failed to create topic: ${error.message}`);
    }
  }

  /**
   * Get a topic by name, creating it if it doesn't exist
   * 
   * @param topicName Name of the topic
   * @returns The topic object
   */
  private async getTopic(topicName: string): Promise<Topic> {
    if (!topicName) {
      throw new BadRequestException('Topic name is required');
    }
    
    return this.createTopicIfNotExists(topicName);
  }

  /**
   * Get or create a subscription
   * 
   * @param topic The topic to subscribe to
   * @param subscriptionName Name of the subscription
   * @param options Subscription options
   * @returns The subscription object
   */
  private async getOrCreateSubscription(
    topic: Topic,
    subscriptionName: string,
    options: SubscriptionOptions = {},
  ): Promise<Subscription> {
    try {
      // Get the subscription reference
      const subscription = topic.subscription(subscriptionName);
      
      // Check if the subscription exists
      const [exists] = await subscription.exists();
      
      if (!exists) {
        // Create the subscription with options
        this.logger.log(`Creating subscription ${subscriptionName} for topic ${topic.name}`);
        
        const createOptions: any = {};
        
        // Apply subscription options
        if (options.exactlyOnceDelivery) {
          createOptions.enableExactlyOnceDelivery = true;
        }
        
        if (options.enableMessageOrdering) {
          createOptions.enableMessageOrdering = true;
        }
        
        if (options.retryPolicy) {
          createOptions.retryPolicy = options.retryPolicy;
        }
        
        if (options.deadLetterPolicy) {
          createOptions.deadLetterPolicy = options.deadLetterPolicy;
        }
        
        await topic.createSubscription(subscriptionName, createOptions);
        this.logger.log(`Subscription ${subscriptionName} created successfully`);
      } else {
        this.logger.debug(`Subscription ${subscriptionName} already exists`);
      }
      
      // Configure subscription options
      if (options.flowControl) {
        subscription.setFlowControlOptions(options.flowControl);
      }
      
      return subscription;
    } catch (error) {
      this.logger.error(
        `Failed to get or create subscription ${subscriptionName}: ${error.message}`,
        error.stack
      );
      throw new InternalServerErrorException(
        `Failed to get or create subscription: ${error.message}`
      );
    }
  }

  /**
   * Serialize data to Buffer for publishing
   * 
   * @param data Data to serialize
   * @returns Buffer containing the serialized data
   */
  private serializeData(data: any): Buffer {
    try {
      if (Buffer.isBuffer(data)) {
        return data;
      }
      
      if (typeof data === 'string') {
        return Buffer.from(data);
      }
      
      return Buffer.from(JSON.stringify(data));
    } catch (error) {
      this.logger.error(`Failed to serialize message data: ${error.message}`, error.stack);
      throw new BadRequestException(`Failed to serialize message data: ${error.message}`);
    }
  }

  /**
   * Deserialize message data from Buffer
   * 
   * @param message PubSub message
   * @returns Deserialized data
   */
  static deserializeMessage<T = any>(message: Message): T {
    try {
      const data = message.data.toString();
      
      try {
        // Attempt to parse as JSON
        return JSON.parse(data) as T;
      } catch {
        // Return as string if not valid JSON
        return data as unknown as T;
      }
    } catch (error) {
      throw new Error(`Failed to deserialize message: ${error.message}`);
    }
  }

  /**
   * Get all active subscriptions
   * 
   * @returns Map of active subscriptions
   */
  getActiveSubscriptions(): Map<string, Subscription> {
    return new Map(this.activeSubscriptions);
  }

  /**
   * List all topics in the project
   * 
   * @returns Array of topic names
   */
  async listTopics(): Promise<string[]> {
    try {
      const [topics] = await this.pubSubClient.getTopics();
      return topics.map(topic => topic.name.split('/').pop());
    } catch (error) {
      this.logger.error(`Failed to list topics: ${error.message}`, error.stack);
      throw new InternalServerErrorException(`Failed to list topics: ${error.message}`);
    }
  }

  /**
   * List all subscriptions for a topic
   * 
   * @param topicName Name of the topic
   * @returns Array of subscription names
   */
  async listSubscriptions(topicName: string): Promise<string[]> {
    try {
      const topic = await this.getTopic(topicName);
      const [subscriptions] = await topic.getSubscriptions();
      return subscriptions.map(sub => sub.name.split('/').pop());
    } catch (error) {
      this.logger.error(
        `Failed to list subscriptions for topic ${topicName}: ${error.message}`,
        error.stack
      );
      throw new InternalServerErrorException(`Failed to list subscriptions: ${error.message}`);
    }
  }
}
