import { z } from 'zod'
import type { Ctx } from './db.js'

export const DEFAULT_SETTINGS = {
  org_name: 'CELTTO-TOTEMS',
  tv_voice_enabled: true,
  tv_chime_enabled: true,
  tv_voice_template: 'Turno {prefix} {number}, pasar a {place}',
  tv_voice_rate: 0.95,
  tv_chime_volume: 0.8,
  tv_history_size: 6,
  totem_auto_print: true,
  totem_pin: '0000',
  totem_return_seconds: 10,
  ticket_footer: 'Aguarde a ser llamado. Gracias.',
}
export type Settings = typeof DEFAULT_SETTINGS

export const settingsPatch = z.object({
  org_name: z.string().min(1).max(80),
  tv_voice_enabled: z.boolean(),
  tv_chime_enabled: z.boolean(),
  tv_voice_template: z.string().min(1).max(200),
  tv_voice_rate: z.number().min(0.5).max(1.5),
  tv_chime_volume: z.number().min(0).max(1),
  tv_history_size: z.number().int().min(1).max(12),
  totem_auto_print: z.boolean(),
  totem_pin: z.string().regex(/^\d{4,8}$/, 'El PIN debe tener entre 4 y 8 números'),
  totem_return_seconds: z.number().int().min(3).max(60),
  ticket_footer: z.string().max(160),
}).partial()

export async function getSettings(ctx: Ctx): Promise<Settings> {
  const rows = await ctx.db.selectFrom('settings').selectAll().execute()
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  for (const r of rows) {
    if (!(r.setting_key in DEFAULT_SETTINGS)) continue
    try { out[r.setting_key] = JSON.parse(r.setting_value) } catch {  }
  }
  return out as Settings
}

export async function saveSettings(ctx: Ctx, patch: Partial<Settings>) {
  for (const [k, v] of Object.entries(patch)) {
    const val = JSON.stringify(v)
    const r = await ctx.db.updateTable('settings').set({ setting_value: val }).where('setting_key', '=', k).executeTakeFirst()
    if (Number(r.numUpdatedRows) === 0) await ctx.db.insertInto('settings').values({ setting_key: k, setting_value: val }).execute()
  }
}

export const publicSettings = ({ totem_pin: _pin, ...rest }: Settings) => rest
