import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  UnauthorizedException,
  ParseUUIDPipe,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AssessmentsService } from './assessments.service';
import { AiServiceService } from '../ai-service/ai-service.service';
import { PrismaService } from '../database/prisma.service';
import { DomainType } from '@prisma/client';

// DTOs
class CreateAssessmentDto {
  patientId: string;
  referralId?: string;
  assessmentDate: Date;
  notes?: string;
}

class UpdateAssessmentDto {
  assessmentDate?: Date;
  notes?: string;
}

class PaginationQueryDto {
  page?: number = 1;
  limit?: number = 10;
  sortBy?: string = 'createdAt';
  sortOrder?: 'asc' | 'desc' = 'desc';
}

class AssessmentFilterDto extends PaginationQueryDto {
  patientId?: string;
  referralId?: string;
  status?: string;
  startDate?: Date;
  endDate?: Date;
}

class UpdateDomainDto {
  content: any;
  clinicianReviewed?: boolean;
  clinicianModified?: boolean;
}

class CompleteAssessmentDto {
  notes?: string;
}

class SignAssessmentDto {
  signature: string; // Base64 encoded signature
}

@ApiTags('assessments')
@ApiBearerAuth()
@Controller('assessments')
export class AssessmentsController {
  constructor(
    private readonly assessmentsService: AssessmentsService,
    private readonly aiService: AiServiceService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.CLINICIAN, UserRole.SUPERVISOR, UserRole.READONLY)
  @ApiOperation({ summary: 'Get all assessments (paginated)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'patientId', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Returns a paginated list of assessments' })
  async findAll(
    @Query() filterDto: AssessmentFilterDto,
    @CurrentUser() user: any,
  ) {
    return this.assessmentsService.findAll({
      ...filterDto,
      organizationId: user.organizationId,
    });
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.CLINICIAN, UserRole.SUPERVISOR, UserRole.READONLY)
  @ApiOperation({ summary: 'Get a specific assessment' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Returns the assessment' })
  @ApiResponse({ status: 404, description: 'Assessment not found' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    const assessment = await this.assessmentsService.findOne(id);
    
    if (!assessment) {
      throw new NotFoundException(`Assessment with ID ${id} not found`);
    }
    
    // Check if user has access to this assessment
    if (assessment.organizationId !== user.organizationId) {
      throw new ForbiddenException('You do not have permission to access this assessment');
    }
    
    return assessment;
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.CLINICIAN, UserRole.SUPERVISOR)
  @ApiOperation({ summary: 'Create a new assessment' })
  @ApiResponse({ status: 201, description: 'Assessment created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  async create(
    @Body() createAssessmentDto: CreateAssessmentDto,
    @CurrentUser() user: any,
  ) {
    // Verify patient exists and belongs to user's organization
    const patient = await this.prisma.patient.findUnique({
      where: { id: createAssessmentDto.patientId },
    });
    
    if (!patient) {
      throw new NotFoundException(`Patient with ID ${createAssessmentDto.patientId} not found`);
    }
    
    if (patient.organizationId !== user.organizationId) {
      throw new ForbiddenException('You do not have permission to create an assessment for this patient');
    }
    
    // If referralId is provided, verify it exists and belongs to the patient
    if (createAssessmentDto.referralId) {
      const referral = await this.prisma.referral.findUnique({
        where: { id: createAssessmentDto.referralId },
      });
      
      if (!referral) {
        throw new NotFoundException(`Referral with ID ${createAssessmentDto.referralId} not found`);
      }
      
      if (referral.patientId !== createAssessmentDto.patientId) {
        throw new BadRequestException('Referral does not belong to the specified patient');
      }
    }
    
    return this.assessmentsService.create({
      ...createAssessmentDto,
      creatorId: user.id,
      updaterId: user.id,
      organizationId: user.organizationId,
    });
  }

  @Put(':id')
  @Roles(UserRole.ADMIN, UserRole.CLINICIAN, UserRole.SUPERVISOR)
  @ApiOperation({ summary: 'Update an assessment' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Assessment updated successfully' })
  @ApiResponse({ status: 404, description: 'Assessment not found' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateAssessmentDto: UpdateAssessmentDto,
    @CurrentUser() user: any,
  ) {
    // Verify assessment exists and user has access
    const assessment = await this.prisma.assessment.findUnique({
      where: { id },
    });
    
    if (!assessment) {
      throw new NotFoundException(`Assessment with ID ${id} not found`);
    }
    
    if (assessment.organizationId !== user.organizationId) {
      throw new ForbiddenException('You do not have permission to update this assessment');
    }
    
    // Cannot update completed or signed assessments
    if (assessment.status === 'COMPLETED' || assessment.status === 'SIGNED') {
      throw new BadRequestException(`Cannot update assessment with status ${assessment.status}`);
    }
    
    return this.assessmentsService.update(id, {
      ...updateAssessmentDto,
      updaterId: user.id,
    });
  }

  @Get(':id/domains')
  @Roles(UserRole.ADMIN, UserRole.CLINICIAN, UserRole.SUPERVISOR, UserRole.READONLY)
  @ApiOperation({ summary: 'Get all domains for an assessment' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Returns all domains for the assessment' })
  @ApiResponse({ status: 404, description: 'Assessment not found' })
  async findAllDomains(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    // Verify assessment exists and user has access
    const assessment = await this.prisma.assessment.findUnique({
      where: { id },
      include: { domains: true },
    });
    
    if (!assessment) {
      throw new NotFoundException(`Assessment with ID ${id} not found`);
    }
    
    if (assessment.organizationId !== user.organizationId) {
      throw new ForbiddenException('You do not have permission to access this assessment');
    }
    
    return assessment.domains;
  }

  @Get(':id/domains/:domainType')
  @Roles(UserRole.ADMIN, UserRole.CLINICIAN, UserRole.SUPERVISOR, UserRole.READONLY)
  @ApiOperation({ summary: 'Get a specific domain for an assessment' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'domainType', enum: DomainType })
  @ApiResponse({ status: 200, description: 'Returns the specified domain' })
  @ApiResponse({ status: 404, description: 'Assessment or domain not found' })
  async findDomain(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('domainType') domainType: DomainType,
    @CurrentUser() user: any,
  ) {
    // Verify assessment exists and user has access
    const assessment = await this.prisma.assessment.findUnique({
      where: { id },
    });
    
    if (!assessment) {
      throw new NotFoundException(`Assessment with ID ${id} not found`);
    }
    
    if (assessment.organizationId !== user.organizationId) {
      throw new ForbiddenException('You do not have permission to access this assessment');
    }
    
    // Get the specific domain
    const domain = await this.prisma.assessmentDomain.findUnique({
      where: {
        assessmentId_domainType: {
          assessmentId: id,
          domainType: domainType as DomainType,
        },
      },
    });
    
    if (!domain) {
      throw new NotFoundException(`Domain ${domainType} not found for assessment ${id}`);
    }
    
    return domain;
  }

  @Put(':id/domains/:domainType')
  @Roles(UserRole.ADMIN, UserRole.CLINICIAN, UserRole.SUPERVISOR)
  @ApiOperation({ summary: 'Update a specific domain for an assessment' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'domainType', enum: DomainType })
  @ApiResponse({ status: 200, description: 'Domain updated successfully' })
  @ApiResponse({ status: 404, description: 'Assessment or domain not found' })
  async updateDomain(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('domainType') domainType: DomainType,
    @Body() updateDomainDto: UpdateDomainDto,
    @CurrentUser() user: any,
  ) {
    // Verify assessment exists and user has access
    const assessment = await this.prisma.assessment.findUnique({
      where: { id },
    });
    
    if (!assessment) {
      throw new NotFoundException(`Assessment with ID ${id} not found`);
    }
    
    if (assessment.organizationId !== user.organizationId) {
      throw new ForbiddenException('You do not have permission to update this assessment');
    }
    
    // Cannot update domains for completed or signed assessments
    if (assessment.status === 'COMPLETED' || assessment.status === 'SIGNED') {
      throw new BadRequestException(`Cannot update domains for assessment with status ${assessment.status}`);
    }
    
    // Check if domain exists
    const domain = await this.prisma.assessmentDomain.findUnique({
      where: {
        assessmentId_domainType: {
          assessmentId: id,
          domainType: domainType as DomainType,
        },
      },
    });
    
    if (!domain) {
      // If domain doesn't exist, create it
      return this.assessmentsService.createDomain(id, domainType as DomainType, {
        ...updateDomainDto,
        clinicianReviewed: true,
        clinicianModified: true,
      });
    }
    
    // Update the domain
    return this.assessmentsService.updateDomain(id, domainType as DomainType, {
      ...updateDomainDto,
      clinicianReviewed: true,
      clinicianModified: true,
    });
  }

  @Post(':id/complete')
  @Roles(UserRole.ADMIN, UserRole.CLINICIAN, UserRole.SUPERVISOR)
  @ApiOperation({ summary: 'Mark an assessment as completed' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Assessment marked as completed' })
  @ApiResponse({ status: 404, description: 'Assessment not found' })
  @HttpCode(HttpStatus.OK)
  async completeAssessment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() completeAssessmentDto: CompleteAssessmentDto,
    @CurrentUser() user: any,
  ) {
    // Verify assessment exists and user has access
    const assessment = await this.prisma.assessment.findUnique({
      where: { id },
      include: { domains: true },
    });
    
    if (!assessment) {
      throw new NotFoundException(`Assessment with ID ${id} not found`);
    }
    
    if (assessment.organizationId !== user.organizationId) {
      throw new ForbiddenException('You do not have permission to complete this assessment');
    }
    
    // Cannot complete already completed or signed assessments
    if (assessment.status === 'COMPLETED' || assessment.status === 'SIGNED') {
      throw new BadRequestException(`Assessment is already ${assessment.status}`);
    }
    
    // Check if all required domains are present
    const requiredDomains = Object.values(DomainType);
    const existingDomains = assessment.domains.map(domain => domain.domainType);
    
    const missingDomains = requiredDomains.filter(domain => !existingDomains.includes(domain));
    
    if (missingDomains.length > 0) {
      throw new BadRequestException(`Cannot complete assessment. Missing required domains: ${missingDomains.join(', ')}`);
    }
    
    return this.assessmentsService.complete(id, user.id, completeAssessmentDto.notes);
  }

  @Post(':id/sign')
  @Roles(UserRole.ADMIN, UserRole.CLINICIAN, UserRole.SUPERVISOR)
  @ApiOperation({ summary: 'Sign an assessment' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Assessment signed successfully' })
  @ApiResponse({ status: 404, description: 'Assessment not found' })
  @HttpCode(HttpStatus.OK)
  async signAssessment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() signAssessmentDto: SignAssessmentDto,
    @CurrentUser() user: any,
  ) {
    // Verify assessment exists and user has access
    const assessment = await this.prisma.assessment.findUnique({
      where: { id },
    });
    
    if (!assessment) {
      throw new NotFoundException(`Assessment with ID ${id} not found`);
    }
    
    if (assessment.organizationId !== user.organizationId) {
      throw new ForbiddenException('You do not have permission to sign this assessment');
    }
    
    // Can only sign completed assessments
    if (assessment.status !== 'COMPLETED') {
      throw new BadRequestException('Cannot sign assessment. Assessment must be completed first.');
    }
    
    // Validate signature
    if (!signAssessmentDto.signature || signAssessmentDto.signature.trim() === '') {
      throw new BadRequestException('Signature is required');
    }
    
    return this.assessmentsService.sign(id, user.id, `${user.firstName} ${user.lastName}`, signAssessmentDto.signature);
  }
}
