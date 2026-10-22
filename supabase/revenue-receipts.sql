-- Cash receipts are separate from work status. Historical workbook rows and new
-- payments share this ledger, so imported paid work is never counted twice.
alter table public.work_items add column if not exists paid_at_ts timestamptz;
alter table public.invoices add column if not exists paid_at_ts timestamptz;

create table if not exists public.payment_receipts (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  client_name text not null,
  amount numeric(14,2) not null check (amount >= 0),
  received_month date not null,
  received_on date,
  received_at timestamptz,
  source text not null check (source in ('historical_workbook','app')),
  source_key text not null,
  reference_kind text,
  reference_id uuid,
  description text not null default '',
  source_file text,
  source_row integer,
  original_date date,
  date_quality text not null default 'exact',
  created_at timestamptz not null default now(),
  unique (workspace_id,source_key)
);
create index if not exists payment_receipts_month_idx on public.payment_receipts(workspace_id,received_month,received_on);
alter table public.payment_receipts enable row level security;
drop policy if exists "members read payment receipts" on public.payment_receipts;
drop policy if exists "members insert payment receipts" on public.payment_receipts;
drop policy if exists "members update payment receipts" on public.payment_receipts;
drop policy if exists "members delete payment receipts" on public.payment_receipts;
create policy "members read payment receipts" on public.payment_receipts for select to authenticated using (public.is_member(workspace_id));
create policy "members insert payment receipts" on public.payment_receipts for insert to authenticated with check (public.is_member(workspace_id));
create policy "members update payment receipts" on public.payment_receipts for update to authenticated using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
create policy "members delete payment receipts" on public.payment_receipts for delete to authenticated using (public.is_member(workspace_id));
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='payment_receipts') then
    alter publication supabase_realtime add table public.payment_receipts;
  end if;
end $$;
notify pgrst, 'reload schema';
