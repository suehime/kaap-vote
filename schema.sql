-- ─────────────────────────────────────────────────────────────
-- Supabase SQL Editor 에 통째로 붙여넣고 Run 하십시오. 한 번이면 됩니다.
--
-- 이미 예전 버전으로 만드셨다면, 아래 한 줄만 따로 실행하시면 됩니다:
--   alter table public.votes add column if not exists years text;
-- ─────────────────────────────────────────────────────────────

-- 투표 한 표 = 한 행.
-- (세션, 사전/사후, 사람) 조합이 유일하므로, 같은 사람이 다시 누르면 덮어씁니다.
create table if not exists public.votes (
  id          bigint generated always as identity primary key,
  session_idx smallint not null,
  phase       text     not null check (phase in ('pre','post')),
  voter       text     not null,
  role        text,                      -- 직군
  years       text,                      -- 중독 임상 경력
  choice      smallint not null check (choice between 1 and 6),
  created_at  timestamptz not null default now(),
  unique (session_idx, phase, voter)
);

alter table public.votes add column if not exists years text;

create index if not exists votes_session_idx on public.votes (session_idx, phase);

-- 진행자가 바꾸는 현재 상태. 항상 한 행만 존재합니다.
create table if not exists public.state (
  id          smallint primary key default 1 check (id = 1),
  session_idx smallint not null default 0,
  phase       text     not null default 'idle',
  is_open     boolean  not null default false,
  panel       text     not null default 'qr',
  updated_at  timestamptz not null default now()
);

insert into public.state (id) values (1) on conflict (id) do nothing;

-- ── 접근 권한 ────────────────────────────────────────────────
-- 학회 하루 동안만 열어둡니다. 끝나면 맨 아래 '잠그기'를 실행하십시오.
alter table public.votes enable row level security;
alter table public.state enable row level security;

drop policy if exists votes_open on public.votes;
drop policy if exists state_open on public.state;

create policy votes_open on public.votes
  for all to anon using (true) with check (true);

create policy state_open on public.state
  for all to anon using (true) with check (true);


-- ─────────────────────────────────────────────────────────────
-- 아래는 필요할 때 한 줄씩 골라 실행하십시오. 지금은 실행하지 마십시오.
-- ─────────────────────────────────────────────────────────────

-- 리허설 연습 데이터 지우기
--   delete from public.votes;

-- 특정 세션만 지우기
--   delete from public.votes where session_idx = 0;

-- 학회가 끝난 뒤 잠그기
--   drop policy votes_open on public.votes;
--   drop policy state_open on public.state;

-- 직군별 집계
--   select session_idx, phase, role, choice, count(*)
--   from public.votes group by 1,2,3,4 order by 1,2,3,4;

-- 경력별 집계
--   select session_idx, phase, years, choice, count(*)
--   from public.votes group by 1,2,3,4 order by 1,2,3,4;

-- 사전 → 사후 이동 행렬 (직군·경력까지 함께)
--   select a.session_idx, a.role, a.years,
--          a.choice as 사전, b.choice as 사후, count(*)
--   from public.votes a
--   join public.votes b
--     on a.voter = b.voter and a.session_idx = b.session_idx
--   where a.phase = 'pre' and b.phase = 'post'
--   group by 1,2,3,4,5 order by 1,2,3,4,5;
