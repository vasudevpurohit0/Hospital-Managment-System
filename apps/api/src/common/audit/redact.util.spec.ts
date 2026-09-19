import { redactSensitiveFields } from './redact.util';

describe('redactSensitiveFields (regression: plaintext temp passwords persisted verbatim into the audit log)', () => {
  it('redacts a top-level temporaryPassword field', () => {
    const result = redactSensitiveFields({ id: 'u1', email: 'doc@example.com', temporaryPassword: 'Sup3rSecret!' });
    expect(result).toEqual({ id: 'u1', email: 'doc@example.com', temporaryPassword: '[REDACTED]' });
  });

  it('redacts nested password/secret/token fields at any depth', () => {
    const result = redactSensitiveFields({
      user: { id: 'u1', passwordHash: 'abc123', profile: { apiKey: 'sk-live-xyz' } },
      refreshToken: 'rt-abc',
    });
    expect(result).toEqual({
      user: { id: 'u1', passwordHash: '[REDACTED]', profile: { apiKey: '[REDACTED]' } },
      refreshToken: '[REDACTED]',
    });
  });

  it('redacts sensitive fields inside array elements', () => {
    const result = redactSensitiveFields([{ id: 'a', secret: 'x' }, { id: 'b', secret: 'y' }]);
    expect(result).toEqual([{ id: 'a', secret: '[REDACTED]' }, { id: 'b', secret: '[REDACTED]' }]);
  });

  it('leaves non-sensitive fields and primitives untouched', () => {
    const input = { id: 'u1', name: 'Dr. Rao', active: true, count: 3 };
    expect(redactSensitiveFields(input)).toEqual(input);
  });

  it('handles null/undefined/primitive input without throwing', () => {
    expect(redactSensitiveFields(null)).toBeNull();
    expect(redactSensitiveFields(undefined)).toBeUndefined();
    expect(redactSensitiveFields('plain string')).toBe('plain string');
    expect(redactSensitiveFields(42)).toBe(42);
  });
});
