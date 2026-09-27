-- Study Desk database. Paste this whole file into Supabase > SQL Editor > New query > Run.
-- Every table has Row Level Security: each person can only see and change their own rows.

create table if not exists profiles (
  user_id uuid primary key references auth.users on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists recs (
  user_id uuid not null references auth.users on delete cascade,
  day date not null,
  focus text,
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);

create table if not exists learned (
  user_id uuid not null references auth.users on delete cascade,
  item_id text not null,
  item jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

create table if not exists quizzes (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  item_id text not null,
  item jsonb not null,
  area text,
  score int not null,
  total int not null,
  created_at timestamptz not null default now()
);
create index if not exists quizzes_user_idx on quizzes (user_id, created_at desc);

create table if not exists glossary (
  user_id uuid not null references auth.users on delete cascade,
  term_id text not null,
  term text not null,
  meaning text,
  example text,
  source text,
  area text,
  created_at timestamptz not null default now(),
  primary key (user_id, term_id)
);

create table if not exists paths (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  topic text not null,
  overview text,
  steps jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists notes (
  user_id uuid not null references auth.users on delete cascade,
  item_id text not null,
  text text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

-- New papers found by the daily job. Shared by everyone, written only by the server.
create table if not exists papers (
  id text primary key,
  day date not null,
  title text not null,
  authors text,
  simple text,
  why text,
  area text,
  upvotes int default 0,
  url text,
  created_at timestamptz not null default now()
);
create index if not exists papers_day_idx on papers (day desc);

create table if not exists push_subs (
  endpoint text primary key,
  user_id uuid not null references auth.users on delete cascade,
  sub jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists ai_usage (
  user_id uuid not null references auth.users on delete cascade,
  day date not null,
  count int not null default 0,
  primary key (user_id, day)
);

-- ---------- Security rules ----------
alter table profiles  enable row level security;
alter table recs      enable row level security;
alter table learned   enable row level security;
alter table quizzes   enable row level security;
alter table glossary  enable row level security;
alter table paths     enable row level security;
alter table notes     enable row level security;
alter table papers    enable row level security;
alter table push_subs enable row level security;
alter table ai_usage  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['profiles','recs','learned','quizzes','glossary','paths','notes','push_subs'] loop
    execute format('drop policy if exists "own rows" on %I', t);
    execute format('create policy "own rows" on %I for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
  end loop;
end $$;

drop policy if exists "signed-in users read papers" on papers;
create policy "signed-in users read papers" on papers for select to authenticated using (true);
-- ai_usage has no policies on purpose: only the server can touch it.

-- Counts AI requests per person per day. Returns false once they pass the limit.
create or replace function bump_usage(uid uuid, lim int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare c int;
begin
  insert into ai_usage (user_id, day, count) values (uid, current_date, 1)
  on conflict (user_id, day) do update set count = ai_usage.count + 1
  returning count into c;
  return c <= lim;
end $$;

revoke execute on function bump_usage(uuid, int) from public, anon, authenticated;
