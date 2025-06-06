import { Module } from '@nestjs/common';
import { AssessmentsController } from './assessments.controller';
import { AssessmentsService } from './assessments.service';
import { DatabaseModule } from '../database/database.module';
import { AiServiceModule } from '../ai-service/ai-service.module';

@Module({
  imports: [
    DatabaseModule,
    AiServiceModule,
  ],
  controllers: [AssessmentsController],
  providers: [AssessmentsService],
  exports: [AssessmentsService],
})
export class AssessmentsModule {}
