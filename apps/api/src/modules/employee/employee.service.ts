import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { CreateEmployeeSimpleDto } from './dto/create-employee-simple.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { EmploymentTypeCode } from '@prisma/client';
import {
  parseEmployeeCsv,
  validateRowFields,
  normaliseEmploymentType,
  ParsedEmployeeRow,
  EMPLOYEE_IMPORT_MAX_BYTES,
} from './csv/employee-csv.util';

/** One row of the validation preview (Row | Employee ID | Status | Error). */
export type EmployeeImportRowStatus = 'VALID' | 'INVALID' | 'DUPLICATE_FILE' | 'DUPLICATE_EXISTING';
export interface EmployeeImportPreviewRow {
  rowNum: number;
  employeeId: string;
  status: EmployeeImportRowStatus;
  error: string | null;
  original: ParsedEmployeeRow;
}

@Injectable()
export class EmployeeService {
  constructor(private prisma: PrismaService) {}

  /** Plain-text create used by the Employee Directory screen — resolves
   *  Post/Grade/EmploymentType by name, creating them if they don't exist
   *  yet, then delegates to the same create() path as the ID-based API. */
  async createSimple(dto: CreateEmployeeSimpleDto) {
    const existing = await this.prisma.employee.findUnique({
      where: { employeeId: dto.employeeId },
    });
    if (existing) {
      throw new ConflictException(`Employee with ID ${dto.employeeId} already exists`);
    }

    return this.prisma.$transaction((tx) => this.createSimpleInTx(tx as any, dto));
  }

  /**
   * The single source of truth for creating one employee from human-readable
   * fields (find-or-create Post/Grade/EmploymentType, then create Employee).
   * Extracted so both the single-record createSimple() and the atomic Bulk
   * Import share exactly the same business logic -- no duplication. Runs
   * inside whatever transaction the caller passes.
   */
  private async createSimpleInTx(tx: PrismaService, dto: CreateEmployeeSimpleDto) {
    let post = await tx.post.findUnique({ where: { title: dto.postTitle } });
    if (!post) {
      post = await tx.post.create({ data: { title: dto.postTitle } });
    }

    let grade = await tx.grade.findFirst({ where: { payLevel: dto.gradePayLevel } });
    if (!grade) {
      grade = await tx.grade.create({ data: { payLevel: dto.gradePayLevel, postId: post.id } });
    }

    let employmentType = await tx.employmentType.findUnique({
      where: { code: dto.employmentTypeCode as EmploymentTypeCode },
    });
    if (!employmentType) {
      employmentType = await tx.employmentType.create({
        data: { code: dto.employmentTypeCode as EmploymentTypeCode, name: `${dto.employmentTypeCode} Employee` },
      });
    }

    return tx.employee.create({
      data: {
        employeeId: dto.employeeId,
        name: dto.name,
        department: dto.department,
        postId: post.id,
        gradeId: grade.id,
        employmentTypeId: employmentType.id,
        contactPhone: dto.contactPhone || null,
        contactEmail: dto.contactEmail || null,
      },
      include: { post: true, grade: true, employmentType: true },
    });
  }

  /**
   * Validates an uploaded CSV row-by-row WITHOUT writing anything. Checks
   * (in order, first failure wins per row): structural CSV/header validity
   * (throws), required fields, Employee ID format, employment-type domain,
   * phone/email format, duplicate Employee ID within the file, and Employee
   * ID already present in this hospital's database. Nothing is silently
   * skipped -- every row comes back with a status and, if bad, a reason.
   */
  async validateEmployeeImport(csvText: string): Promise<{
    totalRows: number;
    validRows: number;
    invalidRows: number;
    duplicateRows: number;
    rows: EmployeeImportPreviewRow[];
  }> {
    const { rows } = parseEmployeeCsv(csvText);

    // Existing IDs in THIS tenant (this.prisma is tenant-scoped) -- so we can
    // never see or collide with another hospital's employees.
    const ids = rows.map((r) => r.employeeId).filter(Boolean);
    const existing = await this.prisma.employee.findMany({
      where: { employeeId: { in: ids } },
      select: { employeeId: true },
    });
    const existingSet = new Set(existing.map((e) => e.employeeId.toLowerCase()));

    const seenInFile = new Set<string>();
    const preview: EmployeeImportPreviewRow[] = rows.map((row) => {
      const fieldError = validateRowFields(row);
      if (fieldError) {
        return { rowNum: row.rowNum, employeeId: row.employeeId, status: 'INVALID', error: fieldError, original: row };
      }
      const key = row.employeeId.toLowerCase();
      if (seenInFile.has(key)) {
        return {
          rowNum: row.rowNum,
          employeeId: row.employeeId,
          status: 'DUPLICATE_FILE',
          error: 'Duplicate Employee ID within the CSV',
          original: row,
        };
      }
      seenInFile.add(key);
      if (existingSet.has(key)) {
        return {
          rowNum: row.rowNum,
          employeeId: row.employeeId,
          status: 'DUPLICATE_EXISTING',
          error: 'Employee ID already exists',
          original: row,
        };
      }
      return { rowNum: row.rowNum, employeeId: row.employeeId, status: 'VALID', error: null, original: row };
    });

    return {
      totalRows: preview.length,
      validRows: preview.filter((r) => r.status === 'VALID').length,
      invalidRows: preview.filter((r) => r.status === 'INVALID').length,
      duplicateRows: preview.filter((r) => r.status === 'DUPLICATE_FILE' || r.status === 'DUPLICATE_EXISTING').length,
      rows: preview,
    };
  }

  /**
   * Atomically imports the caller's validated rows. Re-validates every row
   * server-side (client validation is never trusted) and re-checks the DB for
   * duplicates for concurrency safety, then creates all rows inside a SINGLE
   * transaction: either every valid row is imported or none is, so a mid-way
   * failure can't leave a partially-imported dataset. Reuses the exact
   * createSimpleInTx business logic the manual "Add Employee" form uses.
   */
  async confirmEmployeeImport(rowsIn: ParsedEmployeeRow[]): Promise<{
    totalRows: number;
    validRows: number;
    importedSuccessfully: number;
    failedRows: number;
    failures: { rowNum: number; employeeId: string; error: string }[];
  }> {
    if (!Array.isArray(rowsIn) || rowsIn.length === 0) {
      throw new ConflictException('No employee rows were provided for import.');
    }

    const failures: { rowNum: number; employeeId: string; error: string }[] = [];
    const seen = new Set<string>();
    const accepted: ParsedEmployeeRow[] = [];

    // Server-side re-validation: field rules + in-file duplicates.
    for (const row of rowsIn) {
      const fieldError = validateRowFields(row);
      if (fieldError) {
        failures.push({ rowNum: row.rowNum, employeeId: row.employeeId, error: fieldError });
        continue;
      }
      const key = row.employeeId.toLowerCase();
      if (seen.has(key)) {
        failures.push({ rowNum: row.rowNum, employeeId: row.employeeId, error: 'Duplicate Employee ID within the CSV' });
        continue;
      }
      seen.add(key);
      accepted.push(row);
    }

    // DB duplicate re-check (concurrency safety) against this tenant only.
    if (accepted.length > 0) {
      const existing = await this.prisma.employee.findMany({
        where: { employeeId: { in: accepted.map((r) => r.employeeId) } },
        select: { employeeId: true },
      });
      const existingSet = new Set(existing.map((e) => e.employeeId.toLowerCase()));
      for (let i = accepted.length - 1; i >= 0; i--) {
        if (existingSet.has(accepted[i].employeeId.toLowerCase())) {
          failures.push({ rowNum: accepted[i].rowNum, employeeId: accepted[i].employeeId, error: 'Employee ID already exists' });
          accepted.splice(i, 1);
        }
      }
    }

    let imported = 0;
    if (accepted.length > 0) {
      // All-or-nothing: one transaction wraps every insert.
      await this.prisma.$transaction(async (tx) => {
        for (const row of accepted) {
          await this.createSimpleInTx(tx as any, {
            employeeId: row.employeeId,
            name: row.name,
            department: row.department,
            postTitle: row.postTitle,
            gradePayLevel: row.gradePayLevel,
            employmentTypeCode: normaliseEmploymentType(row.employmentTypeRaw)!,
            contactPhone: row.contactPhone || undefined,
            contactEmail: row.contactEmail || undefined,
          });
          imported++;
        }
      });
    }

    return {
      totalRows: rowsIn.length,
      validRows: accepted.length,
      importedSuccessfully: imported,
      failedRows: failures.length,
      failures,
    };
  }

  /** Guard used by the controller before base64-decoding an upload. */
  assertImportSizeOk(byteLength: number): void {
    if (byteLength > EMPLOYEE_IMPORT_MAX_BYTES) {
      throw new ConflictException(
        `Uploaded file is too large (${byteLength} bytes). Maximum is ${EMPLOYEE_IMPORT_MAX_BYTES} bytes.`,
      );
    }
  }

  async create(createEmployeeDto: CreateEmployeeDto) {
    const existing = await this.prisma.employee.findUnique({
      where: { employeeId: createEmployeeDto.employeeId },
    });

    if (existing) {
      throw new ConflictException(
        `Employee with ID ${createEmployeeDto.employeeId} already exists`,
      );
    }

    return this.prisma.employee.create({
      data: createEmployeeDto,
      include: {
        post: true,
        grade: true,
        employmentType: true,
      },
    });
  }

  async findAll() {
    return this.prisma.employee.findMany({
      include: {
        post: true,
        grade: true,
        employmentType: true,
        hospitalUid: true,
      },
    });
  }

  /** Distinct Post titles and Grade pay levels already on file, for the
   *  Employee Directory's Add Employee form to offer as autocomplete
   *  suggestions instead of free-typing near-duplicates like "Clerk" /
   *  "clerk" / "Clerk " into separate Post records. */
  async getPostGradeOptions() {
    const [posts, grades] = await Promise.all([
      this.prisma.post.findMany({ select: { title: true }, orderBy: { title: 'asc' } }),
      this.prisma.grade.findMany({ select: { payLevel: true }, distinct: ['payLevel'], orderBy: { payLevel: 'asc' } }),
    ]);
    return {
      posts: posts.map((p) => p.title),
      grades: grades.map((g) => g.payLevel),
    };
  }

  async findOne(id: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      include: {
        post: true,
        grade: true,
        employmentType: true,
        hospitalUid: true,
        patientProfile: true,
      },
    });

    if (!employee) {
      throw new NotFoundException(`Employee with ID ${id} not found`);
    }

    return employee;
  }

  async update(id: string, updateDto: UpdateEmployeeDto) {
    await this.findOne(id);

    // Explicit allowlist, not `data: updateDto` -- defense in depth on top
    // of the real DTO class + global ValidationPipe (whitelist,
    // forbidNonWhitelisted) that already validates this body, matching the
    // pattern used in doctor.service.ts/staff.service.ts.
    return this.prisma.employee.update({
      where: { id },
      data: {
        name: updateDto.name,
        department: updateDto.department,
        postId: updateDto.postId,
        gradeId: updateDto.gradeId,
        employmentTypeId: updateDto.employmentTypeId,
        contactPhone: updateDto.contactPhone,
        contactEmail: updateDto.contactEmail,
      },
      include: {
        post: true,
        grade: true,
        employmentType: true,
      },
    });
  }
}
