-- Run once in the Supabase SQL editor. Create two users in Authentication first.
create extension if not exists pgcrypto;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  name text not null default 'GIR Studio',
  join_code text not null unique default upper(substr(encode(gen_random_bytes(9),'hex'),1,12)),
  business jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists public.members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_data text not null default '',
  primary key (workspace_id,user_id)
);
create table if not exists public.clients (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  billing jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.deal_groups (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  label text not null default 'Grouped deal',
  agreed_amount numeric(14,2),
  created_at timestamptz not null default now()
);
create table if not exists public.project_groups (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  label text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.work_items (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  group_id uuid references public.deal_groups(id) on delete set null,
  project_group_id uuid references public.project_groups(id) on delete set null,
  source_row integer,
  sort_order integer not null default 0,
  serial text not null default '',
  work_date date,
  due_date date,
  service text not null default '',
  quantity numeric(14,2) not null default 1,
  rate numeric(14,2) not null default 0,
  quoted_total numeric(14,2) not null default 0,
  advance_amount numeric(14,2) not null default 0,
  advance_received_at date,
  paid_at date,
  status text not null default 'pending' check (status in ('pending','working','changes','sent','paid','discarded')),
  revision_count integer not null default 0,
  assignee_id uuid references auth.users(id),
  remarks text not null default '',
  updated_at timestamptz not null default now()
);
create table if not exists public.invoices (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  number text not null,
  issue_date date not null,
  item_ids uuid[] not null,
  lines jsonb not null,
  subtotal numeric(14,2) not null,
  discount numeric(14,2) not null default 0,
  final_amount numeric(14,2) not null,
  advance_amount numeric(14,2) not null default 0,
  paid_at date,
  status text not null default 'issued' check (status in ('issued','paid')),
  seller jsonb not null default '{}'::jsonb,
  buyer jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.members where workspace_id = ws and user_id = auth.uid()) $$;
create or replace function public.is_owner(ws uuid) returns boolean
language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.workspaces where id = ws and owner_id = auth.uid()) $$;

alter table public.workspaces enable row level security;
alter table public.members enable row level security;
alter table public.clients enable row level security;
alter table public.deal_groups enable row level security;
alter table public.project_groups enable row level security;
alter table public.work_items enable row level security;
alter table public.invoices enable row level security;

create policy "workspace members read" on public.workspaces for select to authenticated using (public.is_member(id));
create policy "owners create workspace" on public.workspaces for insert to authenticated with check (owner_id = auth.uid());
create policy "members edit workspace" on public.workspaces for update to authenticated using (public.is_member(id)) with check (public.is_member(id));
create policy "members read members" on public.members for select to authenticated using (public.is_member(workspace_id));
create policy "owner adds self" on public.members for insert to authenticated with check (user_id = auth.uid() and public.is_owner(workspace_id));
create policy "member edits own name" on public.members for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.join_workspace(code text, name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare ws uuid;
begin
  select id into ws from public.workspaces where join_code = upper(trim(code));
  if ws is null then raise exception 'Workspace code not found'; end if;
  insert into public.members(workspace_id,user_id,display_name) values(ws,auth.uid(),coalesce(nullif(trim(name),''),'Team member')) on conflict do nothing;
  return ws;
end $$;
grant execute on function public.join_workspace(text,text) to authenticated;

create policy "members read clients" on public.clients for select to authenticated using (public.is_member(workspace_id));
create policy "members insert clients" on public.clients for insert to authenticated with check (public.is_member(workspace_id));
create policy "members update clients" on public.clients for update to authenticated using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
create policy "members delete clients" on public.clients for delete to authenticated using (public.is_member(workspace_id));
create policy "members read groups" on public.deal_groups for select to authenticated using (public.is_member(workspace_id));
create policy "members insert groups" on public.deal_groups for insert to authenticated with check (public.is_member(workspace_id));
create policy "members update groups" on public.deal_groups for update to authenticated using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
create policy "members delete groups" on public.deal_groups for delete to authenticated using (public.is_member(workspace_id));
create policy "members read project groups" on public.project_groups for select to authenticated using (public.is_member(workspace_id));
create policy "members insert project groups" on public.project_groups for insert to authenticated with check (public.is_member(workspace_id));
create policy "members update project groups" on public.project_groups for update to authenticated using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
create policy "members delete project groups" on public.project_groups for delete to authenticated using (public.is_member(workspace_id));
create policy "members read items" on public.work_items for select to authenticated using (public.is_member(workspace_id));
create policy "members insert items" on public.work_items for insert to authenticated with check (public.is_member(workspace_id));
create policy "members update items" on public.work_items for update to authenticated using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
create policy "members delete items" on public.work_items for delete to authenticated using (public.is_member(workspace_id));
create policy "members read invoices" on public.invoices for select to authenticated using (public.is_member(workspace_id));
create policy "members insert invoices" on public.invoices for insert to authenticated with check (public.is_member(workspace_id));
create policy "members update invoices" on public.invoices for update to authenticated using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));

alter publication supabase_realtime add table public.clients;
alter publication supabase_realtime add table public.deal_groups;
alter publication supabase_realtime add table public.project_groups;
alter publication supabase_realtime add table public.work_items;
alter publication supabase_realtime add table public.invoices;
alter publication supabase_realtime add table public.members;
