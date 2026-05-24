import { WebSocket } from 'ws';
import { ServerMessage, ClientMessage, LogSubscribePayload, MappingResponse, GroupResponse, LogEntry, LogLevel, LogCategory, LogSubscribePayloadSchema } from '@portswitch/shared';

const LOG_DROP_BUFFER = 500;
const LOG_DROP_BYTES = 256 * 1024;

interface ClientState {
  logFilter: LogSubscribePayload | null;
  pendingDrops: number;
  logBuffer: LogEntry[];
}

function matchesFilter(entry: LogEntry, filter: LogSubscribePayload): boolean {
  if (filter.mappingIds && filter.mappingIds.length > 0) {
    if (!entry.mappingId || !filter.mappingIds.includes(entry.mappingId)) return false;
  }
  if (filter.levels && filter.levels.length > 0) {
    if (!filter.levels.includes(entry.level)) return false;
  }
  if (filter.categories && filter.categories.length > 0) {
    if (!filter.categories.includes(entry.category as LogCategory)) return false;
  }
  return true;
}

export class EventBus {
  private clients = new Map<WebSocket, ClientState>();
  private version: string;

  constructor(version: string) {
    this.version = version;
  }

  addClient(ws: WebSocket, snapshotMappings: MappingResponse[], snapshotGroups: GroupResponse[]): void {
    this.clients.set(ws, { logFilter: null, pendingDrops: 0, logBuffer: [] });

    this.send(ws, {
      type: 'hello',
      payload: { serverVersion: this.version, snapshot: { mappings: snapshotMappings, groups: snapshotGroups } },
    });

    ws.on('message', (data) => this.handleMessage(ws, data.toString()));
    ws.on('close', () => this.clients.delete(ws));
    ws.on('error', () => this.clients.delete(ws));
    ws.on('drain', () => this.drainLogBuffer(ws));
  }

  broadcast(event: ServerMessage): void {
    const json = JSON.stringify(event);
    for (const [ws] of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(json);
      }
    }
  }

  broadcastLog(entry: LogEntry): void {
    for (const [ws, state] of this.clients) {
      if (!state.logFilter) continue;
      if (ws.readyState !== WebSocket.OPEN) continue;
      if (!matchesFilter(entry, state.logFilter)) continue;

      const socketLen = (ws as unknown as { _socket?: { writableLength?: number } })
        ._socket?.writableLength ?? 0;

      if (socketLen > LOG_DROP_BYTES || state.logBuffer.length > 0) {
        if (state.logBuffer.length < LOG_DROP_BUFFER) {
          state.logBuffer.push(entry);
        } else {
          state.pendingDrops++;
        }
      } else {
        if (state.pendingDrops > 0) {
          this.send(ws, { type: 'log.dropped', payload: { count: state.pendingDrops } });
          state.pendingDrops = 0;
        }
        this.send(ws, { type: 'log', payload: { entry } });
      }
    }
  }

  clientCount(): number {
    return this.clients.size;
  }

  private drainLogBuffer(ws: WebSocket): void {
    const state = this.clients.get(ws);
    if (!state || state.logBuffer.length === 0) return;

    if (state.pendingDrops > 0) {
      this.send(ws, { type: 'log.dropped', payload: { count: state.pendingDrops } });
      state.pendingDrops = 0;
    }

    while (state.logBuffer.length > 0 && ws.readyState === WebSocket.OPEN) {
      const entry = state.logBuffer.shift();
      if (entry && state.logFilter && matchesFilter(entry, state.logFilter)) {
        this.send(ws, { type: 'log', payload: { entry } });
      }
    }
  }

  private send(ws: WebSocket, event: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  }

  private handleMessage(ws: WebSocket, raw: string): void {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      return;
    }

    if (msg.type === 'ping') {
      this.send(ws, { type: 'pong' });
    } else if (msg.type === 'log.subscribe') {
      const state = this.clients.get(ws);
      if (state) {
        const parsed = LogSubscribePayloadSchema.safeParse(msg.payload);
        if (parsed.success) {
          state.logFilter = parsed.data;
          state.logBuffer = [];
          state.pendingDrops = 0;
        }
      }
    } else if (msg.type === 'log.unsubscribe') {
      const state = this.clients.get(ws);
      if (state) {
        state.logFilter = null;
        state.logBuffer = [];
        state.pendingDrops = 0;
      }
    }
  }
}

export type { LogEntry, LogLevel, LogCategory };
