import * as net from 'net';
import { EventEmitter } from 'events';

export interface ForwarderOptions {
  sourceHost?: string;
  sourcePort: number;
  targetHost: string;
  targetPort: number;
  drainTimeoutMs?: number;
}

export interface ForwarderStats {
  openConnections: number;
  totalConnections: number;
  bytesIn: number;
  bytesOut: number;
}

export interface ForwarderHandle {
  start(): Promise<void>;
  stop(): Promise<void>;
  stats(): ForwarderStats;
  readonly boundPort: number;
  readonly events: EventEmitter;
}

export type ForwarderEvent =
  | { type: 'connection'; id: number }
  | { type: 'connection.closed'; id: number }
  | { type: 'error'; err: Error };

export function createForwarder(opts: ForwarderOptions): ForwarderHandle {
  const {
    sourceHost = '127.0.0.1',
    sourcePort,
    targetHost,
    targetPort,
    drainTimeoutMs = 5000,
  } = opts;

  const emitter = new EventEmitter();
  const activeSockets = new Set<net.Socket>();
  let connSeq = 0;
  let statsData: ForwarderStats = {
    openConnections: 0,
    totalConnections: 0,
    bytesIn: 0,
    bytesOut: 0,
  };

  let server: net.Server | null = null;
  let stopping = false;
  let drainResolve: (() => void) | null = null;

  function pipeConnection(client: net.Socket): void {
    const id = ++connSeq;
    statsData = {
      ...statsData,
      openConnections: statsData.openConnections + 1,
      totalConnections: statsData.totalConnections + 1,
    };
    emitter.emit('event', { type: 'connection', id } satisfies ForwarderEvent);

    const target = net.createConnection({ host: targetHost, port: targetPort });

    activeSockets.add(client);
    activeSockets.add(target);

    client.on('data', (chunk: Buffer) => {
      statsData = { ...statsData, bytesIn: statsData.bytesIn + chunk.length };
      if (!target.write(chunk)) {
        client.pause();
      }
    });

    target.on('data', (chunk: Buffer) => {
      statsData = { ...statsData, bytesOut: statsData.bytesOut + chunk.length };
      if (!client.write(chunk)) {
        target.pause();
      }
    });

    target.on('drain', () => { client.resume(); });
    client.on('drain', () => { target.resume(); });

    function cleanup(): void {
      if (!activeSockets.has(client)) return;
      activeSockets.delete(client);
      activeSockets.delete(target);
      statsData = { ...statsData, openConnections: statsData.openConnections - 1 };
      emitter.emit('event', { type: 'connection.closed', id } satisfies ForwarderEvent);

      if (stopping && activeSockets.size === 0 && drainResolve) {
        drainResolve();
        drainResolve = null;
      }
    }

    const onClientEnd = (): void => { target.end(); };
    const onTargetEnd = (): void => { client.end(); };

    client.once('end', onClientEnd);
    target.once('end', onTargetEnd);
    client.once('close', cleanup);
    target.once('close', cleanup);

    target.once('error', (err: Error) => {
      emitter.emit('event', { type: 'error', err } satisfies ForwarderEvent);
      client.destroy();
      target.destroy();
    });

    client.once('error', () => {
      client.destroy();
      target.destroy();
    });
  }

  return {
    async start(): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        const srv = net.createServer((socket) => {
          if (!stopping) {
            pipeConnection(socket);
          } else {
            socket.destroy();
          }
        });

        srv.once('error', (err: NodeJS.ErrnoException) => {
          reject(err);
        });

        srv.listen(sourcePort, sourceHost, () => {
          server = srv;
          resolve();
        });
      });
    },

    async stop(): Promise<void> {
      if (!server) return;
      stopping = true;

      // Call server.close() to stop accepting new connections.
      // server.close()'s callback fires only after ALL server connections are ended,
      // so we must NOT await it before draining — do both concurrently.
      const srv = server;
      const serverClosed = new Promise<void>((resolve) => {
        srv.close(() => resolve());
      });

      if (activeSockets.size > 0) {
        await new Promise<void>((resolve) => {
          drainResolve = resolve;

          const timer = setTimeout(() => {
            drainResolve = null;
            for (const sock of activeSockets) {
              sock.destroy();
            }
            activeSockets.clear();
            statsData = { ...statsData, openConnections: 0 };
            resolve();
          }, drainTimeoutMs);

          if (activeSockets.size === 0) {
            clearTimeout(timer);
            drainResolve = null;
            resolve();
          }
        });
      }

      await serverClosed;
    },

    stats(): ForwarderStats {
      return { ...statsData };
    },

    get boundPort(): number {
      if (!server) throw new Error('Forwarder not started');
      const addr = server.address() as net.AddressInfo;
      return addr.port;
    },

    get events(): EventEmitter {
      return emitter;
    },
  };
}
