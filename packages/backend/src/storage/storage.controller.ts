import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Query,
  UseInterceptors,
  UploadedFile,
  Res,
  HttpStatus,
  BadRequestException,
  ParseFilePipeBuilder,
  StreamableFile,
  Logger,
  ParseEnumPipe,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { Response } from 'express';
import { StorageService, UploadOptions, UploadResult, FileMetadata } from './storage.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Express } from 'express';
import { Readable } from 'stream';
import * as path from 'path';

/**
 * DTO for file upload
 */
class FileUploadDto {
  /**
   * The file to upload
   */
  file: Express.Multer.File;

  /**
   * Custom path for the file (optional)
   */
  path?: string;

  /**
   * Whether the file should be publicly accessible
   */
  public?: boolean;

  /**
   * Metadata to attach to the file
   */
  metadata?: Record<string, string>;
}

/**
 * Enum for predefined bucket names
 */
enum BucketName {
  REFERRALS = 'referrals',
  PDFS = 'pdfs',
  LOGS = 'logs',
}

/**
 * Controller for file storage operations
 * Handles file uploads, downloads, and management
 */
@ApiTags('storage')
@Controller('storage')
export class StorageController {
  private readonly logger = new Logger(StorageController.name);
  private readonly MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
  private readonly ALLOWED_MIME_TYPES = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'image/jpeg',
    'image/png',
  ];

  constructor(private readonly storageService: StorageService) {}

  /**
   * Upload a file to storage
   * 
   * @param file The file to upload
   * @param bucket Target bucket name
   * @param customPath Optional custom path for the file
   * @param isPublic Whether the file should be publicly accessible
   * @param user Current authenticated user
   * @returns Upload result with file metadata and URLs
   */
  @Post('upload/:bucket')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload a file to storage' })
  @ApiConsumes('multipart/form-data')
  @ApiParam({
    name: 'bucket',
    enum: BucketName,
    description: 'Target bucket name',
  })
  @ApiBody({
    description: 'File to upload',
    type: FileUploadDto,
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'File uploaded successfully',
    type: Object,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid file or parameters',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Unauthorized',
  })
  @Roles(UserRole.ADMIN, UserRole.CLINICIAN, UserRole.SUPERVISOR)
  async uploadFile(
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({
          fileType: this.ALLOWED_MIME_TYPES,
        })
        .addMaxSizeValidator({
          maxSize: this.MAX_FILE_SIZE,
        })
        .build({
          errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        }),
    )
    file: Express.Multer.File,
    @Param('bucket', new ParseEnumPipe(BucketName)) bucket: BucketName,
    @Query('path') customPath?: string,
    @Query('public') isPublic?: boolean,
    @CurrentUser() user?: any,
  ): Promise<UploadResult> {
    try {
      this.logger.log(`Uploading file ${file.originalname} to bucket ${bucket}`);

      // Prepare upload options
      const options: UploadOptions = {
        path: customPath,
        public: isPublic === true,
        metadata: {
          uploadedBy: user?.id || 'anonymous',
          originalName: file.originalname,
        },
        contentType: file.mimetype,
      };

      // Upload the file
      const result = await this.storageService.uploadFile(
        bucket,
        file.buffer,
        file.originalname,
        options,
      );

      return result;
    } catch (error) {
      this.logger.error(`File upload failed: ${error.message}`, error.stack);
      throw new BadRequestException(`File upload failed: ${error.message}`);
    }
  }

  /**
   * Download a file from storage
   * 
   * @param bucket Source bucket name
   * @param filePath Path to the file
   * @param res Express response object
   * @returns Streamable file
   */
  @Get('files/:bucket/:filePath(*)')
  @ApiOperation({ summary: 'Download a file from storage' })
  @ApiParam({
    name: 'bucket',
    enum: BucketName,
    description: 'Source bucket name',
  })
  @ApiParam({
    name: 'filePath',
    description: 'Path to the file',
    type: String,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'File stream',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'File not found',
  })
  @Public()
  async downloadFile(
    @Param('bucket', new ParseEnumPipe(BucketName)) bucket: BucketName,
    @Param('filePath') filePath: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    try {
      // Get file metadata first to set proper headers
      const metadata = await this.storageService.getFileMetadata(bucket, filePath);
      
      // Set response headers
      res.set({
        'Content-Type': metadata.contentType,
        'Content-Disposition': `inline; filename="${encodeURIComponent(metadata.fileName)}"`,
        'Content-Length': metadata.size.toString(),
        'ETag': metadata.etag,
        'Last-Modified': metadata.updatedAt?.toUTCString() || metadata.createdAt.toUTCString(),
        'Cache-Control': 'max-age=3600',
      });
      
      // Download the file as a stream
      const fileStream = await this.storageService.downloadFile(bucket, filePath, { asStream: true }) as Readable;
      
      return new StreamableFile(fileStream);
    } catch (error) {
      this.logger.error(`File download failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get file metadata
   * 
   * @param bucket Source bucket name
   * @param filePath Path to the file
   * @returns File metadata
   */
  @Get('metadata/:bucket/:filePath(*)')
  @ApiOperation({ summary: 'Get file metadata' })
  @ApiParam({
    name: 'bucket',
    enum: BucketName,
    description: 'Source bucket name',
  })
  @ApiParam({
    name: 'filePath',
    description: 'Path to the file',
    type: String,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'File metadata',
    type: Object,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'File not found',
  })
  async getFileMetadata(
    @Param('bucket', new ParseEnumPipe(BucketName)) bucket: BucketName,
    @Param('filePath') filePath: string,
  ): Promise<FileMetadata> {
    return this.storageService.getFileMetadata(bucket, filePath);
  }

  /**
   * Delete a file from storage
   * 
   * @param bucket Source bucket name
   * @param filePath Path to the file
   * @returns Success status
   */
  @Delete('files/:bucket/:filePath(*)')
  @ApiOperation({ summary: 'Delete a file from storage' })
  @ApiParam({
    name: 'bucket',
    enum: BucketName,
    description: 'Source bucket name',
  })
  @ApiParam({
    name: 'filePath',
    description: 'Path to the file',
    type: String,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'File deleted successfully',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'File not found',
  })
  @Roles(UserRole.ADMIN, UserRole.SUPERVISOR)
  async deleteFile(
    @Param('bucket', new ParseEnumPipe(BucketName)) bucket: BucketName,
    @Param('filePath') filePath: string,
  ): Promise<{ success: boolean }> {
    const success = await this.storageService.deleteFile(bucket, filePath);
    return { success };
  }

  /**
   * List files in a bucket
   * 
   * @param bucket Source bucket name
   * @param prefix Optional prefix to filter files
   * @param limit Maximum number of files to return
   * @returns Array of file metadata
   */
  @Get('files/:bucket')
  @ApiOperation({ summary: 'List files in a bucket' })
  @ApiParam({
    name: 'bucket',
    enum: BucketName,
    description: 'Source bucket name',
  })
  @ApiQuery({
    name: 'prefix',
    required: false,
    description: 'Filter files by prefix',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Maximum number of files to return',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of files',
    type: [Object],
  })
  @Roles(UserRole.ADMIN, UserRole.CLINICIAN, UserRole.SUPERVISOR)
  async listFiles(
    @Param('bucket', new ParseEnumPipe(BucketName)) bucket: BucketName,
    @Query('prefix') prefix?: string,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit?: number,
  ): Promise<FileMetadata[]> {
    return this.storageService.listFiles(bucket, prefix, limit);
  }

  /**
   * Generate a signed URL for temporary access to a file
   * 
   * @param bucket Source bucket name
   * @param filePath Path to the file
   * @param expiresIn URL expiration time in seconds
   * @returns Signed URL
   */
  @Get('signed-url/:bucket/:filePath(*)')
  @ApiOperation({ summary: 'Generate a signed URL for temporary access' })
  @ApiParam({
    name: 'bucket',
    enum: BucketName,
    description: 'Source bucket name',
  })
  @ApiParam({
    name: 'filePath',
    description: 'Path to the file',
    type: String,
  })
  @ApiQuery({
    name: 'expiresIn',
    required: false,
    description: 'URL expiration time in seconds',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Signed URL',
    type: String,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'File not found',
  })
  @Roles(UserRole.ADMIN, UserRole.CLINICIAN, UserRole.SUPERVISOR)
  async getSignedUrl(
    @Param('bucket', new ParseEnumPipe(BucketName)) bucket: BucketName,
    @Param('filePath') filePath: string,
    @Query('expiresIn', new DefaultValuePipe(900), ParseIntPipe) expiresIn?: number,
  ): Promise<{ url: string, expiresAt: Date }> {
    const url = await this.storageService.generateSignedUrl(bucket, filePath, {
      expiresIn,
      method: 'GET',
    });
    
    const expiresAt = new Date(Date.now() + expiresIn * 1000);
    
    return { url, expiresAt };
  }
}
