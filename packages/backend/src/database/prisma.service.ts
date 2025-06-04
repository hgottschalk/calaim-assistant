import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';

/**
 * PrismaService provides database access through Prisma ORM
 * Handles connection lifecycle, transactions, and health checks
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private isConnected = false;

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'stdout', level: 'info' },
        { emit: 'stdout', level: 'warn' },
        { emit: 'stdout', level: 'error' },
      ],
      errorFormat: process.env.NODE_ENV === 'production' ? 'minimal' : 'pretty',
    });

    // Log query performance in development
    if (process.env.NODE_ENV !== 'production') {
      this.$on('query', (e: Prisma.QueryEvent) => {
        this.logger.debug(`Query: ${e.query}`);
        this.logger.debug(`Duration: ${e.duration}ms`);
      });
    }
  }

  /**
   * Connect to the database when the module initializes
   */
  async onModuleInit(): Promise<void> {
    try {
      this.logger.log('Connecting to database...');
      await this.$connect();
      this.isConnected = true;
      this.logger.log('Successfully connected to database');
    } catch (error) {
      this.isConnected = false;
      this.logger.error('Failed to connect to database', error.stack);
      throw error;
    }
  }

  /**
   * Disconnect from the database when the module is destroyed
   */
  async onModuleDestroy(): Promise<void> {
    try {
      this.logger.log('Disconnecting from database...');
      await this.$disconnect();
      this.isConnected = false;
      this.logger.log('Successfully disconnected from database');
    } catch (error) {
      this.logger.error('Error disconnecting from database', error.stack);
      throw error;
    }
  }

  /**
   * Check if the database connection is healthy
   * @returns boolean indicating connection status
   */
  async isHealthy(): Promise<boolean> {
    if (!this.isConnected) {
      return false;
    }

    try {
      // Execute a simple query to verify connection
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      this.logger.error('Database health check failed', error.stack);
      return false;
    }
  }

  /**
   * Execute operations within a transaction
   * @param fn Function containing operations to execute in transaction
   * @returns Result of the transaction function
   */
  async transaction<T>(
    fn: (prisma: Omit<PrismaService, 'transaction' | '$connect' | '$disconnect'>) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.$transaction(async (tx) => {
        return await fn(tx as any);
      });
    } catch (error) {
      this.logger.error(`Transaction failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Execute a raw SQL query with proper error handling
   * @param query SQL query string or template literal
   * @returns Query result
   */
  async executeRaw<T = unknown>(
    query: string | Prisma.Sql,
    ...values: any[]
  ): Promise<T> {
    try {
      if (typeof query === 'string') {
        return await this.$executeRawUnsafe(query, ...values);
      } else {
        return await this.$executeRaw(query);
      }
    } catch (error) {
      this.logger.error(`Raw query execution failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Reconnect to the database if the connection was lost
   */
  async reconnect(): Promise<void> {
    if (this.isConnected) {
      await this.$disconnect();
      this.isConnected = false;
    }
    
    try {
      await this.$connect();
      this.isConnected = true;
      this.logger.log('Successfully reconnected to database');
    } catch (error) {
      this.logger.error('Failed to reconnect to database', error.stack);
      throw error;
    }
  }
}
