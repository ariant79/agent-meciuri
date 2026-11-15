-- Agent meciuri — generalizează evaluare_predictii_fotbal pentru piețele noi
-- (peste/sub 1.5/3.5, ambele_marcheaza, scor_exact, handicap_-1.5), alături de
-- 1x2_fotbal și total_goluri_2.5 care existau deja.

create or replace view public.evaluare_predictii_fotbal as
with meciuri as (
  select
    e.id as eveniment_id,
    (e.extra -> 'scor' ->> 0)::int as ga,
    (e.extra -> 'scor' ->> 1)::int as go
  from public.evenimente e
  where e.sport = 'fotbal' and e.status = 'terminat' and e.extra ? 'scor'
),
rezultate as (
  select eveniment_id, '1x2_fotbal' as piata,
    case when ga > go then 'acasa' when ga < go then 'oaspete' else 'egal' end as rezultat
  from meciuri
  union all
  select eveniment_id, 'total_goluri_1.5', case when (ga + go) > 1.5 then 'peste' else 'sub' end from meciuri
  union all
  select eveniment_id, 'total_goluri_2.5', case when (ga + go) > 2.5 then 'peste' else 'sub' end from meciuri
  union all
  select eveniment_id, 'total_goluri_3.5', case when (ga + go) > 3.5 then 'peste' else 'sub' end from meciuri
  union all
  select eveniment_id, 'ambele_marcheaza', case when ga >= 1 and go >= 1 then 'da' else 'nu' end from meciuri
  union all
  select eveniment_id, 'handicap_-1.5', case when (ga - go) > 1.5 then 'acasa' else 'oaspete' end from meciuri
  union all
  select eveniment_id, 'scor_exact', ga::text || '-' || go::text from meciuri
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
where p.piata in (
  '1x2_fotbal', 'total_goluri_1.5', 'total_goluri_2.5', 'total_goluri_3.5',
  'ambele_marcheaza', 'handicap_-1.5', 'scor_exact'
);

alter view public.evaluare_predictii_fotbal set (security_invoker = true);
