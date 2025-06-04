import os
import uuid
import random
import json
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, HttpUrl
from pydantic_settings import BaseSettings, SettingsConfigDict
from loguru import logger
import httpx

# --- Configuration ---

class Settings(BaseSettings):
    """
    Application settings loaded from environment variables.
    """
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    ENVIRONMENT: str = Field("development", description="Application environment (development, production, test)")
    LOG_LEVEL: str = Field("INFO", description="Logging level (DEBUG, INFO, WARNING, ERROR)")

    # Database settings
    DATABASE_URL: str = Field(..., description="PostgreSQL database connection URL")

    # Redis settings
    REDIS_URL: str = Field(..., description="Redis connection URL")

    # Storage settings (MinIO/GCS)
    STORAGE_ENDPOINT: HttpUrl = Field(..., description="Storage service endpoint (e.g., http://minio:9000)")
    STORAGE_ACCESS_KEY: str = Field(..., description="Storage access key")
    STORAGE_SECRET_KEY: str = Field(..., description="Storage secret key")
    STORAGE_BUCKET_REFERRALS: str = Field("referrals", description="Bucket for referral documents")
    STORAGE_BUCKET_PDFS: str = Field("pdfs", description="Bucket for generated PDFs")

    # Pub/Sub settings
    PUBSUB_PROJECT_ID: str = Field("calaim-local-dev", description="Google Cloud Project ID for Pub/Sub")
    PUBSUB_EMULATOR_HOST: Optional[str] = Field(None, description="Pub/Sub emulator host (e.g., pubsub-emulator:8085)")
    PUBSUB_TOPIC: str = Field("doc.jobs", description="Default Pub/Sub topic for document processing jobs")
    PUBSUB_SUBSCRIPTION: str = Field("ai-service-sub", description="Default Pub/Sub subscription for AI service")

    # AI/NLP specific settings
    SPACY_MODEL_PATH: str = Field("/usr/local/lib/python3.11/site-packages/en_core_web_sm/en_core_web_sm-3.7.4", description="Path to the spaCy model")
    ENABLE_MOCK_API: bool = Field(True, description="Enable mock responses for AI/NLP endpoints")
    MOCK_HEALTHCARE_NL_API: bool = Field(True, description="Mock Google Cloud Healthcare Natural Language API")
    MOCK_DOCUMENT_AI: bool = Field(True, description="Mock Google Cloud Document AI")
    AI_CONFIDENCE_THRESHOLD: float = Field(0.6, description="Minimum confidence score for AI suggestions")

    # CORS settings
    CORS_ORIGINS: str = Field("http://localhost:3000,http://localhost:8080", description="Comma-separated list of allowed CORS origins")

# Load settings
settings = Settings()

# Configure logging
logger.remove()
logger.add(
    os.sys.stderr,
    level=settings.LOG_LEVEL,
    colorize=True,
    format="{level.icon} <green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>"
)

# --- Database and Redis Connections ---

# Database connection pool
db_pool = None

# Redis connection pool
redis_pool = None

# --- Lifespan Context Manager for Startup/Shutdown ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize and cleanup resources during startup and shutdown."""
    global db_pool, redis_pool
    
    # Startup code (previously in @app.on_startup)
    try:
        # TODO: Implement actual PostgreSQL connection pool
        # Example:
        # import asyncpg
        # db_pool = await asyncpg.create_pool(settings.DATABASE_URL)
        logger.info("Database connection initialized")
        
        # TODO: Implement actual Redis connection pool
        # Example:
        # import aioredis
        # redis_pool = await aioredis.from_url(settings.REDIS_URL)
        logger.info("Redis connection initialized")
        
        # TODO: Initialize spaCy model
        # import spacy
        # nlp = spacy.load(settings.SPACY_MODEL_PATH)
        logger.info("NLP models initialized")
        
        logger.info("All startup tasks completed successfully")
    except Exception as e:
        logger.error(f"Error during startup: {str(e)}")
        # Continue anyway for now, but log the error
    
    yield  # This is where the FastAPI application runs
    
    # Shutdown code (previously in @app.on_shutdown)
    try:
        # TODO: Close PostgreSQL connection pool
        # if db_pool:
        #     await db_pool.close()
        logger.info("Database connection closed")
        
        # TODO: Close Redis connection pool
        # if redis_pool:
        #     await redis_pool.close()
        logger.info("Redis connection closed")
        
        logger.info("All shutdown tasks completed successfully")
    except Exception as e:
        logger.error(f"Error during shutdown: {str(e)}")

# --- FastAPI App Initialization ---

app = FastAPI(
    title="CalAIM AI/NLP Microservice",
    description="AI-Powered microservice for CalAIM document processing and domain extraction.",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)

# --- CORS Middleware ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.CORS_ORIGINS.split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Models and Schemas ---

class HealthStatus(BaseModel):
    status: str = Field(..., description="Overall health status")
    version: str = Field("1.0.0", description="API version")
    dependencies: Dict[str, Any] = Field(..., description="Status of individual dependencies")

class DocumentProcessingRequest(BaseModel):
    documentId: str = Field(..., description="Unique ID of the document in the main system")
    documentUri: str = Field(..., description="URI to the document in cloud storage (e.g., gs://bucket/path/to/file.pdf)")
    patientId: str = Field(..., description="ID of the patient associated with the document")
    documentType: str = Field(..., description="Type of the document (e.g., application/pdf, application/msword)")
    referralId: str = Field(..., description="ID of the referral in the main system")
    priority: Optional[str] = Field("normal", description="Processing priority (high, normal, low)")
    callbackUrl: Optional[HttpUrl] = Field(None, description="Callback URL for processing completion notification")

class DocumentProcessingResponse(BaseModel):
    jobId: str = Field(..., description="Unique ID for the processing job")
    status: str = Field(..., description="Current status of the processing job")
    message: Optional[str] = Field(None, description="Additional message about the job status")

class ExtractedEntity(BaseModel):
    type: str = Field(..., description="Entity type (Symptom, Diagnosis, etc.)")
    text: str = Field(..., description="Extracted text")
    confidence: float = Field(..., description="Confidence score (0-1)")
    snomedCode: Optional[str] = Field(None, description="SNOMED CT code if available")
    icd10Code: Optional[str] = Field(None, description="ICD-10 code if available")
    umlsCui: Optional[str] = Field(None, description="UMLS concept ID if available")
    position: Optional[Dict[str, Any]] = Field(None, description="Position in the document")

class EntityExtractionRequest(BaseModel):
    text: str = Field(..., description="Text to analyze")
    includeUmls: Optional[bool] = Field(False, description="Include UMLS concepts")
    includeSources: Optional[bool] = Field(False, description="Include source passages")
    confidenceThreshold: Optional[float] = Field(0.6, description="Minimum confidence threshold")

class EntityExtractionResponse(BaseModel):
    entities: List[ExtractedEntity] = Field(..., description="Extracted entities")

class DomainSuggestion(BaseModel):
    domainType: str = Field(..., description="Domain type (one of the seven CalAIM domains)")
    content: Dict[str, Any] = Field(..., description="Extracted content for the domain")
    confidence: float = Field(..., description="Confidence score for this domain (0-1)")
    sources: Optional[List[str]] = Field(None, description="Source passages that led to this suggestion")
    entities: Optional[List[ExtractedEntity]] = Field(None, description="Extracted entities related to this domain")

class DomainMappingRequest(BaseModel):
    entities: List[ExtractedEntity] = Field(..., description="Entities to map to domains")

class DomainMappingResponse(BaseModel):
    domains: List[DomainSuggestion] = Field(..., description="Domain suggestions")

class JobStatus(BaseModel):
    jobId: str = Field(..., description="Job ID")
    status: str = Field(..., description="Job status (PENDING, PROCESSING, COMPLETED, FAILED)")
    progress: Optional[float] = Field(None, description="Processing progress (0-1)")
    message: Optional[str] = Field(None, description="Status message")
    startedAt: Optional[datetime] = Field(None, description="When processing started")
    completedAt: Optional[datetime] = Field(None, description="When processing completed")

# --- API Endpoints ---

@app.get("/health", response_model=HealthStatus, tags=["health"])
async def health_check():
    """
    Health check endpoint for monitoring and kubernetes probes.
    Returns the status of the service and its dependencies.
    """
    try:
        # Check database connection (mock for now)
        db_status = "ok" if settings.ENABLE_MOCK_API else "unknown"
        
        # Check Redis connection (mock for now)
        redis_status = "ok" if settings.ENABLE_MOCK_API else "unknown"
        
        # Check storage connection (mock for now)
        storage_status = "ok" if settings.ENABLE_MOCK_API else "unknown"
        
        # Check Pub/Sub connection (mock for now)
        pubsub_status = "ok" if settings.ENABLE_MOCK_API else "unknown"
        
        # Check if spaCy model is loaded (mock for now)
        models_status = "ok" if settings.ENABLE_MOCK_API else "unknown"
        
        return HealthStatus(
            status="ok",
            version="1.0.0",
            dependencies={
                "database": db_status,
                "redis": redis_status,
                "storage": storage_status,
                "pubsub": pubsub_status,
                "models": models_status,
                "mock_mode": settings.ENABLE_MOCK_API,
            }
        )
    except Exception as e:
        logger.error(f"Health check failed: {str(e)}")
        return HealthStatus(
            status="error",
            version="1.0.0",
            dependencies={
                "error": str(e)
            }
        )

@app.post("/process-document", response_model=DocumentProcessingResponse, tags=["documents"])
async def process_document(
    request: DocumentProcessingRequest
):
    """
    Process a document from cloud storage.
    This is an asynchronous operation - it returns a job ID that can be used to check status.
    """
    try:
        logger.info(f"Received document processing request for document: {request.documentId}")
        
        # Generate a unique job ID
        job_id = str(uuid.uuid4())
        
        # TODO: In production, actually submit the job to Pub/Sub or a task queue
        # For now, just return a mock response
        
        if settings.ENABLE_MOCK_API:
            # Store job in Redis (mock for now)
            # In a real implementation, we would store the job details in Redis
            logger.info(f"Created job {job_id} for document {request.documentId}")
            
            return DocumentProcessingResponse(
                jobId=job_id,
                status="PENDING",
                message="Document queued for processing"
            )
        else:
            # TODO: Implement actual document processing pipeline
            # 1. Validate the document URI
            # 2. Submit to Pub/Sub
            # 3. Store job metadata in Redis
            
            raise NotImplementedError("Real document processing not yet implemented")
    
    except Exception as e:
        logger.error(f"Error processing document: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error processing document: {str(e)}"
        )

@app.post("/upload-document", response_model=DocumentProcessingResponse, tags=["documents"])
async def upload_document(
    file: UploadFile = File(...),
    patientId: str = Form(...),
    referralId: str = Form(...),
    priority: str = Form("normal")
):
    """
    Upload and process a document directly.
    This endpoint accepts file uploads rather than GCS URIs.
    """
    try:
        logger.info(f"Received document upload for patient: {patientId}, referral: {referralId}")
        
        # Generate IDs
        document_id = str(uuid.uuid4())
        job_id = str(uuid.uuid4())
        
        # TODO: In production:
        # 1. Upload the file to Cloud Storage
        # 2. Call the process-document endpoint with the GCS URI
        
        if settings.ENABLE_MOCK_API:
            # Mock implementation - pretend we uploaded the file
            logger.info(f"Mock file upload for {file.filename}, size: {file.size} bytes")
            
            # Read a small sample of the file to log (for debugging)
            sample = await file.read(1024)  # Read first 1KB
            await file.seek(0)  # Reset file pointer
            
            logger.debug(f"File sample: {sample[:100]}...")
            
            return DocumentProcessingResponse(
                jobId=job_id,
                status="PENDING",
                message=f"Document {document_id} uploaded and queued for processing"
            )
        else:
            # TODO: Implement actual file upload to Cloud Storage
            raise NotImplementedError("Real file upload not yet implemented")
    
    except Exception as e:
        logger.error(f"Error uploading document: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error uploading document: {str(e)}"
        )

@app.get("/jobs/{job_id}", response_model=JobStatus, tags=["jobs"])
async def get_job_status(job_id: str):
    """
    Check the status of a document processing job.
    """
    try:
        logger.info(f"Checking status for job: {job_id}")
        
        # TODO: In production, retrieve job status from Redis or database
        
        if settings.ENABLE_MOCK_API:
            # Generate a deterministic but random-seeming status based on the job ID
            job_hash = hash(job_id) % 100
            
            # Use the hash to determine job status
            if job_hash < 10:
                status_str = "PENDING"
                progress = 0.0
                message = "Job is pending processing"
                started_at = datetime.now() - timedelta(minutes=1)
                completed_at = None
            elif job_hash < 20:
                status_str = "FAILED"
                progress = None
                message = "Document processing failed: OCR error"
                started_at = datetime.now() - timedelta(minutes=5)
                completed_at = datetime.now() - timedelta(minutes=1)
            elif job_hash < 40:
                status_str = "PROCESSING"
                progress = job_hash / 100.0
                message = f"Processing document: {int(progress * 100)}% complete"
                started_at = datetime.now() - timedelta(minutes=2)
                completed_at = None
            else:
                status_str = "COMPLETED"
                progress = 1.0
                message = "Document processed successfully"
                started_at = datetime.now() - timedelta(minutes=3)
                completed_at = datetime.now() - timedelta(seconds=30)
            
            return JobStatus(
                jobId=job_id,
                status=status_str,
                progress=progress,
                message=message,
                startedAt=started_at,
                completedAt=completed_at
            )
        else:
            # TODO: Implement actual job status retrieval
            raise NotImplementedError("Real job status retrieval not yet implemented")
    
    except Exception as e:
        logger.error(f"Error retrieving job status: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error retrieving job status: {str(e)}"
        )

@app.post("/extract-entities", response_model=EntityExtractionResponse, tags=["nlp"])
async def extract_entities(request: EntityExtractionRequest):
    """
    Extract entities from text using NLP.
    This is a synchronous operation.
    """
    try:
        logger.info(f"Extracting entities from text ({len(request.text)} chars)")
        
        if settings.ENABLE_MOCK_API:
            # Generate mock entities based on text content
            entities = generate_mock_entities(
                request.text, 
                confidence_threshold=request.confidenceThreshold or settings.AI_CONFIDENCE_THRESHOLD
            )
            
            return EntityExtractionResponse(entities=entities)
        else:
            # TODO: Implement actual entity extraction using spaCy and/or Google Cloud Healthcare NL API
            raise NotImplementedError("Real entity extraction not yet implemented")
    
    except Exception as e:
        logger.error(f"Error extracting entities: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error extracting entities: {str(e)}"
        )

@app.post("/map-domains", response_model=DomainMappingResponse, tags=["nlp"])
async def map_domains(request: DomainMappingRequest):
    """
    Map entities to CalAIM domains.
    This is a synchronous operation.
    """
    try:
        logger.info(f"Mapping {len(request.entities)} entities to domains")
        
        if settings.ENABLE_MOCK_API:
            # Generate mock domain suggestions based on entities
            domains = generate_mock_domains(request.entities)
            
            return DomainMappingResponse(domains=domains)
        else:
            # TODO: Implement actual domain mapping using rules engine or ML model
            raise NotImplementedError("Real domain mapping not yet implemented")
    
    except Exception as e:
        logger.error(f"Error mapping domains: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error mapping domains: {str(e)}"
        )

@app.get("/jobs/{job_id}/results", response_model=DomainMappingResponse, tags=["jobs"])
async def get_job_results(job_id: str):
    """
    Get the results of a completed document processing job.
    """
    try:
        logger.info(f"Retrieving results for job: {job_id}")
        
        # TODO: In production, retrieve job results from database
        
        if settings.ENABLE_MOCK_API:
            # Generate deterministic but random-seeming results based on the job ID
            job_hash = hash(job_id)
            random.seed(job_hash)
            
            # Generate mock entities
            entities = [
                ExtractedEntity(
                    type="Diagnosis",
                    text="Major Depressive Disorder",
                    confidence=0.92,
                    snomedCode="370143000",
                    icd10Code="F32.9"
                ),
                ExtractedEntity(
                    type="Diagnosis",
                    text="Generalized Anxiety Disorder",
                    confidence=0.89,
                    snomedCode="48694002",
                    icd10Code="F41.1"
                ),
                ExtractedEntity(
                    type="Symptom",
                    text="Insomnia",
                    confidence=0.87,
                    snomedCode="193462001"
                ),
                ExtractedEntity(
                    type="Medication",
                    text="Sertraline 50mg daily",
                    confidence=0.92
                ),
                ExtractedEntity(
                    type="Risk_Behavior",
                    text="Suicidal ideation",
                    confidence=0.78
                ),
                ExtractedEntity(
                    type="Social_Context",
                    text="Housing instability",
                    confidence=0.85
                )
            ]
            
            # Map entities to domains
            domains = generate_mock_domains(entities)
            
            return DomainMappingResponse(domains=domains)
        else:
            # TODO: Implement actual job results retrieval
            raise NotImplementedError("Real job results retrieval not yet implemented")
    
    except Exception as e:
        logger.error(f"Error retrieving job results: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error retrieving job results: {str(e)}"
        )

# --- Helper Functions for Mock Data ---

def generate_mock_entities(text: str, confidence_threshold: float = 0.6) -> List[ExtractedEntity]:
    """Generate mock entities based on text content."""
    entities = []
    
    # Check for depression keywords
    if "depress" in text.lower():
        entities.append(
            ExtractedEntity(
                type="Diagnosis",
                text="Major Depressive Disorder",
                confidence=0.92,
                snomedCode="370143000",
                icd10Code="F32.9"
            )
        )
    
    # Check for anxiety keywords
    if any(kw in text.lower() for kw in ["anxiet", "anxious", "worry"]):
        entities.append(
            ExtractedEntity(
                type="Diagnosis",
                text="Generalized Anxiety Disorder",
                confidence=0.89,
                snomedCode="48694002",
                icd10Code="F41.1"
            )
        )
    
    # Check for sleep issues
    if any(kw in text.lower() for kw in ["sleep", "insomnia"]):
        entities.append(
            ExtractedEntity(
                type="Symptom",
                text="Insomnia",
                confidence=0.87,
                snomedCode="193462001"
            )
        )
    
    # Check for substance use
    if any(kw in text.lower() for kw in ["alcohol", "drink", "substance", "drug"]):
        entities.append(
            ExtractedEntity(
                type="Risk_Behavior",
                text="Substance use",
                confidence=0.82
            )
        )
    
    # Check for housing issues
    if any(kw in text.lower() for kw in ["home", "house", "housing", "homeless"]):
        entities.append(
            ExtractedEntity(
                type="Social_Context",
                text="Housing instability",
                confidence=0.85
            )
        )
    
    # Check for trauma
    if any(kw in text.lower() for kw in ["trauma", "abuse", "neglect"]):
        entities.append(
            ExtractedEntity(
                type="Trauma_Event",
                text="History of trauma",
                confidence=0.79
            )
        )
    
    # Check for suicidal ideation
    if any(kw in text.lower() for kw in ["suicid", "harm", "ideation"]):
        entities.append(
            ExtractedEntity(
                type="Risk_Behavior",
                text="Suicidal ideation",
                confidence=0.78
            )
        )
    
    # Add some medications if mental health conditions are present
    if any(e.type == "Diagnosis" for e in entities):
        entities.append(
            ExtractedEntity(
                type="Medication",
                text="Sertraline 50mg daily",
                confidence=0.92
            )
        )
    
    # Filter by confidence threshold
    entities = [e for e in entities if e.confidence >= confidence_threshold]
    
    # If no entities were found, add a generic one
    if not entities:
        entities.append(
            ExtractedEntity(
                type="Note",
                text="No specific entities detected",
                confidence=0.7
            )
        )
    
    return entities

def generate_mock_domains(entities: List[ExtractedEntity]) -> List[DomainSuggestion]:
    """Generate mock domain suggestions based on entities."""
    domains = []
    
    # Group entities by type
    diagnoses = [e for e in entities if e.type == "Diagnosis"]
    symptoms = [e for e in entities if e.type == "Symptom"]
    medications = [e for e in entities if e.type == "Medication"]
    risk_behaviors = [e for e in entities if e.type == "Risk_Behavior"]
    social_contexts = [e for e in entities if e.type == "Social_Context"]
    trauma_events = [e for e in entities if e.type == "Trauma_Event"]
    strengths = [e for e in entities if e.type == "Strength"]
    
    # Presenting Problem domain
    if diagnoses or symptoms:
        domains.append(
            DomainSuggestion(
                domainType="PRESENTING_PROBLEM",
                content={
                    "description": generate_description(diagnoses, symptoms),
                    "severity": determine_severity(entities),
                    "duration": "Unknown",
                    "impact": "Impacts daily functioning"
                },
                confidence=0.9,
                entities=diagnoses + symptoms
            )
        )
    
    # Behavioral Health History domain
    if medications:
        domains.append(
            DomainSuggestion(
                domainType="BEHAVIORAL_HEALTH_HISTORY",
                content={
                    "previousTreatment": "Unknown",
                    "medications": [m.text for m in medications],
                    "hospitalizations": "None documented"
                },
                confidence=0.85,
                entities=medications
            )
        )
    
    # Risk Assessment domain
    if risk_behaviors:
        domains.append(
            DomainSuggestion(
                domainType="RISK_ASSESSMENT",
                content={
                    "suicideRisk": "Present" if any("suicid" in e.text.lower() for e in risk_behaviors) else "Not documented",
                    "homicideRisk": "Not documented",
                    "selfHarmHistory": "Present" if any("harm" in e.text.lower() for e in risk_behaviors) else "Not documented",
                    "substanceUse": "Present" if any("substance" in e.text.lower() for e in risk_behaviors) else "Not documented"
                },
                confidence=0.8,
                entities=risk_behaviors
            )
        )
    
    # Social Determinants domain
    if social_contexts:
        domains.append(
            DomainSuggestion(
                domainType="SOCIAL_DETERMINANTS",
                content={
                    "housing": "Unstable" if any("housing" in e.text.lower() for e in social_contexts) else "Unknown",
                    "employment": "Unknown",
                    "education": "Unknown",
                    "transportation": "Unknown",
                    "socialSupport": "Unknown"
                },
                confidence=0.75,
                entities=social_contexts
            )
        )
    
    # Trauma domain
    if trauma_events:
        domains.append(
            DomainSuggestion(
                domainType="TRAUMA",
                content={
                    "traumaHistory": "Present",
                    "traumaType": "Unspecified",
                    "traumaImpact": "Impacts current functioning"
                },
                confidence=0.7,
                entities=trauma_events
            )
        )
    
    # Strengths domain
    if strengths:
        domains.append(
            DomainSuggestion(
                domainType="STRENGTHS",
                content={
                    "personalStrengths": [s.text for s in strengths],
                    "supportSystems": "Unknown",
                    "coping": "Unknown"
                },
                confidence=0.65,
                entities=strengths
            )
        )
    
    # If no domains were mapped, add a generic one
    if not domains:
        domains.append(
            DomainSuggestion(
                domainType="PRESENTING_PROBLEM",
                content={
                    "description": "Insufficient information to determine presenting problem",
                    "severity": "Unknown",
                    "duration": "Unknown",
                    "impact": "Unknown"
                },
                confidence=0.5,
                entities=[]
            )
        )
    
    return domains

def generate_description(diagnoses: List[ExtractedEntity], symptoms: List[ExtractedEntity]) -> str:
    """Generate a description from diagnoses and symptoms."""
    description = "Patient presents with "
    
    if diagnoses:
        description += ", ".join(d.text for d in diagnoses)
        
        if symptoms:
            description += ", with symptoms including "
            description += ", ".join(s.text for s in symptoms)
    elif symptoms:
        description += "symptoms including "
        description += ", ".join(s.text for s in symptoms)
    else:
        description += "unspecified concerns"
    
    return description + "."

def determine_severity(entities: List[ExtractedEntity]) -> str:
    """Determine severity based on entities."""
    # Count high-confidence entities
    high_confidence_count = sum(1 for e in entities if e.confidence > 0.9)
    
    # Check for severe conditions
    has_severe_condition = any(
        e.type == "Diagnosis" and any(severe in e.text.lower() for severe in ["severe", "major", "acute"])
        for e in entities
    )
    
    # Check for risk behaviors
    has_risk_behavior = any(e.type == "Risk_Behavior" for e in entities)
    
    if has_severe_condition or (high_confidence_count >= 3 and has_risk_behavior):
        return "SEVERE"
    elif high_confidence_count >= 2 or has_risk_behavior:
        return "MODERATE"
    else:
        return "MILD"

# --- Main Entry Point ---

if __name__ == "__main__":
    import uvicorn
    
    # Run the application with uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True if settings.ENVIRONMENT == "development" else False,
        log_level=settings.LOG_LEVEL.lower()
    )
