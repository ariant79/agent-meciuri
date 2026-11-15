-- Agent meciuri — head-to-head agregat pentru tenis (nu istoric meci-cu-meci)

create table if not exists public.h2h_tenis (
  jucator_id_1  text not null,  -- id mai mic alfabetic (ordine canonică, ca restul codului din lib/predictii/)
  jucator_id_2  text not null,
  victorii_1    integer not null default 0,
  victorii_2    integer not null default 0,
  ultimul_meci  date,
  actualizat_la timestamptz not null default now(),
  primary key (jucator_id_1, jucator_id_2)
);

alter table public.h2h_tenis enable row level security;

create policy "citire publica h2h_tenis" on public.h2h_tenis for select to anon, authenticated using (true);
-- scrierea se face doar cu service role (ocolește RLS), ca la celelalte tabele de predicții
