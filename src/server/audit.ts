import type { Ctx } from './db.js'
import { insertId, nowIso } from './db.js'

export async function audit(
  ctx: Ctx,
  opts: {
    userId?: number | null
    action: string
    entity?: string | null
    entityId?: string | number | null
    detail?: unknown
    ip?: string | null
  },
) {
  try {
    await insertId(ctx, ctx.db, 'audit_log', {
      user_id: opts.userId ?? null,
      action: opts.action,
      entity: opts.entity ?? null,
      entity_id: opts.entityId != null ? String(opts.entityId) : null,
      detail: opts.detail != null ? JSON.stringify(opts.detail).slice(0, 1900) : null,
      ip: opts.ip ?? null,
      created_at: nowIso(),
    })
  } catch {
  }
}
