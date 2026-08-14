import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { SentryExceptionCaptured } from '@sentry/nestjs';
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
  timestamp: string;
  path: string;
}

const PRISMA_STATUS: Partial<Record<string, { status: number; message: string }>> = {
  P2002: { status: HttpStatus.CONFLICT, message: 'Ya existe un registro con esos datos.' },
  P2025: { status: HttpStatus.NOT_FOUND, message: 'El registro no existe.' },
  P2003: { status: HttpStatus.BAD_REQUEST, message: 'La operación viola una relación de datos existente.' },
};

/**
 * Catches every unhandled exception so nothing but a sanitized, consistent
 * body ever reaches the client — a raw Prisma or Node error can otherwise
 * leak table/column names, file paths, or connection strings.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  // Reports to GlitchTip only what's actually unexpected — any thrown
  // HttpException (NotFoundException, BadRequestException, the throttler's
  // 429, etc.) is normal control flow and skipped automatically, so this
  // doesn't turn routine 4xx responses into noise in the error tracker.
  @SentryExceptionCaptured()
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, message, error } = this.resolve(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(`${request.method} ${request.url} → ${status}`, (exception as Error)?.stack);
    }

    const body: ErrorBody = {
      statusCode: status,
      message,
      error,
      timestamp: new Date().toISOString(),
      path: request.url,
    };
    response.status(status).json(body);
  }

  private resolve(exception: unknown): { status: number; message: string | string[]; error: string } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        return { status, message: body, error: exception.name };
      }
      const asObj = body as { message?: string | string[]; error?: string };
      return {
        status,
        message: asObj.message ?? exception.message,
        error: asObj.error ?? exception.name,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped = PRISMA_STATUS[exception.code];
      if (mapped) {
        return { status: mapped.status, message: mapped.message, error: 'DatabaseError' };
      }
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Ha ocurrido un error interno. Intenta nuevamente.',
      error: 'InternalServerError',
    };
  }
}
