import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ConfigModule } from '@nestjs/config';
import { PatientsService } from './patients.service';
import { PatientsController } from './patients.controller';

/**
 * Patients module that provides patient management functionality
 * Handles CRUD operations for patients and related data
 */
@Module({
  imports: [
    // Import DatabaseModule to access PrismaService
    DatabaseModule,
    
    // Import ConfigModule for environment variables
    ConfigModule,
  ],
  controllers: [PatientsController],
  providers: [
    // Main service for patient operations
    PatientsService,
  ],
  exports: [
    // Export PatientsService for use in other modules
    PatientsService,
  ],
})
export class PatientsModule {}
