import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { DomainType, AssessmentStatus } from '@prisma/client';

@Injectable()
export class AssessmentsService {
  private readonly logger = new Logger(AssessmentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Find all assessments with pagination and filtering
   */
  async findAll(params: {
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    patientId?: string;
    referralId?: string;
    status?: string;
    startDate?: Date;
    endDate?: Date;
    organizationId: string;
  }) {
    const {
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      patientId,
      referralId,
      status,
      startDate,
      endDate,
      organizationId,
    } = params;

    // Calculate pagination
    const skip = (page - 1) * limit;
    const take = limit;

    // Build where clause
    const where: any = {
      organizationId,
    };

    if (patientId) {
      where.patientId = patientId;
    }

    if (referralId) {
      where.referralId = referralId;
    }

    if (status) {
      where.status = status;
    }

    if (startDate || endDate) {
      where.assessmentDate = {};
      
      if (startDate) {
        where.assessmentDate.gte = startDate;
      }
      
      if (endDate) {
        where.assessmentDate.lte = endDate;
      }
    }

    try {
      // Get total count for pagination
      const total = await this.prisma.assessment.count({ where });

      // Get assessments with pagination and sorting
      const assessments = await this.prisma.assessment.findMany({
        where,
        skip,
        take,
        orderBy: {
          [sortBy]: sortOrder,
        },
        include: {
          patient: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              dateOfBirth: true,
              medicaidId: true,
            },
          },
          creator: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
          domains: {
            select: {
              domainType: true,
              aiGenerated: true,
              clinicianReviewed: true,
              clinicianModified: true,
            },
          },
        },
      });

      // Calculate pagination metadata
      const totalPages = Math.ceil(total / limit);
      const hasNext = page < totalPages;
      const hasPrevious = page > 1;

      return {
        data: assessments,
        meta: {
          total,
          page,
          limit,
          totalPages,
          hasNext,
          hasPrevious,
        },
      };
    } catch (error) {
      this.logger.error(`Error finding assessments: ${error.message}`, error.stack);
      throw new InternalServerErrorException(`Failed to retrieve assessments: ${error.message}`);
    }
  }

  /**
   * Find one assessment by ID
   */
  async findOne(id: string) {
    try {
      const assessment = await this.prisma.assessment.findUnique({
        where: { id },
        include: {
          patient: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              dateOfBirth: true,
              medicaidId: true,
              gender: true,
              preferredLanguage: true,
            },
          },
          referral: {
            select: {
              id: true,
              referralDate: true,
              referralSource: true,
              referralReason: true,
              documentUrl: true,
              fileName: true,
            },
          },
          creator: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              title: true,
              licenseNumber: true,
              npi: true,
            },
          },
          updater: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
          domains: true,
          problems: {
            include: {
              carePlanItems: true,
            },
          },
          carePlans: {
            select: {
              id: true,
              status: true,
              startDate: true,
              endDate: true,
              createdAt: true,
            },
          },
        },
      });

      if (!assessment) {
        return null;
      }

      return assessment;
    } catch (error) {
      this.logger.error(`Error finding assessment ${id}: ${error.message}`, error.stack);
      throw new InternalServerErrorException(`Failed to retrieve assessment: ${error.message}`);
    }
  }

  /**
   * Create a new assessment
   */
  async create(data: {
    patientId: string;
    referralId?: string;
    creatorId: string;
    updaterId: string;
    organizationId: string;
    assessmentDate: Date;
    notes?: string;
  }) {
    try {
      // Create assessment
      const assessment = await this.prisma.assessment.create({
        data: {
          patientId: data.patientId,
          referralId: data.referralId,
          creatorId: data.creatorId,
          updaterId: data.updaterId,
          organizationId: data.organizationId,
          assessmentDate: data.assessmentDate,
          status: AssessmentStatus.DRAFT,
        },
        include: {
          patient: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      this.logger.log(`Created assessment ${assessment.id} for patient ${assessment.patient.firstName} ${assessment.patient.lastName}`);

      return assessment;
    } catch (error) {
      this.logger.error(`Error creating assessment: ${error.message}`, error.stack);
      throw new InternalServerErrorException(`Failed to create assessment: ${error.message}`);
    }
  }

  /**
   * Update an existing assessment
   */
  async update(id: string, data: {
    assessmentDate?: Date;
    updaterId: string;
    notes?: string;
  }) {
    try {
      // Update assessment
      const assessment = await this.prisma.assessment.update({
        where: { id },
        data: {
          assessmentDate: data.assessmentDate,
          updaterId: data.updaterId,
          updatedAt: new Date(),
        },
        include: {
          patient: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      this.logger.log(`Updated assessment ${assessment.id} for patient ${assessment.patient.firstName} ${assessment.patient.lastName}`);

      return assessment;
    } catch (error) {
      this.logger.error(`Error updating assessment ${id}: ${error.message}`, error.stack);
      
      if (error.code === 'P2025') {
        throw new NotFoundException(`Assessment with ID ${id} not found`);
      }
      
      throw new InternalServerErrorException(`Failed to update assessment: ${error.message}`);
    }
  }

  /**
   * Create a new assessment domain
   */
  async createDomain(assessmentId: string, domainType: DomainType, data: {
    content: any;
    aiGenerated?: boolean;
    aiConfidence?: number;
    clinicianReviewed?: boolean;
    clinicianModified?: boolean;
  }) {
    try {
      // Convert content to string if it's an object
      const contentString = typeof data.content === 'object' 
        ? JSON.stringify(data.content) 
        : data.content;

      // Create domain
      const domain = await this.prisma.assessmentDomain.create({
        data: {
          assessmentId,
          domainType,
          content: contentString,
          aiGenerated: data.aiGenerated || false,
          aiConfidence: data.aiConfidence,
          clinicianReviewed: data.clinicianReviewed || false,
          clinicianModified: data.clinicianModified || false,
        },
      });

      this.logger.log(`Created domain ${domainType} for assessment ${assessmentId}`);

      return domain;
    } catch (error) {
      this.logger.error(`Error creating domain ${domainType} for assessment ${assessmentId}: ${error.message}`, error.stack);
      
      if (error.code === 'P2002') {
        throw new BadRequestException(`Domain ${domainType} already exists for assessment ${assessmentId}`);
      }
      
      if (error.code === 'P2003') {
        throw new NotFoundException(`Assessment with ID ${assessmentId} not found`);
      }
      
      throw new InternalServerErrorException(`Failed to create domain: ${error.message}`);
    }
  }

  /**
   * Update an existing assessment domain
   */
  async updateDomain(assessmentId: string, domainType: DomainType, data: {
    content: any;
    aiGenerated?: boolean;
    aiConfidence?: number;
    clinicianReviewed?: boolean;
    clinicianModified?: boolean;
  }) {
    try {
      // Convert content to string if it's an object
      const contentString = typeof data.content === 'object' 
        ? JSON.stringify(data.content) 
        : data.content;

      // Update domain
      const domain = await this.prisma.assessmentDomain.update({
        where: {
          assessmentId_domainType: {
            assessmentId,
            domainType,
          },
        },
        data: {
          content: contentString,
          aiGenerated: data.aiGenerated,
          aiConfidence: data.aiConfidence,
          clinicianReviewed: data.clinicianReviewed,
          clinicianModified: data.clinicianModified,
          updatedAt: new Date(),
        },
      });

      this.logger.log(`Updated domain ${domainType} for assessment ${assessmentId}`);

      return domain;
    } catch (error) {
      this.logger.error(`Error updating domain ${domainType} for assessment ${assessmentId}: ${error.message}`, error.stack);
      
      if (error.code === 'P2025') {
        throw new NotFoundException(`Domain ${domainType} not found for assessment ${assessmentId}`);
      }
      
      throw new InternalServerErrorException(`Failed to update domain: ${error.message}`);
    }
  }

  /**
   * Mark an assessment as completed
   */
  async complete(id: string, updaterId: string, notes?: string) {
    try {
      // Update assessment status to COMPLETED
      const assessment = await this.prisma.assessment.update({
        where: { id },
        data: {
          status: AssessmentStatus.COMPLETED,
          completedAt: new Date(),
          updaterId,
          updatedAt: new Date(),
        },
        include: {
          patient: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      this.logger.log(`Marked assessment ${assessment.id} as completed for patient ${assessment.patient.firstName} ${assessment.patient.lastName}`);

      // Create audit log entry
      await this.prisma.auditLog.create({
        data: {
          userId: updaterId,
          action: 'COMPLETE',
          resourceType: 'ASSESSMENT',
          resourceId: id,
          description: `Assessment marked as completed`,
          metadata: notes ? JSON.stringify({ notes }) : null,
        },
      });

      return assessment;
    } catch (error) {
      this.logger.error(`Error completing assessment ${id}: ${error.message}`, error.stack);
      
      if (error.code === 'P2025') {
        throw new NotFoundException(`Assessment with ID ${id} not found`);
      }
      
      throw new InternalServerErrorException(`Failed to complete assessment: ${error.message}`);
    }
  }

  /**
   * Sign an assessment
   */
  async sign(id: string, updaterId: string, signedBy: string, signature: string) {
    try {
      // Update assessment status to SIGNED
      const assessment = await this.prisma.assessment.update({
        where: { id },
        data: {
          status: AssessmentStatus.SIGNED,
          signedAt: new Date(),
          signedBy,
          signature,
          updaterId,
          updatedAt: new Date(),
        },
        include: {
          patient: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      this.logger.log(`Signed assessment ${assessment.id} for patient ${assessment.patient.firstName} ${assessment.patient.lastName}`);

      // Create audit log entry
      await this.prisma.auditLog.create({
        data: {
          userId: updaterId,
          action: 'SIGN',
          resourceType: 'ASSESSMENT',
          resourceId: id,
          description: `Assessment signed by ${signedBy}`,
        },
      });

      return assessment;
    } catch (error) {
      this.logger.error(`Error signing assessment ${id}: ${error.message}`, error.stack);
      
      if (error.code === 'P2025') {
        throw new NotFoundException(`Assessment with ID ${id} not found`);
      }
      
      throw new InternalServerErrorException(`Failed to sign assessment: ${error.message}`);
    }
  }
}
