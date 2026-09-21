import { Injectable } from '@nestjs/common';
import { OpdService } from './opd.service';
import { DepartmentService } from './department.service';

/**
 * Read-only, PII-stripped view of the existing OPD queue for the public
 * waiting-area display. It does NOT run its own queue: it calls the exact
 * same OpdService reads the Queue Manager uses, then projects them down
 * to only what a TV in a public area may show -- token, status, doctor name,
 * consultation room. Patient name, mobile, address, diagnosis, and every
 * other identifier are deliberately dropped here, at the source, so they can
 * never reach the wire.
 */
export interface OpdDisplayEntry {
  token: string;
  status: 'CALLED' | 'IN_CONSULTATION';
  doctorName: string | null;
  room: string | null;
}

export interface OpdDisplayWaiting {
  token: string;
  position: number;
}

export interface OpdDisplayDepartment {
  id: string;
  name: string;
  code: string;
  nowServing: OpdDisplayEntry[];
  waiting: OpdDisplayWaiting[];
  waitingCount: number;
}

export interface OpdHospitalSnapshot {
  departments: OpdDisplayDepartment[];
  /** Monotonic per-response stamp so a client can ignore any out-of-order snapshot after a reconnect. */
  generatedAt: string;
}

@Injectable()
export class OpdDisplayService {
  constructor(
    private readonly opdService: OpdService,
    private readonly departmentService: DepartmentService,
  ) {}

  /**
   * Hospital-wide snapshot: every active department, each with its own
   * current-serving and waiting buckets. One DB read for every department's
   * active visits (OpdService.getHospitalQueue), not one read per department
   * -- avoids an N+1 query as the department count grows.
   *
   * A department with zero active visits still appears (sourced from the
   * department list, not from the visit rows), so the display can show
   * "no patient currently being called" / "no patients waiting" for it
   * rather than hiding it.
   */
  async getHospitalSnapshot(): Promise<OpdHospitalSnapshot> {
    const [departments, rows] = await Promise.all([
      this.departmentService.findAll(),
      this.opdService.getHospitalQueue({ id: 'opd-display', roleName: 'OPDDisplayOperator' }),
    ]);

    const byDept = new Map<string, OpdDisplayDepartment>(
      departments.map((d) => [
        d.id,
        { id: d.id, name: d.name, code: d.code, nowServing: [], waiting: [], waitingCount: 0 },
      ]),
    );

    for (const row of rows as any[]) {
      const entry = byDept.get(row.departmentId);
      if (!entry) continue; // row belongs to a department that's since been deactivated
      const token = row.tokenNumber as string;
      if (row.status === 'CALLED' || row.status === 'IN_CONSULTATION') {
        entry.nowServing.push({
          token,
          status: row.status,
          doctorName: row.doctor?.employee?.name ?? null,
          room: row.doctor?.employee?.consultationRoom ?? null,
        });
      } else if (row.status === 'WAITING') {
        entry.waiting.push({ token, position: row.queuePosition ?? entry.waiting.length + 1 });
        entry.waitingCount += 1;
      }
    }

    return {
      departments: Array.from(byDept.values()),
      generatedAt: new Date().toISOString(),
    };
  }
}
