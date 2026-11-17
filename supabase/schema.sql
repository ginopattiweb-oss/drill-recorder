-- Esquema de Boom para Supabase (solo hace falta si quieres desplegar en internet).
-- Pégalo en Supabase → SQL Editor → New query → Run.

create table if not exists public.boom_videos (
  id text primary key,
  title text not null default 'Untitled Boom',
  status text not null default 'uploading',          -- uploading | ready | error
  mime_type text not null default 'video/webm',
  parts integer not null default 1,
  size_bytes bigint not null default 0,
  duration_ms integer not null default 0,
  width integer,
  height integer,
  has_thumbnail boolean not null default false,
  views integer not null default 0,
  transcript jsonb,                                  -- [{start,end,text}]
  summary text,
  chapters jsonb,                                    -- [{start,title}]
  author_name text not null default 'Boom',          -- cambia por tu nombre si quieres
  created_at timestamptz not null default now(),
  transcript_status text not null default 'none'     -- none | processing | done | error
);

create table if not exists public.boom_comments (
  id uuid primary key default gen_random_uuid(),
  video_id text not null references public.boom_videos(id) on delete cascade,
  author_name text not null default 'Anonymous',
  body text not null,
  timestamp_ms integer,
  created_at timestamptz not null default now()
);

create table if not exists public.boom_reactions (
  id uuid primary key default gen_random_uuid(),
  video_id text not null references public.boom_videos(id) on delete cascade,
  emoji text not null,
  timestamp_ms integer not null default 0,
  created_at timestamptz not null default now()
);

create or replace function public.boom_increment_views(vid text)
returns integer
language sql
as $$
  update public.boom_videos set views = views + 1 where id = vid returning views;
$$;

-- RLS activado y SIN policies: el acceso va solo por la service key desde el servidor.
alter table public.boom_videos enable row level security;
alter table public.boom_comments enable row level security;
alter table public.boom_reactions enable row level security;

-- Bucket público para los videos
insert into storage.buckets (id, name, public)
values ('boom-videos', 'boom-videos', true)
on conflict (id) do nothing;
