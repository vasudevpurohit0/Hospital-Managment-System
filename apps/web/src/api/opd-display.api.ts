import { apiFetch, getStoredToken, getActiveHospitalHeader, BASE_URL } from './client';

export interface DisplayNowServing {
  token: string;
  status: 'CALLED' | 'IN_CONSULTATION';
  doctorName: string | null;
  room: string | null;
}

export interface DisplayWaiting {
  token: string;
  position: number;
}

export interface DisplayDepartment {
  id: string;
  name: string;
  code: string;
  nowServing: DisplayNowServing[];
  waiting: DisplayWaiting[];
  waitingCount: number;
}

export interface HospitalSnapshot {
  departments: DisplayDepartment[];
  generatedAt: string;
}

/** One-shot authoritative snapshot of every active department (initial paint / reconnect re-sync). */
export async function fetchDisplaySnapshot(): Promise<HospitalSnapshot> {
  const res = await apiFetch('/api/opd-display/queue');
  if (!res.ok) throw new Error('Failed to load queue snapshot');
  return res.json();
}

export type DisplayStreamEvent =
  | { type: 'snapshot'; snapshot: HospitalSnapshot }
  | { type: 'ping' }
  | { type: 'error'; message: string };

export interface DisplayStreamHandle {
  close: () => void;
}

/**
 * Subscribes to the real-time, hospital-wide OPD display stream over SSE.
 *
 * Why a fetch-based reader rather than the browser's EventSource: EventSource
 * cannot attach the Authorization (Bearer) header this API requires, and we
 * must never move auth into a query string. fetch() streams the same SSE body
 * with proper headers, and gives us explicit control over reconnection.
 *
 * Reliability contract honoured here:
 *  - onStatus('connected'|'reconnecting') lets the UI show link health.
 *  - On any drop/error it auto-reconnects with capped backoff.
 *  - Each (re)connection's first server event is a fresh authoritative
 *    snapshot, so we never replay stale state; we simply render whatever the
 *    server most recently sent. Ordering is the server's, not ours.
 */
export function openDisplayStream(handlers: {
  onEvent: (event: DisplayStreamEvent) => void;
  onStatus: (status: 'connecting' | 'connected' | 'reconnecting') => void;
}): DisplayStreamHandle {
  let closed = false;
  let controller: AbortController | null = null;
  let retryDelay = 1000;
  const MAX_DELAY = 15000;

  const token = () => getStoredToken();

  async function connect() {
    if (closed) return;
    handlers.onStatus(retryDelay === 1000 ? 'connecting' : 'reconnecting');
    controller = new AbortController();

    const headers: Record<string, string> = { Accept: 'text/event-stream' };
    const t = token();
    if (t) headers['Authorization'] = `Bearer ${t}`;
    const hospitalId = getActiveHospitalHeader();
    if (hospitalId) headers['X-Hospital-Id'] = hospitalId;

    const path = '/api/opd-display/stream';

    try {
      // Prefer the configured API origin; fall back to the dev proxy path.
      let res: Response;
      try {
        res = await fetch(`${BASE_URL}${path}`, { headers, signal: controller.signal });
      } catch {
        res = await fetch(path, { headers, signal: controller.signal });
      }

      if (!res.ok || !res.body) {
        throw new Error(`stream failed: ${res.status}`);
      }

      handlers.onStatus('connected');
      retryDelay = 1000; // reset backoff on a clean connect

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // Parse the SSE wire format: events are separated by a blank line, each
      // carrying one or more `data:` lines we concatenate then JSON.parse.
      while (!closed) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sepIndex: number;
        while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
          const rawEvent = buffer.slice(0, sepIndex);
          buffer = buffer.slice(sepIndex + 2);
          const dataLines = rawEvent
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trim());
          if (dataLines.length === 0) continue;
          try {
            const parsed = JSON.parse(dataLines.join('\n'));
            if (parsed?.type === 'snapshot') {
              handlers.onEvent({ type: 'snapshot', snapshot: parsed as HospitalSnapshot });
            } else if (parsed?.type === 'ping') {
              handlers.onEvent({ type: 'ping' });
            } else if (parsed?.type === 'error') {
              handlers.onEvent({ type: 'error', message: parsed.message || 'stream_error' });
            }
          } catch {
            // Ignore an unparseable frame rather than tearing down the stream.
          }
        }
      }
      // Stream ended (server closed) -> fall through to reconnect.
      throw new Error('stream ended');
    } catch (err) {
      if (closed) return;
      handlers.onStatus('reconnecting');
      const delay = retryDelay;
      retryDelay = Math.min(retryDelay * 2, MAX_DELAY);
      setTimeout(connect, delay);
    }
  }

  connect();

  return {
    close: () => {
      closed = true;
      controller?.abort();
    },
  };
}
