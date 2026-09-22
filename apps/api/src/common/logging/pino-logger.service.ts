import { Injectable, LoggerService, LogLevel } from '@nestjs/common';
import pino, { Logger as PinoInstance } from 'pino';
import { getRequestId } from './request-context';

const LEVEL_MAP: Record<LogLevel, pino.Level> = {
  verbose: 'trace',
  debug: 'debug',
  log: 'info',
  warn: 'warn',
  error: 'error',
  fatal: 'fatal',
};

/**
 * Nest's `LoggerService` implementation backed by Pino, wired via
 * `app.useLogger()` -- every existing `new Logger(ClassName).log(...)` call
 * site across the app (dozens of them, already written) transparently
 * routes through this without any of them needing to change, since Nest's
 * `Logger` class delegates to whatever was passed to `useLogger()`.
 *
 * `pino`/`pino-pretty` were already installed dependencies before this --
 * found during this session's own audit that neither was ever actually
 * wired up anywhere, so the app was still using Nest's plain console
 * logger despite having the tooling for real structured logs sitting
 * unused. Human-readable (pino-pretty) outside production, structured JSON
 * in it -- production log aggregators (anything reading stdout) need JSON,
 * not colorized text.
 *
 * Every line automatically carries the current request's correlation ID
 * (see request-context.ts) when one is active, without any call site
 * needing to pass it explicitly.
 */
@Injectable()
export class PinoLoggerService implements LoggerService {
  private readonly pino: PinoInstance;

  constructor() {
    const isProd = process.env.NODE_ENV === 'production';
    this.pino = pino({
      level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
      transport: isProd
        ? undefined
        : {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          },
      // Never let a logged Error object's message/stack accidentally carry
      // request bodies or headers through pino's default serializers --
      // this app already logs deliberately-chosen strings at every call
      // site (see AllExceptionsFilter), not raw request/response objects.
      redact: { paths: ['req.headers.authorization', 'req.headers.cookie'], remove: true },
    });
  }

  /**
   * A plain-object message is kept as real structured data (merged into the
   * log object pino actually sees) rather than flattened to a JSON string --
   * flattening it to text first would put it inside the `msg` string, where
   * pino's own `redact` option (configured above) can no longer see the
   * `req.headers.authorization`-shaped path it's meant to catch. Every
   * existing call site in this app already only ever passes plain strings
   * (or Errors, via `error()`'s stack param), so this only changes behavior
   * for the rare/future case of a call site accidentally logging a raw
   * object.
   */
  private write(level: LogLevel, message: unknown, context?: string) {
    const requestId = getRequestId();
    const pinoLevel = LEVEL_MAP[level];
    if (message !== null && typeof message === 'object' && !(message instanceof Error)) {
      this.pino[pinoLevel]({ context, requestId, ...message }, 'log');
      return;
    }
    this.pino[pinoLevel]({ context, requestId }, this.stringify(message));
  }

  private stringify(message: unknown): string {
    if (typeof message === 'string') return message;
    if (message instanceof Error) return message.message;
    try {
      return JSON.stringify(message);
    } catch {
      return String(message);
    }
  }

  log(message: unknown, context?: string) {
    this.write('log', message, context);
  }

  error(message: unknown, stack?: string, context?: string) {
    const requestId = getRequestId();
    if (message !== null && typeof message === 'object' && !(message instanceof Error)) {
      this.pino.error({ context, requestId, stack, ...message }, 'log');
      return;
    }
    this.pino.error({ context, requestId, stack }, this.stringify(message));
  }

  warn(message: unknown, context?: string) {
    this.write('warn', message, context);
  }

  debug(message: unknown, context?: string) {
    this.write('debug', message, context);
  }

  verbose(message: unknown, context?: string) {
    this.write('verbose', message, context);
  }

  fatal(message: unknown, context?: string) {
    this.write('fatal', message, context);
  }
}
