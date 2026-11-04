import { HttpException, HttpStatus } from '@nestjs/common';

/** An error with a stable machine-readable code that the apps can react to. */
export class AppError extends HttpException {
  constructor(status: HttpStatus, code: string, message: string, details?: unknown) {
    super({ code, message, ...(details !== undefined ? { details } : {}) }, status);
  }
}
