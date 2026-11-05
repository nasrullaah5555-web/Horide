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
          : new S3Storage({
              bucket: config.S3_BUCKET!,
              region: config.S3_REGION,
              accessKeyId: config.S3_ACCESS_KEY_ID!,
              secretAccessKey: config.S3_SECRET_ACCESS_KEY!,
              ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT } : {}),
              forcePathStyle: config.S3_FORCE_PATH_STYLE,
              serverSideEncryption: config.S3_SERVER_SIDE_ENCRYPTION,
            }),
    },
  ],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
