import { Controller, Get, MessageEvent, Sse } from '@nestjs/common';
import { Observable, merge, of, from, interval } from 'rxjs';
import { switchMap, map, catchError } from 'rxjs/operators';
import { OpdDisplayService } from '../services/opd-display.service';
import { QueueEventsService } from '../services/queue-events.service';
import { RequirePermission } from '../../../common/decorators/permissions.decorator';
import { getTenantContext, runWithTenant, TenantContext } from '../../../common/tenant/tenant-context';

/**
 * Read-only endpoints for the hospital-wide public OPD waiting-area display.
 * Every route is gated on OPDVisit:read -- the single permission the
 * OPDDisplayOperator role holds -- so this account can never call, skip,
 * transfer, cancel, or edit anything: the backend, not just a hidden button,
 * enforces read-only.
 *
 * The display consumes the SAME queue data as the Queue Manager (via
 * OpdDisplayService -> OpdService.getHospitalQueue), never a separate queue,
 * and it always shows every active department at once -- there is no
 * per-department view here any more (that remains the Queue Manager's job,
 * see OpdController's departmentId-scoped /opd-visits/queue).
 */
@Controller('opd-display')
export class OpdDisplayController {
  constructor(
    private readonly displayService: OpdDisplayService,
    private readonly queueEvents: QueueEventsService,
  ) {}

  /**
   * One-shot authoritative snapshot of every active department's queue. Used
   * for the initial paint and, crucially, after a reconnect -- the client
   * always re-syncs to real backend state rather than trusting anything it
   * held while disconnected.
   */
  @Get('queue')
  @RequirePermission('OPDVisit', 'read')
  async queue() {
    return this.displayService.getHospitalSnapshot();
  }

  /**
   * Real-time stream of authoritative hospital-wide snapshots, over SSE.
   *
   * Update path: a Queue Manager/Doctor mutation in ANY department ->
   * QueueMutationInterceptor publishes a hospital-scoped "changed" signal ->
   * this stream (filtered to the viewer's own hospital) re-reads the
   * authoritative queue for every department and pushes a fresh,
   * PII-stripped snapshot -> the TV renders it. No polling; the delay is one
   * DB read.
   *
   * Consistency & races: every push is a full snapshot from a fresh DB read
   * ordered by the queue's own rules, so it can't show a stale/duplicate/
   * mis-ordered token. switchMap means if two mutations land in quick
   * succession, an in-flight recompute is abandoned in favour of the newest,
   * so the last snapshot the TV receives always reflects the latest state.
   *
   * Reconnection: SSE reconnects re-invoke this handler, which re-captures
   * the tenant context and immediately emits a fresh snapshot (the `of(null)`
   * seed) -- no stale replay. A 15s heartbeat lets the client notice a dead
   * link quickly and show a "reconnecting" state.
   */
  @Sse('stream')
  @RequirePermission('OPDVisit', 'read')
  stream(): Observable<MessageEvent> {
    // Captured now, while the request's tenant context is on the async stack;
    // reused for every later recompute (the stream outlives this call).
    const ctx: TenantContext = getTenantContext();

    const snapshots$ = merge(of(null), this.queueEvents.streamForHospital(ctx.hospitalId)).pipe(
      switchMap(() =>
        from(runWithTenant(ctx, () => this.displayService.getHospitalSnapshot())).pipe(
          map((snapshot): MessageEvent => ({ data: { type: 'snapshot', ...snapshot } })),
          catchError(() => of<MessageEvent>({ data: { type: 'error', message: 'snapshot_failed' } })),
        ),
      ),
    );

    const heartbeat$: Observable<MessageEvent> = interval(15000).pipe(
      map(() => ({ data: { type: 'ping', at: new Date().toISOString() } })),
    );

    return merge(snapshots$, heartbeat$);
  }
}
