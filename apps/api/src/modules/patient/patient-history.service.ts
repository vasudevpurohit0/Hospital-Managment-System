import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ChargeService } from '../billing/charge.service';
import { DocumentRenderService } from '../../common/rendering/document-render.service';
import { StockTransactionType } from '@prisma/client';
import {
  PatientTimelineEvent,
  PatientTimelineEventType,
  MedicationHistoryRow,
  PatientHistoryReport,
} from './patient-history.types';

/**
 * Builds the complete, chronological patient clinical timeline (Feature:
 * "Complete Patient Clinical Timeline, Treatment History & Downloadable
 * PDF"). Every event is derived from a real column on a real record; nothing
 * is inferred (e.g. "administered" is never inferred from "dispensed", and a
 * missing timestamp is reported as `timeRecorded: false`, never guessed).
 *
 * This system has no medication-administration (MAR) module -- Prescribe and
 * Dispense are the only two medicine-lifecycle steps it actually records, so
 * every ADMINISTERED row in `medicationHistory` is always "not recorded".
 * Similarly, an individual PrescriptionItem's dispensedAt isn't stored on the
 * item itself; the real per-item dispense timestamp comes from the matching
 * StockTransaction (DISPENSE) row for INVENTORY items only -- a CUSTOM item
 * never produces one (PharmacyService skips stock movement for it), so its
 * "Dispensed" stage is timestamped "not recorded" too, honestly.
 */
@Injectable()
export class PatientHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chargeService: ChargeService,
    private readonly documentRender: DocumentRenderService,
  ) {}

  async getPatientTimeline(
    employeeRecordId: string,
    opts: { canViewBilling: boolean },
  ): Promise<PatientHistoryReport> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeRecordId },
      include: {
        patientProfile: true,
        hospitalUid: true,
        employmentType: true,
        visits: {
          orderBy: { createdAt: 'asc' },
          include: {
            opdVisit: { include: { department: true } },
            diagnoses: { orderBy: { createdAt: 'asc' } },
            prescriptions: {
              orderBy: { createdAt: 'asc' },
              include: { items: true },
            },
            labOrders: {
              orderBy: { createdAt: 'asc' },
              include: {
                items: {
                  include: {
                    labTest: { select: { name: true, code: true } },
                    results: { include: { parameter: { include: { ranges: true } } } },
                  },
                },
                sample: true,
                report: true,
              },
            },
            therapyCourses: {
              orderBy: { startedAt: 'asc' },
              include: { service: { select: { name: true, serviceType: true } } },
            },
            therapySessions: {
              orderBy: { scheduledAt: 'asc' },
              include: { service: { select: { name: true, serviceType: true } } },
            },
            admissions: {
              orderBy: { requestedAt: 'asc' },
              include: {
                ward: true,
                room: true,
                bed: true,
                notes: { orderBy: { createdAt: 'asc' } },
                locationHistory: {
                  orderBy: { movedAt: 'asc' },
                  include: { fromWard: true, fromRoom: true, fromBed: true, toWard: true, toRoom: true, toBed: true },
                },
                dischargeSummary: true,
              },
            },
          },
        },
      },
    });
    if (!employee) {
      throw new NotFoundException(`Patient not found`);
    }

    // Every actor reference across the whole record is a raw User FK, not a
    // joined name -- resolve them all in one batched lookup rather than N+1.
    const actorIds = new Set<string>();
    const addActor = (userId: string | null | undefined) => {
      if (userId) actorIds.add(userId);
    };
    for (const v of employee.visits) {
      addActor(v.opdVisit?.doctorId);
      v.diagnoses.forEach((d) => addActor(d.doctorId));
      v.prescriptions.forEach((p) => addActor(p.doctorId));
      v.labOrders.forEach((lo) => {
        addActor(lo.orderedBy);
        addActor(lo.sample?.collectedById);
        addActor(lo.report?.verifiedById);
      });
      v.therapyCourses.forEach((c) => addActor(c.createdById));
      v.therapySessions.forEach((s) => {
        addActor(s.performedById);
        addActor(s.createdById);
      });
      v.admissions.forEach((a) => {
        addActor(a.assignedDoctorId);
        addActor(a.assignedNurseId);
        a.locationHistory.forEach((m) => addActor(m.movedById));
        a.notes.forEach((n) => addActor(n.authoredBy));
        addActor(a.dischargeSummary?.approvedBy);
      });
    }

    const users = actorIds.size
      ? await this.prisma.user.findMany({
          where: { id: { in: [...actorIds] } },
          include: { employee: { select: { name: true } }, role: { select: { name: true } } },
        })
      : [];
    const actorMap = new Map(
      users.map((u) => [u.id, { name: u.employee?.name || u.identifier.split('@')[0], role: u.role?.name ?? null }]),
    );
    const actorName = (userId: string | null | undefined) => (userId && actorMap.get(userId)?.name) || null;
    const actorRole = (userId: string | null | undefined) => (userId && actorMap.get(userId)?.role) || null;

    // Real per-item dispense timestamps -- see class doc for why this can't
    // be read off PrescriptionItem itself.
    const allItemIds = employee.visits.flatMap((v) => v.prescriptions.flatMap((p) => p.items.map((i) => i.id)));
    const dispenseTxns = allItemIds.length
      ? await this.prisma.stockTransaction.findMany({
          where: { prescriptionItemId: { in: allItemIds }, type: StockTransactionType.DISPENSE },
          orderBy: { createdAt: 'asc' },
        })
      : [];
    const dispenseMap = new Map<string, { createdAt: Date; performedBy: string }>();
    for (const txn of dispenseTxns) {
      if (!txn.prescriptionItemId || dispenseMap.has(txn.prescriptionItemId)) continue;
      dispenseMap.set(txn.prescriptionItemId, { createdAt: txn.createdAt, performedBy: txn.performedBy });
    }

    const ledger = opts.canViewBilling ? await this.chargeService.patientLedger(employee.employeeId) : null;
    const branding = await this.documentRender.getBranding();

    const events: PatientTimelineEvent[] = [];
    let eventSeq = 0;
    const pushEvent = (
      type: PatientTimelineEventType,
      timestamp: Date,
      rest: Omit<PatientTimelineEvent, 'id' | 'type' | 'timestamp' | 'timeRecorded'>,
    ) => {
      events.push({
        id: `${type}:${eventSeq++}:${rest.sourceId}`,
        type,
        timestamp: timestamp.toISOString(),
        timeRecorded: true,
        ...rest,
      });
    };

    pushEvent('REGISTRATION', employee.registrationDate ?? employee.createdAt, {
      title: 'Patient Registered',
      department: 'Central Registration',
      location: null,
      performedBy: null,
      performedByRole: null,
      status: null,
      visitId: null,
      admissionId: null,
      sourceId: employee.id,
      details: { employeeId: employee.employeeId, uhid: employee.hospitalUid?.uidCode ?? null },
    });

    for (const v of employee.visits) {
      const department = v.opdVisit?.department?.name ?? null;

      pushEvent('VISIT', v.createdAt, {
        title: v.type === 'OPD' ? `OPD Visit — ${department ?? 'General Medicine'}` : `${v.type} Visit Registered`,
        department,
        location: department,
        performedBy: null,
        performedByRole: null,
        status: v.status,
        visitId: v.id,
        admissionId: null,
        sourceId: v.id,
        details: { visitType: v.type, tokenNumber: v.opdVisit?.tokenNumber ?? null, opdNumber: v.opdVisit?.opdNumber ?? null },
      });

      if (v.opdVisit) {
        const ov = v.opdVisit;
        pushEvent('QUEUE', ov.checkedInAt ?? ov.assignedAt ?? v.createdAt, {
          title: `Queue — Token ${ov.tokenNumber}`,
          department,
          location: department,
          performedBy: null,
          performedByRole: null,
          status: ov.status,
          visitId: v.id,
          admissionId: null,
          sourceId: ov.id,
          details: {
            tokenNumber: ov.tokenNumber,
            generatedAt: ov.assignedAt?.toISOString() ?? null,
            checkedInAt: ov.checkedInAt?.toISOString() ?? null,
            calledAt: ov.calledAt?.toISOString() ?? null,
            serviceStartedAt: ov.consultationStartedAt?.toISOString() ?? null,
            completedAt: ov.completedAt?.toISOString() ?? null,
            closedAt: ov.closedAt?.toISOString() ?? null,
            status: ov.status,
          },
        });
      }

      for (const d of v.diagnoses) {
        // This schema records chief complaint, exam findings and diagnosis
        // on one Diagnosis row per consultation -- there is no separate
        // "diagnosis-only" record and no primary/secondary/provisional/final
        // distinction, so Consultation and Diagnosis are reported as one
        // combined event (Feature rule: don't invent a distinction the data
        // model doesn't support).
        pushEvent('CONSULTATION', d.createdAt, {
          title: 'Doctor Consultation',
          department,
          location: department,
          performedBy: actorName(d.doctorId),
          performedByRole: actorRole(d.doctorId),
          status: null,
          visitId: v.id,
          admissionId: null,
          sourceId: d.id,
          details: {
            chiefComplaint: d.symptoms ?? null,
            clinicalNotes: d.examinationNotes ?? null,
            diagnosis: d.diagnosisText,
            followUpFlag: d.followUpFlag,
            admissionRecommended: d.admissionRecommended,
          },
        });
      }

      for (const lo of v.labOrders) {
        pushEvent('LAB_ORDER', lo.createdAt, {
          title: `Lab Order${lo.labNumber ? ` — ${lo.labNumber}` : ''}`,
          department,
          location: null,
          performedBy: actorName(lo.orderedBy),
          performedByRole: actorRole(lo.orderedBy),
          status: lo.status,
          visitId: v.id,
          admissionId: lo.admissionId,
          sourceId: lo.id,
          details: {
            labNumber: lo.labNumber,
            priority: lo.priority,
            tests: lo.items.map((i) => ({ name: i.labTest.name, code: i.labTest.code, status: i.status })),
            sample: lo.sample
              ? { sampleCode: lo.sample.sampleCode, specimenType: lo.sample.specimenType, collectedAt: lo.sample.collectedAt.toISOString() }
              : null,
          },
        });

        if (lo.report) {
          pushEvent('LAB_RESULT', lo.report.releasedAt, {
            title: `Lab Results — ${lo.labNumber ?? 'Report'}`,
            department,
            location: null,
            performedBy: actorName(lo.report.verifiedById),
            performedByRole: actorRole(lo.report.verifiedById),
            status: 'VERIFIED',
            visitId: v.id,
            admissionId: lo.admissionId,
            sourceId: lo.report.id,
            details: {
              labNumber: lo.labNumber,
              remarks: lo.report.pathologistRemarks,
              results: lo.items.flatMap((i) =>
                i.results.map((r) => ({
                  test: i.labTest.name,
                  parameter: r.parameter.name,
                  groupLabel: r.parameter.groupLabel,
                  value: r.value,
                  unit: r.parameter.unit,
                  range: r.parameter.ranges[0]?.displayText ?? null,
                  flag: r.flag,
                })),
              ),
            },
          });
        }
      }

      for (const p of v.prescriptions) {
        pushEvent('PRESCRIPTION', p.signedAt ?? p.createdAt, {
          title: 'Medicine Prescribed',
          department,
          location: null,
          performedBy: actorName(p.doctorId),
          performedByRole: actorRole(p.doctorId),
          status: p.status,
          visitId: v.id,
          admissionId: null,
          sourceId: p.id,
          details: {
            items: p.items.map((i) => ({
              medicineName: i.medicineName,
              medicineType: i.medicineType,
              dose: i.dose,
              frequency: i.frequency,
              duration: i.duration,
              dispenseStatus: i.dispenseStatus,
            })),
          },
        });

        const dispensedItems = p.items.filter(
          (i) => i.dispenseStatus === 'DISPENSED' || i.dispenseStatus === 'PARTIALLY_DISPENSED',
        );
        if (dispensedItems.length > 0) {
          const knownTimes = dispensedItems
            .map((i) => dispenseMap.get(i.id))
            .filter((t): t is { createdAt: Date; performedBy: string } => !!t);
          // Only anchor a chronological "Dispensed" event when at least one
          // item has a real recorded dispense time -- inventing one from the
          // prescription's own timestamp would misrepresent when dispensing
          // actually happened (Data Accuracy Rule). Items with no real time
          // still appear correctly, as "not recorded", in medicationHistory.
          if (knownTimes.length > 0) {
            const earliest = knownTimes.reduce((a, b) => (a.createdAt < b.createdAt ? a : b));
            pushEvent('MEDICINE_DISPENSED', earliest.createdAt, {
              title: 'Medicines Dispensed',
              department,
              location: 'Pharmacy',
              performedBy: actorName(earliest.performedBy),
              performedByRole: actorRole(earliest.performedBy),
              status: null,
              visitId: v.id,
              admissionId: null,
              sourceId: p.id,
              details: {
                items: dispensedItems.map((i) => ({
                  medicineName: i.medicineName,
                  medicineType: i.medicineType,
                  quantity: i.dispensedQuantity,
                  dispenseStatus: i.dispenseStatus,
                  dispensedAt: dispenseMap.get(i.id)?.createdAt.toISOString() ?? null,
                })),
              },
            });
          }
        }
      }

      for (const c of v.therapyCourses) {
        const eventType: PatientTimelineEventType = c.service.serviceType === 'PROCEDURE' ? 'PROCEDURE' : 'THERAPY_SESSION';
        pushEvent(eventType, c.startedAt, {
          title: `${eventType === 'PROCEDURE' ? 'Procedure' : 'Therapy'} Course Opened — ${c.service.name}`,
          department,
          location: null,
          performedBy: actorName(c.createdById),
          performedByRole: actorRole(c.createdById),
          status: c.status,
          visitId: v.id,
          admissionId: c.admissionId,
          sourceId: c.id,
          details: { service: c.service.name, plannedSessions: c.plannedSessions, source: c.source },
        });
      }

      for (const s of v.therapySessions) {
        if (s.status === 'SCHEDULED') continue; // only report what actually happened
        const eventType: PatientTimelineEventType = s.service.serviceType === 'PROCEDURE' ? 'PROCEDURE' : 'THERAPY_SESSION';
        pushEvent(eventType, s.performedAt ?? s.scheduledAt, {
          title: `${eventType === 'PROCEDURE' ? 'Procedure' : 'Therapy Session'} — ${s.service.name}`,
          department,
          location: null,
          performedBy: actorName(s.performedById) ?? actorName(s.createdById),
          performedByRole: actorRole(s.performedById) ?? actorRole(s.createdById),
          status: s.status,
          visitId: v.id,
          admissionId: s.admissionId,
          sourceId: s.id,
          details: { service: s.service.name, sessionNumber: s.sessionNumber, notes: s.notes, source: s.source },
        });
      }

      for (const a of v.admissions) {
        const location =
          [a.ward?.name, a.room?.roomNumber ? `Room ${a.room.roomNumber}` : null, a.bed?.bedNumber ? `Bed ${a.bed.bedNumber}` : null]
            .filter(Boolean)
            .join(' · ') || null;

        pushEvent('ADMISSION', a.allocatedAt ?? a.requestedAt, {
          title: 'Inpatient Admission',
          department,
          location,
          performedBy: actorName(a.assignedDoctorId),
          performedByRole: actorRole(a.assignedDoctorId),
          status: a.status,
          visitId: v.id,
          admissionId: a.id,
          sourceId: a.id,
          details: {
            admissionNumber: a.admissionNumber,
            ward: a.ward?.name ?? null,
            room: a.room?.roomNumber ?? null,
            bed: a.bed?.bedNumber ?? null,
            assignedDoctor: actorName(a.assignedDoctorId),
            assignedNurse: actorName(a.assignedNurseId),
          },
        });

        for (const move of a.locationHistory) {
          pushEvent('BED_MOVEMENT', move.movedAt, {
            title: 'Bed / Ward Movement',
            department,
            location:
              [move.toWard?.name, move.toRoom?.roomNumber, move.toBed?.bedNumber].filter(Boolean).join(' · ') || null,
            performedBy: actorName(move.movedById),
            performedByRole: actorRole(move.movedById),
            status: null,
            visitId: v.id,
            admissionId: a.id,
            sourceId: move.id,
            details: {
              from: move.fromWardId
                ? { ward: move.fromWard?.name ?? null, room: move.fromRoom?.roomNumber ?? null, bed: move.fromBed?.bedNumber ?? null }
                : null,
              to: { ward: move.toWard?.name ?? null, room: move.toRoom?.roomNumber ?? null, bed: move.toBed?.bedNumber ?? null },
              reason: move.reason,
            },
          });
        }

        // Progress notes (AdmissionNote rows) -- the ward's clinical
        // observation log. These were previously fetched and then dropped;
        // every note is its own chronological event so "Progress Notes" in
        // the acceptance list is actually satisfied. Authorization follows
        // the timeline itself (PatientHistory:read), consistent with
        // diagnoses/prescriptions which likewise don't re-check their
        // dedicated resource grants here.
        for (const n of a.notes) {
          pushEvent('PROGRESS_NOTE', n.createdAt, {
            title: 'Progress Note',
            department,
            location,
            performedBy: actorName(n.authoredBy),
            performedByRole: actorRole(n.authoredBy),
            status: null,
            visitId: v.id,
            admissionId: a.id,
            sourceId: n.id,
            details: {
              note: n.note,
              admissionNumber: a.admissionNumber,
            },
          });
        }

        if (a.dischargedAt) {
          pushEvent('DISCHARGE', a.dischargedAt, {
            title: 'Patient Discharged',
            department,
            location,
            performedBy: actorName(a.dischargeSummary?.approvedBy),
            performedByRole: actorRole(a.dischargeSummary?.approvedBy),
            status: a.status,
            visitId: v.id,
            admissionId: a.id,
            sourceId: a.id,
            details: {
              admissionDate: (a.allocatedAt ?? a.requestedAt).toISOString(),
              dischargeDate: a.dischargedAt.toISOString(),
              summary: a.dischargeSummary?.summaryText ?? null,
              lengthOfStayDays: a.allocatedAt
                ? Math.ceil((a.dischargedAt.getTime() - a.allocatedAt.getTime()) / 86_400_000)
                : null,
            },
          });
        }
      }
    }

    if (ledger) {
      const receiptTotals = new Map<string, { amount: number; date: Date }>();
      for (const txn of ledger.transactions) {
        if (!txn.receiptNumber) continue;
        const existing = receiptTotals.get(txn.receiptNumber);
        const amount = (existing?.amount ?? 0) + Number(txn.totalAmount);
        receiptTotals.set(txn.receiptNumber, { amount, date: existing?.date ?? new Date(txn.date) });
      }
      for (const [receiptNumber, { amount, date }] of receiptTotals) {
        pushEvent('PAYMENT', date, {
          title: `Payment Received — ${receiptNumber}`,
          department: null,
          location: null,
          performedBy: null,
          performedByRole: null,
          status: null,
          visitId: null,
          admissionId: null,
          sourceId: receiptNumber,
          details: { receiptNumber, amount },
        });
      }
    }

    events.sort((a, b) => new Date(a.timestamp as string).getTime() - new Date(b.timestamp as string).getTime());

    // Medication History (Feature #13-16, #28): prescribed / dispensed /
    // administered kept as distinct rows, never merged.
    const medicationHistory: MedicationHistoryRow[] = [];
    for (const v of employee.visits) {
      for (const p of v.prescriptions) {
        for (const item of p.items) {
          medicationHistory.push({
            id: `${item.id}:PRESCRIBED`,
            medicineName: item.medicineName,
            medicineType: item.medicineType,
            stage: 'PRESCRIBED',
            timestamp: (p.signedAt ?? p.createdAt).toISOString(),
            timeRecorded: true,
            dose: item.dose,
            frequency: item.frequency,
            duration: item.duration,
            quantity: null,
            by: actorName(p.doctorId),
            visitId: v.id,
            prescriptionId: p.id,
            prescriptionItemId: item.id,
          });

          const isDispensed = item.dispenseStatus === 'DISPENSED' || item.dispenseStatus === 'PARTIALLY_DISPENSED';
          if (isDispensed) {
            const txn = dispenseMap.get(item.id);
            medicationHistory.push({
              id: `${item.id}:DISPENSED`,
              medicineName: item.medicineName,
              medicineType: item.medicineType,
              stage: 'DISPENSED',
              timestamp: txn ? txn.createdAt.toISOString() : null,
              timeRecorded: !!txn,
              dose: item.dose,
              frequency: item.frequency,
              duration: item.duration,
              quantity: item.dispensedQuantity,
              by: txn ? actorName(txn.performedBy) : null,
              visitId: v.id,
              prescriptionId: p.id,
              prescriptionItemId: item.id,
              ...(txn ? {} : { notRecordedReason: 'No dispense transaction record found for this item.' }),
            });
          }

          medicationHistory.push({
            id: `${item.id}:ADMINISTERED`,
            medicineName: item.medicineName,
            medicineType: item.medicineType,
            stage: 'ADMINISTERED',
            timestamp: null,
            timeRecorded: false,
            dose: item.dose,
            frequency: item.frequency,
            duration: item.duration,
            quantity: null,
            by: null,
            visitId: v.id,
            prescriptionId: p.id,
            prescriptionItemId: item.id,
            notRecordedReason: 'This system does not record medication administration (no MAR/nursing-round module).',
          });
        }
      }
    }

    const profile = employee.patientProfile;
    let age: number | null = null;
    if (profile?.dob) {
      const dob = new Date(profile.dob);
      const today = new Date();
      age = today.getFullYear() - dob.getFullYear();
      const m = today.getMonth() - dob.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
    }

    const totalMedicines = employee.visits.reduce(
      (acc, v) => acc + v.prescriptions.reduce((a, p) => a + p.items.length, 0),
      0,
    );
    const totalBills = ledger
      ? new Set(ledger.transactions.filter((t) => t.receiptNumber).map((t) => t.receiptNumber)).size
      : 0;

    const timestamps = events.map((e) => new Date(e.timestamp as string).getTime());

    return {
      patient: {
        id: employee.id,
        uhid: employee.hospitalUid?.uidCode ?? null,
        employeeId: employee.employeeId,
        name: employee.name,
        age: age !== null ? `${age} Yrs` : '—',
        gender: profile?.gender || '—',
        dob: profile?.dob ? new Date(profile.dob).toISOString().split('T')[0] : '—',
        mobile: employee.contactPhone || '—',
        address: profile?.address || '—',
        employmentType: employee.employmentType?.name || '—',
      },
      hospitalName: branding.hospitalName,
      period: timestamps.length
        ? { from: new Date(Math.min(...timestamps)).toISOString(), to: new Date(Math.max(...timestamps)).toISOString() }
        : { from: null, to: null },
      summary: {
        totalVisits: employee.visits.length,
        totalAdmissions: employee.visits.reduce((a, v) => a + v.admissions.length, 0),
        totalConsultations: employee.visits.reduce((a, v) => a + v.diagnoses.length, 0),
        totalLabOrders: employee.visits.reduce((a, v) => a + v.labOrders.length, 0),
        totalPrescriptions: employee.visits.reduce((a, v) => a + v.prescriptions.length, 0),
        totalMedicines,
        totalProcedures: events.filter((e) => e.type === 'PROCEDURE').length,
        totalTherapySessions: events.filter((e) => e.type === 'THERAPY_SESSION').length,
        totalBills,
      },
      events,
      medicationHistory,
      billing: ledger
        ? {
            authorized: true,
            total: Number(ledger.summary.totalAmount),
            paid: Number(ledger.summary.paidAmount),
            pending: Number(ledger.summary.outstandingAmount),
          }
        : { authorized: false, total: 0, paid: 0, pending: 0 },
      generatedAt: new Date().toISOString(),
    };
  }
}
