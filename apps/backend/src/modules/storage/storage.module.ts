import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env';
import { LocalDiskStorage, S3Storage, STORAGE_PROVIDER } from './storage.provider';

@Global()
@Module({
  providers: [
    {
      provide: STORAGE_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.STORAGE_PROVIDER === 'local'
          ? new LocalDiskStorage(config.STORAGE_LOCAL_DIR)
          : new S3Storage(),
    },
  ],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
