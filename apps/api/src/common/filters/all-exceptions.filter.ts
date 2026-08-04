import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const rawResponse =
      exception instanceof HttpException ? exception.getResponse() : null;

    const errorMessage =
      exception instanceof Error ? exception.message : String(exception);
    const stack = exception instanceof Error ? exception.stack : '';

    if (status >= 500) {
      this.logger.error(
        `[${request.method}] ${request.url} - Status ${status}: ${errorMessage}`,
        stack,
      );
    } else {
      this.logger.warn(`[${request.method}] ${request.url} - Status ${status}: ${errorMessage}`);
    }

    let responsePayload: Record<string, unknown>;

    if (rawResponse && typeof rawResponse === 'object') {
      responsePayload = {
        statusCode: status,
        timestamp: new Date().toISOString(),
        path: request.url,
        ...(rawResponse as Record<string, unknown>),
      };
    } else if (typeof rawResponse === 'string') {
      responsePayload = {
        statusCode: status,
        timestamp: new Date().toISOString(),
        path: request.url,
        message: rawResponse,
      };
    } else {
      // Hide internal stack trace and details for 500 errors sent to client
      responsePayload = {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        error: 'Internal Server Error',
        message: 'An unexpected server error occurred. Please try again later.',
        timestamp: new Date().toISOString(),
        path: request.url,
      };
    }

    response.status(status).json(responsePayload);
  }
}
