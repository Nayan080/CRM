import { Module } from '@nestjs/common';
import {
  ConsentsController,
  DocumentsController,
  SharedController,
  SharesController,
} from './documents/documents.controllers.js';
import { DocumentsService } from './documents/documents.service.js';
import { SharingService } from './documents/sharing.service.js';

/** Stage 6: documents and versions in private storage, consents, external shares. */
@Module({
  controllers: [DocumentsController, ConsentsController, SharesController, SharedController],
  providers: [DocumentsService, SharingService],
})
export class DocumentsModule {}
