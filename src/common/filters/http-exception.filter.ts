import { Catch, HttpException, HttpStatus } from '@nestjs/common';
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
  /** Same id as the X-Request-Id header and the log lines of this request. */
  requestId?: string;
}

const PRISMA_STATUS: Partial<
  Record<string, { status: number; message: string }>
> = {
  P2002: {
    status: HttpStatus.CONFLICT,
    message: 'Ya existe un registro con esos datos.',
  },
  P2025: { status: HttpStatus.NOT_FOUND, message: 'El registro no existe.' },
  P2003: {
    status: HttpStatus.BAD_REQUEST,
    message: 'La operación viola una relación de datos existente.',
  },
};

/**
 * Catches every unhandled exception so nothing but a sanitized, consistent
 * body ever reaches the client — a raw Prisma or Node error can otherwise
 * leak table/column names, file paths, or connection strings.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  // Reports to GlitchTip only what's actually unexpected — any thrown
  // HttpException (NotFoundException, BadRequestException, the throttler's
  // 429, etc.) is normal control flow and skipped automatically, so this
  // doesn't turn routine 4xx responses into noise in the error tracker.
  @SentryExceptionCaptured()
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response & { err?: Error }>();
    const request = ctx.getRequest<Request & { id?: string | number }>();

    const { status, message, error } = this.resolve(exception);
    const requestId = request.id ? String(request.id) : undefined;

    // pino-http logs the request line when the response finishes; handing it
    // the error puts the reason (and, for a 5xx, the stack) on that same line,
    // next to the request id, the user and the company.
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      // Who and which company is already on the error tracker's scope
      // (ContextoSentryInterceptor).
      response.err =
        exception instanceof Error ? exception : new Error(String(exception));
    } else {
      const motivo = new Error(
        Array.isArray(message) ? message.join('; ') : message,
      );
      motivo.name = error;
      motivo.stack = undefined; // expected client errors: the reason is enough
      response.err = motivo;
    }

    const body: ErrorBody = {
      statusCode: status,
      message,
      error,
      timestamp: new Date().toISOString(),
      path: request.url,
      requestId,
    };
    response.status(status).json(body);
  }

  private resolve(exception: unknown): {
    status: number;
    message: string | string[];
    error: string;
  } {
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
        return {
          status: mapped.status,
          message: mapped.message,
          error: 'DatabaseError',
        };
      }
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Ha ocurrido un error interno. Intenta nuevamente.',
      error: 'InternalServerError',
    };
  }
}
