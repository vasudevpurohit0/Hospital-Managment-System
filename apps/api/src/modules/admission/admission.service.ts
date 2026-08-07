import {
  Injectable,
  OnModuleInit,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
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
   * Find available beds across all hospital wards, sorting category-eligible beds first
   */
  async findAvailableBeds(id: string) {
    let admission = await this.findOne(id);

    if (admission.status === AdmissionStatus.REQUESTED) {
      await this.resolveEligibility(id);
      admission = await this.findOne(id);
    }

    const category = admission.eligibleCategory;

    const allBeds = await this.prisma.bed.findMany({
      where: {
        status: BedStatus.AVAILABLE,
        currentAdmissionId: null,
      },
      include: {
        room: {
          include: {
            ward: true,
          },
        },
      },
      orderBy: { bedNumber: 'asc' },
    });

    // Recommended category beds prioritized first, then all remaining available hospital beds
    const recommended = allBeds.filter((b) => b.room?.ward?.category === category);
    const others = allBeds.filter((b) => b.room?.ward?.category !== category);

    return [...recommended, ...others];
  }

  /**
   * Fetch all Wards, Rooms, and Beds for Ward Management
   */
  async findAllWards() {
    return this.prisma.ward.findMany({
      include: {
        rooms: {
          include: {
            beds: {
              include: {
                currentAdmission: {
                  include: {
                    visit: {
                      include: {
                        employee: true,
                      },
                    },
                  },
                },
              },
              orderBy: { bedNumber: 'asc' },
            },
          },
          orderBy: { roomNumber: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Create a new Ward, Room, and Bed dynamically (supports single or multiple beds)
   */
  async createWardAndBed(dto: {
    wardId?: string;
    wardName?: string;
    wardCategory?: string;
    roomNumber: string;
    bedNumber?: string;
    bedNumbers?: string[];
    count?: number;
  }) {
    return this.prisma.$transaction(async (tx) => {
      let ward;
      if (dto.wardId) {
        ward = await tx.ward.findUnique({ where: { id: dto.wardId } });
        if (!ward) throw new NotFoundException(`Ward not found with ID ${dto.wardId}`);
      } else if (dto.wardName) {
        ward = await tx.ward.findFirst({
          where: { name: { equals: dto.wardName, mode: 'insensitive' } },
        });

        if (!ward) {
          ward = await tx.ward.create({
            data: {
              name: dto.wardName,
              category: (dto.wardCategory || 'C') as any,
            },
          });
        }
      } else {
        throw new BadRequestException('Either wardId or wardName must be provided.');
      }

      let room = await tx.room.findFirst({
        where: { wardId: ward.id, roomNumber: dto.roomNumber },
      });

      if (!room) {
        room = await tx.room.create({
          data: {
            wardId: ward.id,
            roomNumber: dto.roomNumber,
            type: 'GENERAL',
          },
        });
      }

      // Determine list of bed numbers to create
      let targets: string[] = [];
      if (dto.bedNumbers && dto.bedNumbers.length > 0) {
        targets = dto.bedNumbers.map((b) => b.trim()).filter(Boolean);
      } else if (dto.bedNumber && dto.bedNumber.trim()) {
        // Support comma-separated strings
        targets = dto.bedNumber.split(',').map((b) => b.trim()).filter(Boolean);
      } else if (dto.count && dto.count > 0) {
        for (let i = 1; i <= dto.count; i++) {
          targets.push(`Bed ${dto.roomNumber}-${i}`);
        }
      } else {
        targets = ['B-1'];
      }

      const createdBeds = [];
      for (const num of targets) {
        const existing = await tx.bed.findFirst({
          where: { roomId: room.id, bedNumber: num },
        });
        if (!existing) {
          const bed = await tx.bed.create({
            data: {
              roomId: room.id,
              bedNumber: num,
              status: BedStatus.AVAILABLE,
            },
          });
          createdBeds.push(bed);
        }
      }

      return {
        ward,
        room,
        createdBeds,
        count: createdBeds.length,
      };
    });
  }

  /**
   * Delete Ward and all its un-occupied rooms and beds
   */
  async deleteWard(wardId: string) {
    const ward = await this.prisma.ward.findUnique({
      where: { id: wardId },
      include: {
        rooms: {
          include: { beds: true },
        },
      },
    });

    if (!ward) throw new NotFoundException(`Ward not found: ${wardId}`);

    const occupied = ward.rooms.some((r) =>
      r.beds.some((b) => b.status === BedStatus.OCCUPIED || b.currentAdmissionId !== null),
    );

    if (occupied) {
      throw new BadRequestException('Cannot delete Ward: it contains patients in occupied beds.');
    }

    const bedIds = ward.rooms.flatMap((r) => r.beds.map((b) => b.id));
    const roomIds = ward.rooms.map((r) => r.id);

    return this.prisma.$transaction(async (tx) => {
      if (bedIds.length > 0) {
        // Disassociate historical admissions pointing to these beds
        await tx.admission.updateMany({
          where: { bedId: { in: bedIds } },
          data: { bedId: null, roomId: null, wardId: null },
        });
        await tx.bed.deleteMany({ where: { id: { in: bedIds } } });
      }
      if (roomIds.length > 0) {
        await tx.room.deleteMany({ where: { id: { in: roomIds } } });
      }
      return tx.ward.delete({ where: { id: wardId } });
    });
  }

  /**
   * Delete single Bed (if not occupied)
   */
  async deleteBed(bedId: string) {
    const bed = await this.prisma.bed.findUnique({ where: { id: bedId } });
    if (!bed) throw new NotFoundException(`Bed not found: ${bedId}`);

    if (bed.status === BedStatus.OCCUPIED || bed.currentAdmissionId !== null) {
      throw new BadRequestException(`Cannot delete Bed ${bed.bedNumber}: currently occupied.`);
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.admission.updateMany({
        where: { bedId },
        data: { bedId: null },
      });
      return tx.bed.delete({ where: { id: bedId } });
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

      if (bed.currentAdmissionId !== null && bed.currentAdmissionId !== id) {
        throw new ConflictException(
          `Bed ${bed.bedNumber} is already occupied by another patient`,
        );
      }

      if (bed.status !== BedStatus.AVAILABLE && bed.currentAdmissionId !== id) {
        throw new ConflictException(
          `Bed ${bed.bedNumber} is already occupied or under maintenance`,
        );
      }

      // 1a. Release any previous bed assigned to this admission to prevent unique constraint failure
      await tx.bed.updateMany({
        where: {
          currentAdmissionId: id,
          id: { not: dto.bedId },
        },
        data: {
          status: BedStatus.AVAILABLE,
          currentAdmissionId: null,
        },
      });

      // 2. Perform optimistic update on Bed to block concurrent duplicate requests
      const updateCount = await tx.bed.updateMany({
        where: {
          id: dto.bedId,
          OR: [
            { currentAdmissionId: null },
            { currentAdmissionId: id },
          ],
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
    // Spec §8.1 & FR-ADM-05: Doctor, Administrator, or SuperAdmin role can approve discharge
    if (roleName !== 'Doctor' && roleName !== 'SuperAdmin' && roleName !== 'Administrator') {
      throw new ForbiddenException(
        `Discharge approval requires the Doctor or Administrator role. Access denied for role: ${roleName}`,
      );
    }

    const admission = await this.findOne(id);

    return this.prisma.$transaction(async (tx) => {
      // 1. Generate / Update Discharge Summary
      await tx.dischargeSummary.upsert({
        where: { admissionId: id },
        update: {
          approvedBy: userId,
          summaryText: dto.summaryText,
        },
        create: {
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
