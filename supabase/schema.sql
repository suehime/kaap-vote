-- 독서로그 데이터베이스 구조
-- Supabase 대시보드 → SQL Editor → New query 에 이 파일 내용을 통째로 붙여 넣고 Run 을 누르세요.
-- 여러 번 실행해도 안전하도록 작성되어 있습니다.
-- 이미 예전 버전을 실행했더라도, 업데이트 후 이 파일을 한 번 더 실행하면 새 기능에 필요한 부분만 추가됩니다.

create extension if not exists pgcrypto;

-- 1. 프로필: 닉네임, 공개 주소(handle), since, 공개 여부, 블로그 연동 정보
create table if not exists public.profiles (
  id            uuid primary key references auth.users on delete cascade,
  handle        text unique check (handle ~ '^[a-z0-9_]{3,20}$'),
  nickname      text not null default '',
  since         text not null default '',
  is_public     boolean not null default false,
  blog_id       text not null default '',
  blog_category text not null default '',
  created_at    timestamptz not null default now()
);

-- 2. 책
create table if not exists public.books (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  title       text not null,
  author      text not null default '',
  genre       text not null default '',
  parent      uuid references public.books(id) on delete set null,
  reason      text not null default '',
  read        text not null default '',
  review_url  text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists books_user_idx on public.books(user_id);

-- 3. 책 사이의 점선 연결(관계선)
create table if not exists public.links (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  from_id     uuid not null references public.books(id) on delete cascade,
  to_id       uuid not null references public.books(id) on delete cascade,
  note        text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists links_user_idx on public.links(user_id);

-- 4. 블로그에서 가져온 새 리뷰 알림
create table if not exists public.review_inbox (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  url           text not null,
  title         text not null,
  category      text not null default '',
  published_at  timestamptz,
  status        text not null default 'new' check (status in ('new','added','dismissed')),
  book_id       uuid references public.books(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (user_id, url)
);

-- 2차 업데이트: 소장르, 글 피드 주소, 생존 신호
alter table public.books    add column if not exists subgenres text[] not null default '{}';
alter table public.profiles add column if not exists feed_url  text   not null default '';
-- 3차 업데이트: 출간년도
alter table public.books    add column if not exists published text   not null default '';
-- 4차 업데이트: 표지, 출판사
alter table public.books    add column if not exists cover_url text   not null default '';
alter table public.books    add column if not exists publisher text   not null default '';
-- 5차 업데이트: 키워드
alter table public.books    add column if not exists keywords  text[] not null default '{}';
-- 6차 업데이트: 소장르별 이어진 책 (예: {"투자": {"parent": "책 id", "reason": "이유"}})
alter table public.books    add column if not exists alt_parents jsonb not null default '{}';

create table if not exists public.heartbeat (
  id  int primary key,
  at  timestamptz not null default now()
);
alter table public.heartbeat enable row level security;

-- 매일 한 번 호출되어 '살아 있음' 기록을 남기는 함수 (Supabase 일시 정지 방지)
create or replace function public.touch_heartbeat()
returns timestamptz language sql security definer set search_path = public as $$
  insert into public.heartbeat (id, at) values (1, now())
  on conflict (id) do update set at = excluded.at
  returning at
$$;
revoke all on function public.touch_heartbeat() from public;
grant execute on function public.touch_heartbeat() to anon, authenticated, service_role;

-- 공개 여부 확인용 함수
create or replace function public.is_public_user(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_public from public.profiles where id = uid), false)
$$;

-- 행 단위 권한: 본인만 편집, 공개로 설정한 사람의 기록은 누구나 읽기만 가능
alter table public.profiles     enable row level security;
alter table public.books        enable row level security;
alter table public.links        enable row level security;
alter table public.review_inbox enable row level security;

drop policy if exists "profiles read"   on public.profiles;
drop policy if exists "profiles insert" on public.profiles;
drop policy if exists "profiles update" on public.profiles;
create policy "profiles read"   on public.profiles for select using (id = auth.uid() or is_public);
create policy "profiles insert" on public.profiles for insert with check (id = auth.uid());
create policy "profiles update" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "books read"   on public.books;
drop policy if exists "books write"  on public.books;
drop policy if exists "books update" on public.books;
drop policy if exists "books delete" on public.books;
create policy "books read"   on public.books for select using (user_id = auth.uid() or public.is_public_user(user_id));
create policy "books write"  on public.books for insert with check (user_id = auth.uid());
create policy "books update" on public.books for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "books delete" on public.books for delete using (user_id = auth.uid());

drop policy if exists "links read"   on public.links;
drop policy if exists "links write"  on public.links;
drop policy if exists "links delete" on public.links;
create policy "links read"   on public.links for select using (user_id = auth.uid() or public.is_public_user(user_id));
create policy "links write"  on public.links for insert with check (user_id = auth.uid());
create policy "links delete" on public.links for delete using (user_id = auth.uid());

drop policy if exists "inbox own read"   on public.review_inbox;
drop policy if exists "inbox own update" on public.review_inbox;
create policy "inbox own read"   on public.review_inbox for select using (user_id = auth.uid());
create policy "inbox own update" on public.review_inbox for update using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select on public.profiles, public.books, public.links to anon, authenticated;
grant insert, update on public.profiles to authenticated;
grant insert, update, delete on public.books, public.links to authenticated;
grant select, update on public.review_inbox to authenticated;
grant execute on function public.is_public_user(uuid) to anon, authenticated;
