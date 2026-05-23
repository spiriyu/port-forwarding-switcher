import type {
  HealthResponse,
  ListMappingsResponse,
  MappingResponse,
  CreateMappingRequest,
  PatchMappingRequest,
} from '@portswitch/shared';

const BASE = '/api/v1';
const WS_RETRY_MS = 5_000;

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } })) as { error: { message: string } };
    throw new Error(err.error?.message ?? res.statusText);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

export const apiClient = {
  daemon: {
    health: () => req<HealthResponse>('GET', '/health'),
  },
  mappings: {
    list: () => req<ListMappingsResponse>('GET', '/mappings'),
    create: (r: CreateMappingRequest) => req<MappingResponse>('POST', '/mappings', r),
    patch: (id: string, r: PatchMappingRequest) => req<MappingResponse>('PATCH', `/mappings/${id}`, r),
    delete: (id: string) => req<void>('DELETE', `/mappings/${id}`),
    toggle: (id: string) => req<MappingResponse>('POST', `/mappings/${id}/toggle`),
  },
  events: {
    subscribe(cb: (event: unknown) => void): () => void {
      let ws: WebSocket | null = null;
      let stopped = false;
      let retryTimer: ReturnType<typeof setTimeout> | null = null;

      function connect(): void {
        if (stopped) return;
        ws = new WebSocket(`ws://${location.host}/api/v1/events`);
        ws.onmessage = (e) => {
          try { cb(JSON.parse(e.data as string)); } catch { /* ignore malformed frames */ }
        };
        ws.onclose = () => {
          ws = null;
          if (!stopped) retryTimer = setTimeout(connect, WS_RETRY_MS);
        };
      }

      connect();
      return () => {
        stopped = true;
        if (retryTimer) clearTimeout(retryTimer);
        ws?.close();
      };
    },
  },
};
