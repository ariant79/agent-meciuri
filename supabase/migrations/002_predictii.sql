-- Agent meciuri — predicții (faza 1: tenis, Elo pe suprafață)
-- Schema e pe piețe de la început, ca să poată primi 1x2/peste-sub/handicap/etc. fără refactorizare.

create table if not exists public.ratinguri (
  sport          text not null,
  jucator_id     text not null,
  nume           text not null,
  suprafata      text not null check (suprafata in ('general', 'hard', 'clay', 'grass')),
  rating         numeric not null,
  nr_meciuri     integer not null default 0,
  ultimul_meci   date,
  actualizat_la  timestamptz not null default now(),
  primary key (sport, jucator_id, suprafata)
);

create table if not exists public.predictii (
  id             bigint generated always as identity primary key,
  eveniment_id   text not null references public.evenimente(id),
  model          text not null,
  versiune_model text not null,
  piata          text not null,              -- 'castigator' (faza 1), apoi '1x2','peste_sub_2.5','handicap_-1.5'...
  selectie       text not null,               -- 'p1'/'p2' (sau '1','X','2','peste','sub'...)
  probabilitate  numeric not null check (probabilitate >= 0 and probabilitate <= 1),
  creat_la       timestamptz not null default now(),
  start_utc      timestamptz not null,
  unique (eveniment_id, model, piata, selectie),
  check (creat_la < start_utc)                -- doar predicții făcute înainte de start
);
create index if not exists predictii_eveniment_idx on public.predictii (eveniment_id);

-- imuabilitate: o predicție inserată nu se mai modifică niciodată (nici de service role)
create or replace function public.predictii_blocheaza_update() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'predictiile sunt imuabile (eveniment_id=%, piata=%, selectie=%)', old.eveniment_id, old.piata, old.selectie;
end;
$$;

drop trigger if exists predictii_nu_se_modifica on public.predictii;
create trigger predictii_nu_se_modifica
  before update on public.predictii
  for each row execute function public.predictii_blocheaza_update();

-- dedup pentru actualizarea Elo din meciurile zilnice ESPN (idempotent la rulări repetate)
create table if not exists public.meciuri_procesate (
  sursa        text not null,   -- 'espn' | 'sackmann'
  id_sursa     text not null,   -- eveniment_id (espn) sau id compus sackmann
  procesat_la  timestamptz not null default now(),
  primary key (sursa, id_sursa)
);

-- potrivirea nume ESPN -> jucator_id Sackmann, pentru excepțiile pe care normalizarea nu le prinde
create table if not exists public.jucatori_alias (
  nume_sursa  text not null,
  sursa       text not null,   -- 'espn'
  jucator_id  text not null,
  primary key (nume_sursa, sursa)
);

-- predicție + rezultat real + Brier + log-loss, doar pentru evenimente terminate cu câștigător cunoscut
create or replace view public.evaluare_predictii as
select
  p.id,
  p.eveniment_id,
  p.model,
  p.versiune_model,
  p.piata,
  p.selectie,
  p.probabilitate,
  p.creat_la,
  p.start_utc,
  e.sport,
  e.competitie,
  e.participant_1,
  e.participant_2,
  (e.extra ->> 'castigator') as castigator,
  (p.selectie = (e.extra ->> 'castigator')) as corect,
  power(p.probabilitate - (case when p.selectie = (e.extra ->> 'castigator') then 1 else 0 end), 2) as brier,
  -ln(case when p.selectie = (e.extra ->> 'castigator') then p.probabilitate else 1 - p.probabilitate end) as log_loss
from public.predictii p
join public.evenimente e on e.id = p.eveniment_id
where e.status = 'terminat'
  and e.extra ->> 'castigator' is not null
  and p.piata = 'castigator';

alter view public.evaluare_predictii set (security_invoker = true);

alter table public.ratinguri         enable row level security;
alter table public.predictii         enable row level security;
alter table public.meciuri_procesate enable row level security;
alter table public.jucatori_alias    enable row level security;

create policy "citire publica ratinguri"         on public.ratinguri         for select to anon, authenticated using (true);
create policy "citire publica predictii"         on public.predictii         for select to anon, authenticated using (true);
create policy "citire publica meciuri_procesate" on public.meciuri_procesate for select to anon, authenticated using (true);
create policy "citire publica jucatori_alias"    on public.jucatori_alias    for select to anon, authenticated using (true);
-- scrierea se face doar cu service role (ocolește RLS), ca la evenimente/rulari
