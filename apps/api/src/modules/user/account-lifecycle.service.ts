import * as bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PrismaClientLike } from '../../common/sequence/document-sequence.service';
import { LoginDirectoryService } from '../../common/tenant/login-directory.service';
import { getTenantContext } from '../../common/tenant/tenant-context';
import { generateSecurePassword } from '../../common/security/password.util';
import { AuthService } from '../auth/auth.service';
import { EmailService } from '../../common/email/email.service';
import { tempPasswordEmailBody, TEMP_PASSWORD_EMAIL_SUBJECT } from '../../common/email/templates';

/**
 * F-25: DoctorService and StaffService started as two independently-written,
 * ~90%-identical account-lifecycle implementations (create/reset/lock/
 * deactivate/resend-activation all mirrored each other line-for-line), which
 * had already caused real fix-drift once. This base class is the shared home
 * for the pieces that were byte-for-byte (or near enough) identical between
 * the two, so a future fix to any of them lands once, not twice.
 *
 * Account *creation* is deliberately left out: the two DTOs, the profile
 * rows each creates (DoctorProfile vs. Employee designation/shift/department
 * fields), and the master-data lookups they each need diverge enough that
 * forcing them through one shared method would trade real duplication for a
 * worse, harder-to-follow abstraction -- exactly the kind of "premature
 * abstraction" that isn't worth it. What genuinely is identical across both
 * -- credential emails, and the lock/deactivate/reset-password/resend-
 * activation control flow -- lives here.
 */

export interface Actor {
  id: string;
  roleName: string;
  /**
   * 'platform' when the actor is a Platform/Central Super Admin operating
   * inside a hospital (via X-Hospital-Id). Their id is a PlatformUser id, NOT
   * a tenant `User` -- so it must never be written to tenant columns that FK
   * to `User` (audit_logs.actor_user_id, email_logs.sent_by_user_id), or the
   * write fails with a foreign-key violation. Undefined/'hospital' = a normal
   * tenant user whose id is safe to record.
   */
  type?: 'hospital' | 'platform';
}

export const TEMP_PASSWORD_TTL_MS = 24 * 60 * 60_000;

/** The minimal shape every account-lifecycle method here actually touches -- both DoctorService's and StaffService's real (much wider) user rows already satisfy this structurally. */
export interface AccountUser {
  id: string;
  identifier: string;
  active: boolean;
  employee: { name: string; employeeId?: string | null } | null;
}

export abstract class AccountLifecycleService<TDto> {
  protected constructor(
    protected readonly prisma: PrismaService,
    protected readonly loginDirectory: LoginDirectoryService,
    protected readonly authService: AuthService,
    protected readonly emailService: EmailService,
  ) {}

  /** Short, lowercase kind used to build audit-log action names, e.g. 'doctor.locked' / 'staff.locked'. */
  protected abstract readonly accountKind: string;

  /**
   * The Prisma `select` shape used to refetch a full DTO-ready row after a
   * mutation. Deliberately typed as a plain `Prisma.UserSelect` rather than
   * threaded through a generic: Prisma's own payload-inference machinery
   * can't be abstracted over a generic `select` shape without far more
   * machinery than this is worth, so `toDto()` below takes `unknown` and
   * each subclass narrows it back to its own concrete row type -- the one
   * deliberately-loose seam in an otherwise fully-typed class.
   */
  protected abstract readonly listSelect: Prisma.UserSelect;

  protected abstract toDto(user: unknown): TDto;

  /** Looks the account up by id, 404ing (with a kind-specific message) if it doesn't exist or isn't of this kind. Subclasses may (and do) declare a richer return type via covariant override -- this signature only promises what the shared methods below actually need. */
  protected abstract requireAccountUser(id: string): Promise<AccountUser>;

  /** The role name to record on the activation email / temp-password flow -- a fixed string for Doctor, `user.role.name` for Staff. */
  protected abstract roleNameFor(user: AccountUser): string;

  /**
   * The tenant `User` id safe to stamp on tenant rows that FK to `User`
   * (audit_logs.actor_user_id, email_logs.sent_by_user_id). A platform/central
   * admin acting inside a hospital has no such tenant row, so returns null for
   * them -- preventing the foreign-key violation that otherwise 500s every
   * account action (reset password, create staff, lock, ...) a platform admin
   * performs in a hospital.
   */
  protected actorTenantUserId(actor?: Actor): string | null {
    return actor && actor.type !== 'platform' ? actor.id : null;
  }

  protected async writeAuditLog(
    client: PrismaClientLike,
    action: string,
    actor: Actor | undefined,
    entityId: string,
    extra?: Record<string, unknown>,
  ) {
    await client.auditLog.create({
      data: {
        // A platform (central) admin's id is not a tenant User, so recording
        // it here would violate audit_logs.actor_user_id's FK. Keep the who in
        // actorRole ('SuperAdmin') and leave the id null for platform actors.
        actorUserId: actor && actor.type !== 'platform' ? actor.id : null,
        actorRole: actor?.roleName ?? 'System',
        action,
        entityType: 'User',
        entityId,
        ...extra,
      },
    });
  }

  /**
   * Always sends the activation link. If the hospital has opted into
   * `sendTemporaryPasswordByEmail`, also emails the temp password directly,
   * separately. Called after the triggering transaction has already
   * committed -- an email failure must never roll back or fail the account
   * action that triggered it (AuthService/EmailService already swallow their
   * own errors; this stays fire-and-forget on top of that).
   */
  protected async sendCredentialEmails(params: {
    identifier: string;
    staffName: string;
    staffId: string | null;
    role: string;
    hospitalId: string;
    actorUserId?: string;
    temporaryPassword?: string;
  }): Promise<void> {
    await this.authService
      .sendActivationEmail({
        identifier: params.identifier,
        staffName: params.staffName,
        staffId: params.staffId,
        role: params.role,
        hospitalId: params.hospitalId,
        actorUserId: params.actorUserId,
      })
      .catch(() => undefined);

    if (!params.temporaryPassword) return;

    const settings = await this.prisma.hospitalSettings.findUnique({ where: { id: 'singleton' } }).catch(() => null);
    if (!settings?.sendTemporaryPasswordByEmail) return;

    const { html, text } = tempPasswordEmailBody({
      staffName: params.staffName,
      loginEmail: params.identifier,
      temporaryPassword: params.temporaryPassword,
    });
    await this.emailService
      .sendMail({
        to: params.identifier,
        subject: TEMP_PASSWORD_EMAIL_SUBJECT,
        html,
        text,
        kind: 'TEMP_PASSWORD',
        sentByUserId: params.actorUserId,
      })
      .catch(() => undefined);
  }

  /** Deactivates (never hard-deletes -- heavily FK-referenced by historical records). */
  async setActive(id: string, active: boolean, actor?: Actor): Promise<TDto> {
    const user = await this.requireAccountUser(id);
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id },
        // Deactivating also kills any already-issued session immediately, not just future logins.
        data: active ? { active } : { active, tokenVersion: { increment: 1 } },
        select: this.listSelect,
      });
      await this.writeAuditLog(tx, active ? `${this.accountKind}.activated` : `${this.accountKind}.deactivated`, actor, id, {
        beforeSnapshot: { active: user.active },
        afterSnapshot: { active },
      });
      return u;
    });
    return this.toDto(updated);
  }

  /** Admin-triggered reset: a fresh one-time password, shown once, same as account creation. Never reveals the existing password (there is no way to -- only its hash is ever stored). */
  async resetPassword(id: string, actor?: Actor, reason?: string) {
    const user = await this.requireAccountUser(id);
    const temporaryPassword = generateSecurePassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          passwordHash,
          mustChangePassword: true,
          passwordChangedAt: null,
          tempPasswordExpiresAt: new Date(Date.now() + TEMP_PASSWORD_TTL_MS),
          tokenVersion: { increment: 1 },
        },
      });
      await this.writeAuditLog(tx, `${this.accountKind}.password_reset`, actor, id, { reason: reason ?? null });
    });

    const { hospitalId } = getTenantContext();
    await this.sendCredentialEmails({
      identifier: user.identifier,
      staffName: user.employee?.name ?? user.identifier,
      staffId: user.employee?.employeeId ?? null,
      role: this.roleNameFor(user),
      hospitalId,
      // Same FK reasoning as writeAuditLog: never stamp a platform admin's id
      // onto a tenant email_logs row.
      actorUserId: actor && actor.type !== 'platform' ? actor.id : undefined,
      temporaryPassword,
    });

    return { id, email: user.identifier, temporaryPassword };
  }

  /** Lock/unlock is independent of active/inactive -- a locked account still shows up as active, just can't authenticate. Unlock clears both the manual lock and any automatic failed-attempt lockout together. */
  async setLocked(id: string, locked: boolean, actor?: Actor, reason?: string): Promise<TDto> {
    const user = await this.requireAccountUser(id);
    if (locked) {
      await this.loginDirectory.lockManually(user.identifier);
      // Locking also kills any already-issued session immediately.
      await this.prisma.user.update({ where: { id }, data: { tokenVersion: { increment: 1 } } });
    } else {
      await this.loginDirectory.unlock(user.identifier);
    }
    await this.writeAuditLog(this.prisma, locked ? `${this.accountKind}.locked` : `${this.accountKind}.unlocked`, actor, id, {
      reason: reason ?? null,
    });
    return this.refetchDto(id);
  }

  /** Invalidates any outstanding unused activation token and sends a fresh one. Never resends or reveals an old password. */
  async resendActivation(id: string, actor?: Actor) {
    const user = await this.requireAccountUser(id);
    const { hospitalId } = getTenantContext();

    await this.authService.sendActivationEmail({
      identifier: user.identifier,
      staffName: user.employee?.name ?? user.identifier,
      staffId: user.employee?.employeeId ?? null,
      role: this.roleNameFor(user),
      hospitalId,
      actorUserId: actor?.id,
    });

    await this.writeAuditLog(this.prisma, `${this.accountKind}.activation_resent`, actor, id);

    return { status: 'success', message: 'Activation email resent.' };
  }

  protected async refetchDto(id: string): Promise<TDto> {
    const updated = await this.prisma.user.findUniqueOrThrow({ where: { id }, select: this.listSelect });
    return this.toDto(updated);
  }
}
