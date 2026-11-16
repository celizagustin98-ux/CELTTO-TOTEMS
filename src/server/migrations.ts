import { MssqlAdapter, PostgresAdapter, type Kysely } from 'kysely'
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
        .addColumn('status', 'varchar(12)', (c) => c.notNull())
        .addColumn('created_at', 'varchar(30)', (c) => c.notNull())
        .addColumn('called_at', 'varchar(30)')
        .addColumn('last_call_at', 'varchar(30)')
        .addColumn('started_at', 'varchar(30)')
        .addColumn('finished_at', 'varchar(30)')
        .addColumn('called_by', 'integer', (c) => c.references('users.id'))
        .addColumn('desk', 'varchar(60)')
        .addColumn('recall_count', 'integer', (c) => c.notNull().defaultTo(0))
        .execute()
      await db.schema
        .createIndex('ix_tickets_queue')
        .on('tickets')
        .columns(['sector_id', 'status', 'business_date'])
        .execute()
      await db.schema
        .createIndex('ux_tickets_code_day')
        .on('tickets')
        .columns(['business_date', 'code'])
        .unique()
        .execute()

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
}
