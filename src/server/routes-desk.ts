import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { requirePerm } from './auth.js'
import { nowIso } from './db.js'
import { HttpError } from './errors.js'
import { patientDeskBody } from './patients.js'
import type { Ctx } from './db.js'
import * as q from './queue.js'

type U = NonNullable<FastifyRequest['user']>

export function deskRoutes(app: FastifyInstance, ctx: Ctx) {
  const pre = { preHandler: requirePerm(ctx, 'desk.attend') }
  const act = (path: string, fn: (u: U, body: unknown) => Promise<unknown>) =>
    app.post(`/api/desk/${path}`, pre, async (req) => {
      await fn(req.user!, req.body)
      return q.deskState(ctx, req.user!)
    })

  app.get('/api/desk/state', pre, async (req) => q.deskState(ctx, req.user!))
  act('call-next', (u) => q.callNext(ctx, u))
  app.post('/api/desk/call/:id', pre, async (req) => {
    const id = z.coerce.number().int().positive().parse((req.params as any).id)
    await q.callSpecific(ctx, req.user!, id)
    return q.deskState(ctx, req.user!)
  })
  act('recall', (u) => q.recall(ctx, u))
  act('start', (u) => q.startServing(ctx, u))
  act('finish', (u) => q.finish(ctx, u))
  act('absent', (u) => q.markAbsent(ctx, u))
  act('transfer', (u, body) => q.transfer(ctx, u, z.object({ sectorId: z.number().int().positive() }).parse(body).sectorId))
  /** La secretaria completa datos del paciente que está atendiendo (teléfono, obra social, observaciones). */
  app.put('/api/desk/patient', pre, async (req) => {
    const b = patientDeskBody.parse(req.body)
    const cur = await ctx.db.selectFrom('tickets').select('patient_id').where('called_by', '=', req.user!.id).where('status', 'in', ['called', 'serving']).executeTakeFirst()
    if (!cur?.patient_id) throw new HttpError(404, 'No hay un paciente identificado en atención')
    await ctx.db
      .updateTable('patients')
      .set({ phone: b.phone || null, health_insurance: b.healthInsurance || null, insurance_number: b.insuranceNumber || null, notes: b.notes || null, updated_at: nowIso() })
      .where('id', '=', cur.patient_id)
      .execute()
    return q.deskState(ctx, req.user!)
  })
  act('desk', (u, body) => q.setDesk(ctx, u, z.object({ deskId: z.number().int().positive().nullable() }).parse(body).deskId))
}
