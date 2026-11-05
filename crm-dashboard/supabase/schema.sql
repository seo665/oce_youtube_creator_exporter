create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role text not null default 'worker' check (role in ('admin', 'worker')),
  created_at timestamptz not null default now()
);

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.create_profile_for_new_user();

create or replace function public.is_crm_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  channel_id text not null unique,
  channel_name text not null default '',
  channel_url text not null default '',
  public_email text not null default '',
  subscriber_count bigint,
  lead_score integer not null default 0,
  data jsonb not null default '{}'::jsonb,
  crm_status text not null default 'new'
    check (crm_status in ('new', 'contacted', 'replied', 'qualified', 'not_interested', 'do_not_contact')),
  assigned_to uuid references public.profiles (id) on delete set null,
  notes text not null default '',
  follow_up_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists leads_assigned_to_idx on public.leads (assigned_to);
create index if not exists leads_crm_status_idx on public.leads (crm_status);
create index if not exists leads_follow_up_date_idx on public.leads (follow_up_date);

create or replace function public.set_lead_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists leads_updated_at on public.leads;
create trigger leads_updated_at
before update on public.leads
for each row execute procedure public.set_lead_updated_at();

create or replace function public.protect_worker_lead_updates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_crm_admin() then
    return new;
  end if;

  if old.assigned_to is distinct from auth.uid()
    or new.assigned_to is distinct from old.assigned_to
    or new.channel_id is distinct from old.channel_id
    or new.channel_name is distinct from old.channel_name
    or new.channel_url is distinct from old.channel_url
    or new.public_email is distinct from old.public_email
    or new.subscriber_count is distinct from old.subscriber_count
    or new.lead_score is distinct from old.lead_score
    or new.data is distinct from old.data
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Workers may only update CRM fields on leads assigned to them';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_worker_lead_updates on public.leads;
create trigger protect_worker_lead_updates
before update on public.leads
for each row execute procedure public.protect_worker_lead_updates();

alter table public.profiles enable row level security;
alter table public.leads enable row level security;

drop policy if exists "Profiles are visible to self and admins" on public.profiles;
create policy "Profiles are visible to self and admins"
on public.profiles for select to authenticated
using (id = (select auth.uid()) or (select public.is_crm_admin()));

drop policy if exists "Admins manage leads" on public.leads;
create policy "Admins manage leads"
on public.leads for all to authenticated
using ((select public.is_crm_admin()))
with check ((select public.is_crm_admin()));

drop policy if exists "Workers view assigned leads" on public.leads;
create policy "Workers view assigned leads"
on public.leads for select to authenticated
using (assigned_to = (select auth.uid()));

drop policy if exists "Workers update assigned leads" on public.leads;
create policy "Workers update assigned leads"
on public.leads for update to authenticated
using (assigned_to = (select auth.uid()))
with check (assigned_to = (select auth.uid()));
