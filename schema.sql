-- MinhaIA Central de Conhecimento 2.0
-- Execute no Supabase SQL Editor. Leia LEIA-ME.md antes de executar.
create extension if not exists pgcrypto;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Central MinhaIA',
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member','viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id,user_id)
);

create or replace function public.is_workspace_member(target_workspace uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.workspace_members m where m.workspace_id=target_workspace and m.user_id=auth.uid()); $$;

create or replace function public.is_workspace_editor(target_workspace uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.workspace_members m where m.workspace_id=target_workspace and m.user_id=auth.uid() and m.role in ('owner','admin','member')); $$;

create or replace function public.get_or_create_workspace()
returns uuid language plpgsql security definer set search_path=public
as $$
declare result_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select workspace_id into result_id from public.workspace_members where user_id=auth.uid() order by created_at limit 1;
  if result_id is null then
    insert into public.workspaces(name,owner_id) values ('Central MinhaIA',auth.uid()) returning id into result_id;
    insert into public.workspace_members(workspace_id,user_id,role) values(result_id,auth.uid(),'owner');
  end if;
  return result_id;
end; $$;

create table if not exists public.knowledge_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  record_type text not null check (record_type in ('knowledge','folders','agents','media')),
  record_id text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  unique(workspace_id,record_type,record_id)
);
create index if not exists knowledge_records_workspace_type_idx on public.knowledge_records(workspace_id,record_type);
create index if not exists knowledge_records_payload_gin_idx on public.knowledge_records using gin(payload);

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  key_hash text not null unique,
  key_prefix text not null,
  permissions text[] not null default array['read']::text[],
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.knowledge_records enable row level security;
alter table public.api_keys enable row level security;

drop policy if exists "members can view their workspaces" on public.workspaces;
create policy "members can view their workspaces" on public.workspaces for select to authenticated using (public.is_workspace_member(id));
drop policy if exists "members can view workspace members" on public.workspace_members;
create policy "members can view workspace members" on public.workspace_members for select to authenticated using (public.is_workspace_member(workspace_id));
drop policy if exists "members can read records" on public.knowledge_records;
create policy "members can read records" on public.knowledge_records for select to authenticated using (public.is_workspace_member(workspace_id));
drop policy if exists "members can insert records" on public.knowledge_records;
create policy "members can insert records" on public.knowledge_records for insert to authenticated with check (public.is_workspace_editor(workspace_id));
drop policy if exists "members can update records" on public.knowledge_records;
create policy "members can update records" on public.knowledge_records for update to authenticated using (public.is_workspace_editor(workspace_id)) with check (public.is_workspace_editor(workspace_id));
drop policy if exists "members can delete records" on public.knowledge_records;
create policy "members can delete records" on public.knowledge_records for delete to authenticated using (public.is_workspace_editor(workspace_id));
-- api_keys não tem políticas para o navegador: somente a Edge Function com service role acessa a tabela.

create or replace function public.create_my_api_key(p_name text, p_permissions text[] default array['read']::text[])
returns text language plpgsql security definer set search_path=public,extensions
as $$
declare wid uuid; raw_key text; perms text[];
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select workspace_id into wid from public.workspace_members where user_id=auth.uid() and role in ('owner','admin') order by created_at limit 1;
  if wid is null then raise exception 'Workspace owner/admin permission required'; end if;
  perms := coalesce(p_permissions,array['read']::text[]);
  if not (perms <@ array['read','write','delete']::text[]) or cardinality(perms)=0 then raise exception 'Invalid permissions'; end if;
  raw_key := 'mia_' || encode(gen_random_bytes(32),'hex');
  insert into public.api_keys(workspace_id,name,key_hash,key_prefix,permissions,created_by)
  values(wid,left(coalesce(p_name,'API externa'),80),encode(digest(raw_key,'sha256'),'hex'),left(raw_key,12),perms,auth.uid());
  return raw_key;
end; $$;

-- Bucket privado para documentos e anexos.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('knowledge-files','knowledge-files',false,52428800,null)
on conflict (id) do update set public=false;

drop policy if exists "workspace members read knowledge files" on storage.objects;
create policy "workspace members read knowledge files" on storage.objects for select to authenticated
using (bucket_id='knowledge-files' and public.is_workspace_member((storage.foldername(name))[1]::uuid));
drop policy if exists "workspace members upload knowledge files" on storage.objects;
create policy "workspace members upload knowledge files" on storage.objects for insert to authenticated
with check (bucket_id='knowledge-files' and public.is_workspace_editor((storage.foldername(name))[1]::uuid));
drop policy if exists "workspace members update knowledge files" on storage.objects;
create policy "workspace members update knowledge files" on storage.objects for update to authenticated
using (bucket_id='knowledge-files' and public.is_workspace_editor((storage.foldername(name))[1]::uuid))
with check (bucket_id='knowledge-files' and public.is_workspace_editor((storage.foldername(name))[1]::uuid));
drop policy if exists "workspace members delete knowledge files" on storage.objects;
create policy "workspace members delete knowledge files" on storage.objects for delete to authenticated
using (bucket_id='knowledge-files' and public.is_workspace_editor((storage.foldername(name))[1]::uuid));

revoke all on function public.get_or_create_workspace() from public, anon;
revoke all on function public.is_workspace_member(uuid) from public, anon;
revoke all on function public.is_workspace_editor(uuid) from public, anon;
revoke all on function public.create_my_api_key(text,text[]) from public, anon;
grant execute on function public.get_or_create_workspace() to authenticated;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.is_workspace_editor(uuid) to authenticated;
grant execute on function public.create_my_api_key(text,text[]) to authenticated;
