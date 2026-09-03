-- ============================================================================
-- KINDRED CHAT — SUPABASE SCHEMA
-- Paste this entire file into Supabase → SQL Editor → New query → Run
-- Safe to re-run: uses IF NOT EXISTS / OR REPLACE / drop-then-create for policies
-- ============================================================================

-- ----------------------------------------------------------------------------
-- EXTENSIONS
-- ----------------------------------------------------------------------------
create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- ============================================================================
-- TABLES
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PROFILES
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text not null,
  bio text default '' not null,
  avatar_url text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  last_seen timestamptz default now() not null,
  is_online boolean default false not null,
  constraint username_format check (username ~ '^[a-zA-Z0-9_.]{3,20}$')
);

create index if not exists idx_profiles_username on public.profiles (username);

-- ----------------------------------------------------------------------------
-- CONVERSATIONS
-- ----------------------------------------------------------------------------
create table if not exists public.conversations (
  id uuid primary key default uuid_generate_v4(),
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  last_message_at timestamptz default now() not null
);

-- ----------------------------------------------------------------------------
-- CONVERSATION MEMBERS
-- ----------------------------------------------------------------------------
create table if not exists public.conversation_members (
  id uuid primary key default uuid_generate_v4(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz default now() not null,
  is_pinned boolean default false not null,
  is_muted boolean default false not null,
  last_read_at timestamptz default now() not null,
  unique (conversation_id, user_id)
);

create index if not exists idx_conv_members_user on public.conversation_members (user_id);
create index if not exists idx_conv_members_conv on public.conversation_members (conversation_id);

-- ----------------------------------------------------------------------------
-- MESSAGES
-- ----------------------------------------------------------------------------
create table if not exists public.messages (
  id uuid primary key default uuid_generate_v4(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  content text,
  message_type text default 'text' not null check (message_type in ('text', 'image', 'file')),
  media_url text,
  reply_to_id uuid references public.messages(id) on delete set null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  is_edited boolean default false not null,
  is_deleted boolean default false not null
);

create index if not exists idx_messages_conv on public.messages (conversation_id, created_at desc);
create index if not exists idx_messages_sender on public.messages (sender_id);

-- ----------------------------------------------------------------------------
-- MESSAGE REACTIONS
-- ----------------------------------------------------------------------------
create table if not exists public.message_reactions (
  id uuid primary key default uuid_generate_v4(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null,
  created_at timestamptz default now() not null,
  unique (message_id, user_id, reaction)
);

create index if not exists idx_reactions_message on public.message_reactions (message_id);

-- ----------------------------------------------------------------------------
-- TYPING INDICATORS (ephemeral — rows are upserted and expire client-side)
-- ----------------------------------------------------------------------------
create table if not exists public.typing_indicators (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  updated_at timestamptz default now() not null,
  primary key (conversation_id, user_id)
);

-- ----------------------------------------------------------------------------
-- MESSAGE READ RECEIPTS (per-message, per-user — powers real "seen")
-- ----------------------------------------------------------------------------
create table if not exists public.message_reads (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz default now() not null,
  primary key (message_id, user_id)
);

create index if not exists idx_message_reads_message on public.message_reads (message_id);

-- ============================================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Auto-update updated_at columns
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists trg_messages_updated_at on public.messages;
create trigger trg_messages_updated_at
  before update on public.messages
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Auto-create profile on signup
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  base_username text;
  final_username text;
  suffix int := 0;
begin
  base_username := coalesce(
    nullif(regexp_replace(lower(new.raw_user_meta_data->>'username'), '[^a-z0-9_.]', '', 'g'), ''),
    'user_' || substr(new.id::text, 1, 8)
  );
  final_username := base_username;

  while exists (select 1 from public.profiles where username = final_username) loop
    suffix := suffix + 1;
    final_username := base_username || suffix::text;
  end loop;

  insert into public.profiles (id, username, display_name, avatar_url)
  values (
    new.id,
    final_username,
    coalesce(new.raw_user_meta_data->>'display_name', base_username),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- Bump conversation.last_message_at whenever a message is inserted
-- ----------------------------------------------------------------------------
create or replace function public.bump_conversation_last_message()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update public.conversations
  set last_message_at = new.created_at,
      updated_at = now()
  where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists trg_bump_last_message on public.messages;
create trigger trg_bump_last_message
  after insert on public.messages
  for each row execute function public.bump_conversation_last_message();

-- ----------------------------------------------------------------------------
-- Helper: is the current user a member of a conversation?
-- (security definer avoids RLS recursion between messages <-> conversation_members)
-- ----------------------------------------------------------------------------
create or replace function public.is_conversation_member(p_conversation_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.conversation_members
    where conversation_id = p_conversation_id and user_id = p_user_id
  );
$$;

-- ----------------------------------------------------------------------------
-- RPC: find or create a 1:1 conversation between the caller and another user
-- ----------------------------------------------------------------------------
create or replace function public.get_or_create_direct_conversation(other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  existing_id uuid;
  new_id uuid;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;
  if me = other_user_id then
    raise exception 'cannot start a conversation with yourself';
  end if;

  select cm1.conversation_id into existing_id
  from public.conversation_members cm1
  join public.conversation_members cm2
    on cm1.conversation_id = cm2.conversation_id
  where cm1.user_id = me
    and cm2.user_id = other_user_id
    and (
      select count(*) from public.conversation_members cm3
      where cm3.conversation_id = cm1.conversation_id
    ) = 2
  limit 1;

  if existing_id is not null then
    return existing_id;
  end if;

  insert into public.conversations default values returning id into new_id;
  insert into public.conversation_members (conversation_id, user_id) values (new_id, me);
  insert into public.conversation_members (conversation_id, user_id) values (new_id, other_user_id);

  return new_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC: mark all messages in a conversation as read by the caller
-- ----------------------------------------------------------------------------
create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if not public.is_conversation_member(p_conversation_id, me) then
    raise exception 'not a member of this conversation';
  end if;

  insert into public.message_reads (message_id, user_id, read_at)
  select m.id, me, now()
  from public.messages m
  where m.conversation_id = p_conversation_id
    and m.sender_id <> me
  on conflict (message_id, user_id) do nothing;

  update public.conversation_members
  set last_read_at = now()
  where conversation_id = p_conversation_id and user_id = me;
end;
$$;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_reactions enable row level security;
alter table public.typing_indicators enable row level security;
alter table public.message_reads enable row level security;

-- ----------------------------------------------------------------------------
-- PROFILES
-- ----------------------------------------------------------------------------
drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all"
  on public.profiles for select
  using (true);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);

-- ----------------------------------------------------------------------------
-- CONVERSATIONS — visible only to members
-- ----------------------------------------------------------------------------
drop policy if exists "conversations_select_member" on public.conversations;
create policy "conversations_select_member"
  on public.conversations for select
  using (public.is_conversation_member(id, auth.uid()));

drop policy if exists "conversations_insert_auth" on public.conversations;
create policy "conversations_insert_auth"
  on public.conversations for insert
  with check (auth.uid() is not null);

drop policy if exists "conversations_update_member" on public.conversations;
create policy "conversations_update_member"
  on public.conversations for update
  using (public.is_conversation_member(id, auth.uid()));

-- ----------------------------------------------------------------------------
-- CONVERSATION MEMBERS
-- ----------------------------------------------------------------------------
drop policy if exists "conv_members_select_own_convs" on public.conversation_members;
create policy "conv_members_select_own_convs"
  on public.conversation_members for select
  using (public.is_conversation_member(conversation_id, auth.uid()));

drop policy if exists "conv_members_insert_self" on public.conversation_members;
create policy "conv_members_insert_self"
  on public.conversation_members for insert
  with check (auth.uid() is not null);

drop policy if exists "conv_members_update_own_row" on public.conversation_members;
create policy "conv_members_update_own_row"
  on public.conversation_members for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "conv_members_delete_own_row" on public.conversation_members;
create policy "conv_members_delete_own_row"
  on public.conversation_members for delete
  using (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- MESSAGES
-- ----------------------------------------------------------------------------
drop policy if exists "messages_select_member" on public.messages;
create policy "messages_select_member"
  on public.messages for select
  using (public.is_conversation_member(conversation_id, auth.uid()));

drop policy if exists "messages_insert_member_own" on public.messages;
create policy "messages_insert_member_own"
  on public.messages for insert
  with check (
    auth.uid() = sender_id
    and public.is_conversation_member(conversation_id, auth.uid())
  );

drop policy if exists "messages_update_own" on public.messages;
create policy "messages_update_own"
  on public.messages for update
  using (auth.uid() = sender_id)
  with check (auth.uid() = sender_id);

drop policy if exists "messages_delete_own" on public.messages;
create policy "messages_delete_own"
  on public.messages for delete
  using (auth.uid() = sender_id);

-- ----------------------------------------------------------------------------
-- MESSAGE REACTIONS
-- ----------------------------------------------------------------------------
drop policy if exists "reactions_select_member" on public.message_reactions;
create policy "reactions_select_member"
  on public.message_reactions for select
  using (
    exists (
      select 1 from public.messages m
      where m.id = message_id
        and public.is_conversation_member(m.conversation_id, auth.uid())
    )
  );

drop policy if exists "reactions_insert_own" on public.message_reactions;
create policy "reactions_insert_own"
  on public.message_reactions for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.messages m
      where m.id = message_id
        and public.is_conversation_member(m.conversation_id, auth.uid())
    )
  );

drop policy if exists "reactions_delete_own" on public.message_reactions;
create policy "reactions_delete_own"
  on public.message_reactions for delete
  using (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- TYPING INDICATORS
-- ----------------------------------------------------------------------------
drop policy if exists "typing_select_member" on public.typing_indicators;
create policy "typing_select_member"
  on public.typing_indicators for select
  using (public.is_conversation_member(conversation_id, auth.uid()));

drop policy if exists "typing_upsert_own" on public.typing_indicators;
create policy "typing_upsert_own"
  on public.typing_indicators for insert
  with check (auth.uid() = user_id and public.is_conversation_member(conversation_id, auth.uid()));

drop policy if exists "typing_update_own" on public.typing_indicators;
create policy "typing_update_own"
  on public.typing_indicators for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "typing_delete_own" on public.typing_indicators;
create policy "typing_delete_own"
  on public.typing_indicators for delete
  using (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- MESSAGE READS
-- ----------------------------------------------------------------------------
drop policy if exists "reads_select_member" on public.message_reads;
create policy "reads_select_member"
  on public.message_reads for select
  using (
    exists (
      select 1 from public.messages m
      where m.id = message_id
        and public.is_conversation_member(m.conversation_id, auth.uid())
    )
  );

drop policy if exists "reads_insert_own" on public.message_reads;
create policy "reads_insert_own"
  on public.message_reads for insert
  with check (auth.uid() = user_id);

-- ============================================================================
-- REALTIME
-- ============================================================================
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.message_reactions;
alter publication supabase_realtime add table public.typing_indicators;
alter publication supabase_realtime add table public.conversation_members;
alter publication supabase_realtime add table public.profiles;
alter publication supabase_realtime add table public.message_reads;

-- ============================================================================
-- STORAGE — chat media bucket
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('chat-media', 'chat-media', true)
on conflict (id) do nothing;

drop policy if exists "chat_media_public_read" on storage.objects;
create policy "chat_media_public_read"
  on storage.objects for select
  using (bucket_id = 'chat-media');

drop policy if exists "chat_media_auth_upload" on storage.objects;
create policy "chat_media_auth_upload"
  on storage.objects for insert
  with check (
    bucket_id = 'chat-media'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "chat_media_owner_delete" on storage.objects;
create policy "chat_media_owner_delete"
  on storage.objects for delete
  using (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================================
-- DONE
-- Files should be uploaded to paths like: chat-media/<user_id>/<filename>
-- so the folder-based storage policies above apply correctly.
-- ============================================================================
