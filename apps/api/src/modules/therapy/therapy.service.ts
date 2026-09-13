import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ServiceType, TherapyCourseStatus, TherapySessionStatus, TherapySource } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ChargeService } from '../billing/charge.service';
import { BenefitRuleService } from '../benefit/benefit-rule.service';
import { OpenCourseDto, ScheduleSessionDto } from './dto/therapy.dto';

/**
 * Two billing shapes, because the CGHS annexures have two (Feature 7):
 *
 *  - A per-sitting therapy (Abhyanga, ₹1,145) bills ONCE PER PERFORMED
 *    SESSION — `performSession` posts the charge.
 *  - A course package ("...for full course of treatment", ₹10,000) bills
 *    ONCE, when the course opens — `openCourse` posts the charge; its
 *    sessions never bill individually, or a 7-session course would post
 *    ₹70,000 instead of ₹10,000.
 *
 * Three valid entry points (extension for the Registration Desk / OPD / IPD
 * therapy workflow):
 *
 *  - DIRECT — a patient came specifically for therapy. Registration opens a
 *    bare Visit (visitPurpose: 'THERAPY' on PatientService.createVisit, so
 *    no OPD token/queue entry and no consultation charge are created), then
 *    books straight against it.
 *  - OPD — opened against a visit that does have an OPDVisit (a real
 *    consultation happened); the doctor who calls this endpoint is recorded
 *    as `createdBy`, which is how "the doctor who recommended the therapy"
 *    stays retrievable without a redundant column.
 *  - IPD — opened with an admissionId; validated to belong to the same
 *    visit so a mismatched admission can never attach to the wrong patient.
 *
 * `source` is always derived here from the visit/admission shape, never
 * taken as a caller-supplied value — the one thing a client could get wrong
 * (by accident or otherwise) and the one thing every reporting/timeline
 * surface depends on being right.
 */
@Injectable()
export class TherapyService {
  private readonly logger = new Logger(TherapyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly charges: ChargeService,
    private readonly benefitRules: BenefitRuleService,
  ) {}

  private async resolveOutcome(visitId: string) {
    const visit = await this.prisma.visit.findUnique({
      where: { id: visitId },
      include: { employee: { include: { employmentType: true } } },
    });
    if (!visit) throw new NotFoundException(`Visit not found: ${visitId}`);
    return this.benefitRules.evaluate(visit.employee.employmentType.code);
  }

  /**
   * Loads the visit (with its OPDVisit presence) and, if an admissionId was
   * supplied, validates it belongs to that same visit — then derives the
   * one true source. Throws rather than silently mislinking a patient's
   * therapy to the wrong admission.
   */
  private async resolveVisitAndSource(visitId: string, admissionId?: string) {
    const visit = await this.prisma.visit.findUnique({
      where: { id: visitId },
      include: { opdVisit: { select: { id: true } } },
    });
    if (!visit) throw new NotFoundException(`Visit not found: ${visitId}`);

    if (admissionId) {
      const admission = await this.prisma.admission.findUnique({ where: { id: admissionId } });
      if (!admission) throw new NotFoundException(`Admission not found: ${admissionId}`);
      if (admission.visitId !== visitId) {
        throw new BadRequestException(
          `Admission ${admissionId} does not belong to visit ${visitId} — refusing to link therapy to a mismatched patient.`,
        );
      }
      return { visit, source: TherapySource.IPD };
    }

    return { visit, source: visit.opdVisit ? TherapySource.OPD : TherapySource.DIRECT };
  }

  /** Opens a course package, billing its one charge immediately. */
  async openCourse(dto: OpenCourseDto, actorUserId?: string) {
    const service = await this.prisma.service.findUnique({ where: { id: dto.serviceId } });
    if (!service) throw new NotFoundException(`Service not found: ${dto.serviceId}`);
    if (service.serviceType !== ServiceType.PACKAGE) {
      throw new BadRequestException(
        `"${service.name}" is a ${service.serviceType}, not a course package. Use scheduleSession instead.`,
      );
    }

    const { source } = await this.resolveVisitAndSource(dto.visitId, dto.admissionId);
    const outcome = await this.resolveOutcome(dto.visitId);

    return this.prisma.$transaction(async (tx) => {
      const charge = await this.charges.postServiceCharge(
        {
          visitId: dto.visitId,
          admissionId: dto.admissionId,
          serviceId: dto.serviceId,
          actorUserId,
        },
        outcome,
        tx,
      );

      const course = await tx.therapyCourse.create({
        data: {
          visitId: dto.visitId,
          admissionId: dto.admissionId ?? null,
          serviceId: dto.serviceId,
          chargeItemId: charge.id,
          plannedSessions: dto.plannedSessions,
          status: TherapyCourseStatus.IN_PROGRESS,
          source,
          createdById: actorUserId ?? null,
        },
      });

      // Pre-schedule the planned sessions for the console's session list —
      // clinical tracking only; none of these bill on their own.
      await tx.therapySession.createMany({
        data: Array.from({ length: dto.plannedSessions }, (_, i) => ({
          visitId: dto.visitId,
          admissionId: dto.admissionId ?? null,
          serviceId: dto.serviceId,
          courseId: course.id,
          sessionNumber: i + 1,
          status: TherapySessionStatus.SCHEDULED,
          source,
          createdById: actorUserId ?? null,
        })),
      });

      this.logger.log(
        `Opened course ${course.id} (${service.name}, ${dto.plannedSessions} sessions, source ${source}) — ` +
          `charged ₹${charge.netAmount} once`,
      );

      return tx.therapyCourse.findUniqueOrThrow({
        where: { id: course.id },
        include: { sessions: true, service: true },
      });
    });
  }

  /** Schedules a standalone (non-course) therapy or procedure session. */
  async scheduleSession(dto: ScheduleSessionDto, actorUserId?: string) {
    const service = await this.prisma.service.findUnique({ where: { id: dto.serviceId } });
    if (!service) throw new NotFoundException(`Service not found: ${dto.serviceId}`);
    if (service.serviceType === ServiceType.PACKAGE) {
      throw new BadRequestException(`"${service.name}" is a course package. Use openCourse instead.`);
    }

    const { source } = await this.resolveVisitAndSource(dto.visitId, dto.admissionId);

    return this.prisma.therapySession.create({
      data: {
        visitId: dto.visitId,
        admissionId: dto.admissionId ?? null,
        serviceId: dto.serviceId,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : new Date(),
        notes: dto.notes ?? null,
        status: TherapySessionStatus.SCHEDULED,
        source,
        createdById: actorUserId ?? null,
      },
      include: { service: true },
    });
  }

  /**
   * Marks a session performed. Bills a fresh charge only when the session is
   * standalone (courseId null) — a session belonging to a course never
   * bills, since the course already paid for all of it up front.
   *
   * The SCHEDULED check runs twice: once here (a fast pre-check that gives a
   * clean error to a normal double-click) and again inside the transaction
   * against a row read through that same transaction, immediately before
   * writing — closing the window a genuinely concurrent second request could
   * otherwise race through between the pre-check and the write, which would
   * otherwise double-bill the same session.
   */
  async performSession(sessionId: string, notes: string | undefined, actorUserId?: string) {
    const precheck = await this.prisma.therapySession.findUnique({
      where: { id: sessionId },
      include: { service: true },
    });
    if (!precheck) throw new NotFoundException(`Therapy session not found: ${sessionId}`);
    if (precheck.status !== TherapySessionStatus.SCHEDULED) {
      throw new BadRequestException(`Session is ${precheck.status}, not SCHEDULED.`);
    }

    const outcome = await this.resolveOutcome(precheck.visitId);

    return this.prisma.$transaction(async (tx) => {
      const session = await tx.therapySession.findUnique({ where: { id: sessionId }, include: { service: true } });
      if (!session) throw new NotFoundException(`Therapy session not found: ${sessionId}`);
      if (session.status !== TherapySessionStatus.SCHEDULED) {
        throw new BadRequestException(`Session is ${session.status}, not SCHEDULED.`);
      }

      if (!session.courseId) {
        await this.charges.postServiceCharge(
          {
            visitId: session.visitId,
            admissionId: session.admissionId ?? undefined,
            serviceId: session.serviceId,
            therapySessionId: session.id,
            actorUserId,
          },
          outcome,
          tx,
        );
      }

      const updated = await tx.therapySession.update({
        where: { id: sessionId },
        data: {
          status: TherapySessionStatus.PERFORMED,
          performedAt: new Date(),
          performedById: actorUserId ?? null,
          notes: notes ?? session.notes,
        },
        include: { service: true, chargeItems: true },
      });

      // A course completes once every one of its sessions has been performed.
      if (session.courseId) {
        const siblings = await tx.therapySession.findMany({ where: { courseId: session.courseId } });
        if (siblings.every((s) => s.id === sessionId || s.status === TherapySessionStatus.PERFORMED)) {
          await tx.therapyCourse.update({
            where: { id: session.courseId },
            data: { status: TherapyCourseStatus.COMPLETED, completedAt: new Date() },
          });
        }
      }

      this.logger.log(
        `Performed session ${sessionId} (${session.service.name})` +
          (session.courseId ? ' — part of a course, no new charge' : ''),
      );

      return updated;
    });
  }

  /** Cancels a session before it happens — no charge was ever posted, so there is nothing to reverse. */
  async cancelSession(sessionId: string) {
    return this.setTerminalStatus(sessionId, TherapySessionStatus.CANCELLED, 'cancel');
  }

  /**
   * Marks a session a no-show — clinically distinct from an advance
   * cancellation (the slot was held, the patient didn't come), but
   * billing-identical: no charge exists to reverse either way.
   */
  async markNoShow(sessionId: string) {
    return this.setTerminalStatus(sessionId, TherapySessionStatus.NO_SHOW, 'mark as no-show');
  }

  private async setTerminalStatus(
    sessionId: string,
    status: typeof TherapySessionStatus.CANCELLED | typeof TherapySessionStatus.NO_SHOW,
    verb: string,
  ) {
    const session = await this.prisma.therapySession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException(`Therapy session not found: ${sessionId}`);
    if (session.status !== TherapySessionStatus.SCHEDULED) {
      throw new BadRequestException(`Only a scheduled session can be ${verb === 'cancel' ? 'cancelled' : verb + 'ed'}.`);
    }
    return this.prisma.therapySession.update({
      where: { id: sessionId },
      data: { status },
    });
  }

  /**
   * The schedule/session list for the therapy console. Scoped to one visit
   * when given; otherwise the full cross-patient console view, optionally
   * narrowed to one calendar day (the console's "today" default) and/or one
   * entry-point source.
   */
  async listSessions(params: { visitId?: string; date?: string; source?: TherapySource } = {}) {
    const dateFilter = params.date
      ? (() => {
          const start = new Date(params.date + 'T00:00:00');
          const end = new Date(start);
          end.setDate(end.getDate() + 1);
          return { gte: start, lt: end };
        })()
      : undefined;

    return this.prisma.therapySession.findMany({
      where: {
        ...(params.visitId ? { visitId: params.visitId } : {}),
        ...(params.source ? { source: params.source } : {}),
        ...(dateFilter ? { scheduledAt: dateFilter } : {}),
      },
      include: {
        service: { select: { code: true, name: true, serviceType: true } },
        course: { select: { id: true, plannedSessions: true, status: true } },
        chargeItems: { select: { id: true, netAmount: true, status: true } },
        visit: { include: { employee: { include: { hospitalUid: true } } } },
        createdBy: { select: { identifier: true } },
        performedBy: { select: { identifier: true } },
      },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  async listCourses(params: { visitId?: string; source?: TherapySource } = {}) {
    return this.prisma.therapyCourse.findMany({
      where: {
        ...(params.visitId ? { visitId: params.visitId } : {}),
        ...(params.source ? { source: params.source } : {}),
      },
      include: {
        service: { select: { code: true, name: true } },
        sessions: { orderBy: { sessionNumber: 'asc' } },
        visit: { include: { employee: { include: { hospitalUid: true } } } },
        createdBy: { select: { identifier: true } },
      },
      orderBy: { startedAt: 'desc' },
    });
  }
}
