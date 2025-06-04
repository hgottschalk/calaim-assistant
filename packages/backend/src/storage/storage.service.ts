import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  Inject,
  UnsupportedMediaTypeException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage, Bucket, GetSignedUrlConfig } from '@google-cloud/storage';
import * as Minio from 'minio';
import * as crypto from 'crypto';
import * as path from 'path';
import * as mime from 'mime-types';
import { Readable } from 'stream';

/**
 * Configuration for the storage service
 */
export interface StorageConfig {
  referralBucket: string;
  pdfBucket: string;
  logsBucket: string;
  isGcs: boolean;
  endpoint: string;
  maxFileSize: number;
  allowedMimeTypes: string[];
  publicUrl: string;
}

/**
 * File metadata interface
 */
export interface FileMetadata {
  fileName: string;
  contentType: string;
  size: number;
  etag?: string;
  createdAt: Date;
  updatedAt?: Date;
  bucket: string;
  path: string;
  url?: string;
  metadata?: Record<string, string>;
}

/**
 * Upload options interface
 */
export interface UploadOptions {
  /**
   * Custom path/key for the file (if not provided, a UUID will be generated)
   */
  path?: string;
  
  /**
   * Metadata to attach to the file
   */
  metadata?: Record<string, string>;
  
  /**
   * Content type override (if not provided, will be inferred from file extension)
   */
  contentType?: string;
  
  /**
   * Whether to make the file publicly accessible (default: false)
   */
  public?: boolean;
  
  /**
   * Whether to overwrite an existing file (default: false)
   */
  overwrite?: boolean;
  
  /**
   * Tags to apply to the object (key-value pairs)
   */
  tags?: Record<string, string>;
}

/**
 * Download options interface
 */
export interface DownloadOptions {
  /**
   * Whether to return a stream instead of a buffer (default: false)
   */
  asStream?: boolean;
  
  /**
   * Range of bytes to download (for partial downloads)
   */
  range?: {
    start?: number;
    end?: number;
  };
}

/**
 * Signed URL options interface
 */
export interface SignedUrlOptions {
  /**
   * URL expiration time in seconds (default: 15 minutes)
   */
  expiresIn?: number;
  
  /**
   * HTTP method for the URL (default: GET)
   */
  method?: 'GET' | 'PUT' | 'DELETE';
  
  /**
   * Content type for PUT requests
   */
  contentType?: string;
  
  /**
   * Additional query parameters
   */
  queryParams?: Record<string, string>;
  
  /**
   * Custom response headers
   */
  responseHeaders?: Record<string, string>;
}

/**
 * File upload result interface
 */
export interface UploadResult {
  /**
   * File metadata
   */
  metadata: FileMetadata;
  
  /**
   * URL to access the file
   */
  url: string;
  
  /**
   * Signed URL for temporary access (if requested)
   */
  signedUrl?: string;
}

/**
 * Storage service for handling file operations
 * Supports both Google Cloud Storage and MinIO
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly isGcs: boolean;
  private readonly gcsClient: Storage | null = null;
  private readonly minioClient: Minio.Client | null = null;
  private readonly config: StorageConfig;

  constructor(
    @Inject('STORAGE_CLIENT') private readonly storageClient: Storage | Minio.Client,
    @Inject('STORAGE_CONFIG') private readonly storageConfig: StorageConfig,
    private readonly configService: ConfigService,
  ) {
    this.isGcs = storageConfig.isGcs;
    this.config = storageConfig;
    
    // Assign the client to the appropriate type
    if (this.isGcs) {
      this.gcsClient = storageClient as Storage;
      this.logger.log('Initialized Google Cloud Storage client');
    } else {
      this.minioClient = storageClient as Minio.Client;
      this.logger.log(`Initialized MinIO client with endpoint: ${storageConfig.endpoint}`);
    }
    
    // Log configuration
    this.logger.log(`Storage configuration: 
      - Referral bucket: ${this.config.referralBucket}
      - PDF bucket: ${this.config.pdfBucket}
      - Logs bucket: ${this.config.logsBucket}
      - Max file size: ${this.config.maxFileSize} bytes
      - Allowed MIME types: ${this.config.allowedMimeTypes.join(', ')}
    `);
  }

  /**
   * Upload a file to storage
   * 
   * @param bucketName Bucket name (or use predefined buckets)
   * @param fileBuffer File buffer or readable stream
   * @param fileName Original file name
   * @param options Upload options
   * @returns Upload result with file metadata and URLs
   */
  async uploadFile(
    bucketName: string | 'referrals' | 'pdfs' | 'logs',
    fileBuffer: Buffer | Readable,
    fileName: string,
    options: UploadOptions = {},
  ): Promise<UploadResult> {
    try {
      // Resolve the actual bucket name
      const bucket = this.resolveBucketName(bucketName);
      
      // Validate file
      this.validateFile(fileBuffer, fileName);
      
      // Generate a path if not provided
      const filePath = options.path || this.generateFilePath(fileName);
      
      // Determine content type
      const contentType = options.contentType || 
        mime.lookup(fileName) || 
        'application/octet-stream';
      
      // Check if file exists and handle overwrite option
      if (!options.overwrite) {
        const exists = await this.fileExists(bucket, filePath);
        if (exists) {
          throw new BadRequestException(`File already exists at path: ${filePath}`);
        }
      }
      
      // Prepare metadata
      const metadata = {
        ...options.metadata,
        originalName: fileName,
        contentType,
        uploadedAt: new Date().toISOString(),
      };
      
      // Upload the file based on storage provider
      if (this.isGcs) {
        await this.uploadToGcs(bucket, filePath, fileBuffer, contentType, metadata, options.public);
      } else {
        await this.uploadToMinio(bucket, filePath, fileBuffer, contentType, metadata, options.tags);
      }
      
      // Get file metadata
      const fileMetadata: FileMetadata = {
        fileName,
        contentType,
        size: this.getBufferSize(fileBuffer),
        createdAt: new Date(),
        bucket,
        path: filePath,
        metadata: options.metadata,
      };
      
      // Generate URLs
      const url = this.generateUrl(bucket, filePath);
      let signedUrl: string | undefined;
      
      if (!options.public) {
        signedUrl = await this.generateSignedUrl(bucket, filePath, {
          expiresIn: 15 * 60, // 15 minutes
          method: 'GET',
          contentType,
        });
      }
      
      this.logger.log(`File uploaded successfully: ${bucket}/${filePath}`);
      
      return {
        metadata: fileMetadata,
        url,
        signedUrl,
      };
    } catch (error) {
      this.handleStorageError(error, 'uploadFile', { bucket: bucketName, fileName });
    }
  }

  /**
   * Download a file from storage
   * 
   * @param bucketName Bucket name
   * @param filePath Path to the file
   * @param options Download options
   * @returns File buffer or stream based on options
   */
  async downloadFile(
    bucketName: string | 'referrals' | 'pdfs' | 'logs',
    filePath: string,
    options: DownloadOptions = {},
  ): Promise<Buffer | Readable> {
    try {
      // Resolve the actual bucket name
      const bucket = this.resolveBucketName(bucketName);
      
      // Check if file exists
      const exists = await this.fileExists(bucket, filePath);
      if (!exists) {
        throw new NotFoundException(`File not found: ${bucket}/${filePath}`);
      }
      
      // Download the file based on storage provider
      if (this.isGcs) {
        return this.downloadFromGcs(bucket, filePath, options);
      } else {
        return this.downloadFromMinio(bucket, filePath, options);
      }
    } catch (error) {
      this.handleStorageError(error, 'downloadFile', { bucket: bucketName, filePath });
    }
  }

  /**
   * Get file metadata
   * 
   * @param bucketName Bucket name
   * @param filePath Path to the file
   * @returns File metadata
   */
  async getFileMetadata(
    bucketName: string | 'referrals' | 'pdfs' | 'logs',
    filePath: string,
  ): Promise<FileMetadata> {
    try {
      // Resolve the actual bucket name
      const bucket = this.resolveBucketName(bucketName);
      
      // Check if file exists
      const exists = await this.fileExists(bucket, filePath);
      if (!exists) {
        throw new NotFoundException(`File not found: ${bucket}/${filePath}`);
      }
      
      // Get metadata based on storage provider
      if (this.isGcs) {
        return this.getGcsMetadata(bucket, filePath);
      } else {
        return this.getMinioMetadata(bucket, filePath);
      }
    } catch (error) {
      this.handleStorageError(error, 'getFileMetadata', { bucket: bucketName, filePath });
    }
  }

  /**
   * Delete a file from storage
   * 
   * @param bucketName Bucket name
   * @param filePath Path to the file
   * @returns Boolean indicating success
   */
  async deleteFile(
    bucketName: string | 'referrals' | 'pdfs' | 'logs',
    filePath: string,
  ): Promise<boolean> {
    try {
      // Resolve the actual bucket name
      const bucket = this.resolveBucketName(bucketName);
      
      // Check if file exists
      const exists = await this.fileExists(bucket, filePath);
      if (!exists) {
        throw new NotFoundException(`File not found: ${bucket}/${filePath}`);
      }
      
      // Delete the file based on storage provider
      if (this.isGcs) {
        await this.gcsClient.bucket(bucket).file(filePath).delete();
      } else {
        await this.minioClient.removeObject(bucket, filePath);
      }
      
      this.logger.log(`File deleted successfully: ${bucket}/${filePath}`);
      
      return true;
    } catch (error) {
      this.handleStorageError(error, 'deleteFile', { bucket: bucketName, filePath });
    }
  }

  /**
   * Generate a signed URL for temporary access to a file
   * 
   * @param bucketName Bucket name
   * @param filePath Path to the file
   * @param options Signed URL options
   * @returns Signed URL string
   */
  async generateSignedUrl(
    bucketName: string | 'referrals' | 'pdfs' | 'logs',
    filePath: string,
    options: SignedUrlOptions = {},
  ): Promise<string> {
    try {
      // Resolve the actual bucket name
      const bucket = this.resolveBucketName(bucketName);
      
      // Set default expiration if not provided
      const expiresIn = options.expiresIn || 15 * 60; // 15 minutes default
      
      // Generate signed URL based on storage provider
      if (this.isGcs) {
        const file = this.gcsClient.bucket(bucket).file(filePath);
        
        const urlConfig: GetSignedUrlConfig = {
          version: 'v4',
          action: options.method === 'PUT' ? 'write' : 
                 options.method === 'DELETE' ? 'delete' : 'read',
          expires: Date.now() + expiresIn * 1000,
        };
        
        if (options.contentType) {
          urlConfig.contentType = options.contentType;
        }
        
        if (options.responseHeaders) {
          urlConfig.responseDisposition = options.responseHeaders['Content-Disposition'];
        }
        
        const [url] = await file.getSignedUrl(urlConfig);
        return url;
      } else {
        // MinIO presigned URL
        const method = options.method === 'PUT' ? 'presignedPutObject' : 
                      options.method === 'DELETE' ? 'presignedRemoveObject' : 'presignedGetObject';
        
        let url: string;
        
        if (method === 'presignedPutObject') {
          url = await this.minioClient.presignedPutObject(bucket, filePath, expiresIn);
        } else if (method === 'presignedRemoveObject') {
          url = await this.minioClient.presignedRemoveObject(bucket, filePath, expiresIn);
        } else {
          const reqParams: { [key: string]: string } = {};
          
          if (options.responseHeaders) {
            if (options.responseHeaders['Content-Disposition']) {
              reqParams['response-content-disposition'] = options.responseHeaders['Content-Disposition'];
            }
            if (options.responseHeaders['Content-Type']) {
              reqParams['response-content-type'] = options.responseHeaders['Content-Type'];
            }
          }
          
          url = await this.minioClient.presignedGetObject(bucket, filePath, expiresIn, reqParams);
        }
        
        // Add query parameters if provided
        if (options.queryParams) {
          const urlObj = new URL(url);
          Object.entries(options.queryParams).forEach(([key, value]) => {
            urlObj.searchParams.append(key, value);
          });
          url = urlObj.toString();
        }
        
        return url;
      }
    } catch (error) {
      this.handleStorageError(error, 'generateSignedUrl', { bucket: bucketName, filePath });
    }
  }

  /**
   * List files in a bucket with optional prefix
   * 
   * @param bucketName Bucket name
   * @param prefix Optional prefix to filter files
   * @param maxResults Maximum number of results to return
   * @returns Array of file metadata
   */
  async listFiles(
    bucketName: string | 'referrals' | 'pdfs' | 'logs',
    prefix: string = '',
    maxResults: number = 100,
  ): Promise<FileMetadata[]> {
    try {
      // Resolve the actual bucket name
      const bucket = this.resolveBucketName(bucketName);
      
      // List files based on storage provider
      if (this.isGcs) {
        const [files] = await this.gcsClient.bucket(bucket).getFiles({
          prefix,
          maxResults,
        });
        
        const results: FileMetadata[] = [];
        
        for (const file of files) {
          const [metadata] = await file.getMetadata();
          
          results.push({
            fileName: path.basename(file.name),
            contentType: metadata.contentType || 'application/octet-stream',
            size: parseInt(metadata.size, 10),
            etag: metadata.etag,
            createdAt: new Date(metadata.timeCreated),
            updatedAt: new Date(metadata.updated),
            bucket,
            path: file.name,
            url: this.generateUrl(bucket, file.name),
            metadata: metadata.metadata,
          });
        }
        
        return results;
      } else {
        // MinIO list objects
        const stream = this.minioClient.listObjects(bucket, prefix, true);
        const results: FileMetadata[] = [];
        let count = 0;
        
        await new Promise<void>((resolve, reject) => {
          stream.on('data', async (obj) => {
            if (count >= maxResults) {
              return;
            }
            
            try {
              const stat = await this.minioClient.statObject(bucket, obj.name);
              
              results.push({
                fileName: path.basename(obj.name),
                contentType: stat.metaData['content-type'] || 'application/octet-stream',
                size: stat.size,
                etag: stat.etag,
                createdAt: new Date(stat.lastModified),
                bucket,
                path: obj.name,
                url: this.generateUrl(bucket, obj.name),
                metadata: this.extractMinioMetadata(stat.metaData),
              });
              
              count++;
            } catch (err) {
              // Skip files that can't be accessed
              this.logger.warn(`Could not get metadata for ${obj.name}: ${err.message}`);
            }
          });
          
          stream.on('error', (err) => {
            reject(err);
          });
          
          stream.on('end', () => {
            resolve();
          });
        });
        
        return results;
      }
    } catch (error) {
      this.handleStorageError(error, 'listFiles', { bucket: bucketName, prefix });
    }
  }

  /**
   * Check if a file exists in storage
   * 
   * @param bucketName Bucket name
   * @param filePath Path to the file
   * @returns Boolean indicating if the file exists
   */
  async fileExists(
    bucketName: string | 'referrals' | 'pdfs' | 'logs',
    filePath: string,
  ): Promise<boolean> {
    try {
      // Resolve the actual bucket name
      const bucket = this.resolveBucketName(bucketName);
      
      // Check existence based on storage provider
      if (this.isGcs) {
        const [exists] = await this.gcsClient.bucket(bucket).file(filePath).exists();
        return exists;
      } else {
        try {
          await this.minioClient.statObject(bucket, filePath);
          return true;
        } catch (err) {
          if (err.code === 'NotFound') {
            return false;
          }
          throw err;
        }
      }
    } catch (error) {
      // Don't throw for file existence checks, just return false for most errors
      if (error.code === 'NotFound' || error.message.includes('does not exist')) {
        return false;
      }
      
      this.logger.error(`Error checking if file exists: ${error.message}`, {
        bucket: bucketName,
        filePath,
        errorCode: error.code,
        errorMessage: error.message,
      });
      
      return false;
    }
  }

  /**
   * Copy a file within storage
   * 
   * @param sourceBucket Source bucket name
   * @param sourceFilePath Source file path
   * @param destinationBucket Destination bucket name
   * @param destinationFilePath Destination file path
   * @returns Metadata for the new file
   */
  async copyFile(
    sourceBucket: string | 'referrals' | 'pdfs' | 'logs',
    sourceFilePath: string,
    destinationBucket: string | 'referrals' | 'pdfs' | 'logs',
    destinationFilePath: string,
  ): Promise<FileMetadata> {
    try {
      // Resolve the actual bucket names
      const srcBucket = this.resolveBucketName(sourceBucket);
      const destBucket = this.resolveBucketName(destinationBucket);
      
      // Check if source file exists
      const exists = await this.fileExists(srcBucket, sourceFilePath);
      if (!exists) {
        throw new NotFoundException(`Source file not found: ${srcBucket}/${sourceFilePath}`);
      }
      
      // Copy the file based on storage provider
      if (this.isGcs) {
        const [job] = await this.gcsClient
          .bucket(srcBucket)
          .file(sourceFilePath)
          .copy(this.gcsClient.bucket(destBucket).file(destinationFilePath));
        
        const [metadata] = await job.getMetadata();
        
        return {
          fileName: path.basename(destinationFilePath),
          contentType: metadata.contentType || 'application/octet-stream',
          size: parseInt(metadata.size, 10),
          etag: metadata.etag,
          createdAt: new Date(metadata.timeCreated),
          updatedAt: new Date(metadata.updated),
          bucket: destBucket,
          path: destinationFilePath,
          url: this.generateUrl(destBucket, destinationFilePath),
          metadata: metadata.metadata,
        };
      } else {
        // MinIO copy object
        const conditions = new Minio.CopyConditions();
        await this.minioClient.copyObject(
          destBucket,
          destinationFilePath,
          `${srcBucket}/${sourceFilePath}`,
          conditions,
        );
        
        // Get metadata of the new file
        return await this.getFileMetadata(destBucket, destinationFilePath);
      }
    } catch (error) {
      this.handleStorageError(error, 'copyFile', {
        sourceBucket,
        sourceFilePath,
        destinationBucket,
        destinationFilePath,
      });
    }
  }

  /**
   * Create a bucket if it doesn't exist
   * 
   * @param bucketName Bucket name
   * @param isPublic Whether the bucket should be publicly accessible
   * @returns Boolean indicating if the bucket was created or already existed
   */
  async createBucketIfNotExists(
    bucketName: string,
    isPublic: boolean = false,
  ): Promise<boolean> {
    try {
      // Check if bucket exists based on storage provider
      let exists = false;
      
      if (this.isGcs) {
        [exists] = await this.gcsClient.bucket(bucketName).exists();
      } else {
        exists = await this.minioClient.bucketExists(bucketName);
      }
      
      // If bucket already exists, return
      if (exists) {
        this.logger.log(`Bucket already exists: ${bucketName}`);
        return false;
      }
      
      // Create the bucket based on storage provider
      if (this.isGcs) {
        await this.gcsClient.createBucket(bucketName);
        
        if (isPublic) {
          // Make bucket publicly accessible
          await this.gcsClient.bucket(bucketName).makePublic();
        }
      } else {
        await this.minioClient.makeBucket(bucketName, this.configService.get('MINIO_REGION', 'us-east-1'));
        
        if (isPublic) {
          // Set public policy for MinIO bucket
          const policy = {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Principal: { AWS: ['*'] },
                Action: ['s3:GetObject'],
                Resource: [`arn:aws:s3:::${bucketName}/*`],
              },
            ],
          };
          
          await this.minioClient.setBucketPolicy(bucketName, JSON.stringify(policy));
        }
      }
      
      this.logger.log(`Bucket created successfully: ${bucketName}`);
      return true;
    } catch (error) {
      this.handleStorageError(error, 'createBucketIfNotExists', { bucketName });
    }
  }

  /**
   * Upload a file to Google Cloud Storage
   */
  private async uploadToGcs(
    bucket: string,
    filePath: string,
    fileBuffer: Buffer | Readable,
    contentType: string,
    metadata: Record<string, string>,
    isPublic: boolean = false,
  ): Promise<void> {
    const file = this.gcsClient.bucket(bucket).file(filePath);
    
    const stream = file.createWriteStream({
      resumable: this.getBufferSize(fileBuffer) > 5 * 1024 * 1024, // Use resumable uploads for files > 5MB
      contentType,
      metadata: { metadata },
      gzip: true, // Enable gzip compression
    });
    
    await new Promise<void>((resolve, reject) => {
      stream.on('error', reject);
      stream.on('finish', resolve);
      
      if (Buffer.isBuffer(fileBuffer)) {
        stream.end(fileBuffer);
      } else {
        fileBuffer.pipe(stream);
      }
    });
    
    if (isPublic) {
      await file.makePublic();
    }
  }

  /**
   * Upload a file to MinIO
   */
  private async uploadToMinio(
    bucket: string,
    filePath: string,
    fileBuffer: Buffer | Readable,
    contentType: string,
    metadata: Record<string, string>,
    tags?: Record<string, string>,
  ): Promise<void> {
    // Convert metadata to MinIO format (all lowercase keys with 'x-amz-meta-' prefix)
    const metaData: Record<string, string> = {};
    Object.entries(metadata).forEach(([key, value]) => {
      metaData[`x-amz-meta-${key.toLowerCase()}`] = value;
    });
    
    // Set content type
    metaData['Content-Type'] = contentType;
    
    if (Buffer.isBuffer(fileBuffer)) {
      await this.minioClient.putObject(bucket, filePath, fileBuffer, undefined, metaData, tags);
    } else {
      // For streams, we need to get the size first
      const size = await this.getStreamSize(fileBuffer);
      
      // Create a new stream since the original might be consumed
      const newStream = new Readable();
      newStream._read = () => {}; // Required implementation
      
      // Pipe the original stream to the new one
      fileBuffer.on('data', (chunk) => {
        newStream.push(chunk);
      });
      
      fileBuffer.on('end', () => {
        newStream.push(null);
      });
      
      fileBuffer.on('error', (err) => {
        newStream.emit('error', err);
      });
      
      await this.minioClient.putObject(bucket, filePath, newStream, size, metaData, tags);
    }
  }

  /**
   * Download a file from Google Cloud Storage
   */
  private async downloadFromGcs(
    bucket: string,
    filePath: string,
    options: DownloadOptions = {},
  ): Promise<Buffer | Readable> {
    const file = this.gcsClient.bucket(bucket).file(filePath);
    
    if (options.asStream) {
      const config: any = {};
      
      if (options.range) {
        config.start = options.range.start;
        config.end = options.range.end;
      }
      
      return file.createReadStream(config);
    } else {
      const [buffer] = await file.download(options.range ? {
        start: options.range.start,
        end: options.range.end,
      } : undefined);
      
      return buffer;
    }
  }

  /**
   * Download a file from MinIO
   */
  private async downloadFromMinio(
    bucket: string,
    filePath: string,
    options: DownloadOptions = {},
  ): Promise<Buffer | Readable> {
    if (options.asStream) {
      return this.minioClient.getObject(bucket, filePath, options.range);
    } else {
      return new Promise<Buffer>((resolve, reject) => {
        this.minioClient.getObject(bucket, filePath, options.range, (err, stream) => {
          if (err) {
            return reject(err);
          }
          
          const chunks: Buffer[] = [];
          
          stream.on('data', (chunk) => {
            chunks.push(chunk);
          });
          
          stream.on('end', () => {
            resolve(Buffer.concat(chunks));
          });
          
          stream.on('error', (err) => {
            reject(err);
          });
        });
      });
    }
  }

  /**
   * Get file metadata from Google Cloud Storage
   */
  private async getGcsMetadata(bucket: string, filePath: string): Promise<FileMetadata> {
    const file = this.gcsClient.bucket(bucket).file(filePath);
    const [metadata] = await file.getMetadata();
    
    return {
      fileName: path.basename(filePath),
      contentType: metadata.contentType || 'application/octet-stream',
      size: parseInt(metadata.size, 10),
      etag: metadata.etag,
      createdAt: new Date(metadata.timeCreated),
      updatedAt: new Date(metadata.updated),
      bucket,
      path: filePath,
      url: this.generateUrl(bucket, filePath),
      metadata: metadata.metadata,
    };
  }

  /**
   * Get file metadata from MinIO
   */
  private async getMinioMetadata(bucket: string, filePath: string): Promise<FileMetadata> {
    const stat = await this.minioClient.statObject(bucket, filePath);
    
    return {
      fileName: path.basename(filePath),
      contentType: stat.metaData['content-type'] || 'application/octet-stream',
      size: stat.size,
      etag: stat.etag,
      createdAt: new Date(stat.lastModified),
      bucket,
      path: filePath,
      url: this.generateUrl(bucket, filePath),
      metadata: this.extractMinioMetadata(stat.metaData),
    };
  }

  /**
   * Extract metadata from MinIO metadata object
   */
  private extractMinioMetadata(metaData: Record<string, string>): Record<string, string> {
    const metadata: Record<string, string> = {};
    
    Object.entries(metaData).forEach(([key, value]) => {
      // Extract custom metadata (prefixed with x-amz-meta-)
      if (key.toLowerCase().startsWith('x-amz-meta-')) {
        const metaKey = key.toLowerCase().replace('x-amz-meta-', '');
        metadata[metaKey] = value;
      }
    });
    
    return metadata;
  }

  /**
   * Generate a URL for a file
   */
  private generateUrl(bucket: string, filePath: string): string {
    if (this.isGcs) {
      // GCS URL format
      return `https://storage.googleapis.com/${bucket}/${encodeURIComponent(filePath)}`;
    } else {
      // MinIO/S3 URL format
      if (this.config.publicUrl) {
        return `${this.config.publicUrl}/${bucket}/${encodeURIComponent(filePath)}`;
      } else {
        return `${this.config.endpoint}/${bucket}/${encodeURIComponent(filePath)}`;
      }
    }
  }

  /**
   * Generate a unique file path based on the original filename
   */
  private generateFilePath(originalFileName: string): string {
    const ext = path.extname(originalFileName);
    const baseName = path.basename(originalFileName, ext);
    const sanitizedName = this.sanitizeFileName(baseName);
    const uuid = crypto.randomUUID();
    const timestamp = Date.now();
    
    return `${sanitizedName}-${uuid}-${timestamp}${ext}`;
  }

  /**
   * Sanitize a filename to remove invalid characters
   */
  private sanitizeFileName(fileName: string): string {
    // Replace spaces with hyphens
    let sanitized = fileName.replace(/\s+/g, '-');
    
    // Remove invalid characters
    sanitized = sanitized.replace(/[^a-zA-Z0-9-_.]/g, '');
    
    // Ensure the name isn't too long
    if (sanitized.length > 100) {
      sanitized = sanitized.substring(0, 100);
    }
    
    return sanitized.toLowerCase();
  }

  /**
   * Validate a file before upload
   */
  private validateFile(fileBuffer: Buffer | Readable, fileName: string): void {
    // Check file size for buffers (streams are checked during upload)
    if (Buffer.isBuffer(fileBuffer) && fileBuffer.length > this.config.maxFileSize) {
      throw new PayloadTooLargeException(
        `File size exceeds the maximum allowed size of ${this.config.maxFileSize} bytes`
      );
    }
    
    // Check file type based on extension
    const contentType = mime.lookup(fileName);
    
    if (!contentType) {
      throw new UnsupportedMediaTypeException(`Could not determine content type for file: ${fileName}`);
    }
    
    if (!this.config.allowedMimeTypes.includes(contentType)) {
      throw new UnsupportedMediaTypeException(
        `File type ${contentType} is not allowed. Allowed types: ${this.config.allowedMimeTypes.join(', ')}`
      );
    }
  }

  /**
   * Resolve a bucket name from predefined buckets or custom name
   */
  private resolveBucketName(bucketName: string | 'referrals' | 'pdfs' | 'logs'): string {
    if (bucketName === 'referrals') {
      return this.config.referralBucket;
    } else if (bucketName === 'pdfs') {
      return this.config.pdfBucket;
    } else if (bucketName === 'logs') {
      return this.config.logsBucket;
    } else {
      return bucketName;
    }
  }

  /**
   * Get the size of a buffer or stream
   */
  private getBufferSize(fileBuffer: Buffer | Readable): number {
    if (Buffer.isBuffer(fileBuffer)) {
      return fileBuffer.length;
    } else {
      // For streams, we can't determine the size synchronously
      // Return a placeholder value
      return 0;
    }
  }

  /**
   * Get the size of a stream by consuming it
   */
  private async getStreamSize(stream: Readable): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      
      stream.on('data', (chunk) => {
        chunks.push(chunk);
        size += chunk.length;
      });
      
      stream.on('end', () => {
        // Reconstruct the stream for later use
        const newStream = new Readable();
        newStream._read = () => {};
        
        // Push all chunks back into the stream
        chunks.forEach(chunk => {
          newStream.push(chunk);
        });
        
        newStream.push(null);
        
        // Replace the original stream with the new one
        Object.assign(stream, newStream);
        
        resolve(size);
      });
      
      stream.on('error', reject);
    });
  }

  /**
   * Handle storage errors with proper logging and error translation
   */
  private handleStorageError(error: any, operation: string, context: Record<string, any>): never {
    // Log the error with context
    this.logger.error(`Storage operation '${operation}' failed: ${error.message}`, {
      ...context,
      errorCode: error.code,
      errorName: error.name,
      stack: error.stack,
    });
    
    // Translate common storage errors to appropriate HTTP exceptions
    if (error instanceof BadRequestException || 
        error instanceof NotFoundException ||
        error instanceof UnsupportedMediaTypeException ||
        error instanceof PayloadTooLargeException) {
      throw error;
    }
    
    if (error.code === 'NotFound' || error.message.includes('does not exist')) {
      throw new NotFoundException(`File not found: ${context.filePath}`);
    }
    
    if (error.code === 'NoSuchBucket') {
      throw new NotFoundException(`Bucket not found: ${context.bucket}`);
    }
    
    if (error.code === 'EntityTooLarge' || error.message.includes('entity too large')) {
      throw new PayloadTooLargeException('File size exceeds the maximum allowed size');
    }
    
    if (error.code === 'InvalidArgument' || error.code === 'BadRequest') {
      throw new BadRequestException(error.message);
    }
    
    // Default to internal server error
    throw new InternalServerErrorException(`Storage operation failed: ${error.message}`);
  }
}
