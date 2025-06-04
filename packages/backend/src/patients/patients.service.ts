import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { Patient, Prisma } from '@prisma/client';

/**
 * Service for managing patients in the CalAIM Assistant application
 * Provides CRUD operations and specialized patient management functions
 */
@Injectable()
export class PatientsService {
  private readonly logger = new Logger(PatientsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new patient
   * 
   * @param data Patient creation data
   * @returns The created patient
   * @throws ConflictException if patient with same identifiers already exists
   */
  async create(data: Prisma.PatientCreateInput): Promise<Patient> {
    try {
      // Check for duplicate Medicaid ID if provided
      if (data.medicaidId) {
        const existingPatient = await this.prisma.patient.findFirst({
          where: { 
            medicaidId: data.medicaidId,
            organizationId: data.organization.connect.id,
          },
        });
        
        if (existingPatient) {
          throw new ConflictException(`Patient with Medicaid ID ${data.medicaidId} already exists`);
        }
      }

      // Create the patient
      const patient = await this.prisma.patient.create({
        data,
      });

      // Log patient creation
      this.logger.log(`Patient created: ${patient.id} (${patient.firstName} ${patient.lastName})`);

      return patient;
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      
      if (error.code === 'P2002') {
        throw new ConflictException('Patient with these identifiers already exists');
      }

      this.logger.error(`Failed to create patient: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Find a patient by their ID
   * 
   * @param id Patient ID
   * @returns The patient or null if not found
   */
  async findById(id: string): Promise<Patient | null> {
    try {
      const patient = await this.prisma.patient.findUnique({
        where: { id },
      });

      return patient;
    } catch (error) {
      this.logger.error(`Failed to find patient by ID ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Find a patient by external ID (from another system)
   * 
   * @param externalId External ID
   * @param organizationId Organization ID
   * @returns The patient or null if not found
   */
  async findByExternalId(externalId: string, organizationId: string): Promise<Patient | null> {
    try {
      const patient = await this.prisma.patient.findFirst({
        where: { 
          externalId,
          organizationId,
        },
      });

      return patient;
    } catch (error) {
      this.logger.error(
        `Failed to find patient by external ID ${externalId}: ${error.message}`,
        error.stack
      );
      throw error;
    }
  }

  /**
   * Find all patients with optional filtering, pagination, and sorting
   * 
   * @param params Query parameters for filtering, pagination, and sorting
   * @returns Array of patients
   */
  async findAll(params: {
    skip?: number;
    take?: number;
    cursor?: Prisma.PatientWhereUniqueInput;
    where?: Prisma.PatientWhereInput;
    orderBy?: Prisma.PatientOrderByWithRelationInput;
    includeInactive?: boolean;
    organizationId?: string;
  }): Promise<Patient[]> {
    const { skip, take, cursor, where, orderBy, includeInactive = false, organizationId } = params;

    try {
      // Apply default filter to exclude inactive patients unless explicitly requested
      // and filter by organization if provided
      const filter: Prisma.PatientWhereInput = {
        ...where,
        ...(includeInactive ? {} : { isActive: true }),
        ...(organizationId ? { organizationId } : {}),
      };

      const patients = await this.prisma.patient.findMany({
        skip,
        take,
        cursor,
        where: filter,
        orderBy,
      });

      return patients;
    } catch (error) {
      this.logger.error(`Failed to find patients: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Count patients with optional filtering
   * 
   * @param where Filter criteria
   * @param includeInactive Whether to include inactive patients
   * @param organizationId Organization ID to filter by
   * @returns Count of matching patients
   */
  async count(
    where?: Prisma.PatientWhereInput,
    includeInactive = false,
    organizationId?: string,
  ): Promise<number> {
    try {
      // Apply default filter to exclude inactive patients unless explicitly requested
      // and filter by organization if provided
      const filter: Prisma.PatientWhereInput = {
        ...where,
        ...(includeInactive ? {} : { isActive: true }),
        ...(organizationId ? { organizationId } : {}),
      };

      return await this.prisma.patient.count({ where: filter });
    } catch (error) {
      this.logger.error(`Failed to count patients: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Update a patient's information
   * 
   * @param id Patient ID
   * @param data Update data
   * @returns The updated patient
   * @throws NotFoundException if patient not found
   */
  async update(id: string, data: Prisma.PatientUpdateInput): Promise<Patient> {
    try {
      // Check if patient exists
      const existingPatient = await this.findById(id);
      
      if (!existingPatient) {
        throw new NotFoundException(`Patient with ID ${id} not found`);
      }

      // Check for duplicate Medicaid ID if changing it
      if (data.medicaidId && data.medicaidId !== existingPatient.medicaidId) {
        const duplicatePatient = await this.prisma.patient.findFirst({
          where: { 
            medicaidId: data.medicaidId as string,
            organizationId: existingPatient.organizationId,
            id: { not: id }, // Exclude current patient
          },
        });
        
        if (duplicatePatient) {
          throw new ConflictException(`Another patient with Medicaid ID ${data.medicaidId} already exists`);
        }
      }

      // Update the patient
      const updatedPatient = await this.prisma.patient.update({
        where: { id },
        data,
      });

      // Log patient update
      this.logger.log(`Patient updated: ${updatedPatient.id} (${updatedPatient.firstName} ${updatedPatient.lastName})`);

      return updatedPatient;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ConflictException) {
        throw error;
      }
      
      if (error.code === 'P2002') {
        throw new ConflictException('Patient with these identifiers already exists');
      }

      this.logger.error(`Failed to update patient ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Soft delete a patient by marking them as inactive
   * 
   * @param id Patient ID
   * @returns The deactivated patient
   * @throws NotFoundException if patient not found
   */
  async softDelete(id: string): Promise<Patient> {
    try {
      // Check if patient exists
      const existingPatient = await this.findById(id);
      
      if (!existingPatient) {
        throw new NotFoundException(`Patient with ID ${id} not found`);
      }

      // Soft delete by marking as inactive
      const updatedPatient = await this.prisma.patient.update({
        where: { id },
        data: { isActive: false },
      });

      // Log patient deactivation
      this.logger.log(`Patient deactivated: ${updatedPatient.id} (${updatedPatient.firstName} ${updatedPatient.lastName})`);

      return updatedPatient;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error(`Failed to deactivate patient ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Reactivate a previously deactivated patient
   * 
   * @param id Patient ID
   * @returns The reactivated patient
   * @throws NotFoundException if patient not found
   */
  async reactivate(id: string): Promise<Patient> {
    try {
      // Check if patient exists (including inactive)
      const existingPatient = await this.prisma.patient.findUnique({
        where: { id },
      });
      
      if (!existingPatient) {
        throw new NotFoundException(`Patient with ID ${id} not found`);
      }

      if (existingPatient.isActive) {
        return existingPatient;
      }

      // Reactivate the patient
      const updatedPatient = await this.prisma.patient.update({
        where: { id },
        data: { isActive: true },
      });

      // Log patient reactivation
      this.logger.log(`Patient reactivated: ${updatedPatient.id} (${updatedPatient.firstName} ${updatedPatient.lastName})`);

      return updatedPatient;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error(`Failed to reactivate patient ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Find patients by organization ID
   * 
   * @param organizationId Organization ID
   * @param params Query parameters for filtering, pagination, and sorting
   * @returns Array of patients in the organization
   */
  async findByOrganization(
    organizationId: string,
    params: {
      skip?: number;
      take?: number;
      where?: Prisma.PatientWhereInput;
      orderBy?: Prisma.PatientOrderByWithRelationInput;
      includeInactive?: boolean;
    } = {},
  ): Promise<Patient[]> {
    return this.findAll({
      ...params,
      organizationId,
    });
  }

  /**
   * Search for patients by name, DOB, or identifiers
   * 
   * @param searchTerm Search term (name, DOB, Medicaid ID)
   * @param organizationId Organization ID to filter by
   * @param params Additional query parameters
   * @returns Array of matching patients
   */
  async search(
    searchTerm: string,
    organizationId: string,
    params: {
      skip?: number;
      take?: number;
      includeInactive?: boolean;
    } = {},
  ): Promise<Patient[]> {
    try {
      const { skip, take, includeInactive = false } = params;
      
      // Parse search term as date if it matches date format
      let searchDate: Date | null = null;
      if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(searchTerm)) {
        searchDate = new Date(searchTerm);
        // Check if date is valid
        if (isNaN(searchDate.getTime())) {
          searchDate = null;
        }
      }

      // Build search filter
      const filter: Prisma.PatientWhereInput = {
        organizationId,
        ...(includeInactive ? {} : { isActive: true }),
        OR: [
          // Search by name
          { firstName: { contains: searchTerm, mode: 'insensitive' } },
          { lastName: { contains: searchTerm, mode: 'insensitive' } },
          // Search by identifiers
          { medicaidId: { equals: searchTerm } },
          { medicareId: { equals: searchTerm } },
          { externalId: { equals: searchTerm } },
        ],
      };

      // Add date of birth search if valid date was parsed
      if (searchDate) {
        filter.OR.push({ dateOfBirth: searchDate });
      }

      return await this.prisma.patient.findMany({
        where: filter,
        skip,
        take,
        orderBy: { lastName: 'asc' },
      });
    } catch (error) {
      this.logger.error(`Failed to search patients: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get a patient's assessments
   * 
   * @param patientId Patient ID
   * @param params Query parameters for filtering and pagination
   * @returns Array of assessments for the patient
   */
  async getAssessments(
    patientId: string,
    params: {
      skip?: number;
      take?: number;
      includeArchived?: boolean;
    } = {},
  ) {
    try {
      const { skip, take, includeArchived = false } = params;

      // Check if patient exists
      const patient = await this.findById(patientId);
      
      if (!patient) {
        throw new NotFoundException(`Patient with ID ${patientId} not found`);
      }

      // Get assessments for the patient
      return this.prisma.assessment.findMany({
        where: {
          patientId,
          ...(includeArchived ? {} : { status: { not: 'ARCHIVED' } }),
        },
        skip,
        take,
        orderBy: { assessmentDate: 'desc' },
        include: {
          creator: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
          domains: true,
        },
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error(`Failed to get assessments for patient ${patientId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get a patient's referrals
   * 
   * @param patientId Patient ID
   * @param params Query parameters for filtering and pagination
   * @returns Array of referrals for the patient
   */
  async getReferrals(
    patientId: string,
    params: {
      skip?: number;
      take?: number;
    } = {},
  ) {
    try {
      const { skip, take } = params;

      // Check if patient exists
      const patient = await this.findById(patientId);
      
      if (!patient) {
        throw new NotFoundException(`Patient with ID ${patientId} not found`);
      }

      // Get referrals for the patient
      return this.prisma.referral.findMany({
        where: { patientId },
        skip,
        take,
        orderBy: { referralDate: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error(`Failed to get referrals for patient ${patientId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get a patient's care plans
   * 
   * @param patientId Patient ID
   * @param params Query parameters for filtering and pagination
   * @returns Array of care plans for the patient
   */
  async getCarePlans(
    patientId: string,
    params: {
      skip?: number;
      take?: number;
      includeDiscontinued?: boolean;
    } = {},
  ) {
    try {
      const { skip, take, includeDiscontinued = false } = params;

      // Check if patient exists
      const patient = await this.findById(patientId);
      
      if (!patient) {
        throw new NotFoundException(`Patient with ID ${patientId} not found`);
      }

      // Get care plans for the patient
      return this.prisma.carePlan.findMany({
        where: {
          patientId,
          ...(includeDiscontinued ? {} : { status: { not: 'DISCONTINUED' } }),
        },
        skip,
        take,
        orderBy: { startDate: 'desc' },
        include: {
          creator: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
          items: true,
        },
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error(`Failed to get care plans for patient ${patientId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Validate patient data before creation or update
   * 
   * @param data Patient data to validate
   * @throws BadRequestException if data is invalid
   */
  validatePatientData(data: any): void {
    // Validate date of birth
    if (data.dateOfBirth) {
      const dob = new Date(data.dateOfBirth);
      const now = new Date();
      
      if (isNaN(dob.getTime())) {
        throw new BadRequestException('Invalid date of birth');
      }
      
      if (dob > now) {
        throw new BadRequestException('Date of birth cannot be in the future');
      }
      
      // Check if patient is unreasonably old (e.g., > 120 years)
      const maxAge = 120;
      const minDate = new Date();
      minDate.setFullYear(now.getFullYear() - maxAge);
      
      if (dob < minDate) {
        throw new BadRequestException(`Date of birth indicates age > ${maxAge} years`);
      }
    }

    // Validate phone number format if provided
    if (data.phone && !/^[0-9+\-() ]{10,15}$/.test(data.phone)) {
      throw new BadRequestException('Invalid phone number format');
    }

    // Validate email format if provided
    if (data.email && !/^[^@]+@[^@]+\.[^@]+$/.test(data.email)) {
      throw new BadRequestException('Invalid email format');
    }

    // Validate SSN format if provided (last 4 digits only)
    if (data.ssn && !/^\d{4}$/.test(data.ssn)) {
      throw new BadRequestException('SSN should contain only the last 4 digits');
    }
  }
}
