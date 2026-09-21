import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreatePrescriptionDto } from './dto/create-prescription.dto';
import { UpdatePrescriptionDto } from './dto/update-prescription.dto';
import { PrescriptionStatus, AdmissionStatus, PrescriptionItemMedicineType } from '@prisma/client';
import { LabService } from '../laboratory/lab.service';
import { DocumentSequenceService } from '../../common/sequence/document-sequence.service';

@Injectable()
export class PrescriptionService {
  private readonly logger = new Logger(PrescriptionService.name);

  constructor(
    private prisma: PrismaService,
    private labService: LabService,
    private sequences: DocumentSequenceService,
  ) {}

  /**
   * Create Draft Prescription with Diagnosis, PrescriptionItems, and LabOrders
   */
  async createPrescription(dto: CreatePrescriptionDto, doctorId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const visit = await tx.visit.findUnique({ where: { id: dto.visitId } });
      if (!visit) {
        throw new NotFoundException(`Visit not found for ID: ${dto.visitId}`);
      }

      // 1. Create Diagnosis record
      const diagnosis = await tx.diagnosis.create({
        data: {
          visitId: dto.visitId,
          doctorId,
          symptoms: dto.symptoms || null,
          examinationNotes: dto.examinationNotes || null,
          diagnosisText: dto.diagnosisText,
          followUpFlag: dto.followUpFlag || false,
          admissionRecommended: dto.admissionRecommended || false,
        },
      });

      // 2. Create Prescription in DRAFT status
      const prescription = await tx.prescription.create({
        data: {
          visitId: dto.visitId,
          doctorId,
          status: PrescriptionStatus.DRAFT,
          items: {
            create: dto.items.map((item) => ({
              medicineName: item.medicineName,
              medicineType: item.medicineType ?? PrescriptionItemMedicineType.INVENTORY,
              dose: item.dose,
              frequency: item.frequency,
              duration: item.duration,
            })),
          },
        },
        include: { items: true },
      });

      // 3. Order lab tests, grouped under one Lab Order (Feature 6), if any
      // were selected from the Lab Test Master.
      if (dto.labTestIds && dto.labTestIds.length > 0) {
        await this.labService.orderTests({ visitId: dto.visitId, labTestIds: dto.labTestIds }, doctorId, tx);
      }

      return { diagnosis, prescription };
    });

    this.logger.log(
      `✅ Created Draft Prescription ${result.prescription.id} for Visit ${dto.visitId}`,
    );
    return result;
  }

  /**
   * Update Draft Prescription (Strict API-level lock enforcement when SIGNED).
   *
   * Replaces the prescription's medicine items wholesale, inside one
   * transaction with the immutability check, so a caller can never edit a
   * prescription that was signed between the check and the write.
   */
  async updatePrescription(id: string, dto: UpdatePrescriptionDto) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.prescription.findUnique({ where: { id } });

      if (!existing) {
        throw new NotFoundException(`Prescription not found for ID: ${id}`);
      }

      // Spec compliance: Signed prescriptions are IMMUTABLE and reject any edit attempt at the API level
      if (existing.status === PrescriptionStatus.SIGNED) {
        throw new ForbiddenException(
          'Signed prescriptions are immutable and locked for audit compliance. Cannot edit a signed prescription.',
        );
      }

      await tx.prescriptionItem.deleteMany({ where: { prescriptionId: id } });

      const updated = await tx.prescription.update({
        where: { id },
        data: {
          items: {
            create: dto.items.map((item) => ({
              medicineName: item.medicineName,
              medicineType: item.medicineType ?? PrescriptionItemMedicineType.INVENTORY,
              dose: item.dose,
              frequency: item.frequency,
              duration: item.duration,
            })),
          },
        },
        include: { items: true },
      });

      this.logger.log(`✏️ Updated Draft Prescription ${id} (${updated.items.length} item(s))`);
      return updated;
    });
  }

  /**
   * Cryptographically Sign Prescription (Doctor role required)
   */
  async signPrescription(id: string, userRole: string) {
    // Spec §10.1 & FR-DOC-07: Doctor, Administrator, or SuperAdmin role can sign
    if (userRole !== 'Doctor' && userRole !== 'SuperAdmin' && userRole !== 'Administrator') {
      throw new ForbiddenException(
        'Signing requires the Doctor or Administrator role. Access denied for role: ' + userRole,
      );
    }

    const signedAt = new Date();

    return this.prisma.$transaction(async (tx) => {
      const rx = await tx.prescription.findUnique({
        where: { id },
        include: { visit: true, items: true },
      });

      if (!rx) throw new NotFoundException(`Prescription not found for ID: ${id}`);

      if (rx.status === PrescriptionStatus.SIGNED) {
        return rx; // Already signed
      }

      const signedRx = await tx.prescription.update({
        where: { id },
        data: {
          status: PrescriptionStatus.SIGNED,
          signedAt,
        },
        include: { items: true },
      });

      // Check if Linked Diagnosis recommended admission (Phase 5 -> Phase 8 linkage)
      const dx = await tx.diagnosis.findFirst({
        where: { visitId: rx.visitId },
        orderBy: { createdAt: 'desc' },
      });

      if (dx && dx.admissionRecommended) {
        const existingAdmission = await tx.admission.findFirst({
          where: { visitId: rx.visitId },
        });

        if (!existingAdmission) {
          const admissionStub = await tx.admission.create({
            data: {
              visitId: rx.visitId,
              admissionNumber: await this.sequences.next('IPD_NUMBER', tx),
              status: AdmissionStatus.REQUESTED,
              eligibleCategory: 'C',
            },
          });
          this.logger.log(`🏥 Created Admission Stub ${admissionStub.id} for Visit ${rx.visitId}`);
        }
      }

      this.logger.log(
        `🔐 Cryptographically Signed Prescription ${id} by Doctor (Role: ${userRole})`,
      );
      return signedRx;
    });
  }

  async findByVisit(visitId: string) {
    return this.prisma.prescription.findMany({
      where: { visitId },
      include: { items: true },
    });
  }
}
