import { Router, Request, Response } from 'express';
import {
  ApiError,
  ErrorCode,
  ERROR_HTTP_STATUS,
  CreateMappingRequestSchema,
  PatchMappingRequestSchema,
  BulkRequestSchema,
} from '@spiriyu/shared';
import { MappingResponse } from '@spiriyu/shared';
import { DaemonContext } from '../server';

function sendApiError(res: Response, err: unknown): void {
  if (err instanceof ApiError) {
    res.status(ERROR_HTTP_STATUS[err.code]).json(err.toResponse());
  } else {
    res.status(500).json(new ApiError(ErrorCode.INTERNAL, 'Unexpected error').toResponse());
  }
}

export function createMappingRoutes(ctx: DaemonContext): Router {
  const router = Router();
  const { store, eventBus, persist, startForwarding, stopForwarding, liveStats } = ctx;

  function withLiveStats(m: MappingResponse): MappingResponse {
    const s = liveStats(m.id);
    return s ? { ...m, stats: s } : m;
  }

  // GET /v1/mappings
  router.get('/', (_req, res) => {
    res.json({ mappings: store.list().map(withLiveStats) });
  });

  // POST /v1/mappings/bulk — must be before /:id
  router.post('/bulk', async (req: Request, res: Response) => {
    const result = BulkRequestSchema.safeParse(req.body);
    if (!result.success) {
      return sendApiError(res, new ApiError(ErrorCode.VALIDATION, 'Invalid bulk request body'));
    }
    const prevEnabledMap = new Map(store.list().map((m) => [m.id, m.enabled]));
    const results = store.bulk(result.data.operations);
    persist();
    const forwardingOps: Array<Promise<void>> = [];
    result.data.operations.forEach((op, i) => {
      const item = results[i];
      if (!item?.ok) return;
      if (op.op === 'create') {
        if (item.mapping?.enabled) forwardingOps.push(startForwarding(item.mapping.id));
      } else if (op.op === 'update') {
        if (!item.mapping) return;
        if (item.mapping.enabled) {
          forwardingOps.push(startForwarding(item.mapping.id));
        } else {
          forwardingOps.push(stopForwarding(item.mapping.id));
        }
      } else if (op.op === 'delete') {
        forwardingOps.push(stopForwarding(op.id));
      }
    });
    await Promise.all(forwardingOps);
    result.data.operations.forEach((op, i) => {
      const item = results[i];
      if (!item?.ok) return;
      if (op.op === 'create') {
        const mapping = (item.mapping && store.get(item.mapping.id)) ?? item.mapping;
        if (!mapping) return;
        eventBus.broadcast({ type: 'mapping.created', payload: { mapping } });
      } else if (op.op === 'update') {
        if (!item.mapping) return;
        const mapping = store.get(item.mapping.id) ?? item.mapping;
        eventBus.broadcast({
          type: 'mapping.updated',
          payload: { mapping, previousEnabled: prevEnabledMap.get(mapping.id) ?? false },
        });
      } else if (op.op === 'delete') {
        eventBus.broadcast({ type: 'mapping.deleted', payload: { id: op.id } });
      }
    });
    res.json({ results });
  });

  // POST /v1/mappings
  router.post('/', async (req: Request, res: Response) => {
    const result = CreateMappingRequestSchema.safeParse(req.body);
    if (!result.success) {
      return sendApiError(res, new ApiError(ErrorCode.VALIDATION, 'Invalid request body', { issues: result.error.issues }));
    }
    try {
      const mapping = store.create(result.data);
      persist();
      eventBus.broadcast({ type: 'mapping.created', payload: { mapping } });
      if (mapping.enabled) await startForwarding(mapping.id);
      res.status(201).json(store.get(mapping.id) ?? mapping);
    } catch (err) {
      sendApiError(res, err);
    }
  });

  // GET /v1/mappings/:id
  router.get('/:id', (req, res) => {
    const mapping = store.get(req.params['id'] ?? '');
    if (!mapping) return sendApiError(res, new ApiError(ErrorCode.NOT_FOUND, `Mapping not found.`));
    res.json(withLiveStats(mapping));
  });

  // PATCH /v1/mappings/:id
  router.patch('/:id', async (req: Request, res: Response) => {
    const result = PatchMappingRequestSchema.safeParse(req.body);
    if (!result.success) {
      return sendApiError(res, new ApiError(ErrorCode.VALIDATION, 'Invalid patch body', { issues: result.error.issues }));
    }
    try {
      const id = req.params['id'] ?? '';
      const previous = store.get(id);
      const mapping = store.update(id, result.data);
      persist();
      eventBus.broadcast({ type: 'mapping.updated', payload: { mapping, previousEnabled: previous?.enabled ?? mapping.enabled } });
      const wasEnabled = previous?.enabled ?? false;
      const nowEnabled = mapping.enabled;
      if (nowEnabled) {
        await startForwarding(id);
      } else if (wasEnabled) {
        await stopForwarding(id);
      }
      res.json(store.get(id) ?? mapping);
    } catch (err) {
      sendApiError(res, err);
    }
  });

  // DELETE /v1/mappings/:id
  router.delete('/:id', async (req: Request, res: Response) => {
    const id = req.params['id'] ?? '';
    try {
      await stopForwarding(id);
      store.delete(id);
      persist();
      eventBus.broadcast({ type: 'mapping.deleted', payload: { id } });
      res.status(204).send();
    } catch (err) {
      sendApiError(res, err);
    }
  });

  // POST /v1/mappings/:id/toggle
  router.post('/:id/toggle', async (req: Request, res: Response) => {
    const id = req.params['id'] ?? '';
    try {
      const previous = store.get(id);
      const mapping = store.toggle(id);
      persist();
      eventBus.broadcast({ type: 'mapping.updated', payload: { mapping, previousEnabled: previous?.enabled ?? !mapping.enabled } });
      if (mapping.enabled) {
        await startForwarding(id);
      } else {
        await stopForwarding(id);
      }
      res.json(store.get(id) ?? mapping);
    } catch (err) {
      sendApiError(res, err);
    }
  });

  return router;
}
