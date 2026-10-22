// One-time, idempotent migration of the historical cash workbook.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');

const workbook = process.argv.find(a => a.endsWith('.xlsx'));
if (!workbook) throw new Error('Pass the historical .xlsx path');
const python = process.env.GIR_PYTHON;
if (!python) throw new Error('Set GIR_PYTHON to the bundled Python executable');
const source = JSON.parse(execFileSync(python, [path.join(__dirname, 'extract-revenue.py'), workbook], { encoding:'utf8' }));
const workspaceId = '17f39873-e10f-4bdf-93ee-1f92b3e25251';
const normalize = s => String(s || '').trim().toLocaleLowerCase('en-IN');
const client = new Client({
  host: 'aws-0-ap-southeast-1.pooler.supabase.com', port:5432, database:'postgres',
  user:'postgres.isdxybpeagloikchhsbp', password:process.env.GIR_DB_PASSWORD,
  ssl:{ca:fs.readFileSync(process.env.GIR_DB_CA_PATH),rejectUnauthorized:true,servername:'aws-0-ap-southeast-1.pooler.supabase.com'},
  connectionTimeoutMillis:15000,
});

(async()=>{
  await client.connect();
  try {
    const clients = await client.query('select id,name from public.clients where workspace_id=$1',[workspaceId]);
    const known = new Map(clients.rows.map(c=>[normalize(c.name),c.id]));
    const unmatched = [...new Set(source.payments.filter(p=>!known.has(normalize(p.client))).map(p=>p.client))];
    const total = source.payments.reduce((sum,p)=>sum+p.amount,0);
    const corrected = source.payments.filter(p=>p.date_quality==='day_month_swapped');
    const monthOnly = source.payments.filter(p=>p.date_quality==='month_only');
    console.log(JSON.stringify({file:source.file,rows:source.payments.length,total,unmatched,correctedRows:corrected.map(p=>p.row),monthOnlyRows:monthOnly.map(p=>p.row)},null,2));
    if (!process.argv.includes('--migrate')) return;
    await client.query('begin');
    await client.query(fs.readFileSync(path.join(__dirname,'revenue-receipts.sql'),'utf8'));
    let inserted=0;
    for (const p of source.payments) {
      const result=await client.query(`insert into public.payment_receipts
        (id,workspace_id,client_id,client_name,amount,received_month,received_on,source,source_key,description,source_file,source_row,original_date,date_quality)
        values ($1,$2,$3,$4,$5,$6,$7,'historical_workbook',$8,$9,$10,$11,$12,$13)
        on conflict (workspace_id,source_key) do nothing`,
        [randomUUID(),workspaceId,known.get(normalize(p.client))||null,p.client,p.amount,p.month,p.received_on,`historical:${source.sha256}:${p.row}`,'Historical payment',source.file,p.row,p.original_date,p.date_quality]);
      inserted+=result.rowCount;
    }
    const recent=await client.query(`select w.id,w.client_id,c.name as client_name,w.service,w.quoted_total,w.advance_amount,
      to_char(w.paid_at,'YYYY-MM-DD') as paid_on from public.work_items w join public.clients c on c.id=w.client_id
      where w.workspace_id=$1 and w.status='paid' and w.paid_at is not null and not exists
      (select 1 from public.payment_receipts p where p.workspace_id=w.workspace_id and p.reference_kind='item' and p.reference_id=w.id)`,[workspaceId]);
    let backfilled=0;
    for(const item of recent.rows){
      const amount=Math.max(0,Number(item.quoted_total)-Number(item.advance_amount));
      if(!amount)continue;
      const result=await client.query(`insert into public.payment_receipts
        (id,workspace_id,client_id,client_name,amount,received_month,received_on,source,source_key,reference_kind,reference_id,description,date_quality)
        values ($1,$2,$3,$4,$5,$6,$7,'app',$8,'item',$9,$10,'date_only')
        on conflict (workspace_id,source_key) do nothing`,
        [randomUUID(),workspaceId,item.client_id,item.client_name,amount,item.paid_on.slice(0,7)+'-01',item.paid_on,`legacy-paid:${item.id}`,item.id,item.service]);
      backfilled+=result.rowCount;
    }
    const check=await client.query('select count(*)::int as count,sum(amount)::numeric(14,2) as total from public.payment_receipts where workspace_id=$1',[workspaceId]);
    await client.query('commit');
    console.log(JSON.stringify({insertedHistorical:inserted,backfilledRecent:backfilled,receiptLedger:check.rows[0]}));
  } catch(e) { await client.query('rollback').catch(()=>{}); throw e; }
  finally { await client.end(); }
})().catch(e=>{console.error('Revenue import failed:',e.message);process.exitCode=1;});
