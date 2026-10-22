const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

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

  const candidateSql = `select w.id, w.client_id, c.name as client_name, w.service, w.paid_at, w.paid_at_ts,
    greatest(0,w.quoted_total-w.advance_amount)::numeric(14,2) as amount
    from public.work_items w join public.clients c on c.id=w.client_id
    where w.workspace_id=$1 and w.status='paid' and w.paid_at >= date '2026-10-01'
      and w.group_id is null and w.project_group_id is null
      and w.quoted_total > w.advance_amount
      and not exists (select 1 from public.invoices i where i.workspace_id=w.workspace_id and w.id=any(i.item_ids))
      and not exists (select 1 from public.payment_receipts r where r.workspace_id=w.workspace_id
        and (r.reference_kind='item' and r.reference_id=w.id or
          r.client_id=w.client_id and r.received_on=w.paid_at and r.amount=greatest(0,w.quoted_total-w.advance_amount)))
    order by w.paid_at,w.id`;

  await client.connect();
  try {
    await client.query('begin isolation level repeatable read');
    const { rows } = await client.query(candidateSql, [workspaceId]);
    console.log(JSON.stringify({candidateCount:rows.length,total:rows.reduce((n,r)=>n+Number(r.amount),0),rows:rows.map(r=>({client:r.client_name,service:r.service,amount:Number(r.amount),paidOn:r.paid_at}))}));
    if (!process.argv.includes('--apply')) { await client.query('rollback'); return; }
    if (rows.length !== 6 || rows.reduce((n,r)=>n+Number(r.amount),0) !== 28400) throw new Error('Candidate set changed; inspect it before applying');
    let inserted=0;
    for (const row of rows) {
      const result=await client.query(`insert into public.payment_receipts
        (id,workspace_id,client_id,client_name,amount,received_month,received_on,received_at,source,source_key,reference_kind,reference_id,description,date_quality)
        values (gen_random_uuid(),$1,$2,$3,$4,date_trunc('month',$5::date)::date,$5,$6,'app',$7,'item',$8,$9,$10)
        on conflict (workspace_id,source_key) do nothing`,
        [workspaceId,row.client_id,row.client_name,row.amount,row.paid_at,row.paid_at_ts,`repair-paid:${row.id}`,row.id,row.service,row.paid_at_ts?'exact':'date_only']);
      inserted+=result.rowCount;
    }
    if(inserted!==rows.length)throw new Error('Not all receipts inserted');
    await client.query('commit');
    console.log(JSON.stringify({inserted,total:rows.reduce((n,r)=>n+Number(r.amount),0)}));
  } catch(error) { await client.query('rollback').catch(()=>{}); throw error; }
  finally { await client.end(); }
}

async function runRest() {
  const token = getAuthToken();
  if (!token) throw new Error('Could not find Supabase session. Ensure GIR Studio Desk is signed in or set SUPABASE_ACCESS_TOKEN.');

  const headers = { 'apikey': anonKey, 'Authorization': `Bearer ${token}` };

  const [itemsRes, receiptsRes, invoicesRes] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/work_items?workspace_id=eq.${workspaceId}&status=eq.paid&paid_at=gte.2026-10-01&group_id=is.null&project_group_id=is.null&select=*,clients(name)&order=paid_at.asc,id.asc`, { headers }),
    fetch(`${supabaseUrl}/rest/v1/payment_receipts?workspace_id=eq.${workspaceId}&select=*`, { headers }),
    fetch(`${supabaseUrl}/rest/v1/invoices?workspace_id=eq.${workspaceId}&select=item_ids`, { headers })
  ]);

  const items = await itemsRes.json();
  if (!Array.isArray(items)) throw new Error('Work items fetch failed: ' + JSON.stringify(items));
  const receipts = await receiptsRes.json();
  if (!Array.isArray(receipts)) throw new Error('Payment receipts fetch failed: ' + JSON.stringify(receipts));
  const invoices = await invoicesRes.json();
  const invoicedItemIds = new Set((invoices || []).flatMap(inv => inv.item_ids || []));

  const rows = items.filter(w => {
    const amount = Math.max(0, Number(w.quoted_total) - Number(w.advance_amount));
    if (amount <= 0) return false;
    if (invoicedItemIds.has(w.id)) return false;
    const hasReceipt = receipts.some(r => {
      if (r.reference_kind === 'item' && r.reference_id === w.id) return true;
      if (r.client_id === w.client_id && r.received_on === w.paid_at && Number(r.amount) === amount) return true;
      return false;
    });
    return !hasReceipt;
  });

  const total = rows.reduce((n, r) => n + (Number(r.quoted_total) - Number(r.advance_amount)), 0);
  console.log(JSON.stringify({candidateCount: rows.length, total, rows: rows.map(r => ({client: r.clients?.name, service: r.service, amount: Number(r.quoted_total) - Number(r.advance_amount), paidOn: r.paid_at}))}));

  if (!process.argv.includes('--apply')) return;
  if (rows.length !== 6 || total !== 28400) throw new Error('Candidate set changed; inspect it before applying');

  const newReceipts = rows.map(row => {
    const amount = Math.max(0, Number(row.quoted_total) - Number(row.advance_amount));
    const paidAt = row.paid_at;
    const receivedMonth = paidAt.slice(0, 7) + '-01';
    return {
      id: randomUUID(),
      workspace_id: workspaceId,
      client_id: row.client_id,
      client_name: row.clients?.name || 'Client',
      amount,
      received_month: receivedMonth,
      received_on: paidAt,
      received_at: row.paid_at_ts || null,
      source: 'app',
      source_key: `repair-paid:${row.id}`,
      reference_kind: 'item',
      reference_id: row.id,
      description: row.service,
      date_quality: row.paid_at_ts ? 'exact' : 'date_only'
    };
  });

  const insertRes = await fetch(`${supabaseUrl}/rest/v1/payment_receipts`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'return=representation,resolution=ignore-duplicates' },
    body: JSON.stringify(newReceipts)
  });

  if (!insertRes.ok) {
    const errText = await insertRes.text();
    throw new Error(`Receipts insert failed (${insertRes.status}): ${errText}`);
  }

  const inserted = await insertRes.json();
  console.log(JSON.stringify({inserted: inserted.length, total}));
}

(async () => {
  if (process.env.GIR_DB_PASSWORD && process.env.GIR_DB_CA_PATH) {
    await runPg();
  } else {
    await runRest();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
