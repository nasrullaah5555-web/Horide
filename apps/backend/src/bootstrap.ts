import { BadRequestException, INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/http-exception.filter';
import type { AppConfig } from './config/env';

/**
 * Builds the application with all security middleware applied.
 * Used by main.ts and by tests, so tests run against exactly the same setup as production.
 */
export async function createApp(config: AppConfig): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    bufferLogs: true,
    // We register the JSON parser ourselves (below) so its errors keep their type
    // and can be turned into clean 400/413 responses.
    bodyParser: false,
  });
  app.useLogger(app.get(Logger));

  app.disable('x-powered-by');
  // Render and Cloudflare sit in front of the API; trust exactly one proxy hop for client IPs.
  app.set('trust proxy', 1);
  app.use(helmet());
  app.enableCors({
    origin: config.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  });
  app.use(json({ limit: '100kb' }));
  // Nest would otherwise turn JSON syntax errors into a 400 that repeats the parser's message,
  // which can echo fragments of the request. Replace it with a fixed, safe error.
  app.use((err: unknown, _req: Request, _res: Response, next: NextFunction) => {
    if ((err as { type?: unknown } | null)?.type === 'entity.parse.failed') {
      next(
        new BadRequestException({
          code: 'INVALID_JSON',
          message: 'Request body is not valid JSON.',
        }),
      );
      return;
    }
    next(err);
  });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
  return app;
}
