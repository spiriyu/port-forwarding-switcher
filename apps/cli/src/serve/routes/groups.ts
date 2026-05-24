import { Router, Request, Response } from 'express';
import { ApiError, ErrorCode, ERROR_HTTP_STATUS, CreateGroupRequestSchema, PatchGroupRequestSchema } from '@portswitch/shared';
import { DaemonContext } from '../server';

function sendApiError(res: Response, err: unknown): void {
  if (err instanceof ApiError) {
    res.status(ERROR_HTTP_STATUS[err.code]).json(err.toResponse());
  } else {
    res.status(500).json(new ApiError(ErrorCode.INTERNAL, 'Unexpected error').toResponse());
  }
}

function syncGroupCounts(ctx: DaemonContext, groupId: string): void {
  const mappings = ctx.store.listByGroup(groupId);
  ctx.groupStore.updateCounts(groupId, {
    mappingCount: mappings.length,
    activeCount: mappings.filter((m) => m.enabled).length,
  });
}

function syncAllGroupCounts(ctx: DaemonContext): void {
  for (const g of ctx.groupStore.list()) {
    syncGroupCounts(ctx, g.id);
  }
}

export function createGroupRoutes(ctx: DaemonContext): Router {
  const router = Router();
  const { groupStore, store, eventBus, persist, stopForwarding, startForwarding } = ctx;

  // GET /v1/groups
  router.get('/', (_req, res) => {
    syncAllGroupCounts(ctx);
    res.json({ groups: groupStore.list() });
  });

  // POST /v1/groups
  router.post('/', (req: Request, res: Response) => {
    const result = CreateGroupRequestSchema.safeParse(req.body);
    if (!result.success) {
      return sendApiError(res, new ApiError(ErrorCode.VALIDATION, 'Invalid request body'));
    }
    try {
      const group = groupStore.create(result.data);
      persist();
      eventBus.broadcast({ type: 'group.created', payload: { group } });
      res.status(201).json(group);
    } catch (err) {
      sendApiError(res, err);
    }
  });

  // GET /v1/groups/:id
  router.get('/:id', (req, res) => {
    const id = req.params['id'] ?? '';
    const group = groupStore.get(id);
    if (!group) return sendApiError(res, new ApiError(ErrorCode.NOT_FOUND, 'Group not found.'));
    syncGroupCounts(ctx, id);
    res.json(groupStore.get(id));
  });

  // PATCH /v1/groups/:id
  router.patch('/:id', (req: Request, res: Response) => {
    const result = PatchGroupRequestSchema.safeParse(req.body);
    if (!result.success) {
      return sendApiError(res, new ApiError(ErrorCode.VALIDATION, 'Invalid patch body'));
    }
    try {
      const group = groupStore.update(req.params['id'] ?? '', result.data);
      persist();
      eventBus.broadcast({ type: 'group.updated', payload: { group } });
      res.json(group);
    } catch (err) {
      sendApiError(res, err);
    }
  });

  // DELETE /v1/groups/:id — also deletes all member mappings
  router.delete('/:id', async (req: Request, res: Response) => {
    const id = req.params['id'] ?? '';
    try {
      if (!groupStore.get(id)) {
        throw new ApiError(ErrorCode.NOT_FOUND, 'Group not found.');
      }
      const members = store.listByGroup(id);
      await Promise.all(members.map((m) => stopForwarding(m.id)));
      for (const m of members) {
        store.delete(m.id);
        eventBus.broadcast({ type: 'mapping.deleted', payload: { id: m.id } });
      }
      groupStore.delete(id);
      persist();
      eventBus.broadcast({ type: 'group.deleted', payload: { id } });
      res.status(204).send();
    } catch (err) {
      sendApiError(res, err);
    }
  });

  // POST /v1/groups/:id/enable — enable all mappings (all-or-nothing conflict check)
  router.post('/:id/enable', async (req: Request, res: Response) => {
    const id = req.params['id'] ?? '';
    try {
      const group = groupStore.get(id);
      if (!group) return sendApiError(res, new ApiError(ErrorCode.NOT_FOUND, 'Group not found.'));

      const conflicts = store.findConflictsIfEnabled(id);
      if (conflicts.length > 0) {
        return sendApiError(
          res,
          new ApiError(
            ErrorCode.CONFLICT,
            `Cannot enable group: ${conflicts.length} mapping(s) in other groups conflict on source port.`,
            { conflictingMappingIds: conflicts },
          ),
        );
      }

      const members = store.listByGroup(id);
      for (const m of members) {
        store.update(m.id, { enabled: true });
      }
      await Promise.all(members.map((m) => startForwarding(m.id)));

      const updatedMembers = store.listByGroup(id);
      syncGroupCounts(ctx, id);
      const updatedGroup = groupStore.get(id)!;

      persist();
      eventBus.broadcast({ type: 'group.toggled', payload: { group: updatedGroup, mappings: updatedMembers } });
      res.json({ group: updatedGroup, mappings: updatedMembers });
    } catch (err) {
      sendApiError(res, err);
    }
  });

  // POST /v1/groups/:id/disable — disable all mappings
  router.post('/:id/disable', async (req: Request, res: Response) => {
    const id = req.params['id'] ?? '';
    try {
      const group = groupStore.get(id);
      if (!group) return sendApiError(res, new ApiError(ErrorCode.NOT_FOUND, 'Group not found.'));

      const members = store.listByGroup(id);
      await Promise.all(members.map((m) => stopForwarding(m.id)));
      for (const m of members) {
        store.update(m.id, { enabled: false });
      }

      const updatedMembers = store.listByGroup(id);
      syncGroupCounts(ctx, id);
      const updatedGroup = groupStore.get(id)!;

      persist();
      eventBus.broadcast({ type: 'group.toggled', payload: { group: updatedGroup, mappings: updatedMembers } });
      res.json({ group: updatedGroup, mappings: updatedMembers });
    } catch (err) {
      sendApiError(res, err);
    }
  });

  return router;
}
