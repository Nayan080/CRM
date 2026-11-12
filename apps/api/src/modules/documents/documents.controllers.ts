import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import {
  type ConsentListQuery,
  type ConsentResponse,
  type CreateConsentInput,
  type CreateShareInput,
  type DocumentListQuery,
  type DocumentResponse,
  MAX_UPLOAD_BYTES,
  type Paginated,
  type ShareListQuery,
  type ShareResponse,
  type SharedMatter,
  type UpdateDocumentInput,
  type UpdateShareInput,
  type UploadDocumentInput,
  consentListQuerySchema,
  createConsentSchema,
  createShareSchema,
  shareListQuerySchema,
  documentListQuerySchema,
  updateDocumentSchema,
  updateShareSchema,
  uploadDocumentSchema,
} from '@crm/contracts';
import { PERMISSIONS } from '@crm/permissions';
import type { Response } from 'express';
import type { ZodType } from 'zod';
import { RequirePermission, TenantScoped } from '../../common/auth/decorators.js';
import { contentDisposition } from '../../common/files/file-type.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import {
  DocumentsService,
  type FileDownload,
  type UploadedFile as File,
} from './documents.service.js';
import { SharingService } from './sharing.service.js';

const uuid = () => new ParseUUIDPipe();
const P = PERMISSIONS;
const pipe = <T>(schema: ZodType<T>) => new ZodValidationPipe(schema);

/** Held in memory (max 20 MB, one file), checked by content, then written to private storage. */
const upload = () =>
  FileInterceptor('file', {
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 10, parts: 12 },
  });

/** Files are always downloads, never rendered by the browser on our origin. */
function sendFile(res: Response, file: FileDownload): StreamableFile {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  return new StreamableFile(file.stream, {
    type: file.mimeType,
    length: file.sizeBytes,
    disposition: contentDisposition(file.fileName),
  });
}

@ApiTags('documents')
@TenantScoped()
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  @RequirePermission(P.DOCUMENT_READ)
  list(
    @Query(pipe(documentListQuerySchema)) q: DocumentListQuery,
  ): Promise<Paginated<DocumentResponse>> {
    return this.documents.list(q);
  }

  @Post()
  @ApiConsumes('multipart/form-data')
  @RequirePermission(P.DOCUMENT_UPLOAD)
  @UseInterceptors(upload())
  create(
    @Body(pipe(uploadDocumentSchema)) body: UploadDocumentInput,
    @UploadedFile() file: File | undefined,
  ): Promise<DocumentResponse> {
    return this.documents.upload(body, file);
  }

  @Get(':id')
  @RequirePermission(P.DOCUMENT_READ)
  get(@Param('id', uuid()) id: string): Promise<DocumentResponse> {
    return this.documents.get(id);
  }

  @Patch(':id')
  @RequirePermission(P.DOCUMENT_UPLOAD)
  update(
    @Param('id', uuid()) id: string,
    @Body(pipe(updateDocumentSchema)) body: UpdateDocumentInput,
  ): Promise<DocumentResponse> {
    return this.documents.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission(P.DOCUMENT_UPLOAD)
  remove(@Param('id', uuid()) id: string): Promise<void> {
    return this.documents.remove(id);
  }

  @Post(':id/versions')
  @ApiConsumes('multipart/form-data')
  @RequirePermission(P.DOCUMENT_UPLOAD)
  @UseInterceptors(upload())
  addVersion(
    @Param('id', uuid()) id: string,
    @UploadedFile() file: File | undefined,
  ): Promise<DocumentResponse> {
    return this.documents.addVersion(id, file);
  }

  @Get(':id/download')
  @RequirePermission(P.DOCUMENT_DOWNLOAD)
  async download(
    @Param('id', uuid()) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return sendFile(res, await this.documents.download(id));
  }

  @Get(':id/versions/:versionId/download')
  @RequirePermission(P.DOCUMENT_DOWNLOAD)
  async downloadVersion(
    @Param('id', uuid()) id: string,
    @Param('versionId', uuid()) versionId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return sendFile(res, await this.documents.download(id, versionId));
  }
}

@ApiTags('consents')
@TenantScoped()
@Controller('consents')
export class ConsentsController {
  constructor(private readonly sharing: SharingService) {}

  @Get()
  @RequirePermission(P.CLIENT_READ)
  list(@Query(pipe(consentListQuerySchema)) q: ConsentListQuery): Promise<ConsentResponse[]> {
    return this.sharing.listConsents(q);
  }

  @Post()
  @RequirePermission(P.CLIENT_UPDATE)
  create(@Body(pipe(createConsentSchema)) body: CreateConsentInput): Promise<ConsentResponse> {
    return this.sharing.createConsent(body);
  }

  @Post(':id/withdraw')
  @HttpCode(200)
  @RequirePermission(P.CLIENT_UPDATE)
  withdraw(@Param('id', uuid()) id: string): Promise<ConsentResponse> {
    return this.sharing.withdrawConsent(id);
  }
}

@ApiTags('shares')
@TenantScoped()
@Controller('shares')
export class SharesController {
  constructor(private readonly sharing: SharingService) {}

  @Get()
  @RequirePermission(P.SHARE_MANAGE)
  list(@Query(pipe(shareListQuerySchema)) q: ShareListQuery): Promise<ShareResponse[]> {
    return this.sharing.listShares(q);
  }

  @Post()
  @RequirePermission(P.SHARE_MANAGE)
  create(@Body(pipe(createShareSchema)) body: CreateShareInput): Promise<ShareResponse> {
    return this.sharing.createShare(body);
  }

  @Patch(':id')
  @RequirePermission(P.SHARE_MANAGE)
  update(
    @Param('id', uuid()) id: string,
    @Body(pipe(updateShareSchema)) body: UpdateShareInput,
  ): Promise<ShareResponse> {
    return this.sharing.updateShare(id, body);
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @RequirePermission(P.SHARE_MANAGE)
  revoke(@Param('id', uuid()) id: string): Promise<ShareResponse> {
    return this.sharing.revokeShare(id);
  }
}

/**
 * For EXTERNAL members (DEC-09): only matters explicitly shared with them, checked on every request.
 * No role permission is required — the share itself is the permission.
 */
@ApiTags('shared')
@TenantScoped()
@Controller('shared')
export class SharedController {
  constructor(private readonly sharing: SharingService) {}

  @Get()
  list(): Promise<SharedMatter[]> {
    return this.sharing.sharedWithMe();
  }

  @Get(':shareId')
  get(@Param('shareId', uuid()) shareId: string): Promise<SharedMatter> {
    return this.sharing.sharedMatter(shareId);
  }

  @Get(':shareId/documents/:documentId/download')
  async download(
    @Param('shareId', uuid()) shareId: string,
    @Param('documentId', uuid()) documentId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return sendFile(res, await this.sharing.downloadShared(shareId, documentId));
  }
}
