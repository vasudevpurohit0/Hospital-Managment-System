import { Injectable, NotFoundException, BadRequestException, ConflictException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { OpdTokenGeneratorService } from './opd-token-generator.service';
import { DepartmentService } from './department.service';
import { CreateOpdVisitDto } from '../dto/create-opd-visit.dto';
import { ChargeService } from '../../billing/charge.service';
import { BenefitRuleService } from '../../benefit/benefit-rule.service';
import { DocumentSequenceService } from '../../../common/sequence/document-sequence.service';
import { toAuditActorUserId } from '../../../common/audit/audit-actor.util';

/** The consultation service auto-charged on every OPD visit, once priced. */
const OPD_CONSULTATION_SERVICE_CODE = 'CONSULT-GEN';

/** Still-active states; a shared/department queue and a doctor's own queue both mean "not yet resolved one way or another." */
const ACTIVE_STATUSES = ['WAITING', 'CALLED', 'IN_CONSULTATION'] as const;

export interface QueueActor {
  id: string;
  roleName: string;
  type?: 'hospital' | 'platform';
}

@Injectable()
export class OpdService {
  private readonly logger = new Logger(OpdService.name);

  constructor(
    private prisma: PrismaService,
    private tokenGenerator: OpdTokenGeneratorService,
    private departmentService: DepartmentService,
    private chargeService: ChargeService,
    private benefitRuleService: BenefitRuleService,
    private sequences: DocumentSequenceService,
  ) {}

  /** A Doctor caller may only ever act on their own visit; every other role is unrestricted (existing permission grants already gate who can reach these endpoints at all). */
  private assertOwnership(visit: { doctorId: string | null }, actor?: QueueActor) {
    if (actor?.roleName === 'Doctor' && visit.doctorId !== actor.id) {
      // Same as every other doctor-scoping check in this codebase (Admission,
      // PatientService): a 404, not a 403 -- doesn't confirm to a doctor that
      // another doctor's visit even exists.
      throw new NotFoundException('OPD visit not found.');
    }
  }

  private async assertDoctorEligibleForDepartment(
    doctorId: string,
    departmentId: string,
    opts: { requireAvailable?: boolean } = {},
  ): Promise<void> {
    const doctor = await this.prisma.user.findUnique({
      where: { id: doctorId },
      include: { role: true, doctorProfile: { include: { departments: true } } },
    });
    if (!doctor || !doctor.active || doctor.role.name !== 'Doctor' || !doctor.doctorProfile) {
      throw new BadRequestException('Selected doctor is not an active doctor with a profile.');
    }
    const eligible =
      doctor.doctorProfile.departmentId === departmentId ||
      doctor.doctorProfile.departments.some((d) => d.departmentId === departmentId);
    if (!eligible) {
      throw new BadRequestException('Selected doctor does not belong to this department.');
    }
    // Only enforced for a transfer target (see transfer() below), not for
    // registration -- a patient can still be pre-queued at registration for a
    // doctor who hasn't checked in for the day yet.
    if (opts.requireAvailable && doctor.doctorProfile.dutyStatus !== 'AVAILABLE') {
      throw new BadRequestException(
        'Selected doctor is not currently available to receive patients (must be checked in and not on a break).',
      );
    }
  }

  /**
   * Create an OPD Visit record and issue an atomic daily queue token. The
   * doctor is assigned now (not just at call-time) -- required, and
   * validated against the same eligibility rule the registration picker
   * itself uses (active, Doctor role, has a profile, belongs to this
   * department), so a client can't smuggle in an ineligible doctor id.
   */
  async createOpdVisit(dto: CreateOpdVisitDto) {
    // Without this, an invalid/unresolved visitId fell through to
    // tx.oPDVisit.create() and hit a raw Postgres foreign-key violation
    // instead of a clean 404 -- matching the existence check already done
    // for prescriptions and lab orders elsewhere in this codebase.
    const visit = await this.prisma.visit.findUnique({ where: { id: dto.visitId } });
    if (!visit) {
      throw new NotFoundException(`Visit not found for ID: ${dto.visitId}`);
    }

    const dept = await this.departmentService.findById(dto.departmentId);
    if (!dept) {
      throw new NotFoundException(`Department not found for ID: ${dto.departmentId}`);
    }

    await this.assertDoctorEligibleForDepartment(dto.doctorId, dept.id);

    // Token, visit and (if priced) the consultation charge are written
    // together: if any step fails, the token is rolled back instead of
    // leaving a hole in the day's sequence, and no charge can exist for an
    // OPDVisit that doesn't.
    const { opdVisit, tokenNumber } = await this.prisma.$transaction(async (tx) => {
      const issuedToken = await this.tokenGenerator.generateDailyToken(dept.code, tx);

      // Permanent OPD number, distinct from the daily queue token — Feature
      // 11 searches by both as separate identifiers.
      const opdNumber = await this.sequences.next('OPD_NUMBER', tx);

      const now = new Date();
      const queuePosition = (await tx.oPDVisit.count({ where: { doctorId: dto.doctorId, status: 'WAITING' } })) + 1;

      const created = await tx.oPDVisit.create({
        data: {
          visitId: dto.visitId,
          departmentId: dept.id,
          doctorId: dto.doctorId,
          tokenNumber: issuedToken,
          opdNumber,
          status: 'WAITING',
          assignedAt: now,
          checkedInAt: now,
          queuePosition,
        },
        include: {
          department: true,
          doctor: { select: { id: true, identifier: true, active: true, employee: { select: { name: true, department: true, consultationRoom: true } } } },
          visit: {
            include: {
              employee: { include: { employmentType: true } },
            },
          },
        },
      });

      // Best-effort: CONSULT-GEN is seeded with no rate (no ESIC consultation
      // fee is published in the reference material), so this quietly skips
      // rather than blocking OPD visit creation. The moment an administrator
      // prices it, new visits start charging automatically — no code change
      // needed. Uses the benefit evaluator's employment-type wildcard, the
      // same default that already governs medicine charges, rather than
      // inventing a second rule engine for non-medicine services.
      const consultationService = await tx.service.findUnique({
        where: { code: OPD_CONSULTATION_SERVICE_CODE },
      });
      if (consultationService) {
        const outcome = await this.benefitRuleService.evaluate(
          created.visit.employee.employmentType.code,
        );
        await this.chargeService.postServiceChargeIfPriced(
          { visitId: dto.visitId, serviceId: consultationService.id },
          outcome,
          tx,
        );
      }

      return { opdVisit: created, tokenNumber: issuedToken };
    });

    this.logger.log(`Created OPDVisit ${opdVisit.id} with token ${tokenNumber}, assigned to doctor ${dto.doctorId}`);
    return {
      status: 'CREATED',
      opdVisit,
      tokenNumber,
    };
  }

  /**
   * Fetch the active queue for a department (waiting/called/in-consultation),
   * optionally narrowed to one doctor -- the Reception/QueueManager
   * department view with a doctor filter.
   *
   * A Doctor caller is rejected outright, regardless of the Employee:read
   * grant that gates this route (a Doctor legitimately needs that permission
   * elsewhere, e.g. patient lookup) -- a doctor's queue view is exclusively
   * `getMyQueue` below. The frontend already hides/blocks this screen for
   * Doctor, but that alone doesn't stop a direct API call, which is what
   * this guards against.
   */
  async getQueue(departmentId: string, doctorId?: string, actor?: QueueActor) {
    if (actor?.roleName === 'Doctor') {
      throw new ForbiddenException('Doctors must use their own queue (GET /opd-visits/my-queue).');
    }
    const dept = await this.departmentService.findById(departmentId);
    const targetDeptId = dept?.id || departmentId;

    return this.prisma.oPDVisit.findMany({
      where: {
        departmentId: targetDeptId,
        status: { in: [...ACTIVE_STATUSES] },
        ...(doctorId ? { doctorId } : {}),
      },
      include: {
        department: true,
        doctor: { select: { id: true, identifier: true, active: true, employee: { select: { name: true, department: true, consultationRoom: true } } } },
        visit: {
          include: {
            employee: true,
          },
        },
      },
      orderBy: [{ priority: 'desc' }, { queuePosition: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * Active queue (waiting/called/in-consultation) across every department in
   * the hospital's schema, in one query -- backs the hospital-wide public
   * display. Ordered by department first so the caller can bucket rows by
   * `departmentId` with a single pass; within a department the ordering is
   * identical to `getQueue`'s (priority desc, queuePosition asc, createdAt
   * asc), so a department's own queue order is unchanged by going
   * hospital-wide.
   */
  async getHospitalQueue(actor?: QueueActor) {
    if (actor?.roleName === 'Doctor') {
      throw new ForbiddenException('Doctors must use their own queue (GET /opd-visits/my-queue).');
    }
    return this.prisma.oPDVisit.findMany({
      where: { status: { in: [...ACTIVE_STATUSES] } },
      include: {
        department: true,
        doctor: { select: { id: true, identifier: true, active: true, employee: { select: { name: true, department: true, consultationRoom: true } } } },
        visit: { include: { employee: true } },
      },
      orderBy: [{ departmentId: 'asc' }, { priority: 'desc' }, { queuePosition: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** A doctor's own active queue (waiting/called/in-consultation) -- doctorId is always the caller's own id from the JWT, never client-supplied. */
  async getMyQueue(doctorId: string) {
    return this.prisma.oPDVisit.findMany({
      where: { doctorId, status: { in: [...ACTIVE_STATUSES] } },
      include: { department: true, visit: { include: { employee: true } } },
      orderBy: [{ priority: 'desc' }, { queuePosition: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * Safely claims the first eligible WAITING patient assigned to this
   * doctor. Guarded by a status-conditioned `updateMany` inside a
   * transaction: Postgres serializes concurrent UPDATEs against the same
   * row, so if two "call next" requests race for the same candidate, the
   * loser's WHERE clause re-evaluates against the now-CALLED row once it
   * gets the lock and matches zero rows -- exactly one caller ever wins.
   * Refuses to run while the doctor already has a CALLED/IN_CONSULTATION
   * visit open, rather than silently auto-closing it as the old single-id
   * `callToken` used to -- the doctor must explicitly finish/skip/no-show
   * their current patient first.
   */
  async callNext(doctorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.doctorProfile.findUnique({ where: { userId: doctorId }, select: { dutyStatus: true } });
      if (profile?.dutyStatus === 'ON_BREAK') {
        throw new BadRequestException('You are on a break. End your break before calling the next patient.');
      }
      if (profile?.dutyStatus === 'OFF_DUTY') {
        throw new BadRequestException('You are checked out. Check in before calling the next patient.');
      }

      const inProgress = await tx.oPDVisit.findFirst({
        where: { doctorId, status: { in: ['CALLED', 'IN_CONSULTATION'] } },
      });
      if (inProgress) {
        throw new BadRequestException(
          'Finish, skip, or mark no-show for your current patient before calling the next one.',
        );
      }

      const candidate = await tx.oPDVisit.findFirst({
        where: { doctorId, status: 'WAITING' },
        orderBy: [{ priority: 'desc' }, { queuePosition: 'asc' }, { createdAt: 'asc' }],
      });
      if (!candidate) {
        throw new NotFoundException('No waiting patients in your queue.');
      }

      const claim = await tx.oPDVisit.updateMany({
        where: { id: candidate.id, status: 'WAITING' },
        data: { status: 'CALLED', calledAt: new Date() },
      });
      if (claim.count === 0) {
        throw new ConflictException('This patient was just claimed by another action. Try again.');
      }

      return tx.oPDVisit.findUniqueOrThrow({
        where: { id: candidate.id },
        include: { department: true, doctor: { select: { id: true, identifier: true, active: true, employee: { select: { name: true, department: true, consultationRoom: true } } } }, visit: { include: { employee: true } } },
      });
    });
  }

  /**
   * Mark a specific token called (Reception/QueueManager/Admin manual
   * override, or a doctor re-calling a patient who stepped away). A Doctor
   * caller may only call their own already-assigned visit -- ownership is
   * checked, never overwritten, since the doctor is now assigned at
   * registration rather than by whoever happens to call the token.
   */
  async callToken(id: string, actor?: QueueActor) {
    const targetVisit = await this.prisma.oPDVisit.findUnique({ where: { id } });
    if (!targetVisit) {
      throw new NotFoundException(`OPDVisit not found for ID: ${id}`);
    }
    this.assertOwnership(targetVisit, actor);
    if (targetVisit.status !== 'WAITING') {
      throw new BadRequestException(`Cannot call a visit in status ${targetVisit.status}.`);
    }

    const calledAt = new Date();
    await this.prisma.oPDVisit.updateMany({
      where: {
        departmentId: targetVisit.departmentId,
        doctorId: targetVisit.doctorId,
        status: { in: ['CALLED', 'IN_CONSULTATION'] },
        id: { not: id },
      },
      data: { status: 'COMPLETED', closedAt: calledAt, completedAt: calledAt },
    });

    return this.prisma.oPDVisit.update({
      where: { id },
      data: { status: 'CALLED', calledAt },
      include: { department: true, doctor: { select: { id: true, identifier: true, active: true, employee: { select: { name: true, department: true, consultationRoom: true } } } }, visit: { include: { employee: true } } },
    });
  }

  /** CALLED → IN_CONSULTATION. */
  async startConsultation(id: string, actor?: QueueActor) {
    const visit = await this.prisma.oPDVisit.findUnique({ where: { id } });
    if (!visit) throw new NotFoundException(`OPDVisit not found for ID: ${id}`);
    this.assertOwnership(visit, actor);
    if (visit.status !== 'CALLED') {
      throw new BadRequestException(`Cannot start a consultation from status ${visit.status}.`);
    }
    return this.prisma.oPDVisit.update({
      where: { id },
      data: { status: 'IN_CONSULTATION', consultationStartedAt: new Date() },
      include: { department: true, doctor: { select: { id: true, identifier: true, active: true, employee: { select: { name: true, department: true, consultationRoom: true } } } }, visit: { include: { employee: true } } },
    });
  }

  /**
   * IN_CONSULTATION → COMPLETED, closing the underlying Visit exactly the
   * same way the older `closeOpdVisit` does (kept below, unmodified, for
   * any existing caller) -- this is the richer version that also updates
   * the new queue-state fields.
   */
  async completeConsultation(id: string, actor?: QueueActor) {
    const visit = await this.prisma.oPDVisit.findUnique({ where: { id } });
    if (!visit) throw new NotFoundException(`OPDVisit not found for ID: ${id}`);
    this.assertOwnership(visit, actor);
    if (visit.status !== 'IN_CONSULTATION' && visit.status !== 'CALLED') {
      throw new BadRequestException(`Cannot complete a visit from status ${visit.status}.`);
    }
    const completedAt = new Date();
    const updated = await this.prisma.oPDVisit.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        completedAt,
        closedAt: completedAt,
        visit: { update: { status: 'CLOSED', closedAt: completedAt } },
      },
      include: { department: true, doctor: { select: { id: true, identifier: true, active: true, employee: { select: { name: true, department: true, consultationRoom: true } } } }, visit: true },
    });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: toAuditActorUserId(actor),
        actorRole: actor?.roleName ?? 'System',
        action: 'opdvisit.completed',
        entityType: 'OPDVisit',
        entityId: id,
      },
    });
    return updated;
  }

  async markNoShow(id: string, actor?: QueueActor, reason?: string) {
    return this.terminalTransition(id, 'NO_SHOW', 'opdvisit.no_show', actor, reason);
  }

  async skip(id: string, actor?: QueueActor, reason?: string) {
    return this.terminalTransition(id, 'SKIPPED', 'opdvisit.skipped', actor, reason);
  }

  async cancel(id: string, actor?: QueueActor, reason?: string) {
    return this.terminalTransition(id, 'CANCELLED', 'opdvisit.cancelled', actor, reason);
  }

  private async terminalTransition(
    id: string,
    status: 'NO_SHOW' | 'SKIPPED' | 'CANCELLED',
    action: string,
    actor?: QueueActor,
    reason?: string,
  ) {
    const visit = await this.prisma.oPDVisit.findUnique({ where: { id } });
    if (!visit) throw new NotFoundException(`OPDVisit not found for ID: ${id}`);
    this.assertOwnership(visit, actor);
    if (!(ACTIVE_STATUSES as readonly string[]).includes(visit.status)) {
      throw new BadRequestException(`Cannot transition a visit from status ${visit.status}.`);
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.oPDVisit.update({
        where: { id },
        data: { status, skipReason: reason ?? null },
        include: { department: true, doctor: { select: { id: true, identifier: true, active: true, employee: { select: { name: true, department: true, consultationRoom: true } } } }, visit: { include: { employee: true } } },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: toAuditActorUserId(actor),
          actorRole: actor?.roleName ?? 'System',
          action,
          entityType: 'OPDVisit',
          entityId: id,
          beforeSnapshot: { status: visit.status },
          afterSnapshot: { status },
          reason: reason ?? null,
        },
      });
      return updated;
    });
  }

  /**
   * Reassigns a waiting/called visit to a different eligible doctor.
   * `TRANSFERRED` exists as a real audit-log action name, but the visit
   * itself resolves straight back to WAITING under the new doctor --
   * resting in a dead terminal state would make it invisible to every
   * queue, which defeats the point of a transfer.
   */
  async transfer(id: string, newDoctorId: string, actor?: QueueActor, reason?: string) {
    if (!reason || !reason.trim()) {
      throw new BadRequestException('A reason is required to reassign a patient.');
    }
    const visit = await this.prisma.oPDVisit.findUnique({ where: { id } });
    if (!visit) throw new NotFoundException(`OPDVisit not found for ID: ${id}`);
    this.assertOwnership(visit, actor);
    if (!(ACTIVE_STATUSES as readonly string[]).includes(visit.status)) {
      throw new BadRequestException(`Cannot transfer a visit from status ${visit.status}.`);
    }
    if (newDoctorId === visit.doctorId) {
      throw new BadRequestException('Cannot transfer a patient to the same doctor.');
    }
    await this.assertDoctorEligibleForDepartment(newDoctorId, visit.departmentId, { requireAvailable: true });

    return this.prisma.$transaction(async (tx) => {
      const queuePosition = (await tx.oPDVisit.count({ where: { doctorId: newDoctorId, status: 'WAITING' } })) + 1;
      const updated = await tx.oPDVisit.update({
        where: { id },
        data: {
          doctorId: newDoctorId,
          status: 'WAITING',
          queuePosition,
          transferReason: reason ?? null,
          calledAt: null,
          consultationStartedAt: null,
        },
        include: { department: true, doctor: { select: { id: true, identifier: true, active: true, employee: { select: { name: true, department: true, consultationRoom: true } } } }, visit: { include: { employee: true } } },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: toAuditActorUserId(actor),
          actorRole: actor?.roleName ?? 'System',
          action: 'opdvisit.transferred',
          entityType: 'OPDVisit',
          entityId: id,
          beforeSnapshot: { doctorId: visit.doctorId },
          afterSnapshot: { doctorId: newDoctorId },
          reason: reason ?? null,
        },
      });
      return updated;
    });
  }

  /** A doctor's own called/seen OPD patients (any status, historical) -- kept exactly as Phase 10 built it. `getMyQueue` above is the new "still active" view. */
  async getMyPatients(doctorId: string) {
    return this.prisma.oPDVisit.findMany({
      where: { doctorId },
      include: { department: true, visit: { include: { employee: true } } },
      orderBy: { calledAt: 'desc' },
    });
  }

  /**
   * Mark visit closed. Kept exactly as-is for any existing caller;
   * `completeConsultation` above is the new richer status-tracking version.
   */
  async closeOpdVisit(id: string) {
    const closedAt = new Date();

    const existing = await this.prisma.oPDVisit.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`OPDVisit not found for ID: ${id}`);
    }

    return this.prisma.oPDVisit.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        completedAt: closedAt,
        closedAt,
        visit: {
          update: {
            status: 'CLOSED',
            closedAt,
          },
        },
      },
      include: { department: true, visit: true },
    });
  }
}
