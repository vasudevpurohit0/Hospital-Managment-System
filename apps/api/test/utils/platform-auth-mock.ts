/**
 * Every login-dependent e2e spec needs this since the schema-per-tenant
 * conversion: `AuthService.login()` always resolves the identifier through
 * `LoginDirectoryService` (which reads `PlatformPrismaService`) *before* it
 * ever reaches the tenant-scoped `PrismaService` a spec mocks with its own
 * fixtures. Without overriding `PlatformPrismaService` (and
 * `TenantClientFactory`) too, every one of these specs 401s in `beforeAll`
 * regardless of how correct its tenant-side mock is.
 */

export interface MockDirectoryUser {
  identifier: string;
  /** null = a platform (Super Admin) user; a real value routes into the tenant mock below. */
  hospitalId: string | null;
}

/** Fixed fake hospital every mocked hospital-staff login in these specs resolves to. Never a real schema -- TenantClientFactory is mocked to never actually connect to it. */
export const E2E_TEST_HOSPITAL_ID = '00000000-0000-0000-0000-0000000000aa';
const E2E_TEST_SCHEMA_NAME = 'hospital_e2e_test';

/**
 * Builds the platform-directory mocks for `.overrideProvider(PlatformPrismaService)`
 * and `.overrideProvider(TenantClientFactory)`. `tenantPrisma` is the same
 * mock object the spec already passes to `.overrideProvider(PrismaService)` --
 * handing it back from `TenantClientFactory.getClient()` means
 * `runWithTenant()`'s stashed `prismaClient` is inert (every real service
 * call still goes through the DI-injected, always-the-mock `PrismaService`)
 * but harmless, and login never opens a real database connection.
 */
export function createPlatformAuthMocks(users: MockDirectoryUser[], tenantPrisma: unknown) {
  interface DirectoryRow {
    identifier: string;
    hospitalId: string | null;
    failedAttempts: number;
    lockedUntil: Date | null;
    manuallyLockedAt: Date | null;
    lastAttemptAt: Date | null;
  }

  const directoryRows = new Map<string, DirectoryRow>(
    users.map((u) => [
      u.identifier,
      {
        identifier: u.identifier,
        hospitalId: u.hospitalId,
        failedAttempts: 0,
        lockedUntil: null,
        manuallyLockedAt: null,
        lastAttemptAt: null,
      },
    ]),
  );

  const platformPrismaMock = {
    loginIdentifier: {
      findUnique: jest.fn().mockImplementation(async ({ where }: { where: { identifier: string } }) => {
        return directoryRows.get(where.identifier) ?? null;
      }),
      update: jest
        .fn()
        .mockImplementation(async ({ where, data }: { where: { identifier: string }; data: Partial<DirectoryRow> }) => {
          const row = directoryRows.get(where.identifier);
          if (!row) throw new Error(`No mocked directory row for "${where.identifier}"`);
          Object.assign(row, data);
          return row;
        }),
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    hospital: {
      findUnique: jest.fn().mockImplementation(async ({ where }: { where: { id: string } }) => {
        if (where.id !== E2E_TEST_HOSPITAL_ID) return null;
        return { id: E2E_TEST_HOSPITAL_ID, status: 'ACTIVE', schemaName: E2E_TEST_SCHEMA_NAME, slug: 'e2e-test' };
      }),
    },
    platformUser: { findUnique: jest.fn().mockResolvedValue(null) },
    platformLoginActivity: { create: jest.fn().mockResolvedValue({}) },
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
  };

  const tenantClientFactoryMock = {
    getClient: jest.fn().mockResolvedValue(tenantPrisma),
  };

  /** For a spec that creates an additional user mid-test (bypassing the real registration flow, which would otherwise call LoginDirectoryService.register() itself) -- registers it in this same in-memory directory so a subsequent login for it can resolve. */
  function registerUser(identifier: string, hospitalId: string | null = E2E_TEST_HOSPITAL_ID) {
    directoryRows.set(identifier, {
      identifier,
      hospitalId,
      failedAttempts: 0,
      lockedUntil: null,
      manuallyLockedAt: null,
      lastAttemptAt: null,
    });
  }

  return { platformPrismaMock, tenantClientFactoryMock, registerUser };
}

/** The tenant-side stubs every successful login writes to, regardless of which spec: without these, a spec whose own fixture object omits them 401s not because auth logic rejected it, but because `this.prisma.loginActivity.create(...)` (etc.) throws on an undefined property before its own `.catch()` is even reached. */
export function baseLoginTenantStubs() {
  return {
    loginActivity: { create: jest.fn().mockResolvedValue({}) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
}
