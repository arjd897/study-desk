-- Curriculum layer: a shared, pre-generated knowledge base.
-- Everything here except mastery/attempts is written ONLY by the server and
-- read by every signed-in learner, so one generation serves all users.

-- ---------- the spine ----------
create table if not exists concepts (
  id          text primary key,              -- slug, e.g. 'kv-cache'
  title       text not null,
  blurb       text not null default '',      -- one line: what it is
  area        text not null,
  track       text not null,                 -- which vertical slice it belongs to
  sort        int  not null default 0,       -- suggested order inside the track
  max_level   int  not null default 5,       -- deepest level worth authoring
  created_at  timestamptz not null default now()
);

-- prerequisite edges: you cannot learn `concept_id` before `requires_id`
create table if not exists concept_edges (
  concept_id  text not null references concepts on delete cascade,
  requires_id text not null references concepts on delete cascade,
  primary key (concept_id, requires_id),
  check (concept_id <> requires_id)
);

-- ---------- the papers ----------
create table if not exists corpus_papers (
  arxiv_id    text primary key,              -- '1706.03762'
  title       text not null,
  authors     text not null default '',
  published   date,
  abstract    text not null default '',
  sections    jsonb not null default '[]'::jsonb,  -- [{heading, text}]
  full_text   boolean not null default false,      -- did we get more than the abstract
  chars       int not null default 0,
  fetched_at  timestamptz not null default now()
);

create table if not exists concept_papers (
  concept_id  text not null references concepts on delete cascade,
  arxiv_id    text not null,
  role        text not null default 'canonical',   -- canonical | followup | background
  note        text not null default '',            -- why this paper, for this concept
  primary key (concept_id, arxiv_id)
);

-- ---------- the generated content ----------
-- One row per concept per depth level. Shared by every learner.
create table if not exists concept_levels (
  concept_id  text not null references concepts on delete cascade,
  level       int  not null check (level between 0 and 5),
  body        text not null,                        -- markdown
  sources     jsonb not null default '[]'::jsonb,   -- [{arxiv_id, section}]
  exercise    jsonb,                                -- L3: {brief, reference, rubric}
  model       text not null default '',
  version     int  not null default 1,
  created_at  timestamptz not null default now(),
  primary key (concept_id, level)
);

-- ---------- per-learner state ----------
create table if not exists mastery (
  user_id     uuid not null references auth.users on delete cascade,
  concept_id  text not null references concepts on delete cascade,
  level       int  not null default 0,        -- highest level passed
  score       real not null default 0,        -- 0..1 confidence at that level
  streak      int  not null default 0,        -- consecutive successful reviews
  due_at      date,                           -- spaced repetition
  updated_at  timestamptz not null default now(),
  primary key (user_id, concept_id)
);

create table if not exists attempts (
  id          bigserial primary key,
  user_id     uuid not null references auth.users on delete cascade,
  concept_id  text not null references concepts on delete cascade,
  level       int  not null,
  kind        text not null,                  -- recall | derive | critique | design | code
  question    text not null default '',
  response    text not null default '',
  score       real not null default 0,        -- 0..1
  feedback    text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists attempts_user_idx on attempts (user_id, created_at desc);
create index if not exists mastery_due_idx  on mastery  (user_id, due_at);

-- ---------- security ----------
alter table concepts        enable row level security;
alter table concept_edges   enable row level security;
alter table corpus_papers   enable row level security;
alter table concept_papers  enable row level security;
alter table concept_levels  enable row level security;
alter table mastery         enable row level security;
alter table attempts        enable row level security;

-- Shared knowledge: any signed-in learner may read, nobody may write from the
-- browser. The daily job writes with the service key, which bypasses RLS.
do $$
declare t text;
begin
  foreach t in array array['concepts','concept_edges','corpus_papers','concept_papers','concept_levels'] loop
    execute format('drop policy if exists "read shared" on %I', t);
    execute format('create policy "read shared" on %I for select to authenticated using (true)', t);
  end loop;
end $$;

-- Private progress: each learner sees only their own rows.
do $$
declare t text;
begin
  foreach t in array array['mastery','attempts'] loop
    execute format('drop policy if exists "own rows" on %I', t);
    execute format('create policy "own rows" on %I for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
  end loop;
end $$;
