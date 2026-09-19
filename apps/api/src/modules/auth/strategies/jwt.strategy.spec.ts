import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy, JwtPayload } from './jwt.strategy';

describe('JwtStrategy', () => {
  const mockPrisma = {
    user: { findUnique: jest.fn() },
  };

  const strategy = new JwtStrategy(mockPrisma as never);

  const basePayload: JwtPayload = {
    sub: 'user-1',
    identifier: 'nurse@esic.gov.in',
    roleId: 'role-1',
    roleName: 'Nurse',
    hospitalId: 'hospital-1',
    schemaName: 'hospital_test',
    tokenVersion: 2,
    type: 'access',
  };

  const activeUser = {
    id: 'user-1',
    identifier: 'nurse@esic.gov.in',
    roleId: 'role-1',
    active: true,
    mustChangePassword: false,
    tokenVersion: 2,
    role: { name: 'Nurse', permissions: [] },
  };

  beforeEach(() => jest.clearAllMocks());

  it('accepts a token whose tokenVersion matches the live User row', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(activeUser);
    const result = await strategy.validate(basePayload);
    expect(result.id).toBe('user-1');
  });

  it('rejects a token issued before a password reset/lock/deactivation bumped tokenVersion', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...activeUser, tokenVersion: 3 });
    await expect(strategy.validate(basePayload)).rejects.toThrow(UnauthorizedException);
  });

  it('does not reject an old token that predates tokenVersion entirely (backward compatibility)', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...activeUser, tokenVersion: 3 });
    const payloadWithoutVersion: Partial<JwtPayload> = { ...basePayload };
    delete payloadWithoutVersion.tokenVersion;
    const result = await strategy.validate(payloadWithoutVersion as JwtPayload);
    expect(result.id).toBe('user-1');
  });

  it('still rejects an inactive user regardless of tokenVersion', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...activeUser, active: false });
    await expect(strategy.validate(basePayload)).rejects.toThrow(UnauthorizedException);
  });
});
