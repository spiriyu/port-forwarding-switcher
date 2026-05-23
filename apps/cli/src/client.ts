import {
  ErrorCode,
  DEFAULT_DAEMON_PORT,
  type ApiErrorBody,
  type MappingResponse,
  type ListMappingsResponse,
  type CreateMappingRequest,
  type PatchMappingRequest,
  type HealthResponse,
  type DiagnosticsResponse,
  type LogEntry,
} from '@portswitch/shared';

export const DEFAULT_URL = `http://127.0.0.1:${DEFAULT_DAEMON_PORT}/api`;

export class DaemonUnreachableError extends Error {
  constructor(cause?: unknown) {
    super(cause instanceof Error ? cause.message : 'Cannot reach daemon');
    this.name = 'DaemonUnreachableError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class DaemonApiError extends Error {
  readonly statusCode: number;
  readonly body: ApiErrorBody;

  constructor(statusCode: number, body: ApiErrorBody) {
    super(body.message);
    this.name = 'DaemonApiError';
    this.statusCode = statusCode;
    this.body = body;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class DaemonClient {
  readonly baseUrl: string;
  readonly wsUrl: string;

  constructor(httpUrl: string = DEFAULT_URL) {
    this.baseUrl = httpUrl.replace(/\/$/, '');
    // Derive WS URL: strip /api path, use ws scheme, append /api/v1/events
    const parsed = new URL(this.baseUrl);
    this.wsUrl = `ws://${parsed.host}/api/v1/events`;
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new DaemonUnreachableError(err);
    }
    if (!res.ok) {
      let errBody: ApiErrorBody;
      try {
        const j = (await res.json()) as { error: ApiErrorBody };
        errBody = j.error;
      } catch {
        errBody = { code: ErrorCode.INTERNAL, message: res.statusText };
      }
      throw new DaemonApiError(res.status, errBody);
    }
    if (res.status === 204) return undefined as unknown as T;
    return res.json() as Promise<T>;
  }

  listMappings() { return this.req<ListMappingsResponse>('GET', '/v1/mappings'); }
  getMapping(id: string) { return this.req<MappingResponse>('GET', `/v1/mappings/${id}`); }
  createMapping(req: CreateMappingRequest) { return this.req<MappingResponse>('POST', '/v1/mappings', req); }
  patchMapping(id: string, req: PatchMappingRequest) { return this.req<MappingResponse>('PATCH', `/v1/mappings/${id}`, req); }
  deleteMapping(id: string) { return this.req<void>('DELETE', `/v1/mappings/${id}`); }
  toggleMapping(id: string) { return this.req<MappingResponse>('POST', `/v1/mappings/${id}/toggle`); }
  health() { return this.req<HealthResponse>('GET', '/v1/health'); }
  diagnostics() { return this.req<DiagnosticsResponse>('GET', '/v1/diagnostics'); }

  logs(params?: { from?: string; limit?: number; mappingId?: string }) {
    const qs = new URLSearchParams();
    if (params?.from) qs.set('from', params.from);
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    if (params?.mappingId) qs.set('mappingId', params.mappingId);
    const q = qs.toString();
    return this.req<{ entries: LogEntry[] }>('GET', `/v1/logs${q ? '?' + q : ''}`);
  }
}
