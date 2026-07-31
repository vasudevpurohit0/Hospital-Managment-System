import {
  Injectable,
  OnModuleInit,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FacilityEligibilityService } from '../facility/facility.service';
import { AllocateBedDto } from './dto/allocate-bed.dto';
import { CreateNoteDto } from './dto/create-note.dto';
import { DischargeDto } from './dto/discharge.dto';
import { AdmissionStatus, BedStatus } from '@prisma/client';

@Injectable()
export class AdmissionService implements OnModuleInit {
  private readonly logger = new Logger(AdmissionService.name);

  constructor(
    private prisma: PrismaService,
    private eligibilityService: FacilityEligibilityService,
  ) {}

  async onModuleInit() {
    // Populate initial admission stubs for any visit with an admission-recommended diagnosis
    const count = await this.prisma.admission.count();
    if (count === 0) {
      const visits = await this.prisma.visit.findMany({
        include: { employee: true },
      });

      for (const visit of visits) {
        const dx = await this.prisma.diagnosis.findFirst({
          where: { visitId: visit.id },
        });

        if (dx && dx.admissionRecommended) {
          await this.prisma.admission.create({
            data: {
              visitId: visit.id,
              status: AdmissionStatus.REQUESTED,
              eligibleCategory: 'C',
            },
          });
        }
      }
    }
  }

  async findAll() {
    return this.prisma.admission.findMany({
      include: {
        visit: {
          include: {
            employee: {
              include: { post: true, grade: true },
            },
          },
        },
        ward: true,
        room: true,
        bed: true,
        assignedDoctor: true,
        assignedNurse: true,
        notes: {
          include: { author: true },
          orderBy: { createdAt: 'desc' },
        },
        dischargeSummary: {
          include: { approver: true },
        },
      },
      orderBy: { requestedAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const admission = await this.prisma.admission.findUnique({
      where: { id },
      include: {
        visit: {
          include: {
            employee: {
              include: { post: true, grade: true },
            },
          },
        },
        ward: true,
        room: true,
        bed: true,
        assignedDoctor: true,
        assignedNurse: true,
        notes: {
          include: { author: true },
          orderBy: { createdAt: 'desc' },
        },
        dischargeSummary: {
          include: { approver: true },
        },
      },
    });

    if (!admission) {
      throw new NotFoundException(`Admission record with ID ${id} not found`);
    }
    return admission;
  }

  /**
   * Resolve Facility Eligibility Category for the requested admission (Module 5 linkage)
   */
  async resolveEligibility(id: string) {
    const admission = await this.findOne(id);

    // Call FacilityEligibilityRule engine to resolve category
    const employeeId = admission.visit.employee.id;
    const resolved = await this.eligibilityService.resolve(employeeId);

    return this.prisma.admission.update({
      where: { id },
      data: {
        eligibleCategory: resolved.category,
        status: AdmissionStatus.ELIGIBILITY_CHECKED,
      },
      include: {
        visit: {
          include: { employee: true },
        },
      },
    });
  }

  /**
   * Find available beds matching the resolved eligibility category
   */
  async findAvailableBeds(id: string) {
    let admission = await this.findOne(id);

    if (admission.status === AdmissionStatus.REQUESTED) {
      await this.resolveEligibility(id);
      admission = await this.findOne(id);
    }

    const category = admission.eligibleCategory;

    return this.prisma.bed.findMany({
      where: {
        status: BedStatus.AVAILABLE,
        currentAdmissionId: null,
        room: {
          ward: {
            category: category as any,
          },
        },
      },
      include: {
        room: {
          include: {
            ward: true,
          },
        },
      },
    });
  }

  /**
   * Allocate a specific Bed to an Admission transactionally (Spec §8.1 & FR-ADM-03)
   * Enforces database-level concurrency safeguards.
   */
  async allocateBed(id: string, dto: AllocateBedDto, _userId?: string) {
    await this.findOne(id);

    return this.prisma.$transaction(async (tx) => {
      // 1. Fetch the Bed and verify availability
      const bed = await tx.bed.findUnique({
        where: { id: dto.bedId },
        include: { room: true },
      });

      if (!bed) {
        throw new NotFoundException(`Bed with ID ${dto.bedId} not found`);
      }

      if (bed.status !== BedStatus.AVAILABLE || bed.currentAdmissionId !== null) {
        throw new ConflictException(
          `Bed ${bed.bedNumber} is already occupied or under maintenance`,
        );
      }

      // 2. Perform optimistic update on Bed to block concurrent duplicate requests
      const updateCount = await tx.bed.updateMany({
        where: {
          id: dto.bedId,
          currentAdmissionId: null,
          status: BedStatus.AVAILABLE,
        },
        data: {
          status: BedStatus.OCCUPIED,
          currentAdmissionId: id,
        },
      });

      if (updateCount.count === 0) {
        throw new ConflictException(
          `Bed ${bed.bedNumber} has already been allocated by another transaction`,
        );
      }

      // 3. Update Admission details and status
      const updated = await tx.admission.update({
        where: { id },
        data: {
          status: AdmissionStatus.UNDER_TREATMENT, // Moves from Allocated -> UnderTreatment immediately
          bedId: dto.bedId,
          wardId: bed.room.wardId,
          roomId: bed.roomId,
          assignedDoctorId: dto.assignedDoctorId,
          assignedNurseId: dto.assignedNurseId,
          allocatedAt: new Date(),
        },
        include: {
          visit: {
            include: { employee: true },
          },
          bed: true,
          assignedDoctor: true,
          assignedNurse: true,
        },
      });

      this.logger.log(`🏥 Allocated Bed ${bed.bedNumber} to Admission ${id}`);
      return updated;
    });
  }

  /**
   * Log daily observations/treatment notes (Nurse/Ward Staff)
   */
  async addNote(id: string, dto: CreateNoteDto, userId: string) {
    await this.findOne(id);

    const note = await this.prisma.admissionNote.create({
      data: {
        admissionId: id,
        authoredBy: userId,
        note: dto.note,
      },
      include: {
        author: true,
      },
    });

    this.logger.log(`📝 Added note to Admission ${id} by User ${userId}`);
    return note;
  }

  /**
   * Doctor-approved discharge flow (transactional: generates summary and frees bed)
   */
  async discharge(id: string, dto: DischargeDto, userId: string, roleName: string) {
    // Spec §8.1 & FR-ADM-05: Discharge requires explicit doctor approval (or SuperAdmin)
    if (roleName !== 'Doctor' && roleName !== 'SuperAdmin') {
      throw new ForbiddenException(
        `Discharge approval requires the Doctor role. Access denied for role: ${roleName}`,
      );
    }

    const admission = await this.findOne(id);

    return this.prisma.$transaction(async (tx) => {
      // 1. Generate Discharge Summary
      await tx.dischargeSummary.create({
        data: {
          admissionId: id,
          approvedBy: userId,
          summaryText: dto.summaryText,
        },
      });

      // 2. Free the Bed associated with the Admission
      if (admission.bedId) {
        await tx.bed.update({
          where: { id: admission.bedId },
          data: {
            status: BedStatus.AVAILABLE,
            currentAdmissionId: null,
          },
        });
        this.logger.log(`🛌 Freed Bed ${admission.bedId} associated with Admission ${id}`);
      }

      // 3. Mark Admission as DISCHARGED
      const updated = await tx.admission.update({
        where: { id },
        data: {
          status: AdmissionStatus.DISCHARGED,
          dischargedAt: new Date(),
        },
        include: {
          visit: {
            include: { employee: true },
          },
          bed: true,
          assignedDoctor: true,
          assignedNurse: true,
          dischargeSummary: true,
        },
      });

      this.logger.log(`✅ Discharge completed for Admission ${id}`);
      return updated;
    });
  }
}
