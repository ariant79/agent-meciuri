-- Agent meciuri — schema inițială
create table if not exists public.evenimente (
  id              text primary key,              -- sursa:id_extern
  data_ro         date not null,                 -- ziua în Europe/Bucharest
  sursa           text not null,
  sport           text not null,
  competitie      text not null,
  cod_competitie  text not null,
  faza            text,
  participant_1   text not null,
  participant_2   text not null,
  start_utc       timestamptz not null,
  status          text not null default 'programat',
  extra           jsonb not null default '{}'::jsonb,
  scor            numeric,
  scor_detalii    jsonb,                         -- {valoare, rivalitate, traditie}
  etichete        text[] not null default '{}',
  selectat        boolean not null default false,
  actualizat_la   timestamptz not null default now()
);
create index if not exists evenimente_data_sel_idx on public.evenimente (data_ro, selectat, scor desc);

create table if not exists public.rulari (
  id            bigint generated always as identity primary key,
  pornita_la    timestamptz not null default now(),
  terminata_la  timestamptz,
  data_ro       date not null,
  stare_surse   jsonb not null default '{}'::jsonb, -- {"espn-fotbal": {"ok": true, "evenimente": 42}, ...}
  eroare        text
);

alter table public.evenimente enable row level security;
alter table public.rulari     enable row level security;

create policy "citire publica evenimente" on public.evenimente for select to anon, authenticated using (true);
create policy "citire publica rulari"     on public.rulari     for select to anon, authenticated using (true);
-- scrierea se face doar cu service role (ocolește RLS) din /api/collect
