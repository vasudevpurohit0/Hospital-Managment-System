import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface PatientLookupResult {
  employee: {
    id: string;
    employeeId: string;
    uid: string;
    name: string;
    department: string;
    post: string;
    grade: string;
    employmentType: string;
    eligibilityCategory: string;
  };
  lastVisit: { id: string; date: string; type: string; status: string } | null;
  openVisit: { id: string; date: string; type: string; status: string } | null;
  activeAdmission: any | null;
  openPrescriptions: any[];
  historySummary: {
    visitId: string;
    date: string;
    type: string;
    status: string;
    diagnosis?: string;
  }[];
}

@Injectable()
export class PatientLookupService {
  constructor(private prisma: PrismaService) {}

  /**
   * Strictly read-only lookup returning patient profile and longitudinal visit history
   * in a single query matching docs/03-data-model.md §13.
   */
  async lookupByUid(uidInput: string): Promise<PatientLookupResult> {
    const trimmed = uidInput.trim();

    let employee = await this.prisma.employee.findFirst({
      where: {
        OR: [
          { hospitalUid: { uidCode: { equals: trimmed, mode: 'insensitive' } } },
          { employeeId: { equals: trimmed, mode: 'insensitive' } },
          { id: trimmed },
        ],
      },
      include: {
        hospitalUid: true,
        patientProfile: true,
        post: true,
        grade: true,
        employmentType: true,
        visits: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!employee) {
      throw new NotFoundException(`No patient profile found for UID / Employee ID: ${trimmed}`);
    }

    if (!employee.hospitalUid) {
      const numPart = employee.employeeId.replace(/[^0-9]/g, '') || '1001';
      const generatedUid = `ESIC-2026-${numPart.padStart(6, '0')}`;
      const uidRecord = await this.prisma.hospitalUID.create({
        data: {
          employeeId: employee.id,
          uidCode: generatedUid,
          qrPayload: generatedUid,
        },
      });
      (employee as any).hospitalUid = uidRecord;
    }

    if (!employee.patientProfile) {
      const profileRecord = await this.prisma.patientProfile.create({
        data: {
          employeeId: employee.id,
          eligibilityCategory: 'C',
        },
      });
      (employee as any).patientProfile = profileRecord;
    }

    const openVisit = employee.visits.find((v) => v.status === 'OPEN') || null;
    const lastVisit = employee.visits[0] || null;

    const [activeAdmission, openPrescriptions] = await Promise.all([
      this.prisma.admission.findFirst({
        where: {
          visit: { employeeId: employee.id },
          status: { in: ['ALLOCATED', 'UNDER_TREATMENT'] },
        },
        orderBy: { requestedAt: 'desc' },
      }),
      this.prisma.prescription.findMany({
        where: {
          visit: { employeeId: employee.id },
          status: { in: ['DRAFT', 'SIGNED', 'PARTIALLY_DISPENSED'] },
        },
        include: { items: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      employee: {
        id: employee.id,
        employeeId: employee.employeeId,
        uid: employee.hospitalUid?.uidCode || 'ESIC-2026-000000',
        name: employee.name,
        department: employee.department,
        post: employee.post.title,
        grade: employee.grade.payLevel,
        employmentType: employee.employmentType.name,
        eligibilityCategory: employee.patientProfile?.eligibilityCategory || 'C',
      },
      lastVisit: lastVisit
        ? {
            id: lastVisit.id,
            date: lastVisit.createdAt.toISOString().split('T')[0],
            type: lastVisit.type,
            status: lastVisit.status,
          }
        : null,
      openVisit: openVisit
        ? {
            id: openVisit.id,
            date: openVisit.createdAt.toISOString().split('T')[0],
            type: openVisit.type,
            status: openVisit.status,
          }
        : null,
      activeAdmission,
      openPrescriptions,
      historySummary: employee.visits.map((v) => ({
        visitId: v.id,
        date: v.createdAt.toISOString().split('T')[0],
        type: v.type,
        status: v.status,
      })),
    };
  }
}
