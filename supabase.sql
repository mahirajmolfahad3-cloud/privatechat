-- Ping private chat schema
-- Run this entire file in Supabase SQL Editor.

create extension if not exists pgcrypto;

do $$
begin
  create type public.conversation_state as enum ('active');
exception when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  chat_id text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  display_name text not null default 'New user',
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint profiles_display_name_length check (char_length(display_name) between 1 and 40)
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  state public.conversation_state not null default 'active',
  created_at timestamptz not null default now(),
  constraint conversations_users_ordered check (user_a < user_b),
  constraint conversations_unique_pair unique (user_a, user_b)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  reply_to_id uuid references public.messages(id) on delete set null,
  content text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  edited_at timestamptz,
  constraint messages_content_length check (char_length(btrim(content)) between 1 and 4000)
);

-- Idempotent migrations so re-running this file upgrades existing databases.
alter table public.messages add column if not exists reply_to_id uuid references public.messages(id) on delete set null;
alter table public.messages add column if not exists edited_at timestamptz;

create index if not exists messages_conversation_created_idx on public.messages(conversation_id, created_at);
create index if not exists messages_reply_to_idx on public.messages(reply_to_id);
create index if not exists conversations_user_a_idx on public.conversations(user_a);
create index if not exists conversations_user_b_idx on public.conversations(user_b);
create index if not exists profiles_chat_id_idx on public.profiles(chat_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'display_name', 'New user'), 40)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

-- Profiles: a client can read its own profile and profiles it has a conversation with.
drop policy if exists profiles_select_own_or_contact on public.profiles;
create policy profiles_select_own_or_contact
on public.profiles for select
to authenticated
using (
  id = (select auth.uid())
  or exists (
    select 1 from public.conversations c
    where (c.user_a = (select auth.uid()) and c.user_b = profiles.id)
       or (c.user_b = (select auth.uid()) and c.user_a = profiles.id)
  )
);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

-- Conversation rows are only visible to their two members.
drop policy if exists conversations_select_member on public.conversations;
create policy conversations_select_member
on public.conversations for select
to authenticated
using ((select auth.uid()) in (user_a, user_b));

-- Messages are visible only to members of the parent conversation.
drop policy if exists messages_select_member on public.messages;
create policy messages_select_member
on public.messages for select
to authenticated
using (
  exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id
      and (select auth.uid()) in (c.user_a, c.user_b)
  )
);

drop policy if exists messages_insert_member_sender on public.messages;
create policy messages_insert_member_sender
on public.messages for insert
to authenticated
with check (
  sender_id = (select auth.uid())
  and exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id
      and (select auth.uid()) in (c.user_a, c.user_b)
  )
);

-- Users may edit only their own messages, and only the text/edited_at columns.
drop policy if exists messages_update_own on public.messages;
create policy messages_update_own
on public.messages for update
to authenticated
using (sender_id = (select auth.uid()))
with check (sender_id = (select auth.uid()));

revoke update on public.messages from authenticated;
grant update (content, edited_at) on public.messages to authenticated;

-- Read state is updated only through the SECURITY DEFINER mark_conversation_read() function.

-- Find a person by their public Ping ID without exposing the entire profiles table.
create or replace function public.find_user_by_chat_id(p_chat_id text)
returns table (id uuid, chat_id text, display_name text, last_seen_at timestamptz)
language sql
security definer set search_path = public
as $$
  select p.id, p.chat_id, p.display_name, p.last_seen_at
  from public.profiles p
  where upper(p.chat_id) = upper(btrim(p_chat_id))
    and p.id <> (select auth.uid())
  limit 1;
$$;

grant execute on function public.find_user_by_chat_id(text) to authenticated;

create or replace function public.get_or_create_conversation(other_user_id uuid)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  a uuid;
  b uuid;
  convo_id uuid;
begin
  if me is null then raise exception 'Not authenticated'; end if;
  if other_user_id is null or other_user_id = me then raise exception 'Invalid recipient'; end if;
  if not exists (select 1 from public.profiles where id = other_user_id) then raise exception 'Recipient not found'; end if;

  if me < other_user_id then a := me; b := other_user_id;
  else a := other_user_id; b := me; end if;

  insert into public.conversations (user_a, user_b)
  values (a, b)
  on conflict (user_a, user_b) do nothing
  returning id into convo_id;

  if convo_id is null then
    select id into convo_id from public.conversations where user_a = a and user_b = b;
  end if;

  return convo_id;
end;
$$;

grant execute on function public.get_or_create_conversation(uuid) to authenticated;

create or replace function public.list_my_conversations()
returns table (
  conversation_id uuid,
  other_user_id uuid,
  other_chat_id text,
  other_display_name text,
  other_last_seen_at timestamptz,
  last_message text,
  last_message_at timestamptz,
  unread_count bigint
)
language sql
security definer set search_path = public
as $$
  select
    c.id,
    other.id,
    other.chat_id,
    other.display_name,
    other.last_seen_at,
    lm.content,
    lm.created_at,
    coalesce(unread.count, 0)
  from public.conversations c
  join public.profiles other on other.id = case when c.user_a = (select auth.uid()) then c.user_b else c.user_a end
  left join lateral (
    select m.content, m.created_at
    from public.messages m
    where m.conversation_id = c.id
    order by m.created_at desc
    limit 1
  ) lm on true
  left join lateral (
    select count(*)::bigint as count
    from public.messages m
    where m.conversation_id = c.id
      and m.sender_id <> (select auth.uid())
      and m.read_at is null
  ) unread on true
  where (select auth.uid()) in (c.user_a, c.user_b)
  order by lm.created_at desc nulls last, c.created_at desc;
$$;

grant execute on function public.list_my_conversations() to authenticated;

create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id and (select auth.uid()) in (c.user_a, c.user_b)
  ) then
    raise exception 'Conversation not found';
  end if;

  update public.messages
  set read_at = coalesce(read_at, now())
  where conversation_id = p_conversation_id
    and sender_id <> (select auth.uid())
    and read_at is null;
end;
$$;

grant execute on function public.mark_conversation_read(uuid) to authenticated;

create or replace function public.touch_presence()
returns void
language sql
security definer set search_path = public
as $$
  update public.profiles set last_seen_at = now() where id = (select auth.uid());
$$;

grant execute on function public.touch_presence() to authenticated;

-- Needed for Supabase Realtime Postgres Changes. Make this idempotent for re-running the SQL file.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
