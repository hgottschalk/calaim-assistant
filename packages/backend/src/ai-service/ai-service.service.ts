import {
  Injectable,
  Logger,
  Inject,
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
  RequestTimeoutException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { catchError, firstValueFrom, timeout, retry } from 'rxjs';
import { AxiosError } from 'axios';

/**
 * Configuration for the AI service
 */
export interface AiServiceConfig {
  baseUrl: string;
  timeout: number;
  enableMock: boolean;
  maxRetries: number;
  confidenceThreshold: number;
}

/**
 * Document processing request
 */
export interface DocumentProcessingRequest {
  /**
   * Document ID in the system
   */
  documentId: string;
  
  /**
   * GCS URI to the document
   */
  documentUri: string;
  
  /**
   * Patient ID associated with the document
   */
  patientId: string;
  
  /**
   * Document type (PDF, DOCX, etc.)
   */
  documentType: string;
  
  /**
   * Referral ID in the system
   */
  referralId: string;
  
  /**
   * Priority of the processing job
   */
  priority?: 'high' | 'normal' | 'low';
  
  /**
   * Callback URL for processing completion
   */
  callbackUrl?: string;
}

/**
 * Document processing status
 */
export enum ProcessingStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  MANUAL_REVIEW = 'MANUAL_REVIEW',
}

/**
 * Document processing result
 */
export interface DocumentProcessingResult {
  /**
   * Job ID assigned by the AI service
   */
  jobId: string;
  
  /**
   * Document ID from the request
   */
  documentId: string;
  
  /**
   * Processing status
   */
  status: ProcessingStatus;
  
  /**
   * Overall confidence score (0-1)
   */
  confidenceScore?: number;
  
  /**
   * Error message if processing failed
   */
  errorMessage?: string;
  
  /**
   * Timestamp when processing started
   */
  startedAt?: Date;
  
  /**
   * Timestamp when processing completed
   */
  completedAt?: Date;
  
  /**
   * Extracted domains with suggestions
   */
  domains?: DomainSuggestion[];
}

/**
 * Domain suggestion with extracted content
 */
export interface DomainSuggestion {
  /**
   * Domain type (one of the seven CalAIM domains)
   */
  domainType: string;
  
  /**
   * Extracted content for the domain
   */
  content: any;
  
  /**
   * Confidence score for this domain (0-1)
   */
  confidence: number;
  
  /**
   * Source passages that led to this suggestion
   */
  sources?: string[];
  
  /**
   * Extracted entities related to this domain
   */
  entities?: ExtractedEntity[];
}

/**
 * Extracted entity from the document
 */
export interface ExtractedEntity {
  /**
   * Entity type (Symptom, Diagnosis, etc.)
   */
  type: string;
  
  /**
   * Extracted text
   */
  text: string;
  
  /**
   * Confidence score (0-1)
   */
  confidence: number;
  
  /**
   * UMLS concept ID if available
   */
  umlsCui?: string;
  
  /**
   * SNOMED CT code if available
   */
  snomedCode?: string;
  
  /**
   * ICD-10 code if available
   */
  icd10Code?: string;
  
  /**
   * Position in the document
   */
  position?: {
    start: number;
    end: number;
    page?: number;
  };
}

/**
 * Service for communicating with the AI/NLP microservice
 * Handles document processing, entity extraction, and domain mapping
 */
@Injectable()
export class AiServiceService {
  private readonly logger = new Logger(AiServiceService.name);

  constructor(
    private readonly httpService: HttpService,
    @Inject('AI_SERVICE_CONFIG') private readonly config: AiServiceConfig,
    private readonly configService: ConfigService,
  ) {
    this.logger.log(`AI Service initialized with base URL: ${config.baseUrl}`);
    
    if (config.enableMock) {
      this.logger.warn('AI Service is running in MOCK mode - using simulated responses');
    }
  }

  /**
   * Submit a document for processing
   * 
   * @param request Document processing request
   * @returns Job ID for tracking the processing
   */
  async submitDocument(request: DocumentProcessingRequest): Promise<string> {
    try {
      this.logger.log(`Submitting document ${request.documentId} for processing`);
      
      // Use mock response if enabled
      if (this.config.enableMock) {
        return this.mockSubmitDocument(request);
      }
      
      // Call the AI service to submit the document
      const response = await firstValueFrom(
        this.httpService.post<{ jobId: string }>(`${this.config.baseUrl}/api/v1/documents`, request)
          .pipe(
            timeout(this.config.timeout),
            retry({ count: this.config.maxRetries, delay: 1000 }),
            catchError((error: AxiosError) => {
              this.handleHttpError(error, 'submitDocument');
              throw error;
            })
          )
      );
      
      const jobId = response.data.jobId;
      this.logger.log(`Document ${request.documentId} submitted successfully with job ID: ${jobId}`);
      
      return jobId;
    } catch (error) {
      this.logger.error(`Failed to submit document ${request.documentId}: ${error.message}`, error.stack);
      
      if (error instanceof BadRequestException || 
          error instanceof InternalServerErrorException ||
          error instanceof RequestTimeoutException) {
        throw error;
      }
      
      throw new InternalServerErrorException(`Failed to submit document: ${error.message}`);
    }
  }

  /**
   * Get the status of a document processing job
   * 
   * @param jobId Job ID from submitDocument
   * @returns Processing status
   */
  async getJobStatus(jobId: string): Promise<DocumentProcessingResult> {
    try {
      this.logger.log(`Checking status for job: ${jobId}`);
      
      // Use mock response if enabled
      if (this.config.enableMock) {
        return this.mockGetJobStatus(jobId);
      }
      
      // Call the AI service to get job status
      const response = await firstValueFrom(
        this.httpService.get<DocumentProcessingResult>(`${this.config.baseUrl}/api/v1/jobs/${jobId}`)
          .pipe(
            timeout(this.config.timeout),
            retry({ count: this.config.maxRetries, delay: 1000 }),
            catchError((error: AxiosError) => {
              this.handleHttpError(error, 'getJobStatus');
              throw error;
            })
          )
      );
      
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to get status for job ${jobId}: ${error.message}`, error.stack);
      
      if (error instanceof BadRequestException || 
          error instanceof NotFoundException ||
          error instanceof InternalServerErrorException ||
          error instanceof RequestTimeoutException) {
        throw error;
      }
      
      throw new InternalServerErrorException(`Failed to get job status: ${error.message}`);
    }
  }

  /**
   * Get the processing results for a completed job
   * 
   * @param jobId Job ID from submitDocument
   * @returns Processing results with domain suggestions
   */
  async getProcessingResults(jobId: string): Promise<DocumentProcessingResult> {
    try {
      this.logger.log(`Getting results for job: ${jobId}`);
      
      // Use mock response if enabled
      if (this.config.enableMock) {
        return this.mockGetProcessingResults(jobId);
      }
      
      // Call the AI service to get processing results
      const response = await firstValueFrom(
        this.httpService.get<DocumentProcessingResult>(`${this.config.baseUrl}/api/v1/jobs/${jobId}/results`)
          .pipe(
            timeout(this.config.timeout),
            retry({ count: this.config.maxRetries, delay: 1000 }),
            catchError((error: AxiosError) => {
              this.handleHttpError(error, 'getProcessingResults');
              throw error;
            })
          )
      );
      
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to get results for job ${jobId}: ${error.message}`, error.stack);
      
      if (error instanceof BadRequestException || 
          error instanceof NotFoundException ||
          error instanceof InternalServerErrorException ||
          error instanceof RequestTimeoutException) {
        throw error;
      }
      
      throw new InternalServerErrorException(`Failed to get processing results: ${error.message}`);
    }
  }

  /**
   * Extract entities from text directly (synchronous API)
   * 
   * @param text Text to analyze
   * @param options Extraction options
   * @returns Extracted entities
   */
  async extractEntities(
    text: string,
    options: {
      includeUmls?: boolean;
      includeSources?: boolean;
      confidenceThreshold?: number;
    } = {},
  ): Promise<ExtractedEntity[]> {
    try {
      this.logger.log(`Extracting entities from text (${text.length} chars)`);
      
      // Use mock response if enabled
      if (this.config.enableMock) {
        return this.mockExtractEntities(text, options);
      }
      
      // Set default options
      const confidenceThreshold = options.confidenceThreshold || this.config.confidenceThreshold;
      
      // Call the AI service to extract entities
      const response = await firstValueFrom(
        this.httpService.post<{ entities: ExtractedEntity[] }>(`${this.config.baseUrl}/api/v1/extract`, {
          text,
          includeUmls: options.includeUmls !== false,
          includeSources: options.includeSources === true,
          confidenceThreshold,
        })
          .pipe(
            timeout(this.config.timeout),
            retry({ count: this.config.maxRetries, delay: 1000 }),
            catchError((error: AxiosError) => {
              this.handleHttpError(error, 'extractEntities');
              throw error;
            })
          )
      );
      
      return response.data.entities;
    } catch (error) {
      this.logger.error(`Failed to extract entities: ${error.message}`, error.stack);
      
      if (error instanceof BadRequestException || 
          error instanceof InternalServerErrorException ||
          error instanceof RequestTimeoutException) {
        throw error;
      }
      
      throw new InternalServerErrorException(`Failed to extract entities: ${error.message}`);
    }
  }

  /**
   * Map entities to CalAIM domains
   * 
   * @param entities Extracted entities
   * @returns Domain suggestions
   */
  async mapToDomains(entities: ExtractedEntity[]): Promise<DomainSuggestion[]> {
    try {
      this.logger.log(`Mapping ${entities.length} entities to domains`);
      
      // Use mock response if enabled
      if (this.config.enableMock) {
        return this.mockMapToDomains(entities);
      }
      
      // Call the AI service to map entities to domains
      const response = await firstValueFrom(
        this.httpService.post<{ domains: DomainSuggestion[] }>(`${this.config.baseUrl}/api/v1/map-domains`, {
          entities,
        })
          .pipe(
            timeout(this.config.timeout),
            retry({ count: this.config.maxRetries, delay: 1000 }),
            catchError((error: AxiosError) => {
              this.handleHttpError(error, 'mapToDomains');
              throw error;
            })
          )
      );
      
      return response.data.domains;
    } catch (error) {
      this.logger.error(`Failed to map entities to domains: ${error.message}`, error.stack);
      
      if (error instanceof BadRequestException || 
          error instanceof InternalServerErrorException ||
          error instanceof RequestTimeoutException) {
        throw error;
      }
      
      throw new InternalServerErrorException(`Failed to map entities to domains: ${error.message}`);
    }
  }

  /**
   * Check the health of the AI service
   * 
   * @returns Boolean indicating if the service is healthy
   */
  async checkHealth(): Promise<boolean> {
    try {
      // Use mock response if enabled
      if (this.config.enableMock) {
        return true;
      }
      
      // Call the AI service health endpoint
      const response = await firstValueFrom(
        this.httpService.get<{ status: string }>(`${this.config.baseUrl}/health`)
          .pipe(
            timeout(5000), // Short timeout for health checks
            catchError((error: AxiosError) => {
              this.logger.error(`Health check failed: ${error.message}`);
              return Promise.resolve({ data: { status: 'error' } });
            })
          )
      );
      
      return response.data.status === 'ok';
    } catch (error) {
      this.logger.error(`Health check failed: ${error.message}`, error.stack);
      return false;
    }
  }

  /**
   * Cancel a processing job
   * 
   * @param jobId Job ID to cancel
   * @returns Boolean indicating success
   */
  async cancelJob(jobId: string): Promise<boolean> {
    try {
      this.logger.log(`Cancelling job: ${jobId}`);
      
      // Use mock response if enabled
      if (this.config.enableMock) {
        return true;
      }
      
      // Call the AI service to cancel the job
      await firstValueFrom(
        this.httpService.post<void>(`${this.config.baseUrl}/api/v1/jobs/${jobId}/cancel`)
          .pipe(
            timeout(this.config.timeout),
            catchError((error: AxiosError) => {
              this.handleHttpError(error, 'cancelJob');
              throw error;
            })
          )
      );
      
      return true;
    } catch (error) {
      this.logger.error(`Failed to cancel job ${jobId}: ${error.message}`, error.stack);
      
      if (error instanceof BadRequestException || 
          error instanceof NotFoundException ||
          error instanceof InternalServerErrorException) {
        throw error;
      }
      
      return false;
    }
  }

  /**
   * Handle HTTP errors from the AI service
   * 
   * @param error Axios error
   * @param operation Name of the operation that failed
   */
  private handleHttpError(error: AxiosError, operation: string): void {
    const status = error.response?.status;
    const data = error.response?.data as any;
    const message = data?.message || error.message;
    
    this.logger.error(
      `AI Service ${operation} failed: ${message}`,
      {
        status,
        operation,
        errorData: data,
        url: error.config?.url,
      }
    );
    
    // Map HTTP status codes to appropriate exceptions
    if (status === 400) {
      throw new BadRequestException(`AI Service ${operation} failed: ${message}`);
    } else if (status === 404) {
      throw new NotFoundException(`AI Service ${operation} failed: ${message}`);
    } else if (status === 408 || error.code === 'ECONNABORTED') {
      throw new RequestTimeoutException(`AI Service ${operation} timed out`);
    } else {
      throw new InternalServerErrorException(`AI Service ${operation} failed: ${message}`);
    }
  }

  /**
   * Mock implementation of submitDocument
   */
  private mockSubmitDocument(request: DocumentProcessingRequest): string {
    // Generate a fake job ID
    const jobId = `mock-job-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    this.logger.warn(`[MOCK] Document ${request.documentId} submitted with job ID: ${jobId}`);
    return jobId;
  }

  /**
   * Mock implementation of getJobStatus
   */
  private mockGetJobStatus(jobId: string): DocumentProcessingResult {
    // Determine a random status based on the job ID
    const hash = jobId.split('-').pop();
    const hashNum = parseInt(hash, 10) || 0;
    
    let status: ProcessingStatus;
    
    if (hashNum % 10 === 0) {
      status = ProcessingStatus.FAILED;
    } else if (hashNum % 5 === 0) {
      status = ProcessingStatus.MANUAL_REVIEW;
    } else if (hashNum % 3 === 0) {
      status = ProcessingStatus.PROCESSING;
    } else {
      status = ProcessingStatus.COMPLETED;
    }
    
    this.logger.warn(`[MOCK] Job ${jobId} status: ${status}`);
    
    return {
      jobId,
      documentId: `mock-doc-${hashNum}`,
      status,
      confidenceScore: status === ProcessingStatus.COMPLETED ? 0.85 : undefined,
      errorMessage: status === ProcessingStatus.FAILED ? 'Mock error message' : undefined,
      startedAt: new Date(Date.now() - 60000), // 1 minute ago
      completedAt: status === ProcessingStatus.COMPLETED ? new Date() : undefined,
    };
  }

  /**
   * Mock implementation of getProcessingResults
   */
  private mockGetProcessingResults(jobId: string): DocumentProcessingResult {
    // Generate mock domains and entities
    const domains: DomainSuggestion[] = [
      {
        domainType: 'PRESENTING_PROBLEM',
        content: {
          description: 'Patient presents with symptoms of major depressive disorder and generalized anxiety.',
          severity: 'MODERATE',
          duration: '6 months',
          impact: 'Significant impact on daily functioning and work performance.'
        },
        confidence: 0.92,
        entities: [
          {
            type: 'Diagnosis',
            text: 'major depressive disorder',
            confidence: 0.95,
            snomedCode: '370143000',
            icd10Code: 'F32.9'
          },
          {
            type: 'Diagnosis',
            text: 'generalized anxiety',
            confidence: 0.89,
            snomedCode: '48694002',
            icd10Code: 'F41.1'
          },
          {
            type: 'Symptom',
            text: 'insomnia',
            confidence: 0.87,
            snomedCode: '193462001'
          }
        ]
      },
      {
        domainType: 'BEHAVIORAL_HEALTH_HISTORY',
        content: {
          previousTreatment: 'Outpatient therapy in 2021',
          medications: ['Sertraline 50mg daily', 'Lorazepam 0.5mg as needed'],
          hospitalizations: 'None'
        },
        confidence: 0.78,
        entities: [
          {
            type: 'Medication',
            text: 'Sertraline 50mg daily',
            confidence: 0.92
          },
          {
            type: 'Medication',
            text: 'Lorazepam 0.5mg as needed',
            confidence: 0.90
          }
        ]
      },
      {
        domainType: 'RISK_ASSESSMENT',
        content: {
          suicideRisk: 'Low',
          homicideRisk: 'None',
          selfHarmHistory: 'Denies current ideation'
        },
        confidence: 0.85,
        entities: [
          {
            type: 'Risk_Behavior',
            text: 'Denies current ideation',
            confidence: 0.82
          }
        ]
      }
    ];
    
    this.logger.warn(`[MOCK] Returning results for job ${jobId} with ${domains.length} domains`);
    
    return {
      jobId,
      documentId: `mock-doc-${jobId.split('-').pop()}`,
      status: ProcessingStatus.COMPLETED,
      confidenceScore: 0.85,
      startedAt: new Date(Date.now() - 60000), // 1 minute ago
      completedAt: new Date(),
      domains
    };
  }

  /**
   * Mock implementation of extractEntities
   */
  private mockExtractEntities(
    text: string,
    options: {
      includeUmls?: boolean;
      includeSources?: boolean;
      confidenceThreshold?: number;
    }
  ): ExtractedEntity[] {
    // Generate mock entities based on text content
    const entities: ExtractedEntity[] = [];
    
    // Check for depression keywords
    if (text.toLowerCase().includes('depress')) {
      entities.push({
        type: 'Diagnosis',
        text: 'Major Depressive Disorder',
        confidence: 0.92,
        snomedCode: '370143000',
        icd10Code: 'F32.9',
        umlsCui: options.includeUmls ? 'C0011570' : undefined
      });
    }
    
    // Check for anxiety keywords
    if (text.toLowerCase().includes('anxiet') || text.toLowerCase().includes('anxious')) {
      entities.push({
        type: 'Diagnosis',
        text: 'Generalized Anxiety Disorder',
        confidence: 0.89,
        snomedCode: '48694002',
        icd10Code: 'F41.1',
        umlsCui: options.includeUmls ? 'C0003469' : undefined
      });
    }
    
    // Check for sleep issues
    if (text.toLowerCase().includes('sleep') || text.toLowerCase().includes('insomnia')) {
      entities.push({
        type: 'Symptom',
        text: 'Insomnia',
        confidence: 0.87,
        snomedCode: '193462001',
        umlsCui: options.includeUmls ? 'C0917801' : undefined
      });
    }
    
    // Add sources if requested
    if (options.includeSources) {
      entities.forEach(entity => {
        entity['sources'] = ['Mock source passage'];
      });
    }
    
    // Apply confidence threshold
    const threshold = options.confidenceThreshold || this.config.confidenceThreshold;
    const filteredEntities = entities.filter(entity => entity.confidence >= threshold);
    
    this.logger.warn(`[MOCK] Extracted ${filteredEntities.length} entities from text`);
    
    return filteredEntities;
  }

  /**
   * Mock implementation of mapToDomains
   */
  private mockMapToDomains(entities: ExtractedEntity[]): DomainSuggestion[] {
    // Group entities by type
    const diagnoses = entities.filter(e => e.type === 'Diagnosis');
    const symptoms = entities.filter(e => e.type === 'Symptom');
    const medications = entities.filter(e => e.type === 'Medication');
    const riskBehaviors = entities.filter(e => e.type === 'Risk_Behavior');
    
    // Create domain suggestions based on entity types
    const domains: DomainSuggestion[] = [];
    
    // Presenting Problem domain
    if (diagnoses.length > 0 || symptoms.length > 0) {
      domains.push({
        domainType: 'PRESENTING_PROBLEM',
        content: {
          description: this.generateDescription(diagnoses, symptoms),
          severity: this.determineSeverity(entities),
        },
        confidence: 0.9,
        entities: [...diagnoses, ...symptoms]
      });
    }
    
    // Behavioral Health History domain
    if (medications.length > 0) {
      domains.push({
        domainType: 'BEHAVIORAL_HEALTH_HISTORY',
        content: {
          medications: medications.map(m => m.text),
        },
        confidence: 0.8,
        entities: medications
      });
    }
    
    // Risk Assessment domain
    if (riskBehaviors.length > 0) {
      domains.push({
        domainType: 'RISK_ASSESSMENT',
        content: {
          riskFactors: riskBehaviors.map(r => r.text),
        },
        confidence: 0.85,
        entities: riskBehaviors
      });
    }
    
    this.logger.warn(`[MOCK] Mapped entities to ${domains.length} domains`);
    
    return domains;
  }

  /**
   * Generate a description from diagnoses and symptoms
   */
  private generateDescription(diagnoses: ExtractedEntity[], symptoms: ExtractedEntity[]): string {
    let description = 'Patient presents with ';
    
    if (diagnoses.length > 0) {
      description += diagnoses.map(d => d.text).join(' and ');
      
      if (symptoms.length > 0) {
        description += ', with symptoms including ';
        description += symptoms.map(s => s.text).join(' and ');
      }
    } else if (symptoms.length > 0) {
      description += 'symptoms including ';
      description += symptoms.map(s => s.text).join(' and ');
    } else {
      description += 'unspecified concerns';
    }
    
    return description + '.';
  }

  /**
   * Determine severity based on entities
   */
  private determineSeverity(entities: ExtractedEntity[]): string {
    // Count high-confidence entities
    const highConfidenceCount = entities.filter(e => e.confidence > 0.9).length;
    
    if (highConfidenceCount >= 3) {
      return 'SEVERE';
    } else if (highConfidenceCount >= 1) {
      return 'MODERATE';
    } else {
      return 'MILD';
    }
  }
}
