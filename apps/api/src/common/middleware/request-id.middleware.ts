import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { requestContextStorage } from '../logging/request-context';

const HEADER = 'x-request-id';

/**
 * Gives every request a stable correlation ID an operator can grep across
 * log lines to trace request -> service -> DB/Redis -> response, without
 * guessing by timestamp+path+method under concurrent load (previously the
 * only option -- no correlation mechanism existed at all). Trusts an
 * upstream reverse-proxy/load-balancer's own X-Request-Id if present
 * (so a request can be traced end-to-end across that hop too), otherwise
 * mints a fresh UUID. Echoed back on the response header and read by
 * AllExceptionsFilter so a client-reported error can be matched to the
 * exact server-side log line.
 *
 * Also seeds requestContextStorage (AsyncLocalStorage, the same pattern
 * tenant-context.ts already uses for tenant scoping) so PinoLoggerService
 * can stamp this id onto every log line for the lifetime of the request,
 * without every one of the dozens of existing `new Logger(X).log(...)`
 * call sites needing to be rewritten to thread it through by hand.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const incoming = req.headers[HEADER];
    const id = (typeof incoming === 'string' && incoming.trim()) || randomUUID();
    (req as Request & { id: string }).id = id;
    res.setHeader('X-Request-Id', id);
    requestContextStorage.run({ requestId: id }, next);
  }
}
