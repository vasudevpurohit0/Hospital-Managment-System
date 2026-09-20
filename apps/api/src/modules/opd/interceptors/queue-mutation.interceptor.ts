import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { QueueEventsService } from '../services/queue-events.service';
import { hasTenantContext, getTenantContext } from '../../../common/tenant/tenant-context';

/**
 * Emits a "queue changed" signal after any successful *mutating* request on
 * OpdController, so the public display (SSE) updates the instant a Queue
 * Manager or Doctor calls/skips/transfers/etc. a patient.
 *
 * This is purely additive: it observes the response and fires an event; it
 * changes no request/response and can never fail the underlying action
 * (publish() swallows its own errors). GET requests are ignored -- reads
 * don't change queue state.
 */
@Injectable()
export class QueueMutationInterceptor implements NestInterceptor {
  constructor(private readonly queueEvents: QueueEventsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const isMutation = req?.method && req.method !== 'GET';

    if (!isMutation) {
      return next.handle();
    }

    // Capture the hospital now, while the request's tenant context is still
    // on the async stack -- the tap() below also runs within it, but reading
    // it here keeps the intent explicit and avoids any surprise.
    const hospitalId = hasTenantContext() ? getTenantContext().hospitalId : '';

    return next.handle().pipe(
      tap({
        next: () => {
          if (hospitalId) this.queueEvents.publish(hospitalId);
        },
        // On error we deliberately publish nothing: the mutation didn't
        // commit, so the authoritative queue state hasn't changed.
      }),
    );
  }
}
