import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { PlatformPrismaService } from './platform-prisma.service';

const LOCKOUT_THRESHOLD = Number(process.env.LOGIN_LOCKOUT_THRESHOLD || 5);
const LOCKOUT_MINUTES = Number(process.env.LOGIN_LOCKOUT_MINUTES || 15);

export interface ResolvedIdentifier {
  hospitalId: string | null;
}

/**
 * The single directory that makes one unified login possible: maps every
 * login identifier on the platform to the hospital it belongs to (null for a
 * PlatformUser). Since it lives in the public/platform schema, it's the one
 * table reachable before any tenant schema is even known -- which is also
 * why lockout state lives here rather than per-tenant.
 */
@Injectable()
export class LoginDirectoryService {
  constructor(private readonly platformPrisma: PlatformPrismaService) {}

  /** Registers a newly created user's identifier. Throws if already taken anywhere on the platform. */
  async register(identifier: string, hospitalId: string | null): Promise<void> {
    const existing = await this.platformPrisma.loginIdentifier.findUnique({ where: { identifier } });
    if (existing) {
      throw new ConflictException(
        `The identifier "${identifier}" is already registered${existing.hospitalId ? ' to another hospital' : ' to a platform account'}.`,
      );
    }
    await this.platformPrisma.loginIdentifier.create({ data: { identifier, hospitalId } });
  }

  async resolve(identifier: string): Promise<ResolvedIdentifier | null> {
    const row = await this.platformPrisma.loginIdentifier.findUnique({ where: { identifier } });
    if (!row) return null;
    return { hospitalId: row.hospitalId };
  }

  /** Throws if this identifier is currently locked out from repeated failures. */
  async checkLock(identifier: string): Promise<void> {
    const row = await this.platformPrisma.loginIdentifier.findUnique({ where: { identifier } });
    if (row?.lockedUntil && row.lockedUntil > new Date()) {
      throw new ForbiddenException('Account temporarily locked due to repeated failed attempts. Try again later.');
    }
  }

  async recordFailure(identifier: string): Promise<void> {
    const row = await this.platformPrisma.loginIdentifier.findUnique({ where: { identifier } });
    if (!row) return; // unresolvable identifiers have no directory row to update
    const failedAttempts = row.failedAttempts + 1;
    const lockedUntil =
      failedAttempts >= LOCKOUT_THRESHOLD ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : row.lockedUntil;
    await this.platformPrisma.loginIdentifier.update({
      where: { identifier },
      data: { failedAttempts, lockedUntil, lastAttemptAt: new Date() },
    });
  }

  async recordSuccess(identifier: string): Promise<void> {
    await this.platformPrisma.loginIdentifier
      .update({
        where: { identifier },
        data: { failedAttempts: 0, lockedUntil: null, lastAttemptAt: new Date() },
      })
      .catch(() => undefined); // identifier always exists by the time this is called (post-resolve)
  }

  async rename(oldIdentifier: string, newIdentifier: string): Promise<void> {
    await this.platformPrisma.loginIdentifier.update({
      where: { identifier: oldIdentifier },
      data: { identifier: newIdentifier },
    });
  }

  async remove(identifier: string): Promise<void> {
    await this.platformPrisma.loginIdentifier.deleteMany({ where: { identifier } });
  }
}
