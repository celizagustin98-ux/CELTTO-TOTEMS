import { MssqlAdapter, PostgresAdapter, sql, type Kysely } from 'kysely'
import type { Migration } from 'kysely/migration'

function pkId(db: Kysely<any>) {
  const adapter = db.getExecutor().adapter
  if (adapter instanceof MssqlAdapter) {
    return (c: any) => c.identity().primaryKey().notNull()
  }
  if (adapter instanceof PostgresAdapter) {
    return (c: any) => c.generatedByDefaultAsIdentity().primaryKey().notNull()
  }
  return (c: any) => c.primaryKey().autoIncrement().notNull()
}

/** Texto largo portable: text en Postgres/SQLite, nvarchar(max) en SQL Server. */
function bigText(db: Kysely<any>) {
  return db.getExecutor().adapter instanceof MssqlAdapter ? sql`nvarchar(max)` : sql`text`
}

const supportsAlterFk = (db: Kysely<any>) => {
  const a = db.getExecutor().adapter
  return a instanceof PostgresAdapter || a instanceof MssqlAdapter
}

/** Tipo fecha/hora real según el motor. */
function tsType(db: Kysely<any>) {
  const a = db.getExecutor().adapter
  return a instanceof PostgresAdapter ? sql`timestamptz` : a instanceof MssqlAdapter ? sql`datetimeoffset(3)` : sql`varchar(30)`
}

/** Índice único que permite varios NULL (SQL Server solo admite uno salvo con índice filtrado). */
async function uniqueWhereNotNull(db: Kysely<any>, name: string, table: string, column: string) {
  if (db.getExecutor().adapter instanceof MssqlAdapter) await sql.raw(`CREATE UNIQUE INDEX ${name} ON ${table}(${column}) WHERE ${column} IS NOT NULL`).execute(db)
  else await db.schema.createIndex(name).on(table).column(column).unique().execute()
}

export const migrations: Record<string, Migration> = {
  '001_init': {
    async up(db: Kysely<any>) {
      const id = pkId(db)

      await db.schema
        .createTable('sectors')
        .addColumn('id', 'integer', id)
        .addColumn('name', 'varchar(100)', (c) => c.notNull())
        .addColumn('color', 'varchar(9)', (c) => c.notNull())
        .addColumn('welcome_message', 'varchar(200)')
        .addColumn('sort_order', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('active', 'integer', (c) => c.notNull().defaultTo(1))
        .addColumn('created_at', 'varchar(30)', (c) => c.notNull())
        .execute()

      await db.schema
        .createTable('buttons')
        .addColumn('id', 'integer', id)
        .addColumn('sector_id', 'integer', (c) => c.notNull().references('sectors.id'))
        .addColumn('target_sector_id', 'integer', (c) => c.notNull().references('sectors.id'))
        .addColumn('label', 'varchar(100)', (c) => c.notNull())
        .addColumn('subtitle', 'varchar(160)')
        .addColumn('color', 'varchar(9)')
        .addColumn('prefix', 'varchar(3)', (c) => c.notNull())
        .addColumn('priority', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('priority_id', 'integer')
        .addColumn('sort_order', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('active', 'integer', (c) => c.notNull().defaultTo(1))
        .execute()

      await db.schema
        .createTable('users')
        .addColumn('id', 'integer', id)
        .addColumn('username', 'varchar(60)', (c) => c.notNull().unique())
        .addColumn('display_name', 'varchar(100)', (c) => c.notNull())
        .addColumn('password_hash', 'varchar(300)', (c) => c.notNull())
        .addColumn('role', 'varchar(20)', (c) => c.notNull())
        .addColumn('sector_id', 'integer', (c) => c.references('sectors.id'))
        .addColumn('desk', 'varchar(60)')
        .addColumn('desk_id', 'integer')
        .addColumn('active', 'integer', (c) => c.notNull().defaultTo(1))
        .addColumn('created_at', 'varchar(30)', (c) => c.notNull())
        .execute()

      await db.schema
        .createTable('sessions')
        .addColumn('token_hash', 'varchar(64)', (c) => c.primaryKey().notNull())
        .addColumn('user_id', 'integer', (c) => c.notNull().references('users.id'))
        .addColumn('expires_at', 'varchar(30)', (c) => c.notNull())
        .addColumn('created_at', 'varchar(30)', (c) => c.notNull())
        .execute()

      await db.schema
        .createTable('tickets')
        .addColumn('id', 'integer', id)
        .addColumn('code', 'varchar(12)', (c) => c.notNull())
        .addColumn('prefix', 'varchar(3)', (c) => c.notNull())
        .addColumn('number', 'integer', (c) => c.notNull())
        .addColumn('business_date', 'varchar(10)', (c) => c.notNull())
        .addColumn('button_id', 'integer', (c) => c.notNull().references('buttons.id'))
        .addColumn('sector_id', 'integer', (c) => c.notNull().references('sectors.id'))
        .addColumn('origin_sector_id', 'integer', (c) => c.notNull().references('sectors.id'))
        .addColumn('priority', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('priority_id', 'integer')
        .addColumn('status', 'varchar(12)', (c) => c.notNull())
        .addColumn('created_at', 'varchar(30)', (c) => c.notNull())
        .addColumn('called_at', 'varchar(30)')
        .addColumn('last_call_at', 'varchar(30)')
        .addColumn('started_at', 'varchar(30)')
        .addColumn('finished_at', 'varchar(30)')
        .addColumn('called_by', 'integer', (c) => c.references('users.id'))
        .addColumn('desk', 'varchar(60)')
        .addColumn('desk_id', 'integer')
        .addColumn('recall_count', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('print_count', 'integer', (c) => c.notNull().defaultTo(0))
        .execute()
      await db.schema.createIndex('ix_tickets_queue').on('tickets').columns(['sector_id', 'status', 'business_date']).execute()
      await db.schema.createIndex('ux_tickets_code_day').on('tickets').columns(['business_date', 'code']).unique().execute()

      await db.schema
        .createTable('counters')
        .addColumn('counter_key', 'varchar(40)', (c) => c.primaryKey().notNull())
        .addColumn('counter_value', 'integer', (c) => c.notNull())
        .execute()

      await db.schema
        .createTable('ticket_events')
        .addColumn('id', 'integer', id)
        .addColumn('ticket_id', 'integer', (c) => c.notNull().references('tickets.id'))
        .addColumn('type', 'varchar(20)', (c) => c.notNull())
        .addColumn('user_id', 'integer')
        .addColumn('data', 'varchar(500)')
        .addColumn('created_at', 'varchar(30)', (c) => c.notNull())
        .execute()

      await db.schema
        .createTable('settings')
        .addColumn('setting_key', 'varchar(60)', (c) => c.primaryKey().notNull())
        .addColumn('setting_value', 'varchar(2000)', (c) => c.notNull())
        .execute()
    },
  },
  '002_ops': {
    async up(db: Kysely<any>) {
      const id = pkId(db)

      await db.schema
        .createTable('priorities')
        .addColumn('id', 'integer', id)
        .addColumn('name', 'varchar(80)', (c) => c.notNull())
        .addColumn('weight', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('color', 'varchar(9)')
        .addColumn('sort_order', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('active', 'integer', (c) => c.notNull().defaultTo(1))
        .execute()

      await db.schema
        .createTable('desks')
        .addColumn('id', 'integer', id)
        .addColumn('sector_id', 'integer', (c) => c.notNull().references('sectors.id'))
        .addColumn('name', 'varchar(80)', (c) => c.notNull())
        .addColumn('code', 'varchar(20)', (c) => c.notNull())
        .addColumn('active', 'integer', (c) => c.notNull().defaultTo(1))
        .addColumn('sort_order', 'integer', (c) => c.notNull().defaultTo(0))
        .execute()

      await db.schema
        .createTable('stations')
        .addColumn('id', 'integer', id)
        .addColumn('kind', 'varchar(10)', (c) => c.notNull())
        .addColumn('name', 'varchar(100)', (c) => c.notNull())
        .addColumn('sector_id', 'integer', (c) => c.references('sectors.id'))
        .addColumn('device_key', 'varchar(64)', (c) => c.notNull().unique())
        .addColumn('active', 'integer', (c) => c.notNull().defaultTo(1))
        .addColumn('last_seen_at', 'varchar(30)')
        .addColumn('created_at', 'varchar(30)', (c) => c.notNull())
        .execute()

      await db.schema
        .createTable('audit_log')
        .addColumn('id', 'integer', id)
        .addColumn('user_id', 'integer')
        .addColumn('action', 'varchar(60)', (c) => c.notNull())
        .addColumn('entity', 'varchar(40)')
        .addColumn('entity_id', 'varchar(40)')
        .addColumn('detail', 'varchar(2000)')
        .addColumn('ip', 'varchar(60)')
        .addColumn('created_at', 'varchar(30)', (c) => c.notNull())
        .execute()
      await db.schema.createIndex('ix_audit_created').on('audit_log').columns(['created_at']).execute()

      await db.schema
        .createTable('day_closes')
        .addColumn('id', 'integer', id)
        .addColumn('business_date', 'varchar(10)', (c) => c.notNull().unique())
        .addColumn('closed_by', 'integer')
        .addColumn('notes', 'varchar(500)')
        .addColumn('snapshot', 'varchar(8000)')
        .addColumn('created_at', 'varchar(30)', (c) => c.notNull())
        .execute()

      await db
        .insertInto('priorities')
        .values([
          { name: 'Normal', weight: 0, color: '#64748b', sort_order: 1, active: 1 },
          { name: 'Preferencial', weight: 10, color: '#2563eb', sort_order: 2, active: 1 },
          { name: 'Urgente', weight: 20, color: '#dc2626', sort_order: 3, active: 1 },
        ])
        .execute()
    },
  },

  '003_hardening': {
    async up(db: Kysely<any>) {
      await db.schema.alterTable('tickets').addColumn('dni', 'varchar(20)').execute()
      await db.schema.alterTable('users').addColumn('last_login_at', 'varchar(30)').execute()
      await db.schema.alterTable('stations').addColumn('lang', 'varchar(5)').execute()
      await db.schema.alterTable('buttons').addColumn('icon', 'varchar(40)').execute()

      await db.schema
        .createTable('assets')
        .addColumn('asset_key', 'varchar(40)', (c) => c.primaryKey().notNull())
        .addColumn('mime', 'varchar(40)', (c) => c.notNull())
        .addColumn('data', bigText(db), (c) => c.notNull())
        .addColumn('updated_at', 'varchar(30)', (c) => c.notNull())
        .execute()

      await db.schema.createIndex('ix_sessions_user').on('sessions').column('user_id').execute()
      await db.schema.createIndex('ix_sessions_expires').on('sessions').column('expires_at').execute()
      await db.schema.createIndex('ix_events_ticket').on('ticket_events').column('ticket_id').execute()
      await db.schema.createIndex('ix_tickets_lastcall').on('tickets').columns(['business_date', 'last_call_at']).execute()
      await db.schema.createIndex('ix_tickets_calledby').on('tickets').columns(['called_by', 'status']).execute()

      if (supportsAlterFk(db)) {
        // Limpiar referencias huérfanas antes de crear las claves foráneas
        await sql`UPDATE buttons SET priority_id = NULL WHERE priority_id IS NOT NULL AND priority_id NOT IN (SELECT id FROM priorities)`.execute(db)
        await sql`UPDATE tickets SET priority_id = NULL WHERE priority_id IS NOT NULL AND priority_id NOT IN (SELECT id FROM priorities)`.execute(db)
        await sql`UPDATE users SET desk_id = NULL WHERE desk_id IS NOT NULL AND desk_id NOT IN (SELECT id FROM desks)`.execute(db)
        await sql`UPDATE tickets SET desk_id = NULL WHERE desk_id IS NOT NULL AND desk_id NOT IN (SELECT id FROM desks)`.execute(db)
        await db.schema.alterTable('buttons').addForeignKeyConstraint('fk_buttons_priority', ['priority_id'], 'priorities', ['id']).execute()
        await db.schema.alterTable('tickets').addForeignKeyConstraint('fk_tickets_priority', ['priority_id'], 'priorities', ['id']).execute()
        await db.schema.alterTable('users').addForeignKeyConstraint('fk_users_desk', ['desk_id'], 'desks', ['id']).execute()
        await db.schema.alterTable('tickets').addForeignKeyConstraint('fk_tickets_desk', ['desk_id'], 'desks', ['id']).execute()
      }

      // Unificar prioridades: los botones con prioridad numérica pasan a usar la tabla de prioridades
      const prios = await db.selectFrom('priorities').select(['id', 'weight']).orderBy('weight').execute()
      if (prios.length) {
        const byLevel = (lvl: number) => prios[Math.min(lvl, prios.length - 1)]
        for (const lvl of [0, 1, 2]) {
          const p = byLevel(lvl)
          await db.updateTable('buttons').set({ priority_id: p.id, priority: p.weight }).where('priority_id', 'is', null).where('priority', '=', lvl).execute()
        }
      }
    },
  },

  '004_patients': {
    async up(db: Kysely<any>) {
      const id = pkId(db)
      await db.schema
        .createTable('patients')
        .addColumn('id', 'integer', id)
        .addColumn('document_type', 'varchar(10)', (c) => c.notNull().defaultTo('DNI'))
        .addColumn('document', 'varchar(20)', (c) => c.notNull())
        .addColumn('first_name', 'varchar(80)', (c) => c.notNull())
        .addColumn('last_name', 'varchar(80)', (c) => c.notNull())
        .addColumn('phone', 'varchar(30)')
        .addColumn('email', 'varchar(120)')
        .addColumn('birth_date', 'varchar(10)')
        .addColumn('notes', 'varchar(500)')
        // Nombre y apellido en minúsculas y sin tildes, para buscar "perez" y encontrar "Pérez"
        .addColumn('search_name', 'varchar(170)', (c) => c.notNull().defaultTo(''))
        .addColumn('visits', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('last_visit_at', 'varchar(30)')
        .addColumn('source', 'varchar(20)', (c) => c.notNull().defaultTo('totem'))
        .addColumn('active', 'integer', (c) => c.notNull().defaultTo(1))
        .addColumn('created_at', 'varchar(30)', (c) => c.notNull())
        .addColumn('updated_at', 'varchar(30)', (c) => c.notNull())
        .execute()
      await db.schema.createIndex('ux_patients_document').on('patients').columns(['document_type', 'document']).unique().execute()
      await db.schema.createIndex('ix_patients_last_name').on('patients').columns(['last_name', 'first_name']).execute()
      await db.schema.createIndex('ix_patients_search').on('patients').column('search_name').execute()

      await db.schema.alterTable('tickets').addColumn('patient_id', 'integer').execute()
      await db.schema.createIndex('ix_tickets_patient').on('tickets').column('patient_id').execute()
      if (supportsAlterFk(db)) {
        await db.schema.alterTable('tickets').addForeignKeyConstraint('fk_tickets_patient', ['patient_id'], 'patients', ['id']).execute()
      }
    },
  },

  /**
   * 005: plataforma — fechas reales, multi-sede, supervisores por área, resúmenes diarios, archivo histórico,
   * DNI cifrado, consentimiento y obra social, link privado del turno, sincronización sin conexión,
   * doble factor y multimedia en disco.
   */
  '005_platform': {
    async up(db: Kysely<any>) {
      const id = pkId(db)
      const adapter = db.getExecutor().adapter
      const isPg = adapter instanceof PostgresAdapter
      const isMs = adapter instanceof MssqlAdapter
      const ts = tsType(db)

      // 1) Fechas: de texto ISO a tipo fecha/hora real (SQLite no tiene tipo fecha: queda como texto)
      const TS_COLUMNS: [string, string, boolean][] = [
        ['sectors', 'created_at', true],
        ['users', 'created_at', true],
        ['users', 'last_login_at', false],
        ['sessions', 'expires_at', true],
        ['sessions', 'created_at', true],
        ['tickets', 'created_at', true],
        ['tickets', 'called_at', false],
        ['tickets', 'last_call_at', false],
        ['tickets', 'started_at', false],
        ['tickets', 'finished_at', false],
        ['ticket_events', 'created_at', true],
        ['stations', 'last_seen_at', false],
        ['stations', 'created_at', true],
        ['audit_log', 'created_at', true],
        ['day_closes', 'created_at', true],
        ['assets', 'updated_at', true],
        ['patients', 'last_visit_at', false],
        ['patients', 'created_at', true],
        ['patients', 'updated_at', true],
      ]
      if (isPg) {
        for (const [t, c] of TS_COLUMNS) await sql.raw(`ALTER TABLE ${t} ALTER COLUMN ${c} TYPE timestamptz USING ${c}::timestamptz`).execute(db)
      } else if (isMs) {
        // SQL Server no permite cambiar el tipo de una columna indexada: se quitan y recrean esos índices
        for (const ix of [['tickets', 'ix_tickets_lastcall'], ['audit_log', 'ix_audit_created'], ['sessions', 'ix_sessions_expires']])
          await sql.raw(`DROP INDEX ${ix[1]} ON ${ix[0]}`).execute(db)
        for (const [t, c, notNull] of TS_COLUMNS) await sql.raw(`ALTER TABLE ${t} ALTER COLUMN ${c} datetimeoffset(3) ${notNull ? 'NOT NULL' : 'NULL'}`).execute(db)
        await db.schema.createIndex('ix_tickets_lastcall').on('tickets').columns(['business_date', 'last_call_at']).execute()
        await db.schema.createIndex('ix_audit_created').on('audit_log').column('created_at').execute()
        await db.schema.createIndex('ix_sessions_expires').on('sessions').column('expires_at').execute()
      }

      // 2) Sedes (multi-sede): cada secretaría pertenece a una sede
      await db.schema
        .createTable('sites')
        .addColumn('id', 'integer', id)
        .addColumn('name', 'varchar(100)', (c) => c.notNull())
        .addColumn('code', 'varchar(20)', (c) => c.notNull().unique())
        .addColumn('address', 'varchar(200)')
        .addColumn('timezone', 'varchar(60)')
        .addColumn('active', 'integer', (c) => c.notNull().defaultTo(1))
        .addColumn('created_at', ts, (c) => c.notNull())
        .execute()
      await db.insertInto('sites').values({ name: 'Sede principal', code: 'principal', address: null, timezone: null, active: 1, created_at: new Date().toISOString() }).execute()
      const site = await db.selectFrom('sites').select('id').where('code', '=', 'principal').executeTakeFirstOrThrow()
      await db.schema.alterTable('sectors').addColumn('site_id', 'integer').execute()
      await db.updateTable('sectors').set({ site_id: site.id }).execute()
      await db.schema.alterTable('users').addColumn('site_id', 'integer').execute()
      await db.schema.createIndex('ix_sectors_site').on('sectors').column('site_id').execute()
      if (isPg || isMs) {
        await db.schema.alterTable('sectors').addForeignKeyConstraint('fk_sectors_site', ['site_id'], 'sites', ['id']).execute()
        await db.schema.alterTable('users').addForeignKeyConstraint('fk_users_site', ['site_id'], 'sites', ['id']).execute()
      }

      // 3) Áreas de cada supervisor
      await db.schema
        .createTable('user_sectors')
        .addColumn('user_id', 'integer', (c) => c.notNull().references('users.id'))
        .addColumn('sector_id', 'integer', (c) => c.notNull().references('sectors.id'))
        .addPrimaryKeyConstraint('pk_user_sectors', ['user_id', 'sector_id'])
        .execute()

      // 4) Doble factor y desafíos de inicio de sesión
      await db.schema.alterTable('users').addColumn('totp_secret_enc', 'varchar(300)').execute()
      await db.schema.alterTable('users').addColumn('totp_pending_enc', 'varchar(300)').execute()
      await db.schema.alterTable('users').addColumn('totp_enabled', 'integer', (c) => c.notNull().defaultTo(0)).execute()
      await db.schema.alterTable('users').addColumn('totp_backup', 'varchar(1500)').execute()
      await db.schema.alterTable('users').addColumn('password_changed_at', ts).execute()
      await db.schema
        .createTable('auth_challenges')
        .addColumn('token_hash', 'varchar(64)', (c) => c.primaryKey().notNull())
        .addColumn('user_id', 'integer', (c) => c.notNull().references('users.id'))
        .addColumn('attempts', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('expires_at', ts, (c) => c.notNull())
        .execute()

      // 5) Resúmenes para reportes rápidos (por día, secretaría y usuario; y por hora)
      await db.schema
        .createTable('daily_stats')
        .addColumn('id', 'integer', id)
        .addColumn('business_date', 'varchar(10)', (c) => c.notNull())
        .addColumn('site_id', 'integer')
        .addColumn('sector_id', 'integer', (c) => c.notNull())
        .addColumn('user_id', 'integer', (c) => c.notNull().defaultTo(0)) // 0 = total de la secretaría
        .addColumn('issued', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('called', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('done', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('absent', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('cancelled', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('transferred', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('recalls', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('wait_sum_sec', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('wait_count', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('wait_max_sec', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('service_sum_sec', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('service_count', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('first_call_at', ts)
        .addColumn('last_finish_at', ts)
        .addColumn('computed_at', ts, (c) => c.notNull())
        .execute()
      await db.schema.createIndex('ux_daily_stats').on('daily_stats').columns(['business_date', 'sector_id', 'user_id']).unique().execute()
      await db.schema
        .createTable('hourly_stats')
        .addColumn('business_date', 'varchar(10)', (c) => c.notNull())
        .addColumn('sector_id', 'integer', (c) => c.notNull())
        .addColumn('hour', 'integer', (c) => c.notNull())
        .addColumn('weekday', 'integer', (c) => c.notNull())
        .addColumn('issued', 'integer', (c) => c.notNull().defaultTo(0))
        .addPrimaryKeyConstraint('pk_hourly_stats', ['business_date', 'sector_id', 'hour'])
        .execute()

      // 6) Archivo histórico: los turnos viejos salen de las tablas operativas (que quedan livianas)
      await db.schema
        .createTable('tickets_archive')
        .addColumn('id', 'integer', (c) => c.primaryKey().notNull())
        .addColumn('code', 'varchar(12)', (c) => c.notNull())
        .addColumn('business_date', 'varchar(10)', (c) => c.notNull())
        .addColumn('button_id', 'integer', (c) => c.notNull())
        .addColumn('sector_id', 'integer', (c) => c.notNull())
        .addColumn('origin_sector_id', 'integer', (c) => c.notNull())
        .addColumn('priority', 'integer', (c) => c.notNull())
        .addColumn('status', 'varchar(12)', (c) => c.notNull())
        .addColumn('created_at', ts, (c) => c.notNull())
        .addColumn('called_at', ts)
        .addColumn('started_at', ts)
        .addColumn('finished_at', ts)
        .addColumn('called_by', 'integer')
        .addColumn('desk', 'varchar(60)')
        .addColumn('recall_count', 'integer', (c) => c.notNull())
        .addColumn('patient_id', 'integer')
        .addColumn('archived_at', ts, (c) => c.notNull())
        .execute()
      await db.schema.createIndex('ix_tickets_archive_date').on('tickets_archive').columns(['business_date', 'sector_id']).execute()
      await db.schema
        .createTable('ticket_events_archive')
        .addColumn('id', 'integer', (c) => c.primaryKey().notNull())
        .addColumn('ticket_id', 'integer', (c) => c.notNull())
        .addColumn('type', 'varchar(20)', (c) => c.notNull())
        .addColumn('user_id', 'integer')
        .addColumn('data', 'varchar(500)')
        .addColumn('created_at', ts, (c) => c.notNull())
        .execute()
      await db.schema.createIndex('ix_events_archive_ticket').on('ticket_events_archive').column('ticket_id').execute()

      // 7) Paciente: DNI cifrado + hash para buscar, consentimiento y obra social
      await db.schema.alterTable('patients').addColumn('document_hash', 'varchar(64)').execute()
      await db.schema.alterTable('patients').addColumn('document_enc', 'varchar(300)').execute()
      await db.schema.alterTable('patients').addColumn('document_last4', 'varchar(4)').execute()
      await db.schema.alterTable('patients').addColumn('consent_at', ts).execute()
      await db.schema.alterTable('patients').addColumn('consent_version', 'varchar(20)').execute()
      await db.schema.alterTable('patients').addColumn('health_insurance', 'varchar(80)').execute()
      await db.schema.alterTable('patients').addColumn('insurance_number', 'varchar(40)').execute()
      // DROP INDEX ... ON tabla es sintaxis de SQL Server; en PostgreSQL/SQLite va solo el nombre
      await (isMs ? db.schema.dropIndex('ux_patients_document').on('patients') : db.schema.dropIndex('ux_patients_document')).execute()
      if (isPg) await sql`ALTER TABLE patients ALTER COLUMN document DROP NOT NULL`.execute(db)
      if (isMs) await sql`ALTER TABLE patients ALTER COLUMN document varchar(20) NULL`.execute(db)
      await uniqueWhereNotNull(db, 'ux_patients_doc_hash', 'patients', 'document_hash')

      // 8) Turno: link privado para el QR y referencia para sincronizar turnos emitidos sin conexión
      await db.schema.alterTable('tickets').addColumn('public_token', 'varchar(32)').execute()
      await db.schema.alterTable('tickets').addColumn('offline_ref', 'varchar(40)').execute()
      await db.schema.alterTable('tickets').addColumn('origin', 'varchar(10)', (c) => c.notNull().defaultTo('online')).execute()
      await uniqueWhereNotNull(db, 'ux_tickets_public_token', 'tickets', 'public_token')
      await uniqueWhereNotNull(db, 'ux_tickets_offline_ref', 'tickets', 'offline_ref')

      // 9) Multimedia de la TV: el archivo va al disco; la base guarda solo los datos
      await db.schema
        .createTable('media')
        .addColumn('id', 'integer', id)
        .addColumn('file_key', 'varchar(40)', (c) => c.notNull().unique())
        .addColumn('kind', 'varchar(10)', (c) => c.notNull())
        .addColumn('mime', 'varchar(40)', (c) => c.notNull())
        .addColumn('size_bytes', 'integer', (c) => c.notNull())
        .addColumn('original_name', 'varchar(200)')
        .addColumn('sort_order', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('active', 'integer', (c) => c.notNull().defaultTo(1))
        .addColumn('created_at', ts, (c) => c.notNull())
        .execute()
    },
  },
}
