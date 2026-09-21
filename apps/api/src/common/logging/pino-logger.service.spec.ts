import { PinoLoggerService } from './pino-logger.service';
import { requestContextStorage } from './request-context';

describe('PinoLoggerService', () => {
  const captured: any[] = [];

  beforeEach(() => {
    captured.length = 0;
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      try {
        captured.push(JSON.parse(chunk.toString()));
      } catch {
        // pino-pretty output in non-prod isn't JSON -- ignore for this test's purposes
      }
      return true;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function withProdJsonLogger<T>(fn: (logger: PinoLoggerService) => T): T {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      return fn(new PinoLoggerService());
    } finally {
      process.env.NODE_ENV = prev;
    }
  }

  it('emits structured JSON with the log level, context, and message', () => {
    withProdJsonLogger((logger) => logger.log('hello world', 'MyService'));
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({ level: 30, context: 'MyService', msg: 'hello world' });
  });

  it('includes the active request id from AsyncLocalStorage without the call site passing it', () => {
    withProdJsonLogger((logger) => {
      requestContextStorage.run({ requestId: 'req-abc-999' }, () => {
        logger.warn('something happened', 'AnotherService');
      });
    });
    expect(captured[0]).toMatchObject({ requestId: 'req-abc-999', context: 'AnotherService' });
  });

  it('omits requestId (undefined, not a stale value) outside any request context', () => {
    withProdJsonLogger((logger) => logger.log('boot message', 'Bootstrap'));
    expect(captured[0].requestId).toBeUndefined();
  });

  it('error() includes the stack trace field separately from the message', () => {
    withProdJsonLogger((logger) => logger.error('it broke', 'Error: it broke\n  at x', 'Ctx'));
    expect(captured[0]).toMatchObject({ level: 50, msg: 'it broke', stack: expect.stringContaining('it broke') });
  });

  it('redacts an Authorization header if a raw request-like object is ever logged directly', () => {
    withProdJsonLogger((logger) =>
      logger.log({ req: { headers: { authorization: 'Bearer super-secret-token' } } } as any, 'Ctx'),
    );
    expect(JSON.stringify(captured[0])).not.toContain('super-secret-token');
  });
});
