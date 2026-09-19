import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { PlatformPrismaService } from './platform-prisma.service';

const LOCKOUT_THRESHOLD = Number(process.env.LOGIN_LOCKOUT_THRESHOLD || 5);
const LOCKOUT_MINUTES = Number(process.env.LOGIN_LOCKOUT_MINUTES || 15);

export interface ResolvedIdentifier {
  hospitalId: string | null;
}

export interface LoginIdentifierStatus {
  identifier: string;
  failedAttempts: number;
  lockedUntil: Date | null;
  manuallyLockedAt: Date | null;
  lastAttemptAt: Date | null;
}

/** Every identifier this directory sees is normalized the same way login does, so casing can never create a duplicate or a silent lookup miss. */
function normalize(identifier: string): string {
  return identifier.trim().toLowerCase();
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
    const normalized = normalize(identifier);
    const existing = await this.platformPrisma.loginIdentifier.findUnique({ where: { identifier: normalized } });
    if (existing) {
      throw new ConflictException(
        `The identifier "${identifier}" is already registered${existing.hospitalId ? ' to another hospital' : ' to a platform account'}.`,
      );
    }
    await this.platformPrisma.loginIdentifier.create({ data: { identifier: normalized, hospitalId } });
  }

  async resolve(identifier: string): Promise<ResolvedIdentifier | null> {
    const row = await this.platformPrisma.loginIdentifier.findUnique({ where: { identifier: normalize(identifier) } });
    if (!row) return null;
    return { hospitalId: row.hospitalId };
  }

  /** Throws if this identifier is currently locked out, whether automatically (repeated failures) or manually (an admin's Lock Account action). */
  async checkLock(identifier: string): Promise<void> {
    const row = await this.platformPrisma.loginIdentifier.findUnique({ where: { identifier: normalize(identifier) } });
    if (row?.manuallyLockedAt) {
      throw new ForbiddenException('Account locked by an administrator. Contact your administrator to unlock it.');
    }
    if (row?.lockedUntil && row.lockedUntil > new Date()) {
      throw new ForbiddenException('Account temporarily locked due to repeated failed attempts. Try again later.');
    }
  }

  async recordFailure(identifier: string): Promise<void> {
    const normalized = normalize(identifier);
    const row = await this.platformPrisma.loginIdentifier.findUnique({ where: { identifier: normalized } });
    if (!row) return; // unresolvable identifiers have no directory row to update
    const failedAttempts = row.failedAttempts + 1;
    const lockedUntil =
      failedAttempts >= LOCKOUT_THRESHOLD ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : row.lockedUntil;
    await this.platformPrisma.loginIdentifier.update({
      where: { identifier: normalized },
      data: { failedAttempts, lockedUntil, lastAttemptAt: new Date() },
    });
  }

  async recordSuccess(identifier: string): Promise<void> {
    await this.platformPrisma.loginIdentifier
      .update({
        where: { identifier: normalize(identifier) },
        data: { failedAttempts: 0, lockedUntil: null, lastAttemptAt: new Date() },
      })
      .catch(() => undefined); // identifier always exists by the time this is called (post-resolve)
  }

  /** Admin-triggered lock (the Lock Account button) -- independent of the automatic failed-attempt lockout. */
  async lockManually(identifier: string): Promise<void> {
    await this.platformPrisma.loginIdentifier.update({
      where: { identifier: normalize(identifier) },
      data: { manuallyLockedAt: new Date() },
    });
  }

  /** Unlock means usable again immediately -- clears the manual lock AND the automatic one together, not just whichever triggered it. */
  async unlock(identifier: string): Promise<void> {
    await this.platformPrisma.loginIdentifier.update({
      where: { identifier: normalize(identifier) },
      data: { manuallyLockedAt: null, lockedUntil: null, failedAttempts: 0 },
    });
  }

  async getStatus(identifier: string): Promise<LoginIdentifierStatus | null> {
    const row = await this.platformPrisma.loginIdentifier.findUnique({ where: { identifier: normalize(identifier) } });
    if (!row) return null;
    return {
      identifier: row.identifier,
      failedAttempts: row.failedAttempts,
      lockedUntil: row.lockedUntil,
      manuallyLockedAt: row.manuallyLockedAt,
      lastAttemptAt: row.lastAttemptAt,
    };
  }

  /** Batch form of getStatus, for a staff list screen that shouldn't do one query per row. */
  async getStatuses(identifiers: string[]): Promise<Map<string, LoginIdentifierStatus>> {
    if (identifiers.length === 0) return new Map();
    const rows = await this.platformPrisma.loginIdentifier.findMany({
      where: { identifier: { in: identifiers.map(normalize) } },
    });
    const map = new Map<string, LoginIdentifierStatus>();
    for (const row of rows) {
      map.set(row.identifier, {
        identifier: row.identifier,
        failedAttempts: row.failedAttempts,
        lockedUntil: row.lockedUntil,
        manuallyLockedAt: row.manuallyLockedAt,
        lastAttemptAt: row.lastAttemptAt,
      });
    }
    return map;
  }

  async rename(oldIdentifier: string, newIdentifier: string): Promise<void> {
    await this.platformPrisma.loginIdentifier.update({
      where: { identifier: normalize(oldIdentifier) },
      data: { identifier: normalize(newIdentifier) },
    });
  }

  async remove(identifier: string): Promise<void> {
    await this.platformPrisma.loginIdentifier.deleteMany({ where: { identifier: normalize(identifier) } });
  }
}
