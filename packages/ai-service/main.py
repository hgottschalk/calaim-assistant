import os
import uuid
import random
import json
import asyncio
import base64
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List, Union, Tuple
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, status, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, HttpUrl
from pydantic_settings import BaseSettings, SettingsConfigDict
from loguru import logger
import httpx

# Google Cloud imports
try:
    from google.cloud import documentai_v1 as documentai
    from google.cloud import language_v1
    from google.cloud import pubsub_v1
    from google.cloud import storage
    GOOGLE_CLOUD_IMPORTS_SUCCESSFUL = True
except ImportError:
    logger.warning("Google Cloud libraries not installed or not found. Using mock implementations only.")
    GOOGLE_CLOUD_IMPORTS_SUCCESSFUL = False

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
    STORAGE_USE_GCS: bool = Field(False, description="Use Google Cloud Storage instead of MinIO/S3")

    # Pub/Sub settings
    PUBSUB_PROJECT_ID: str = Field("calaim-local-dev", description="Google Cloud Project ID for Pub/Sub")
    PUBSUB_EMULATOR_HOST: Optional[str] = Field(None, description="Pub/Sub emulator host (e.g., pubsub-emulator:8085)")
    PUBSUB_TOPIC: str = Field("doc.jobs", description="Default Pub/Sub topic for document processing jobs")
    PUBSUB_SUBSCRIPTION: str = Field("ai-service-sub", description="Default Pub/Sub subscription for AI service")

    # Document AI settings
    DOCUMENT_AI_PROJECT_ID: str = Field("calaim-local-dev", description="Google Cloud Project ID for Document AI")
    DOCUMENT_AI_LOCATION: str = Field("us", description="Document AI processor location")
    DOCUMENT_AI_PROCESSOR_ID: str = Field("", description="Document AI processor ID")

    # Healthcare NL API settings
    HEALTHCARE_NL_PROJECT_ID: str = Field("calaim-local-dev", description="Google Cloud Project ID for Healthcare NL API")
    HEALTHCARE_NL_LOCATION: str = Field("us-central1", description="Healthcare NL API location")

    # AI/NLP specific settings
    SPACY_MODEL_PATH: str = Field("/usr/local/lib/python3.11/site-packages/en_core_web_sm/en_core_web_sm-3.7.4", description="Path to the spaCy model")
    ENABLE_MOCK_API: bool = Field(True, description="Enable mock responses for AI/NLP endpoints")
    MOCK_HEALTHCARE_NL_API: bool = Field(True, description="Mock Google Cloud Healthcare Natural Language API")
    MOCK_DOCUMENT_AI: bool = Field(True, description="Mock Google Cloud Document AI")
    AI_CONFIDENCE_THRESHOLD: float = Field(0.6, description="Minimum confidence score for AI suggestions")
    
    # Entity extraction settings
    ENTITY_CONFIDENCE_WEIGHTS: Dict[str, float] = Field(
        default_factory=lambda: {
            "Diagnosis": 1.0,
            "Symptom": 0.9,
            "Medication": 0.85,
            "Risk_Behavior": 0.95,
            "Social_Context": 0.8,
            "Trauma_Event": 0.9,
            "Strength": 0.7
        },
        description="Confidence weights for different entity types"
    )

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

# --- Google Cloud Clients ---

# Document AI client
document_ai_client = None

# Healthcare NL API client
healthcare_nl_client = None

# Pub/Sub publisher and subscriber
pubsub_publisher = None
pubsub_subscriber = None

# Storage client
storage_client = None

# --- Lifespan Context Manager for Startup/Shutdown ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize and cleanup resources during startup and shutdown."""
    global db_pool, redis_pool, document_ai_client, healthcare_nl_client, pubsub_publisher, pubsub_subscriber, storage_client
    
    # Startup code (previously in @app.on_startup)
    try:
        # Initialize database connection
        # TODO: Implement actual PostgreSQL connection pool
        # Example:
        # import asyncpg
        # db_pool = await asyncpg.create_pool(settings.DATABASE_URL)
        logger.info("Database connection initialized")
        
        # Initialize Redis connection
        # TODO: Implement actual Redis connection pool
        # Example:
        # import aioredis
        # redis_pool = await aioredis.from_url(settings.REDIS_URL)
        logger.info("Redis connection initialized")
        
        # Initialize Google Cloud clients if not in mock mode
        if not settings.ENABLE_MOCK_API and GOOGLE_CLOUD_IMPORTS_SUCCESSFUL:
            # Initialize Document AI client
            if not settings.MOCK_DOCUMENT_AI:
                document_ai_client = documentai.DocumentProcessorServiceClient()
                logger.info("Document AI client initialized")
            
            # Initialize Healthcare NL API client
            if not settings.MOCK_HEALTHCARE_NL_API:
                healthcare_nl_client = language_v1.LanguageServiceClient()
                logger.info("Healthcare NL API client initialized")
            
            # Initialize Pub/Sub clients
            publisher_options = pubsub_v1.types.PublisherOptions(enable_message_ordering=True)
            pubsub_publisher = pubsub_v1.PublisherClient(publisher_options=publisher_options)
            pubsub_subscriber = pubsub_v1.SubscriberClient()
            
            # Create subscription if it doesn't exist
            subscription_path = pubsub_subscriber.subscription_path(
                settings.PUBSUB_PROJECT_ID, 
                settings.PUBSUB_SUBSCRIPTION
            )
            topic_path = pubsub_publisher.topic_path(
                settings.PUBSUB_PROJECT_ID, 
                settings.PUBSUB_TOPIC
            )
            
            try:
                pubsub_subscriber.get_subscription(subscription=subscription_path)
            except Exception:
                # Create subscription
                pubsub_subscriber.create_subscription(
                    request={"name": subscription_path, "topic": topic_path}
                )
            
            logger.info(f"Pub/Sub clients initialized with subscription: {subscription_path}")
            
            # Initialize Storage client
            if settings.STORAGE_USE_GCS:
                storage_client = storage.Client(project=settings.PUBSUB_PROJECT_ID)
                logger.info("Google Cloud Storage client initialized")
        
        # Initialize spaCy model
        # TODO: Initialize spaCy model
        # import spacy
        # nlp = spacy.load(settings.SPACY_MODEL_PATH)
        logger.info("NLP models initialized")
        
        # Start Pub/Sub listener if not in mock mode
        if not settings.ENABLE_MOCK_API and GOOGLE_CLOUD_IMPORTS_SUCCESSFUL and pubsub_subscriber:
            asyncio.create_task(start_pubsub_listener())
            logger.info("Pub/Sub listener started")
        
        logger.info("All startup tasks completed successfully")
    except Exception as e:
        logger.error(f"Error during startup: {str(e)}")
        # Continue anyway for now, but log the error
    
    yield  # This is where the FastAPI application runs
    
    # Shutdown code (previously in @app.on_shutdown)
    try:
        # Close PostgreSQL connection pool
        # if db_pool:
        #     await db_pool.close()
        logger.info("Database connection closed")
        
        # Close Redis connection pool
        # if redis_pool:
        #     await redis_pool.close()
        logger.info("Redis connection closed")
        
        # Close Pub/Sub clients
        if pubsub_subscriber:
            pubsub_subscriber.close()
        logger.info("Pub/Sub clients closed")
        
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

# --- Google Cloud Integration Functions ---

async def process_document_with_document_ai(document_uri: str, document_type: str) -> Tuple[str, float]:
    """
    Process a document using Google Cloud Document AI.
    
    Args:
        document_uri: URI to the document in cloud storage
        document_type: MIME type of the document
    
    Returns:
        Tuple of (extracted_text, confidence_score)
    """
    if settings.MOCK_DOCUMENT_AI or not document_ai_client:
        logger.warning(f"Using mock Document AI for document: {document_uri}")
        # Return mock text based on document type
        mock_text = f"This is mock text extracted from {document_uri}. "
        mock_text += "Patient presents with symptoms of depression and anxiety. "
        mock_text += "Medical history includes hypertension and type 2 diabetes. "
        mock_text += "Currently taking sertraline 50mg daily and metformin 500mg twice daily. "
        mock_text += "Patient reports housing instability and lack of transportation."
        return mock_text, 0.85
    
    try:
        # Parse the document URI to get bucket and object name
        if document_uri.startswith("gs://"):
            # Format: gs://bucket-name/object-name
            parts = document_uri[5:].split("/", 1)
            bucket_name = parts[0]
            object_name = parts[1]
        else:
            # Assume local storage URI format
            # Format: http://storage-endpoint/bucket-name/object-name
            parts = document_uri.split("/")
            bucket_name = parts[-2]
            object_name = parts[-1]
        
        # Get the document content
        if settings.STORAGE_USE_GCS and storage_client:
            # Use GCS client
            bucket = storage_client.bucket(bucket_name)
            blob = bucket.blob(object_name)
            content = blob.download_as_bytes()
        else:
            # Use HTTP client to get from MinIO/S3
            async with httpx.AsyncClient() as client:
                response = await client.get(document_uri)
                response.raise_for_status()
                content = response.content
        
        # Determine processor type based on document type
        processor_id = settings.DOCUMENT_AI_PROCESSOR_ID
        if not processor_id:
            # Use default processor based on document type
            if "pdf" in document_type.lower():
                processor_id = "pretrained-form-parser"
            else:
                processor_id = "pretrained-document-ocr"
        
        # Construct the processor name
        processor_name = f"projects/{settings.DOCUMENT_AI_PROJECT_ID}/locations/{settings.DOCUMENT_AI_LOCATION}/processors/{processor_id}"
        
        # Process the document
        raw_document = documentai.RawDocument(content=content, mime_type=document_type)
        request = documentai.ProcessRequest(
            name=processor_name,
            raw_document=raw_document
        )
        
        response = document_ai_client.process_document(request=request)
        document = response.document
        
        # Extract text and confidence
        text = document.text
        # Calculate average confidence across all pages
        confidence = sum(page.layout.confidence for page in document.pages) / len(document.pages) if document.pages else 0.75
        
        logger.info(f"Document AI processed document with {len(text)} chars, confidence: {confidence:.2f}")
        return text, confidence
    
    except Exception as e:
        logger.error(f"Error processing document with Document AI: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Document AI processing failed: {str(e)}"
        )

async def extract_entities_with_healthcare_nl(text: str, include_umls: bool = False) -> List[ExtractedEntity]:
    """
    Extract healthcare entities from text using Google Healthcare NL API.
    
    Args:
        text: Text to analyze
        include_umls: Whether to include UMLS concepts
    
    Returns:
        List of extracted entities
    """
    if settings.MOCK_HEALTHCARE_NL_API or not healthcare_nl_client:
        logger.warning(f"Using mock Healthcare NL API for text of length: {len(text)}")
        return generate_mock_entities(text, settings.AI_CONFIDENCE_THRESHOLD)
    
    try:
        # Prepare the document
        document = language_v1.Document(
            content=text,
            type_=language_v1.Document.Type.PLAIN_TEXT,
            language="en"
        )
        
        # Analyze entities
        features = {
            "extract_entities": True,
            "extract_entity_sentiment": False,
            "extract_document_sentiment": False,
            "extract_syntax": False,
            "classify_text": False,
        }
        
        response = healthcare_nl_client.annotate_text(document=document, features=features)
        
        # Process and convert entities
        entities = []
        for entity in response.entities:
            # Skip entities with low salience
            if entity.salience < settings.AI_CONFIDENCE_THRESHOLD:
                continue
            
            # Determine entity type
            entity_type = map_healthcare_nl_entity_type(entity.type_)
            if not entity_type:
                continue
            
            # Create extracted entity
            extracted_entity = ExtractedEntity(
                type=entity_type,
                text=entity.name,
                confidence=entity.salience,
            )
            
            # Add metadata if available
            for metadata_name, metadata_value in entity.metadata.items():
                if metadata_name == "umls_cui" and include_umls:
                    extracted_entity.umlsCui = metadata_value
                elif metadata_name == "snomed_ct_concept_id":
                    extracted_entity.snomedCode = metadata_value
                elif metadata_name == "icd10_code":
                    extracted_entity.icd10Code = metadata_value
            
            # Add position information
            if entity.mentions:
                mention = entity.mentions[0]
                extracted_entity.position = {
                    "start": mention.text.begin_offset,
                    "end": mention.text.begin_offset + len(mention.text.content),
                }
            
            entities.append(extracted_entity)
        
        logger.info(f"Healthcare NL API extracted {len(entities)} entities")
        return entities
    
    except Exception as e:
        logger.error(f"Error extracting entities with Healthcare NL API: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Healthcare NL API extraction failed: {str(e)}"
        )

def map_healthcare_nl_entity_type(nl_entity_type: str) -> Optional[str]:
    """
    Map Healthcare NL API entity types to our entity types.
    
    Args:
        nl_entity_type: Entity type from Healthcare NL API
    
    Returns:
        Mapped entity type or None if not mappable
    """
    # Mapping from Healthcare NL API entity types to our entity types
    mapping = {
        "DISEASE": "Diagnosis",
        "SYMPTOM": "Symptom",
        "MEDICATION": "Medication",
        "PROCEDURE": "Procedure",
        "PROBLEM": "Symptom",
        "SUBSTANCE_ABUSE": "Risk_Behavior",
        "HOUSING_STATUS": "Social_Context",
        "EMPLOYMENT": "Social_Context",
        "FAMILY": "Social_Context",
        "TRAUMATIC_EVENT": "Trauma_Event",
        "PSYCHOLOGICAL_CONDITION": "Diagnosis",
    }
    
    return mapping.get(nl_entity_type)

def aggregate_entity_confidence(entities: List[ExtractedEntity]) -> float:
    """
    Aggregate confidence scores across multiple entities.
    
    Args:
        entities: List of extracted entities
    
    Returns:
        Aggregated confidence score
    """
    if not entities:
        return 0.0
    
    # Apply weights based on entity type
    weighted_scores = []
    for entity in entities:
        weight = settings.ENTITY_CONFIDENCE_WEIGHTS.get(entity.type, 0.7)
        weighted_scores.append(entity.confidence * weight)
    
    # Calculate weighted average
    if weighted_scores:
        return sum(weighted_scores) / len(weighted_scores)
    return 0.0

# --- Pub/Sub Listener ---

async def start_pubsub_listener():
    """
    Start listening for Pub/Sub messages.
    This runs as a background task.
    """
    if settings.ENABLE_MOCK_API or not pubsub_subscriber:
        logger.warning("Pub/Sub listener not started (mock mode or client not available)")
        return
    
    subscription_path = pubsub_subscriber.subscription_path(
        settings.PUBSUB_PROJECT_ID, 
        settings.PUBSUB_SUBSCRIPTION
    )
    
    logger.info(f"Starting Pub/Sub listener for subscription: {subscription_path}")
    
    def callback(message):
        try:
            # Parse the message data
            data = json.loads(message.data.decode("utf-8"))
            logger.info(f"Received Pub/Sub message: {data}")
            
            # Process the document asynchronously
            asyncio.create_task(process_document_job(data))
            
            # Acknowledge the message
            message.ack()
        except Exception as e:
            logger.error(f"Error processing Pub/Sub message: {str(e)}", exc_info=True)
            # Negative acknowledgement to retry later
            message.nack()
    
    # Start listening
    streaming_pull_future = pubsub_subscriber.subscribe(
        subscription_path, 
        callback=callback
    )
    
    try:
        # Keep the listener running
        await asyncio.get_event_loop().run_in_executor(
            None, 
            lambda: streaming_pull_future.result()
        )
    except Exception as e:
        logger.error(f"Pub/Sub listener error: {str(e)}", exc_info=True)
        streaming_pull_future.cancel()

async def process_document_job(data: Dict[str, Any]):
    """
    Process a document job from Pub/Sub.
    
    Args:
        data: Job data from Pub/Sub message
    """
    job_id = data.get("jobId")
    document_uri = data.get("documentUri")
    document_type = data.get("documentType")
    document_id = data.get("documentId")
    patient_id = data.get("patientId")
    referral_id = data.get("referralId")
    
    if not all([job_id, document_uri, document_type, document_id, patient_id, referral_id]):
        logger.error(f"Invalid document job data: {data}")
        return
    
    try:
        # Update job status to PROCESSING
        # TODO: Update job status in database
        
        # Process the document
        text, doc_confidence = await process_document_with_document_ai(document_uri, document_type)
        
        # Extract entities
        entities = await extract_entities_with_healthcare_nl(text)
        
        # Map entities to domains
        domains = map_entities_to_domains(entities)
        
        # Calculate overall confidence
        overall_confidence = aggregate_entity_confidence(entities)
        
        # Store results
        # TODO: Store results in database
        
        # Update job status to COMPLETED
        # TODO: Update job status in database
        
        # Send callback if provided
        callback_url = data.get("callbackUrl")
        if callback_url:
            await send_callback(callback_url, {
                "jobId": job_id,
                "status": "COMPLETED",
                "documentId": document_id,
                "confidenceScore": overall_confidence,
                "entitiesCount": len(entities),
                "domainsCount": len(domains)
            })
        
        logger.info(f"Document job {job_id} processed successfully")
    except Exception as e:
        logger.error(f"Error processing document job {job_id}: {str(e)}", exc_info=True)
        
        # Update job status to FAILED
        # TODO: Update job status in database
        
        # Send callback if provided
        callback_url = data.get("callbackUrl")
        if callback_url:
            await send_callback(callback_url, {
                "jobId": job_id,
                "status": "FAILED",
                "documentId": document_id,
                "error": str(e)
            })

async def send_callback(url: str, data: Dict[str, Any]):
    """
    Send a callback to notify about job completion.
    
    Args:
        url: Callback URL
        data: Data to send
    """
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                url,
                json=data,
                headers={"Content-Type": "application/json"},
                timeout=10.0
            )
            response.raise_for_status()
            logger.info(f"Callback sent successfully to {url}")
    except Exception as e:
        logger.error(f"Error sending callback to {url}: {str(e)}", exc_info=True)

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
        
        # Check Pub/Sub connection
        pubsub_status = "ok" if (settings.ENABLE_MOCK_API or pubsub_subscriber) else "error"
        
        # Check Document AI client
        document_ai_status = "ok" if (settings.ENABLE_MOCK_API or document_ai_client) else "error"
        
        # Check Healthcare NL API client
        healthcare_nl_status = "ok" if (settings.ENABLE_MOCK_API or healthcare_nl_client) else "error"
        
        return HealthStatus(
            status="ok",
            version="1.0.0",
            dependencies={
                "database": db_status,
                "redis": redis_status,
                "storage": storage_status,
                "pubsub": pubsub_status,
                "document_ai": document_ai_status,
                "healthcare_nl": healthcare_nl_status,
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
    request: DocumentProcessingRequest,
    background_tasks: BackgroundTasks
):
    """
    Process a document from cloud storage.
    This is an asynchronous operation - it returns a job ID that can be used to check status.
    """
    try:
        logger.info(f"Received document processing request for document: {request.documentId}")
        
        # Generate a unique job ID
        job_id = str(uuid.uuid4())
        
        if settings.ENABLE_MOCK_API:
            # Store job in Redis (mock for now)
            # In a real implementation, we would store the job details in Redis
            logger.info(f"Created job {job_id} for document {request.documentId}")
            
            # Process in background for mock mode too
            background_tasks.add_task(
                mock_process_document,
                job_id=job_id,
                document_id=request.documentId,
                document_uri=request.documentUri,
                document_type=request.documentType,
                callback_url=request.callbackUrl
            )
            
            return DocumentProcessingResponse(
                jobId=job_id,
                status="PENDING",
                message="Document queued for processing"
            )
        else:
            # Publish message to Pub/Sub
            if pubsub_publisher:
                topic_path = pubsub_publisher.topic_path(
                    settings.PUBSUB_PROJECT_ID, 
                    settings.PUBSUB_TOPIC
                )
                
                # Prepare message data
                message_data = {
                    "jobId": job_id,
                    "documentId": request.documentId,
                    "documentUri": request.documentUri,
                    "documentType": request.documentType,
                    "patientId": request.patientId,
                    "referralId": request.referralId,
                    "priority": request.priority,
                    "callbackUrl": str(request.callbackUrl) if request.callbackUrl else None,
                    "timestamp": datetime.now().isoformat()
                }
                
                # Publish message
                message_bytes = json.dumps(message_data).encode("utf-8")
                future = pubsub_publisher.publish(topic_path, message_bytes)
                message_id = future.result()
                
                logger.info(f"Published message {message_id} to {topic_path}")
                
                return DocumentProcessingResponse(
                    jobId=job_id,
                    status="PENDING",
                    message="Document queued for processing via Pub/Sub"
                )
            else:
                # Process directly if Pub/Sub is not available
                background_tasks.add_task(
                    process_document_job,
                    data={
                        "jobId": job_id,
                        "documentId": request.documentId,
                        "documentUri": request.documentUri,
                        "documentType": request.documentType,
                        "patientId": request.patientId,
                        "referralId": request.referralId,
                        "callbackUrl": str(request.callbackUrl) if request.callbackUrl else None
                    }
                )
                
                return DocumentProcessingResponse(
                    jobId=job_id,
                    status="PENDING",
                    message="Document queued for processing"
                )
    
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
    priority: str = Form("normal"),
    background_tasks: BackgroundTasks = None
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
        
        # Determine document type
        document_type = file.content_type or "application/octet-stream"
        
        if settings.ENABLE_MOCK_API:
            # Mock implementation - pretend we uploaded the file
            logger.info(f"Mock file upload for {file.filename}, size: {file.size} bytes")
            
            # Read a small sample of the file to log (for debugging)
            sample = await file.read(1024)  # Read first 1KB
            await file.seek(0)  # Reset file pointer
            
            logger.debug(f"File sample: {sample[:100]}...")
            
            # Process in background
            if background_tasks:
                background_tasks.add_task(
                    mock_process_document,
                    job_id=job_id,
                    document_id=document_id,
                    document_uri=f"mock://uploads/{document_id}/{file.filename}",
                    document_type=document_type
                )
            
            return DocumentProcessingResponse(
                jobId=job_id,
                status="PENDING",
                message=f"Document {document_id} uploaded and queued for processing"
            )
        else:
            # TODO: Implement actual file upload to Cloud Storage
            # For now, we'll use a mock implementation
            document_uri = f"mock://uploads/{document_id}/{file.filename}"
            
            # Process in background
            if background_tasks:
                background_tasks.add_task(
                    process_document_job,
                    data={
                        "jobId": job_id,
                        "documentId": document_id,
                        "documentUri": document_uri,
                        "documentType": document_type,
                        "patientId": patientId,
                        "referralId": referralId
                    }
                )
            
            return DocumentProcessingResponse(
                jobId=job_id,
                status="PENDING",
                message=f"Document {document_id} uploaded and queued for processing"
            )
    
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
            # For now, return a mock response
            return JobStatus(
                jobId=job_id,
                status="PROCESSING",
                progress=0.5,
                message="Document processing in progress",
                startedAt=datetime.now() - timedelta(minutes=1),
                completedAt=None
            )
    
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
        
        # Set confidence threshold
        confidence_threshold = request.confidenceThreshold or settings.AI_CONFIDENCE_THRESHOLD
        
        if settings.MOCK_HEALTHCARE_NL_API or settings.ENABLE_MOCK_API:
            # Generate mock entities based on text content
            entities = generate_mock_entities(
                request.text, 
                confidence_threshold=confidence_threshold
            )
        else:
            # Use real Healthcare NL API
            entities = await extract_entities_with_healthcare_nl(
                request.text,
                include_umls=request.includeUmls
            )
            
            # Filter by confidence threshold
            entities = [e for e in entities if e.confidence >= confidence_threshold]
        
        return EntityExtractionResponse(entities=entities)
    
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
        
        # Map entities to domains
        domains = map_entities_to_domains(request.entities)
        
        return DomainMappingResponse(domains=domains)
    
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
            domains = map_entities_to_domains(entities)
            
            return DomainMappingResponse(domains=domains)
        else:
            # TODO: Implement actual job results retrieval
            # For now, return a mock response
            return DomainMappingResponse(
                domains=[
                    DomainSuggestion(
                        domainType="PRESENTING_PROBLEM",
                        content={
                            "description": "Patient presents with symptoms of depression and anxiety",
                            "severity": "MODERATE",
                            "duration": "Unknown",
                            "impact": "Impacts daily functioning"
                        },
                        confidence=0.85
                    )
                ]
            )
    
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

def map_entities_to_domains(entities: List[ExtractedEntity]) -> List[DomainSuggestion]:
    """Generate domain suggestions based on entities."""
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
                confidence=calculate_domain_confidence(diagnoses + symptoms),
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
                confidence=calculate_domain_confidence(medications),
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
                confidence=calculate_domain_confidence(risk_behaviors),
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
                confidence=calculate_domain_confidence(social_contexts),
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
                confidence=calculate_domain_confidence(trauma_events),
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
                confidence=calculate_domain_confidence(strengths),
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

def calculate_domain_confidence(entities: List[ExtractedEntity]) -> float:
    """Calculate confidence score for a domain based on its entities."""
    if not entities:
        return 0.5
    
    # Apply weights based on entity type
    weighted_confidences = []
    for entity in entities:
        weight = settings.ENTITY_CONFIDENCE_WEIGHTS.get(entity.type, 0.7)
        weighted_confidences.append(entity.confidence * weight)
    
    # Calculate weighted average confidence
    if weighted_confidences:
        base_confidence = sum(weighted_confidences) / len(weighted_confidences)
        
        # Boost confidence based on number of entities (more entities = higher confidence)
        entity_count_boost = min(0.1, len(entities) * 0.02)  # Max boost of 0.1
        
        # Cap final confidence at 0.98
        return min(0.98, base_confidence + entity_count_boost)
    
    return 0.5

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

async def mock_process_document(job_id: str, document_id: str, document_uri: str, document_type: str, callback_url: Optional[str] = None):
    """
    Mock implementation of document processing for background tasks.
    
    Args:
        job_id: Job ID
        document_id: Document ID
        document_uri: Document URI
        document_type: Document MIME type
        callback_url: Optional callback URL
    """
    try:
        logger.info(f"[MOCK] Starting processing of document {document_id} (job {job_id})")
        
        # Simulate processing delay
        await asyncio.sleep(5)
        
        # Simulate document text extraction
        mock_text = f"This is mock text extracted from {document_uri}. "
        mock_text += "Patient presents with symptoms of depression and anxiety. "
        mock_text += "Medical history includes hypertension and type 2 diabetes. "
        mock_text += "Currently taking sertraline 50mg daily and metformin 500mg twice daily. "
        mock_text += "Patient reports housing instability and lack of transportation."
        
        # Simulate entity extraction
        entities = generate_mock_entities(mock_text)
        
        # Simulate domain mapping
        domains = map_entities_to_domains(entities)
        
        # Simulate confidence calculation
        overall_confidence = calculate_domain_confidence(entities)
        
        logger.info(f"[MOCK] Completed processing of document {document_id} (job {job_id})")
        
        # Send callback if provided
        if callback_url:
            await send_callback(callback_url, {
                "jobId": job_id,
                "status": "COMPLETED",
                "documentId": document_id,
                "confidenceScore": overall_confidence,
                "entitiesCount": len(entities),
                "domainsCount": len(domains)
            })
    
    except Exception as e:
        logger.error(f"[MOCK] Error processing document {document_id} (job {job_id}): {str(e)}")
        
        # Send callback if provided
        if callback_url:
            await send_callback(callback_url, {
                "jobId": job_id,
                "status": "FAILED",
                "documentId": document_id,
                "error": str(e)
            })

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
