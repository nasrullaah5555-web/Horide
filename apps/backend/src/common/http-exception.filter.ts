import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * Every error leaves the API in one shape:
 *   { "error": { "code": "NOT_FOUND", "message": "...", "details": ... }, "requestId": "..." }
 * Unexpected errors are logged in full but the client only sees a generic message,
 * so stack traces, SQL and internal details never leak.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    const requestId = req.id ? String(req.id) : undefined;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const obj =
        typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
      res.status(status).json({
        error: {
          code: typeof obj.code === 'string' ? obj.code : statusCode(status),
          message: typeof obj.message === 'string' ? obj.message : exception.message,
          ...(obj.details !== undefined ? { details: obj.details } : {}),
        },
        requestId,
      });
      return;
    }

    // Errors from Express middleware (e.g. the JSON body parser) are not HttpExceptions.
    // They carry a 4xx status and expose=true; map them to safe, fixed messages.
    const clientError = expressClientError(exception);
    if (clientError) {
      res.status(clientError.status).json({ error: clientError.error, requestId });
      return;
    }

    this.logger.error({ err: exception, requestId }, 'Unhandled error');
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' },
      requestId,
    });
  }
}

function expressClientError(
  exception: unknown,
): { status: number; error: { code: string; message: string } } | null {
  if (typeof exception !== 'object' || exception === null) return null;
  const e = exception as { status?: unknown; expose?: unknown; type?: unknown };
  if (typeof e.status !== 'number' || e.status < 400 || e.status >= 500 || e.expose !== true) {
    return null;
  }
  if (e.type === 'entity.too.large') {
    return {
      status: 413,
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' },
    };
  }
  if (e.type === 'entity.parse.failed') {
    return {
      status: 400,
      error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON.' },
    };
  }
  return { status: e.status, error: { code: statusCode(e.status), message: 'Invalid request.' } };
}

function statusCode(status: number): string {
  const name = HttpStatus[status];
  return typeof name === 'string' ? name : 'ERROR';
}
