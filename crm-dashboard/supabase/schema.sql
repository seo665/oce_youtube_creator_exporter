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
  scrape_count integer not null default 1 check (scrape_count > 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
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
drop index if exists public.leads_follow_up_date_idx;

create table if not exists public.scrape_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  keywords text[] not null,
  search_types text[] not null,
  max_results integer not null,
  status text not null default 'running' check (status in ('running', 'complete')),
  completed_keywords text[] not null default '{}',
  unique_leads integer not null default 0,
  new_leads integer not null default 0,
  duplicates integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.scrape_campaign_leads (
  campaign_id uuid not null references public.scrape_campaigns (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  keywords text[] not null default '{}',
  primary key (campaign_id, lead_id)
);

alter table public.leads
  add column if not exists scrape_count integer not null default 1,
  add column if not exists first_seen_at timestamptz not null default now(),
  add column if not exists last_seen_at timestamptz not null default now();

create index if not exists leads_scrape_count_idx on public.leads (scrape_count);

alter table public.scrape_campaigns enable row level security;
alter table public.scrape_campaign_leads enable row level security;

drop policy if exists "Admins view scrape campaigns" on public.scrape_campaigns;
create policy "Admins view scrape campaigns"
on public.scrape_campaigns for select to authenticated
using ((select public.is_crm_admin()));

drop policy if exists "Admins view campaign leads" on public.scrape_campaign_leads;
create policy "Admins view campaign leads"
on public.scrape_campaign_leads for select to authenticated
using ((select public.is_crm_admin()));

grant select on public.scrape_campaigns, public.scrape_campaign_leads to authenticated;

create or replace function public.create_scrape_campaign(
  p_name text,
  p_keywords text[],
  p_search_types text[],
  p_max_results integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign_id uuid;
begin
  if not public.is_crm_admin() then
    raise exception 'Administrator access is required';
  end if;
  if length(trim(coalesce(p_name, ''))) = 0 or length(p_name) > 100 then
    raise exception 'Enter a campaign name of 1 to 100 characters';
  end if;
  if coalesce(array_length(p_keywords, 1), 0) < 1 or array_length(p_keywords, 1) > 30 then
    raise exception 'A campaign must have 1 to 30 search phrases';
  end if;
  if exists (
    select 1
    from unnest(p_keywords) as input_keyword(keyword)
    where nullif(trim(input_keyword.keyword), '') is null
      or length(trim(input_keyword.keyword)) > 200
  ) then
    raise exception 'Search phrases must contain 1 to 200 characters';
  end if;
  if p_max_results is null or p_max_results < 1 or p_max_results > 25 then
    raise exception 'Results per phrase must be between 1 and 25';
  end if;
  if p_search_types is null
    or cardinality(p_search_types) < 1
    or cardinality(p_search_types) > 2
    or cardinality(array(select distinct search_type from unnest(p_search_types) as selected(search_type))) <> cardinality(p_search_types)
    or not (p_search_types <@ array['channel', 'video']::text[])
  then
    raise exception 'Choose channel search, video search, or both';
  end if;

  insert into public.scrape_campaigns (name, keywords, search_types, max_results, created_by)
  values (
    trim(p_name),
    (select array_agg(distinct trim(input_keyword.keyword)) from unnest(p_keywords) as input_keyword(keyword)),
    p_search_types,
    p_max_results,
    auth.uid()
  )
  returning id into v_campaign_id;
  return v_campaign_id;
end;
$$;

create or replace function public.record_scrape_keyword(
  p_campaign_id uuid,
  p_keyword text,
  p_leads jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign public.scrape_campaigns%rowtype;
  v_lead jsonb;
  v_lead_id uuid;
  v_is_new_lead boolean;
  v_link_inserted integer;
  v_keyword_new integer := 0;
  v_keyword_duplicates integer := 0;
  v_keyword_unique integer := 0;
  v_new_leads integer := 0;
  v_duplicates integer := 0;
  v_unique_leads integer := 0;
begin
  if not public.is_crm_admin() then
    raise exception 'Administrator access is required';
  end if;
  if p_leads is null or jsonb_typeof(p_leads) <> 'array' or jsonb_array_length(p_leads) > 50 then
    raise exception 'Scrape results must be an array of at most 50 channels';
  end if;
  if p_keyword is null or length(trim(p_keyword)) < 1 or length(trim(p_keyword)) > 200 then
    raise exception 'Enter a search phrase of 1 to 200 characters';
  end if;

  select * into v_campaign
  from public.scrape_campaigns
  where id = p_campaign_id and created_by = auth.uid()
  for update;
  if not found or v_campaign.status <> 'running' then
    raise exception 'This scrape campaign is not available to resume';
  end if;
  if not (trim(p_keyword) = any(v_campaign.keywords)) then
    raise exception 'This phrase is not part of the campaign';
  end if;
  if trim(p_keyword) = any(v_campaign.completed_keywords) then
    raise exception 'This campaign phrase has already been completed';
  end if;

  for v_lead in select value from jsonb_array_elements(p_leads)
  loop
    if length(trim(coalesce(v_lead->>'channel_id', ''))) = 0 then
      raise exception 'A scrape result is missing its YouTube channel ID';
    end if;

    insert into public.leads (
      channel_id, channel_name, channel_url, public_email,
      subscriber_count, lead_score, data, scrape_count
    )
    values (
      trim(v_lead->>'channel_id'),
      coalesce(v_lead->>'channel_name', ''),
      coalesce(v_lead->>'channel_url', ''),
      coalesce(v_lead->>'public_email', ''),
      nullif(v_lead->>'subscriber_count', '')::bigint,
      coalesce(nullif(v_lead->>'lead_score', '')::integer, 0),
      coalesce(v_lead->'data', '{}'::jsonb),
      1
    )
    on conflict (channel_id) do update set
      channel_name = coalesce(nullif(excluded.channel_name, ''), public.leads.channel_name),
      channel_url = coalesce(nullif(excluded.channel_url, ''), public.leads.channel_url),
      public_email = coalesce(nullif(excluded.public_email, ''), public.leads.public_email),
      subscriber_count = coalesce(excluded.subscriber_count, public.leads.subscriber_count),
      lead_score = greatest(public.leads.lead_score, excluded.lead_score),
      data = public.leads.data || excluded.data || jsonb_build_object(
        'source_keywords_all',
        (
          select string_agg(distinct trim(value), ' | ' order by trim(value))
          from regexp_split_to_table(
            concat_ws(
              ' | ',
              nullif(public.leads.data->>'source_keywords_all', ''),
              nullif(excluded.data->>'source_keywords_all', '')
            ),
            '\s*\|\s*'
          ) as phrase(value)
          where trim(value) <> ''
        ),
        'matched_titles_all',
        (
          select string_agg(distinct trim(value), ' | ' order by trim(value))
          from regexp_split_to_table(
            concat_ws(
              ' | ',
              nullif(public.leads.data->>'matched_titles_all', ''),
              nullif(excluded.data->>'matched_titles_all', '')
            ),
            '\s*\|\s*'
          ) as phrase(value)
          where trim(value) <> ''
        ),
        'matched_descriptions_all',
        (
          select string_agg(distinct trim(value), ' | ' order by trim(value))
          from regexp_split_to_table(
            concat_ws(
              ' | ',
              nullif(public.leads.data->>'matched_descriptions_all', ''),
              nullif(excluded.data->>'matched_descriptions_all', '')
            ),
            '\s*\|\s*'
          ) as phrase(value)
          where trim(value) <> ''
        )
      ),
      last_seen_at = now()
    returning id, (xmax = 0) into v_lead_id, v_is_new_lead;

    insert into public.scrape_campaign_leads (campaign_id, lead_id, keywords)
    values (p_campaign_id, v_lead_id, array[trim(p_keyword)])
    on conflict (campaign_id, lead_id) do nothing;
    get diagnostics v_link_inserted = row_count;

    if v_link_inserted = 1 then
      v_keyword_unique := v_keyword_unique + 1;
      v_unique_leads := v_unique_leads + 1;
      if v_is_new_lead then
        v_keyword_new := v_keyword_new + 1;
        v_new_leads := v_new_leads + 1;
      else
        update public.leads
        set scrape_count = scrape_count + 1
        where id = v_lead_id;
        v_keyword_duplicates := v_keyword_duplicates + 1;
        v_duplicates := v_duplicates + 1;
      end if;
    else
      update public.scrape_campaign_leads
      set keywords = array(
        select distinct keyword
        from unnest(keywords || array[trim(p_keyword)]) as keyword
      )
      where campaign_id = p_campaign_id and lead_id = v_lead_id;
    end if;
  end loop;

  update public.scrape_campaigns
  set completed_keywords = array_append(completed_keywords, trim(p_keyword)),
      unique_leads = unique_leads + v_keyword_unique,
      new_leads = new_leads + v_keyword_new,
      duplicates = duplicates + v_keyword_duplicates
  where id = p_campaign_id;

  return jsonb_build_object(
    'campaign_id', p_campaign_id,
    'keyword_unique', v_keyword_unique,
    'new_leads', v_keyword_new,
    'duplicates', v_keyword_duplicates
  );
end;
$$;

create or replace function public.complete_scrape_campaign(p_campaign_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign public.scrape_campaigns%rowtype;
begin
  if not public.is_crm_admin() then
    raise exception 'Administrator access is required';
  end if;
  select * into v_campaign
  from public.scrape_campaigns
  where id = p_campaign_id and created_by = auth.uid()
  for update;
  if not found then
    raise exception 'This scrape campaign was not found';
  end if;
  if cardinality(v_campaign.completed_keywords) <> cardinality(v_campaign.keywords) then
    raise exception 'Some campaign phrases are still incomplete';
  end if;
  update public.scrape_campaigns set status = 'complete' where id = p_campaign_id;
end;
$$;

revoke all on function public.create_scrape_campaign(text, text[], text[], integer) from public;
revoke all on function public.record_scrape_keyword(uuid, text, jsonb) from public;
revoke all on function public.complete_scrape_campaign(uuid) from public;
grant execute on function public.create_scrape_campaign(text, text[], text[], integer) to authenticated;
grant execute on function public.record_scrape_keyword(uuid, text, jsonb) to authenticated;
grant execute on function public.complete_scrape_campaign(uuid) to authenticated;

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

grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.leads to authenticated;
