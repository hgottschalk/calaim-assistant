import { Module, Global } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PrismaHealthIndicator } from './prisma-health.indicator';

@Global()
@Module({
  providers: [PrismaService, PrismaHealthIndicator],
  exports: [PrismaService, PrismaHealthIndicator],
})
export class DatabaseModule {}
