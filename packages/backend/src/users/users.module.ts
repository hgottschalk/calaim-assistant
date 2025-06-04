import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { ConfigModule } from '@nestjs/config';

/**
 * Users module that provides user management functionality
 * Exports UsersService for use in other modules like AuthModule
 */
@Module({
  imports: [
    // Import DatabaseModule to access PrismaService
    DatabaseModule,
    
    // Import ConfigModule for environment variables
    ConfigModule,
  ],
  controllers: [UsersController],
  providers: [
    // Main service for user operations
    UsersService,
  ],
  exports: [
    // Export UsersService for use in other modules
    UsersService,
  ],
})
export class UsersModule {}
