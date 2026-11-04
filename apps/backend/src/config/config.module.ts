import { DynamicModule, Global, Module } from '@nestjs/common';
import { AppConfig } from './env';

/** Injection token for the validated configuration object. */
export const APP_CONFIG = Symbol('APP_CONFIG');

/**
 * Makes the validated config available everywhere via @Inject(APP_CONFIG).
 * The config is validated before Nest starts (see main.ts), so modules never see invalid values.
 */
@Global()
@Module({})
export class ConfigModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: APP_CONFIG, useValue: Object.freeze({ ...config }) }],
      exports: [APP_CONFIG],
    };
  }
}
