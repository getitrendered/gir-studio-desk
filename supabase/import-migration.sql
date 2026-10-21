-- Run after schema.sql. This adds a reviewed, atomic workbook migration.
alter table public.work_items add column if not exists serial text not null default '';
create table if not exists public.import_batches (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  file_name text not null,
  source_sha256 text not null,
  client_count integer not null default 0,
  group_count integer not null default 0,
  item_count integer not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists import_batches_workspace_hash_idx
  on public.import_batches(workspace_id,source_sha256);
alter table public.import_batches enable row level security;
drop policy if exists "members read import batches" on public.import_batches;
create policy "members read import batches" on public.import_batches
  for select to authenticated using (public.is_member(workspace_id));

create or replace function public.migrate_workbook(p_workspace_id uuid, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  batch_id uuid;
  source_hash text;
  existing public.import_batches%rowtype;
  client_row jsonb;
  group_row jsonb;
  item_row jsonb;
  client_id uuid;
  group_id uuid;
  v_client_count integer := 0;
  v_group_count integer := 0;
  v_item_count integer := 0;
begin
  if auth.uid() is null or not public.is_member(p_workspace_id) then
    raise exception 'You are not a member of this workspace';
  end if;
  if jsonb_typeof(p_payload->'clients') is distinct from 'array' then
    raise exception 'Migration payload must contain a clients array';
  end if;
  batch_id := (p_payload->>'batch_id')::uuid;
  source_hash := coalesce(p_payload->>'source_sha256','');
  if batch_id is null or length(source_hash) <> 64 then
    raise exception 'Migration needs a valid batch ID and workbook hash';
  end if;

  insert into public.import_batches(id,workspace_id,file_name,source_sha256)
  values(batch_id,p_workspace_id,coalesce(p_payload->>'file_name','Workbook'),source_hash)
  on conflict (workspace_id,source_sha256) do nothing;
  if not found then
    select * into existing from public.import_batches
      where workspace_id = p_workspace_id and source_sha256 = source_hash;
    return jsonb_build_object('already_imported',true,'batch_id',existing.id,
      'client_count',existing.client_count,'group_count',existing.group_count,'item_count',existing.item_count);
  end if;

  for client_row in select value from jsonb_array_elements(p_payload->'clients') loop
    client_id := (client_row->>'id')::uuid;
    insert into public.clients(id,workspace_id,name,billing,sort_order)
    values(client_id,p_workspace_id,client_row->>'name',coalesce(client_row->'billing','{}'::jsonb),
      coalesce((client_row->>'sort_order')::integer,0));
    v_client_count := v_client_count + 1;

    for group_row in select value from jsonb_array_elements(coalesce(client_row->'groups','[]'::jsonb)) loop
      insert into public.deal_groups(id,workspace_id,client_id,label,agreed_amount)
      values((group_row->>'id')::uuid,p_workspace_id,client_id,
        coalesce(group_row->>'label','Grouped deal'),nullif(group_row->>'agreed_amount','')::numeric);
      v_group_count := v_group_count + 1;
    end loop;

    for item_row in select value from jsonb_array_elements(coalesce(client_row->'items','[]'::jsonb)) loop
      group_id := nullif(item_row->>'group_id','')::uuid;
      if group_id is not null and not exists (
        select 1 from jsonb_array_elements(coalesce(client_row->'groups','[]'::jsonb)) g
        where (g->>'id')::uuid = group_id
      ) then
        raise exception 'A work row references a group outside its client';
      end if;
      insert into public.work_items(id,workspace_id,client_id,group_id,source_row,sort_order,serial,
        work_date,due_date,service,quantity,rate,quoted_total,status,revision_count,remarks)
      values((item_row->>'id')::uuid,p_workspace_id,client_id,group_id,
        nullif(item_row->>'source_row','')::integer,coalesce((item_row->>'sort_order')::integer,0),
        coalesce(item_row->>'serial',''),
        nullif(item_row->>'work_date','')::date,nullif(item_row->>'due_date','')::date,
        coalesce(item_row->>'service',''),coalesce((item_row->>'quantity')::numeric,1),
        coalesce((item_row->>'rate')::numeric,0),coalesce((item_row->>'quoted_total')::numeric,0),
        coalesce(item_row->>'status','pending'),coalesce((item_row->>'revision_count')::integer,0),
        coalesce(item_row->>'remarks',''));
      v_item_count := v_item_count + 1;
    end loop;
  end loop;

  update public.import_batches set client_count = v_client_count,
    group_count = v_group_count, item_count = v_item_count
  where id = batch_id;
  return jsonb_build_object('already_imported',false,'batch_id',batch_id,
    'client_count',v_client_count,'group_count',v_group_count,'item_count',v_item_count);
end $$;

revoke all on function public.migrate_workbook(uuid,jsonb) from public;
grant execute on function public.migrate_workbook(uuid,jsonb) to authenticated;
