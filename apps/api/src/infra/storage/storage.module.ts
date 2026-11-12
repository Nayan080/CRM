import { Global, Inject, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { OBJECT_STORAGE, type ObjectStorage, createObjectStorage } from './storage.js';

@Global()
@Module({
  providers: [
    {
      provide: OBJECT_STORAGE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createObjectStorage(config.storage),
    },
  ],
  exports: [OBJECT_STORAGE],
})
export class StorageModule implements OnApplicationBootstrap {
  private readonly log = new Logger(StorageModule.name);

  constructor(@Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage) {}

  /** Never blocks start-up: if storage is down, uploads fail with a clear error instead. */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.storage.ensureReady();
    } catch (error) {
      this.log.warn(`Object storage not ready: ${(error as Error).message}`);
    }
  }
}
