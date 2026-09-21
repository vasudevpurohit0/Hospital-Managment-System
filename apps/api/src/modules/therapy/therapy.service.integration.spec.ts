import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TherapySource } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PricingService } from '../catalog/pricing.service';
import { ChargeService } from '../billing/charge.service';
import { BenefitRuleService } from '../benefit/benefit-rule.service';
import { TherapyService } from './therapy.service';

const describeWithDb = process.env.DATABASE_URL ? describe : describe.skip;

describeWithDb('TherapyService (integration)', () => {
  let prisma: PrismaService;
  let therapy: TherapyService;

  const createdVisitIds: string[] = [];
  const createdEmployeeIds: string[] = [];
  const createdCourseIds: string[] = [];
  const createdSessionIds: string[] = [];

  const uniqueSuffix = () => Date.now().toString().slice(-6) + Math.floor(Math.random() * 1000);

  const createdOpdVisitIds: string[] = [];
  const createdAdmissionIds: string[] = [];

  async function makeVisit() {
    // CONTRACTUAL → PAID, so charge amounts below assert the actual rate
    // resolved rather than a COVERED zero — the benefit-outcome zeroing
    // itself is already covered by charge.service.integration.spec.ts.
    const contractualType = await prisma.employmentType.findFirstOrThrow({ where: { code: 'CONTRACTUAL' } });
    const post = await prisma.post.findFirstOrThrow();
    const grade = await prisma.grade.findFirstOrThrow();
    const employee = await prisma.employee.create({
      data: {
        employeeId: `ZZ-THR-${uniqueSuffix()}`,
        name: 'Therapy Test Patient',
        department: 'Test',
        postId: post.id,
        gradeId: grade.id,
        employmentTypeId: contractualType.id,
      },
    });
    createdEmployeeIds.push(employee.id);
    const visit = await prisma.visit.create({ data: { employeeId: employee.id, type: 'OPD', status: 'OPEN' } });
    createdVisitIds.push(visit.id);
    return visit.id;
  }

  /** A visit with a real OPDVisit attached — the shape entry point 2 (OPD → Therapy) actually has. */
  async function makeOpdConsultationVisit() {
    const visitId = await makeVisit();
    const dept = await prisma.department.findFirstOrThrow();
    const opdVisit = await prisma.oPDVisit.create({
      data: { visitId, departmentId: dept.id, tokenNumber: `ZZTHR-${uniqueSuffix()}` },
    });
    createdOpdVisitIds.push(opdVisit.id);
    return visitId;
  }

  /** A visit with a real Admission attached — the shape entry point 3 (IPD → Therapy) actually has. */
  async function makeIpdAdmission() {
    const visitId = await makeVisit();
    const admission = await prisma.admission.create({ data: { visitId, status: 'UNDER_TREATMENT' } });
    createdAdmissionIds.push(admission.id);
    return { visitId, admissionId: admission.id };
  }

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const pricing = new PricingService(prisma);
    const charges = new ChargeService(prisma, pricing);
    const benefitRules = new BenefitRuleService(prisma);
    therapy = new TherapyService(prisma, charges, benefitRules);
  });

  afterAll(async () => {
    await prisma.chargeItem.deleteMany({ where: { visitId: { in: createdVisitIds } } });
    await prisma.therapySession.deleteMany({ where: { id: { in: createdSessionIds } } });
    await prisma.therapySession.deleteMany({ where: { visitId: { in: createdVisitIds } } });
    await prisma.therapyCourse.deleteMany({ where: { id: { in: createdCourseIds } } });
    await prisma.therapyCourse.deleteMany({ where: { visitId: { in: createdVisitIds } } });
    await prisma.admission.deleteMany({ where: { id: { in: createdAdmissionIds } } });
    await prisma.oPDVisit.deleteMany({ where: { id: { in: createdOpdVisitIds } } });
    await prisma.visit.deleteMany({ where: { id: { in: createdVisitIds } } });
    await prisma.employee.deleteMany({ where: { id: { in: createdEmployeeIds } } });
    await prisma.$disconnect();
  });

  describe('per-sitting therapy — Feature 7', () => {
    it('bills once per performed session, not once per scheduling', async () => {
      const visitId = await makeVisit();
      const abhyanga = await prisma.service.findUniqueOrThrow({ where: { code: 'AYU-001' } });

      const session = await therapy.scheduleSession({ visitId, serviceId: abhyanga.id });
      createdSessionIds.push(session.id);

      let charges = await prisma.chargeItem.count({ where: { therapySessionId: session.id } });
      expect(charges).toBe(0); // scheduling alone never bills

      await therapy.performSession(session.id, undefined);
      charges = await prisma.chargeItem.count({ where: { therapySessionId: session.id } });
      expect(charges).toBe(1);

      const charge = await prisma.chargeItem.findFirstOrThrow({ where: { therapySessionId: session.id } });
      expect(Number(charge.netAmount)).toBe(1145);
      expect(charge.serviceId).toBe(abhyanga.id);
    });

    it('refuses to perform an already-performed session twice', async () => {
      const visitId = await makeVisit();
      const abhyanga = await prisma.service.findUniqueOrThrow({ where: { code: 'AYU-001' } });
      const session = await therapy.scheduleSession({ visitId, serviceId: abhyanga.id });
      createdSessionIds.push(session.id);

      await therapy.performSession(session.id, undefined);
      await expect(therapy.performSession(session.id, undefined)).rejects.toThrow(BadRequestException);

      const charges = await prisma.chargeItem.count({ where: { therapySessionId: session.id } });
      expect(charges).toBe(1);
    });

    it('refuses to schedule a course-package service as a standalone session', async () => {
      const visitId = await makeVisit();
      const coursePkg = await prisma.service.findUniqueOrThrow({ where: { code: 'AYU-039' } }); // Ksharasoothra course
      await expect(therapy.scheduleSession({ visitId, serviceId: coursePkg.id })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('course package — bills once on opening, not per session', () => {
    it('posts exactly one charge for the whole course, regardless of session count', async () => {
      const visitId = await makeVisit();
      const coursePkg = await prisma.service.findUniqueOrThrow({ where: { code: 'AYU-039' } }); // ₹10,000, Ksharasoothra

      const course = await therapy.openCourse({ visitId, serviceId: coursePkg.id, plannedSessions: 7 });
      createdCourseIds.push(course.id);

      const courseCharges = await prisma.chargeItem.count({
        where: { serviceId: coursePkg.id, visitId, therapySessionId: null },
      });
      expect(courseCharges).toBe(1);

      const charge = await prisma.chargeItem.findFirstOrThrow({
        where: { serviceId: coursePkg.id, visitId, therapySessionId: null },
      });
      expect(Number(charge.netAmount)).toBe(10000);
      expect(course.sessions).toHaveLength(7);

      // Perform all 7 sessions — none of them should add a single rupee.
      for (const session of course.sessions) {
        await therapy.performSession(session.id, undefined);
      }

      const totalCharged = await prisma.chargeItem.aggregate({
        where: { visitId, serviceId: coursePkg.id },
        _sum: { netAmount: true },
      });
      expect(Number(totalCharged._sum.netAmount)).toBe(10000);

      const finishedCourse = await prisma.therapyCourse.findUniqueOrThrow({ where: { id: course.id } });
      expect(finishedCourse.status).toBe('COMPLETED');
    });

    it('refuses to open a course for a non-package service', async () => {
      const visitId = await makeVisit();
      const abhyanga = await prisma.service.findUniqueOrThrow({ where: { code: 'AYU-001' } });
      await expect(
        therapy.openCourse({ visitId, serviceId: abhyanga.id, plannedSessions: 3 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('charge integrity', () => {
    it('a per-sitting charge carries both the service and the session, per the origin rules', async () => {
      const visitId = await makeVisit();
      const abhyanga = await prisma.service.findUniqueOrThrow({ where: { code: 'AYU-001' } });
      const session = await therapy.scheduleSession({ visitId, serviceId: abhyanga.id });
      createdSessionIds.push(session.id);
      await therapy.performSession(session.id, undefined);

      const charge = await prisma.chargeItem.findFirstOrThrow({ where: { therapySessionId: session.id } });
      expect(charge.serviceId).not.toBeNull();
      expect(charge.servicePriceId).not.toBeNull();
      expect(charge.prescriptionItemId).toBeNull();
      expect(charge.labOrderItemId).toBeNull();
    });
  });

  describe('three valid entry points — source is always derived, never trusted from the caller', () => {
    it('DIRECT: a bare visit with no OPDVisit and no admission derives as Direct Therapy', async () => {
      const visitId = await makeVisit(); // no OPDVisit, no admission
      const abhyanga = await prisma.service.findUniqueOrThrow({ where: { code: 'AYU-001' } });
      const session = await therapy.scheduleSession({ visitId, serviceId: abhyanga.id });
      createdSessionIds.push(session.id);

      const stored = await prisma.therapySession.findUniqueOrThrow({ where: { id: session.id } });
      expect(stored.source).toBe('DIRECT');
      expect(stored.admissionId).toBeNull();
    });

    it('OPD: a visit with a real OPDVisit derives as OPD, and records the recommending doctor as createdBy', async () => {
      const visitId = await makeOpdConsultationVisit();
      const doctorUser = await prisma.user.findFirstOrThrow({ where: { role: { name: 'Doctor' } } });
      const abhyanga = await prisma.service.findUniqueOrThrow({ where: { code: 'AYU-001' } });

      const session = await therapy.scheduleSession({ visitId, serviceId: abhyanga.id }, doctorUser.id);
      createdSessionIds.push(session.id);

      const stored = await prisma.therapySession.findUniqueOrThrow({ where: { id: session.id } });
      expect(stored.source).toBe('OPD');
      expect(stored.createdById).toBe(doctorUser.id);
    });

    it('IPD: a visit with a real Admission derives as IPD, and the charge lands on that admission', async () => {
      const { visitId, admissionId } = await makeIpdAdmission();
      const doctorUser = await prisma.user.findFirstOrThrow({ where: { role: { name: 'Doctor' } } });
      const abhyanga = await prisma.service.findUniqueOrThrow({ where: { code: 'AYU-001' } });

      const session = await therapy.scheduleSession({ visitId, admissionId, serviceId: abhyanga.id }, doctorUser.id);
      createdSessionIds.push(session.id);
      expect(session.admissionId).toBe(admissionId);

      const nurseUser = await prisma.user.findFirstOrThrow({ where: { role: { name: 'Nurse' } } });
      await therapy.performSession(session.id, undefined, nurseUser.id);

      const charge = await prisma.chargeItem.findFirstOrThrow({ where: { therapySessionId: session.id } });
      expect(charge.admissionId).toBe(admissionId);
      expect(charge.visitId).toBe(visitId);

      const stored = await prisma.therapySession.findUniqueOrThrow({ where: { id: session.id } });
      expect(stored.source).toBe('IPD');
      expect(stored.performedById).toBe(nurseUser.id);
    });

    it('a course opened against an admission is also tagged IPD and its pre-scheduled sessions inherit it', async () => {
      const { visitId, admissionId } = await makeIpdAdmission();
      const coursePkg = await prisma.service.findUniqueOrThrow({ where: { code: 'AYU-039' } });

      const course = await therapy.openCourse({ visitId, admissionId, serviceId: coursePkg.id, plannedSessions: 2 });
      createdCourseIds.push(course.id);

      expect(course.sessions.every((s) => s.admissionId === admissionId)).toBe(true);
      const storedCourse = await prisma.therapyCourse.findUniqueOrThrow({ where: { id: course.id } });
      expect(storedCourse.source).toBe('IPD');
      const storedSessions = await prisma.therapySession.findMany({ where: { courseId: course.id } });
      expect(storedSessions.every((s) => s.source === 'IPD')).toBe(true);
    });

    it('refuses an admission that does not belong to the given visit — never links therapy to the wrong patient', async () => {
      const { visitId } = await makeIpdAdmission();
      const other = await makeIpdAdmission(); // a second, unrelated admission
      const abhyanga = await prisma.service.findUniqueOrThrow({ where: { code: 'AYU-001' } });

      await expect(
        therapy.scheduleSession({ visitId, admissionId: other.admissionId, serviceId: abhyanga.id }),
      ).rejects.toThrow(BadRequestException);

      const orphanCharges = await prisma.chargeItem.count({ where: { visitId, admissionId: other.admissionId } });
      expect(orphanCharges).toBe(0);
    });

    it('refuses an admission id that does not exist at all', async () => {
      const visitId = await makeVisit();
      const abhyanga = await prisma.service.findUniqueOrThrow({ where: { code: 'AYU-001' } });
      await expect(
        therapy.scheduleSession({ visitId, admissionId: '00000000-0000-0000-0000-000000000000', serviceId: abhyanga.id }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('no-show — clinically distinct from cancel, billing-identical (no charge either way)', () => {
    it('marks a scheduled session as NO_SHOW and never bills it', async () => {
      const visitId = await makeVisit();
      const abhyanga = await prisma.service.findUniqueOrThrow({ where: { code: 'AYU-001' } });
      const session = await therapy.scheduleSession({ visitId, serviceId: abhyanga.id });
      createdSessionIds.push(session.id);

      const updated = await therapy.markNoShow(session.id);
      expect(updated.status).toBe('NO_SHOW');

      const charges = await prisma.chargeItem.count({ where: { therapySessionId: session.id } });
      expect(charges).toBe(0);
    });

    it('refuses to mark a performed session as no-show', async () => {
      const visitId = await makeVisit();
      const abhyanga = await prisma.service.findUniqueOrThrow({ where: { code: 'AYU-001' } });
      const session = await therapy.scheduleSession({ visitId, serviceId: abhyanga.id });
      createdSessionIds.push(session.id);
      await therapy.performSession(session.id, undefined);

      await expect(therapy.markNoShow(session.id)).rejects.toThrow(BadRequestException);
    });

    it('refuses to perform a session already marked no-show', async () => {
      const visitId = await makeVisit();
      const abhyanga = await prisma.service.findUniqueOrThrow({ where: { code: 'AYU-001' } });
      const session = await therapy.scheduleSession({ visitId, serviceId: abhyanga.id });
      createdSessionIds.push(session.id);
      await therapy.markNoShow(session.id);

      await expect(therapy.performSession(session.id, undefined)).rejects.toThrow(BadRequestException);
      const charges = await prisma.chargeItem.count({ where: { therapySessionId: session.id } });
      expect(charges).toBe(0);
    });
  });

  describe('console listing — filters used by the Therapy / Panchakarma Console', () => {
    it('lists sessions scoped to one visit only', async () => {
      const visitId = await makeVisit();
      const otherVisitId = await makeVisit();
      const abhyanga = await prisma.service.findUniqueOrThrow({ where: { code: 'AYU-001' } });

      const session = await therapy.scheduleSession({ visitId, serviceId: abhyanga.id });
      createdSessionIds.push(session.id);
      const otherSession = await therapy.scheduleSession({ visitId: otherVisitId, serviceId: abhyanga.id });
      createdSessionIds.push(otherSession.id);

      const scoped = await therapy.listSessions({ visitId });
      expect(scoped.map((s) => s.id)).toContain(session.id);
      expect(scoped.map((s) => s.id)).not.toContain(otherSession.id);
    });

    it('filters the console by source', async () => {
      const directVisitId = await makeVisit();
      const opdVisitId = await makeOpdConsultationVisit();
      const abhyanga = await prisma.service.findUniqueOrThrow({ where: { code: 'AYU-001' } });

      const directSession = await therapy.scheduleSession({ visitId: directVisitId, serviceId: abhyanga.id });
      createdSessionIds.push(directSession.id);
      const opdSession = await therapy.scheduleSession({ visitId: opdVisitId, serviceId: abhyanga.id });
      createdSessionIds.push(opdSession.id);

      const directOnly = await therapy.listSessions({ source: TherapySource.DIRECT });
      expect(directOnly.some((s) => s.id === directSession.id)).toBe(true);
      expect(directOnly.some((s) => s.id === opdSession.id)).toBe(false);
    });
  });
});
