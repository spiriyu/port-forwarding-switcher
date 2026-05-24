import * as http from 'http';
import * as net from 'net';
import * as path from 'path';
import express from 'express';
import { WebSocketServer, WebSocket as WsSocket } from 'ws';

// Resolve version from package.json — path differs between bundled (dist/) and test (__dirname = src/)
const PKG_VERSION: string = (() => {
  for (const rel of ['package.json', '../../package.json', '../../../../package.json']) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pkg = require(path.join(__dirname, rel)) as { version?: string };
      if (pkg.version) return pkg.version;
    } catch { /* try next */ }
  }
  return '0.0.0';
})();
import {
  resolveConfigPath,
  resolveLogPath,
  PortswitchConfig,
  CURRENT_SCHEMA_VERSION,
  DEFAULT_DAEMON_PORT,
  ErrorCode,
} from '@portswitch/shared';
import { createForwarder, ForwarderHandle } from '@portswitch/proxy-core';
import { InMemoryMappingStore } from './store/mapping-store';
import { InMemoryGroupStore } from './store/group-store';
import { EventBus } from './ws/event-bus';
import { Logger } from './logging/logger';
import { loadConfig, saveConfig, watchConfig, debounce } from './config/config-store';
import { createHealthRouter } from './routes/health';
import { createMappingRoutes } from './routes/mappings';
import { createLogsRouter, diagnosticsHandler } from './routes/logs';
import { createGroupRoutes } from './routes/groups';

export interface DaemonContext {
  store: InMemoryMappingStore;
  groupStore: InMemoryGroupStore;
  eventBus: EventBus;
  logger: Logger;
  startedAt: number;
  version: string;
  configPath: string;
  logPath: string;
  daemonConfig: PortswitchConfig['daemon'];
  persist: () => void;
  startForwarding(id: string): Promise<void>;
  stopForwarding(id: string): Promise<void>;
  liveStats(id: string): import('@portswitch/proxy-core').ForwarderStats | undefined;
}

export interface DaemonOptions {
  port?: number;
  configPath?: string;
  logPath?: string;
  uiDir?: string;
}

export interface DaemonHandle {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly port: number;
  readonly httpServer: http.Server;
  readonly configPath: string;
}

export function createDaemon(opts: DaemonOptions = {}): DaemonHandle {
  const configPath = opts.configPath ?? resolveConfigPath();
  const logPath = opts.logPath ?? resolveLogPath();
  const bindPort = opts.port ?? DEFAULT_DAEMON_PORT;
  const uiDir = opts.uiDir ?? path.join(__dirname, 'ui');
  const startedAt = Date.now();

  const store = new InMemoryMappingStore();
  const groupStore = new InMemoryGroupStore();
  const eventBus = new EventBus(PKG_VERSION);
  const forwarders = new Map<string, ForwarderHandle>();
  const forwarderLocks = new Map<string, Promise<void>>();

  function withForwarderLock(id: string, fn: () => Promise<void>): Promise<void> {
    const prev = forwarderLocks.get(id) ?? Promise.resolve();
    const next = prev.then(fn).finally(() => {
      if (forwarderLocks.get(id) === next) forwarderLocks.delete(id);
    });
    forwarderLocks.set(id, next);
    return next;
  }

  let currentDaemonConfig: PortswitchConfig['daemon'] = {
    port: bindPort,
    logRetention: { maxFiles: 10, maxFileBytes: 5 * 1024 * 1024 },
  };

  const logger = new Logger({
    logDir: logPath,
    maxFileBytes: currentDaemonConfig.logRetention.maxFileBytes,
    maxFiles: currentDaemonConfig.logRetention.maxFiles,
    onEntry: (entry) => eventBus.broadcastLog(entry),
  });

  async function flushConfig(): Promise<void> {
    const config: PortswitchConfig = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      daemon: currentDaemonConfig,
      groups: groupStore.toConfigs(),
      mappings: store.toConfigs(),
    };
    await saveConfig(configPath, config);
  }

  const persist = debounce(flushConfig, 50);

  async function startForwardingImpl(id: string): Promise<void> {
    const mapping = store.get(id);
    if (!mapping) return;
    const existing = forwarders.get(id);
    if (existing) { await existing.stop(); forwarders.delete(id); }
    const handle = createForwarder({
      sourceHost: mapping.sourceHost,
      sourcePort: mapping.sourcePort,
      targetHost: mapping.targetHost,
      targetPort: mapping.targetPort,
      drainTimeoutMs: 30000,
    });
    try {
      await handle.start();
      forwarders.set(id, handle);
      store.setListening(id);
      logger.info('mapping', 'listenerBound', {
        sourceHost: mapping.sourceHost, sourcePort: mapping.sourcePort,
        targetHost: mapping.targetHost, targetPort: mapping.targetPort,
      }, id);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'EADDRINUSE') {
        store.setError(id, ErrorCode.EADDRINUSE, `Port ${mapping.sourcePort} is already in use.`);
      } else if (e.code === 'EACCES' && mapping.sourcePort < 1024) {
        store.setError(id, ErrorCode.EACCES_PRIVILEGED_PORT, `Port ${mapping.sourcePort} requires elevated privileges.`);
      } else if (e.code === 'EACCES') {
        store.setError(id, ErrorCode.EACCES, `Permission denied binding to port ${mapping.sourcePort}.`);
      } else {
        store.setError(id, ErrorCode.INTERNAL, e.message);
      }
      logger.error('mapping', 'listenerError', e, { sourcePort: mapping.sourcePort, code: e.code }, id);
    }
    eventBus.broadcast({
      type: 'mapping.status',
      payload: { id, status: store.get(id)?.status ?? 'error', error: store.get(id)?.error },
    });
  }

  async function stopForwardingImpl(id: string): Promise<void> {
    const handle = forwarders.get(id);
    if (!handle) return;
    forwarders.delete(id);
    await handle.stop();
    if (store.get(id)) {
      store.setDisabled(id);
      eventBus.broadcast({ type: 'mapping.status', payload: { id, status: 'disabled' } });
      logger.info('mapping', 'listenerUnbound', {}, id);
    }
  }

  function startForwarding(id: string): Promise<void> {
    return withForwarderLock(id, () => startForwardingImpl(id));
  }
  function stopForwarding(id: string): Promise<void> {
    return withForwarderLock(id, () => stopForwardingImpl(id));
  }
  function liveStats(id: string) { return forwarders.get(id)?.stats(); }

  const ctx: DaemonContext = {
    store, groupStore, eventBus, logger, startedAt, version: PKG_VERSION,
    configPath, logPath,
    get daemonConfig() { return currentDaemonConfig; },
    persist, startForwarding, stopForwarding, liveStats,
  };

  const app = express();
  app.disable('x-powered-by');

  // Allow same-origin requests from the UI (same port). Block cross-origin to prevent DNS-rebinding.
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    const origin = req.headers['origin'];
    if (
      origin !== undefined &&
      origin !== `http://localhost:${bindPort}` &&
      origin !== `http://127.0.0.1:${bindPort}`
    ) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cross-origin requests are not allowed.' } });
      return;
    }
    next();
  });

  app.use(express.json({ limit: '64kb' }));

  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    const t0 = Date.now();
    res.on('finish', () => {
      logger.debug('api', 'request', { method: req.method, path: req.path, status: res.statusCode, durationMs: Date.now() - t0 });
    });
    next();
  });

  // All API routes under /api
  const apiRouter = express.Router();
  apiRouter.use('/v1/health', createHealthRouter(ctx));
  apiRouter.use('/v1/mappings', createMappingRoutes(ctx));
  apiRouter.use('/v1/logs', createLogsRouter(ctx));
  apiRouter.get('/v1/diagnostics', diagnosticsHandler(ctx) as express.RequestHandler);
  apiRouter.use('/v1/groups', createGroupRoutes(ctx));
  app.use('/api', apiRouter);

  // Serve React UI at /ui (gracefully skip if not built yet)
  const uiFsModule = require('fs') as typeof import('fs');
  if (uiFsModule.existsSync(uiDir)) {
    app.use('/ui', express.static(uiDir, { index: 'index.html' }));
    app.get('/ui/*', (_req, res) => res.sendFile(path.join(uiDir, 'index.html')));
  } else {
    app.get('/ui', (_req, res) => res.status(503).json({ error: { code: 'UI_NOT_BUILT', message: 'UI files not found. Run: npx nx build web && npx nx run cli:copy-ui' } }));
  }
  app.get('/', (_req, res) => res.redirect('/ui'));

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if ((err as { type?: string }).type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'VALIDATION', message: 'Invalid JSON body' } });
    } else {
      res.status(500).json({ error: { code: 'INTERNAL', message: err.message } });
    }
  });

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/api/v1/events' });

  type TrackedSocket = WsSocket & { _pingSent?: boolean };

  const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const ext = ws as TrackedSocket;
      if (ext._pingSent) { ws.terminate(); return; }
      ext._pingSent = true;
      ws.ping();
      ws.once('pong', () => { ext._pingSent = false; });
    });
  }, 30_000);

  wss.on('connection', (ws) => {
    (ws as TrackedSocket)._pingSent = false;
    eventBus.addClient(ws, store.list(), groupStore.list());
    logger.debug('api', 'wsConnected', { clients: eventBus.clientCount() });
    ws.once('close', () => {
      logger.debug('api', 'wsDisconnected', { clients: eventBus.clientCount() });
    });
  });

  let stopWatcher: (() => void) | null = null;
  let stopped = false;

  return {
    async start(): Promise<void> {
      await logger.open();
      logger.info('daemon', 'startup', { version: PKG_VERSION, configPath, logPath });
      const config = await loadConfig(configPath);
      currentDaemonConfig = config.daemon;
      groupStore.hydrate(config.groups);
      store.hydrate(config.mappings);
      logger.info('config', 'loaded', { configPath, mappings: config.mappings.length });
      await Promise.all(store.list().filter((m) => m.enabled).map((m) => startForwarding(m.id)));

      stopWatcher = watchConfig(configPath, (reloaded) => {
        const prevList = store.list();
        const prevIds = new Set(prevList.map((m) => m.id));
        const prevEnabled = new Set(prevList.filter((m) => m.enabled).map((m) => m.id));
        currentDaemonConfig = reloaded.daemon;
        groupStore.hydrate(reloaded.groups);
        store.hydrate(reloaded.mappings);
        for (const [id] of forwarders) store.setListening(id);
        const next = store.list();
        const nextIds = new Set(next.map((m) => m.id));
        const nextEnabled = new Set(next.filter((m) => m.enabled).map((m) => m.id));
        const toStop = [...prevEnabled].filter((id) => !nextEnabled.has(id));
        const toStart = next.filter((m) => m.enabled && !prevEnabled.has(m.id));
        const deleted = [...prevIds].filter((id) => !nextIds.has(id));
        void Promise.all([...[...toStop, ...deleted].map((id) => stopForwarding(id))])
          .then(() => Promise.all(toStart.map((m) => startForwarding(m.id))));
        logger.info('config', 'externalEditDetected', { configPath });
        eventBus.broadcast({ type: 'hello', payload: { serverVersion: PKG_VERSION, snapshot: { mappings: next, groups: groupStore.list() } } });
      });

      await new Promise<void>((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(bindPort, '127.0.0.1', () => {
          httpServer.off('error', reject);
          const addr = httpServer.address() as net.AddressInfo;
          logger.info('daemon', 'apiBound', { host: '127.0.0.1', port: addr.port });
          resolve();
        });
      });
    },

    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      clearInterval(pingInterval);
      logger.info('daemon', 'shutdown', { reason: 'stop' });
      eventBus.broadcast({ type: 'daemon.shutdown', payload: { reason: 'stop' } });
      if (stopWatcher) { stopWatcher(); stopWatcher = null; }
      await persist.flush();
      await Promise.all(Array.from(forwarders.keys()).map((id) => stopForwarding(id)));
      wss.clients.forEach((ws) => ws.terminate());
      await new Promise<void>((resolve, reject) => {
        wss.close((err) => (err ? reject(err) : resolve()));
      });
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
      await logger.close();
    },

    get port(): number {
      const addr = httpServer.address();
      if (!addr || typeof addr === 'string') throw new Error('Daemon is not listening');
      return addr.port;
    },
    httpServer,
    configPath,
  };
}
