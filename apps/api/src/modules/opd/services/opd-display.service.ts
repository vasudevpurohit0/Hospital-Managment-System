import { Injectable } from '@nestjs/common';
import { OpdService } from './opd.service';
import { DepartmentService } from './department.service';

/**
 * Read-only, PII-stripped view of the existing OPD queue for the public
 * waiting-area display. It does NOT run its own queue: it calls the exact
 * same OpdService.getQueue() the Queue Manager reads, then projects it down
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

export interface OpdDisplaySnapshot {
  department: { id: string; name: string; code: string } | null;
  nowServing: OpdDisplayEntry[];
  waiting: OpdDisplayWaiting[];
  waitingCount: number;
  /** Monotonic per-response stamp so a client can ignore any out-of-order snapshot after a reconnect. */
  generatedAt: string;
}

@Injectable()
export class OpdDisplayService {
  constructor(
    private readonly opdService: OpdService,
    private readonly departmentService: DepartmentService,
  ) {}

  /** Active departments, for the display's department picker. */
  async listDepartments() {
    const departments = await this.departmentService.findAll();
    return departments.map((d) => ({ id: d.id, name: d.name, code: d.code }));
  }

  async getSnapshot(departmentId: string): Promise<OpdDisplaySnapshot> {
    // Reuse the authoritative queue read. The OPDDisplayOperator role is not a
    // Doctor, so getQueue's "doctors must use their own queue" guard doesn't
    // apply; it returns the same records the Queue Manager screen shows.
    const rows = await this.opdService.getQueue(departmentId, undefined, {
      id: 'opd-display',
      roleName: 'OPDDisplayOperator',
    });

    const dept =
      (rows[0] as any)?.department ??
      (await this.departmentService.findById(departmentId).catch(() => null));

    const nowServing: OpdDisplayEntry[] = [];
    const waiting: OpdDisplayWaiting[] = [];

    for (const row of rows as any[]) {
      const token = row.tokenNumber as string;
      if (row.status === 'CALLED' || row.status === 'IN_CONSULTATION') {
        nowServing.push({
          token,
          status: row.status,
          doctorName: row.doctor?.employee?.name ?? null,
          room: row.doctor?.employee?.consultationRoom ?? null,
        });
      } else if (row.status === 'WAITING') {
        waiting.push({ token, position: row.queuePosition ?? waiting.length + 1 });
      }
    }

    return {
      department: dept ? { id: dept.id, name: dept.name, code: dept.code } : null,
      nowServing,
      waiting,
      waitingCount: waiting.length,
      generatedAt: new Date().toISOString(),
    };
  }
}
