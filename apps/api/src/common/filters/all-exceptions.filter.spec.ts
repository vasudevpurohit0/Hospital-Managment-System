import { BadRequestException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  function run(exception: unknown, requestId?: string) {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const response = { status };
    const request = { method: 'GET', url: '/api/employees', id: requestId };
    const host: any = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request,
      }),
    };
    filter.catch(exception, host);
    return { status, json };
  }

  it('includes the request id on a handled HttpException response', () => {
    const { json } = run(new BadRequestException('bad input'), 'req-abc-123');
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'req-abc-123' }));
  });

  it('includes the request id on the generic 500 fallback response, without leaking the real error message', () => {
    const { status, json } = run(new Error('connection string contains a password'), 'req-xyz-789');
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-xyz-789',
        message: 'An unexpected server error occurred. Please try again later.',
      }),
    );
    const payload = json.mock.calls[0][0];
    expect(JSON.stringify(payload)).not.toContain('password');
  });

  it('still returns a valid response when request.id is unset (defensive -- should never happen once RequestIdMiddleware is wired)', () => {
    const { json } = run(new BadRequestException('bad input'), undefined);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ requestId: undefined }));
  });
});
