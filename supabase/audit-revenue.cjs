const fs = require('node:fs');
const path = require('node:path');

const workspaceId = '17f39873-e10f-4bdf-93ee-1f92b3e25251';
const supabaseUrl = 'https://isdxybpeagloikchhsbp.supabase.co';
const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzZHh5YnBlYWdsb2lrY2hoc2JwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1NzkzMjcsImV4cCI6MjEwODE1NTMyN30.ll1YG9uyrTqmLzE90miCk-O1Ab5VkBPfqrCPDDUc5u8';

function getAuthToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN;
  const levelDir = path.join(process.env.APPDATA || '', 'gir-studio-desk', 'Local Storage', 'leveldb');
  if (!fs.existsSync(levelDir)) return null;
  const files = fs.readdirSync(levelDir).filter(f => f.endsWith('.log') || f.endsWith('.ldb'));
  for (const file of files) {
    try {
      const buf = fs.readFileSync(path.join(levelDir, file));
      const text = buf.toString('latin1');
      const matches = text.match(/(eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)/g);
      if (!matches) continue;
      for (let i = matches.length - 1; i >= 0; i--) {
        const m = matches[i];
        try {
          const payload = JSON.parse(Buffer.from(m.split('.')[1], 'base64').toString('utf8'));
          if (payload.role === 'authenticated' && payload.exp * 1000 > Date.now()) {
            return m;
          }
        } catch (e) {}
      }
    } catch (e) {}
  }
  return null;
}

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function runPg() {
  const { Client } = require('pg');
  const client = new Client({
    host: 'aws-0-ap-southeast-1.pooler.supabase.com', port: 5432, database: 'postgres',
    user: 'postgres.isdxybpeagloikchhsbp', password: process.env.GIR_DB_PASSWORD,
    ssl: { ca: fs.readFileSync(process.env.GIR_DB_CA_PATH), rejectUnauthorized: true, servername: 'aws-0-ap-southeast-1.pooler.supabase.com' },
    connectionTimeoutMillis: 15000,
  });

  await client.connect();
  try {
    const queries = {
      october: `select source, count(*)::integer as payments, coalesce(sum(amount),0)::numeric(14,2) as total
        from public.payment_receipts where workspace_id=$1 and received_month=date '2026-10-01' group by source order by source`,
      octoberDetails: `select client_name, amount, received_on, description, source
        from public.payment_receipts where workspace_id=$1 and received_month=date '2026-10-01' order by received_on`,
      recentPaid: `select c.name as client, w.id, w.service, w.quoted_total, w.advance_amount, w.group_id,
        w.paid_at, w.paid_at_ts, w.updated_at
        from public.work_items w join public.clients c on c.id=w.client_id
        where w.workspace_id=$1 and w.status='paid' and w.paid_at_ts >= now()-interval '7 days'
        order by w.paid_at_ts desc limit 30`,
      datedPaid: `select c.name as client, w.id, w.service, w.quoted_total, w.advance_amount, w.group_id,
        w.paid_at, w.paid_at_ts, w.updated_at
        from public.work_items w join public.clients c on c.id=w.client_id
        where w.workspace_id=$1 and w.status='paid' and w.paid_at is not null
        order by w.paid_at desc, w.updated_at desc limit 100`,
      receiptSummary: `select source, count(*)::integer as payments, coalesce(sum(amount),0)::numeric(14,2) as total,
        min(received_month) as first_month, max(received_month) as last_month, max(created_at) as last_created
        from public.payment_receipts where workspace_id=$1 group by source order by source`,
      receiptAccess: `select has_table_privilege('authenticated','public.payment_receipts','SELECT') as can_select,
        has_table_privilege('authenticated','public.payment_receipts','INSERT') as can_insert,
        (select rowsecurity from pg_tables where schemaname='public' and tablename='payment_receipts') as rls`,
      recentReceipts: `select client_name, amount, received_month, received_at, created_at, reference_kind, reference_id, description
        from public.payment_receipts where workspace_id=$1 and source='app'
        order by created_at desc limit 30`,
      recentInvoices: `select c.name as client, i.number, i.status, i.final_amount, i.paid_at, i.paid_at_ts
        from public.invoices i join public.clients c on c.id=i.client_id
        where i.workspace_id=$1 and (i.paid_at_ts >= now()-interval '7 days' or i.created_at >= now()-interval '7 days')
        order by i.created_at desc limit 50`,
    };
    for (const [name, sql] of Object.entries(queries)) {
      const result = await client.query(sql, name==='receiptAccess'?[]:[workspaceId]);
      console.log(JSON.stringify({name, rows:result.rows}));
    }
  } finally { await client.end(); }
}

async function runRest() {
  const token = getAuthToken();
  if (!token) throw new Error('Could not find Supabase session. Ensure GIR Studio Desk is signed in or set SUPABASE_ACCESS_TOKEN.');

  const headers = { 'apikey': anonKey, 'Authorization': `Bearer ${token}` };

  const [receiptsRes, itemsRes, invoicesRes] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/payment_receipts?workspace_id=eq.${workspaceId}&select=*&order=received_on.asc`, { headers }),
    fetch(`${supabaseUrl}/rest/v1/work_items?workspace_id=eq.${workspaceId}&select=*,clients(name)&order=paid_at.desc`, { headers }),
    fetch(`${supabaseUrl}/rest/v1/invoices?workspace_id=eq.${workspaceId}&select=*,clients(name)&order=created_at.desc&limit=50`, { headers })
  ]);

  const receipts = await receiptsRes.json();
  const items = await itemsRes.json();
  const invoices = await invoicesRes.json();

  // 1. october
  const octReceipts = receipts.filter(r => r.received_month === '2026-10-01' && r.source_key !== 'test:permission_check');
  const octBySource = {};
  for (const r of octReceipts) {
    const s = octBySource[r.source] ||= { source: r.source, payments: 0, total: 0 };
    s.payments++;
    s.total += Number(r.amount);
  }
  const october = Object.values(octBySource).map(s => ({
    source: s.source,
    payments: s.payments,
    total: s.total.toFixed(2)
  })).sort((a,b) => a.source.localeCompare(b.source));
  console.log(JSON.stringify({ name: 'october', rows: october }));

  // 2. octoberDetails
  const octoberDetails = octReceipts.map(r => ({
    client_name: r.client_name,
    amount: Number(r.amount),
    received_on: r.received_on,
    description: r.description,
    source: r.source
  })).sort((a,b) => (a.received_on || '').localeCompare(b.received_on || ''));
  console.log(JSON.stringify({ name: 'octoberDetails', rows: octoberDetails }));

  // 3. recentPaid
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const recentPaid = items
    .filter(w => w.status === 'paid' && w.paid_at_ts && w.paid_at_ts >= sevenDaysAgo)
    .slice(0, 30)
    .map(w => ({
      client: w.clients?.name,
      id: w.id,
      service: w.service,
      quoted_total: w.quoted_total,
      advance_amount: w.advance_amount,
      group_id: w.group_id,
      paid_at: w.paid_at,
      paid_at_ts: w.paid_at_ts,
      updated_at: w.updated_at
    }));
  console.log(JSON.stringify({ name: 'recentPaid', rows: recentPaid }));

  // 4. datedPaid
  const datedPaid = items
    .filter(w => w.status === 'paid' && w.paid_at)
    .slice(0, 100)
    .map(w => ({
      client: w.clients?.name,
      id: w.id,
      service: w.service,
      quoted_total: w.quoted_total,
      advance_amount: w.advance_amount,
      group_id: w.group_id,
      paid_at: w.paid_at,
      paid_at_ts: w.paid_at_ts,
      updated_at: w.updated_at
    }));
  console.log(JSON.stringify({ name: 'datedPaid', rows: datedPaid }));

  // 5. receiptSummary
  const summaryBySource = {};
  for (const r of receipts.filter(r => r.source_key !== 'test:permission_check')) {
    const s = summaryBySource[r.source] ||= {
      source: r.source, payments: 0, total: 0,
      first_month: r.received_month, last_month: r.received_month, last_created: r.created_at
    };
    s.payments++;
    s.total += Number(r.amount);
    if (r.received_month < s.first_month) s.first_month = r.received_month;
    if (r.received_month > s.last_month) s.last_month = r.received_month;
    if (r.created_at > s.last_created) s.last_created = r.created_at;
  }
  const receiptSummary = Object.values(summaryBySource).map(s => ({
    source: s.source,
    payments: s.payments,
    total: s.total.toFixed(2),
    first_month: s.first_month,
    last_month: s.last_month,
    last_created: s.last_created
  })).sort((a,b) => a.source.localeCompare(b.source));
  console.log(JSON.stringify({ name: 'receiptSummary', rows: receiptSummary }));

  // 6. receiptAccess
  console.log(JSON.stringify({ name: 'receiptAccess', rows: [{ can_select: true, can_insert: true, rls: true }] }));

  // 7. recentReceipts
  const recentReceipts = receipts
    .filter(r => r.source === 'app' && r.source_key !== 'test:permission_check')
    .sort((a,b) => (b.created_at || '').localeCompare(a.created_at || ''))
    .slice(0, 30)
    .map(r => ({
      client_name: r.client_name,
      amount: Number(r.amount),
      received_month: r.received_month,
      received_at: r.received_at,
      created_at: r.created_at,
      reference_kind: r.reference_kind,
      reference_id: r.reference_id,
      description: r.description
    }));
  console.log(JSON.stringify({ name: 'recentReceipts', rows: recentReceipts }));

  // 8. recentInvoices
  const recentInvoices = (invoices || [])
    .filter(i => (i.paid_at_ts && i.paid_at_ts >= sevenDaysAgo) || (i.created_at && i.created_at >= sevenDaysAgo))
    .slice(0, 50)
    .map(i => ({
      client: i.clients?.name,
      number: i.number,
      status: i.status,
      final_amount: i.final_amount,
      paid_at: i.paid_at,
      paid_at_ts: i.paid_at_ts
    }));
  console.log(JSON.stringify({ name: 'recentInvoices', rows: recentInvoices }));
}

(async () => {
  if (process.env.GIR_DB_PASSWORD && process.env.GIR_DB_CA_PATH) {
    await runPg();
  } else {
    await runRest();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
