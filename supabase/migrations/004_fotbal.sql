-- Agent meciuri — predicții fotbal (sub-proiectul B): model Poisson/Maher (atac/apărare per echipă)

create table if not exists public.ratinguri_fotbal (
  liga            text not null,              -- cod competiție ESPN (ex. "eng.1")
  echipa_id       text not null,              -- nume echipă normalizat (text.ts), canonic
  nume            text not null,
  atac            double precision not null,
  aparare         double precision not null,
  avantaj_gazda   double precision not null,  -- per ligă; duplicat pe fiecare rând din ligă (simplu, fără tabel separat)
  nr_meciuri      integer not null default 0,
  actualizat_la   timestamptz not null default now(),
  primary key (liga, echipa_id)
);

-- istoric brut de meciuri (football-data.co.uk la backfill + ESPN zilnic), folosit pentru
-- re-estimarea periodică a ratingurilor pe o fereastră glisantă (modelul Poisson nu se
-- actualizează incremental per meci, ca Elo-ul de tenis — se re-antrenează din istoricul brut)
create table if not exists public.meciuri_fotbal_istoric (
  id                 bigint generated always as identity primary key,
  liga               text not null,
  data               date not null,
  echipa_acasa_id    text not null,
  echipa_oaspete_id  text not null,
  gol_acasa          integer not null,
  gol_oaspete        integer not null,
  sursa              text not null,  -- 'football-data' | 'espn'
  unique (liga, data, echipa_acasa_id, echipa_oaspete_id)
);
create index if not exists meciuri_fotbal_istoric_liga_data_idx on public.meciuri_fotbal_istoric (liga, data);

-- potrivirea nume ESPN -> echipa_id canonic (football-data), pentru excepțiile pe care normalizarea nu le prinde
create table if not exists public.echipe_alias (
  nume_sursa  text not null,
  sursa       text not null,   -- 'espn'
  echipa_id   text not null,
  primary key (nume_sursa, sursa)
);

-- predicție + rezultat real + Brier + log-loss pentru meciurile de fotbal terminate, pe cele
-- două piețe ("1x2_fotbal": acasa/egal/oaspete; "total_goluri_2.5": peste/sub)
create or replace view public.evaluare_predictii_fotbal as
with meciuri as (
  select
    e.id as eveniment_id,
    (e.extra -> 'scor' ->> 0)::int as goluri_acasa,
    (e.extra -> 'scor' ->> 1)::int as goluri_oaspete
  from public.evenimente e
  where e.sport = 'fotbal' and e.status = 'terminat' and e.extra ? 'scor'
),
rezultate as (
  select eveniment_id, '1x2_fotbal' as piata,
    case when goluri_acasa > goluri_oaspete then 'acasa'
         when goluri_acasa < goluri_oaspete then 'oaspete'
         else 'egal' end as rezultat
  from meciuri
  union all
  select eveniment_id, 'total_goluri_2.5' as piata,
    case when (goluri_acasa + goluri_oaspete) >= 3 then 'peste' else 'sub' end as rezultat
  from meciuri
)
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
  r.rezultat,
  (p.selectie = r.rezultat) as corect,
  power(p.probabilitate - (case when p.selectie = r.rezultat then 1 else 0 end), 2) as brier,
  -ln(case when p.selectie = r.rezultat then p.probabilitate else 1 - p.probabilitate end) as log_loss
from public.predictii p
join rezultate r on r.eveniment_id = p.eveniment_id and r.piata = p.piata
join public.evenimente e on e.id = p.eveniment_id
where p.piata in ('1x2_fotbal', 'total_goluri_2.5');

alter view public.evaluare_predictii_fotbal set (security_invoker = true);

alter table public.ratinguri_fotbal       enable row level security;
alter table public.meciuri_fotbal_istoric enable row level security;
alter table public.echipe_alias           enable row level security;

create policy "citire publica ratinguri_fotbal"       on public.ratinguri_fotbal       for select to anon, authenticated using (true);
create policy "citire publica meciuri_fotbal_istoric" on public.meciuri_fotbal_istoric for select to anon, authenticated using (true);
create policy "citire publica echipe_alias"           on public.echipe_alias           for select to anon, authenticated using (true);
-- scrierea se face doar cu service role (ocolește RLS), ca la restul tabelelor de predicții
