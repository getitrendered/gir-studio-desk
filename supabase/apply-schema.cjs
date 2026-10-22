const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const password = process.env.GIR_DB_PASSWORD;
if (!password) throw new Error('Set GIR_DB_PASSWORD before running this setup script.');
const caPath = process.env.GIR_DB_CA_PATH;
if (!caPath) throw new Error('Set GIR_DB_CA_PATH to the CA certificate downloaded from Supabase Database Settings.');

const client = new Client({
  host: 'aws-0-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.isdxybpeagloikchhsbp',
  password,
  ssl: { ca: fs.readFileSync(caPath), rejectUnauthorized: true, servername: 'aws-0-ap-southeast-1.pooler.supabase.com' },
  connectionTimeoutMillis: 15000,
});

(async () => {
  await client.connect();
  try {
    if (process.argv.includes('--workspace')) {
      const result = await client.query('select w.id,w.name,w.join_code,count(c.id)::integer as clients from public.workspaces w left join public.clients c on c.workspace_id=w.id group by w.id,w.name,w.join_code order by clients desc');
      console.log('Existing workspaces:', result.rows);
      return;
    }
    if (process.argv.includes('--check')) {
      const result = await client.query("select (select count(*)::integer from auth.users) as auth_users, (select count(*)::integer from public.workspaces) as workspaces, exists(select 1 from information_schema.columns where table_schema='public' and table_name='work_items' and column_name='advance_amount') as advance_ready, exists(select 1 from information_schema.columns where table_schema='public' and table_name='work_items' and column_name='project_group_id') as project_groups_ready, to_regprocedure('public.join_gir_workspace(text,text)') is not null as gir_join_ready");
      console.log('Supabase setup status:', result.rows[0]);
      return;
    }
    if (process.argv.includes('--upgrade')) {
      await client.query('begin');
      await client.query(fs.readFileSync(path.join(__dirname, 'import-migration.sql'), 'utf8'));
      await client.query(fs.readFileSync(path.join(__dirname, 'revenue-receipts.sql'), 'utf8'));
      await client.query('commit');
      console.log('Supabase import schema upgraded.');
      return;
    }
    const existing = await client.query("select to_regclass('public.workspaces') as workspaces, to_regclass('public.import_batches') as import_batches");
    if (existing.rows[0].workspaces || existing.rows[0].import_batches) {
      throw new Error('Some app tables already exist; inspect the schema before applying the initial migration.');
    }
    await client.query('begin');
    await client.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, 'import-migration.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, 'revenue-receipts.sql'), 'utf8'));
    await client.query('commit');
    const result = await client.query("select to_regclass('public.workspaces') is not null as workspaces, to_regclass('public.import_batches') is not null as import_batches, to_regprocedure('public.migrate_workbook(uuid,jsonb)') is not null as migrate_workbook");
    console.log('Supabase schema installed:', result.rows[0]);
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
})().catch(error => {
  console.error('Supabase setup failed:', error.message);
  process.exitCode = 1;
});
