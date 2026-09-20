import { Injectable } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';
import { filter } from 'rxjs/operators';

/**
 * A tiny in-process pub/sub for "the OPD queue changed" signals, backing the
 * real-time public waiting-area display (OpdDisplayController's SSE stream).
 *
 * Design notes:
 *  - The event carries ONLY the hospitalId plus a monotonic sequence number.
 *    It is a *trigger*, never the data: every subscriber responds by
 *    re-reading the authoritative queue for its own department from the
 *    database. That is what keeps the display consistent -- a stale, skipped,
 *    duplicated, or mis-ordered token is impossible when the source of truth
 *    is always a fresh DB read ordered by the same rules the Queue Manager
 *    uses, not a diff replayed on the client.
 *  - Publishing is fire-and-forget and never throws, so it can never affect
 *    the queue mutation that triggered it (Call/Skip/No-show/Transfer/... in
 *    the existing Queue Manager flow stay byte-for-byte unchanged).
 *  - Hospital-wide granularity (no departmentId on the event) is deliberate:
 *    a transfer moves a token between two departments, and a single
 *    hospital-scoped signal refreshes both departments' displays with no
 *    special-casing. The fan-out cost is trivial (a handful of TVs per
 *    hospital).
 */
@Injectable()
export class QueueEventsService {
  private readonly changes$ = new Subject<{ hospitalId: string; seq: number }>();
  private seq = 0;

  /** Called after any successful OPD queue mutation (see QueueMutationInterceptor). Never throws. */
  publish(hospitalId: string): void {
    if (!hospitalId) return;
    try {
      this.seq += 1;
      this.changes$.next({ hospitalId, seq: this.seq });
    } catch {
      // A realtime notification must never break the operation that caused it.
    }
  }

  /** Stream of change signals for one hospital only. */
  streamForHospital(hospitalId: string): Observable<{ hospitalId: string; seq: number }> {
    return this.changes$.asObservable().pipe(filter((e) => e.hospitalId === hospitalId));
  }
}
