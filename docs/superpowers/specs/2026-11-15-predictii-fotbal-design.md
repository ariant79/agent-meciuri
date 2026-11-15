# Spec: Predicții fotbal (sub-proiectul B din planul multi-sport)

Data: 2026-11-15

## Context

Acesta e al doilea sub-proiect din decompunerea cerinței "predicții pentru toate sporturile + pagină de detaliu meci" (primul, pagina `/meci/[id]`, e deja implementat). Scopul acestui sub-proiect: predicții de fotbal (1X2 + total goluri), pe modelul deja stabilit la tenis (Elo) — model separat de piață, backfill istoric, actualizare zilnică, integrare în `/meci/[id]`.

## Scop

- Model Poisson (Maher) de atac/apărare per echipă, per ligă, pentru ligile de club acoperite de football-data.co.uk.
- Piețe: **1X2** (acasă/egal/oaspete) și **total goluri 2.5** (peste/sub).
- Backfill istoric din football-data.co.uk, actualizare zilnică integrată în `colecteaza.ts`.
- Integrare în pagina `/meci/[id]` existentă.

## În afara scopului (explicit)

- Cupe europene (Champions League/Europa League) și echipe naționale — rămân cu placeholder-ul "predicții în lucru" existent, la fel ca celelalte sporturi fără model.
- Corecția Dixon-Coles (corelație scoruri mici, decădere temporală) — model Poisson independent simplu la prima versiune; Dixon-Coles poate fi o iterație ulterioară dacă backtestul arată nevoie.
- Actualizare incrementală tip-Elo a ratingurilor de atac/apărare — se recalculează complet, periodic, prin regresie pe fereastră glisantă.
- Scor exact ca piață de predicție.

## Arhitectură

Fișiere noi, în oglindă cu structura de tenis:

- `lib/predictii/modele/poisson-fotbal.ts` — funcții pure: `creeazaStare()`, `estimeazaRatinguri(meciuri)` (regresie Poisson/IRLS pe fereastra glisantă), `probabilitatiScor(ratingAcasa, ratingOaspete, avantajGazda)` → distribuție de scoruri.
- `lib/predictii/piete/1x2.ts` — derivă `{acasa, egal, oaspete}` din distribuția de scoruri.
- `lib/predictii/piete/total-goluri.ts` — derivă `{peste, sub}` pentru linia 2.5.
- `lib/predictii/potrivire-echipe.ts` — echivalentul `potrivire-nume.ts` pentru echipe (aliasuri + normalizare de nume).
- `lib/predictii/sackmann-fotbal.ts` (sau `football-data.ts`) — parsare CSV football-data.co.uk.
- `scripts/backfill-fotbal.ts` — backfill istoric + populare `echipe_alias`/`ratinguri_fotbal`.
- `lib/predictii/actualizare-zilnica-fotbal.ts` — rulată zilnic din `colecteaza.ts`, alături de cea de tenis.

Reutilizate neschimbate: `fetchToateRanduri`, tabela `predictii` (generică, `piata`/`selectie`/`probabilitate`), triggerul de imutabilitate, `meciuri_procesate`.

## Model: Poisson (Maher)

Per ligă acoperită, separat:

- Fiecare echipă are rating de **atac** (α) și **apărare** (β); fiecare ligă are un singur parametru de **avantaj gazdă** (γ).
- `λ_acasa = exp(α_acasa − β_oaspete + γ)`, `λ_oaspete = exp(α_oaspete − β_acasa)`.
- Golurile acasă/oaspete: Poisson independente cu parametrii `λ_acasa`/`λ_oaspete`.
- Ratingurile se estimează prin regresie Poisson (log-link), rezolvată Newton-Raphson/IRLS (hand-rolled, aceeași tehnică ca la `logistic-rank.ts`, fără librărie ML), pe toate meciurile din fereastra glisantă (implicit ultimele 3 sezoane — lungimea exactă se validează prin backtest, nu se presupune).
- Din `(λ_acasa, λ_oaspete)` se construiește o grilă de probabilități peste scoruri (0-9 goluri fiecare echipă, acoperă >99.9% din masa de probabilitate), din care se derivă:
  - **1X2**: suma probabilităților unde acasă>oaspete / acasă=oaspete / acasă<oaspete.
  - **Total goluri 2.5**: suma probabilităților unde suma golurilor ≤2 (sub) vs ≥3 (peste).

Recalcularea completă (regresie pe toată fereastra) rulează o dată pe zi, per ligă — nu per meci.

## Date și schemă

Migrare nouă `supabase/migrations/004_fotbal.sql`:

```sql
create table public.ratinguri_fotbal (
  liga            text not null,
  echipa_id       text not null,
  nume            text not null,
  atac            double precision not null,
  aparare         double precision not null,
  avantaj_gazda   double precision not null,
  nr_meciuri      integer not null,
  actualizat_la   timestamptz not null default now(),
  primary key (liga, echipa_id)
);

create table public.echipe_alias (
  sursa       text not null,
  nume_sursa  text not null,
  echipa_id   text not null,
  primary key (sursa, nume_sursa)
);
```

RLS: citire publică (`anon`, `authenticated`), scriere doar via service role (bypass RLS) — identic cu restul tabelelor de predicții.

**Fără schimbare** la tabela `predictii` — se scrie `piata="1x2_fotbal"` (selecții `acasa`/`egal`/`oaspete`) și `piata="total_goluri_2.5"` (selecții `peste`/`sub`), folosind coloanele generice existente (`piata`/`selectie`/`probabilitate`).

**Potrivire echipe**: `echipa_id` canonic = numele echipei normalizat din football-data.co.uk (sursă de bază, echivalentul Sackmann la tenis). La colectarea zilnică ESPN, `participant_1`/`participant_2` se mapează la `echipa_id` prin `echipe_alias`, cu fallback pe normalizare de nume (echivalentul `gasesteJucatorId`). Aliasurile noi se adaugă manual pe măsură ce apar nepotriviri.

## Ligi acoperite

Doar ligile de club acoperite de football-data.co.uk (Premier League, La Liga, Serie A, Bundesliga, Ligue 1 + alte câteva divizii disponibile pe acel site). Toate celelalte competiții de fotbal (cupe europene, echipe naționale, alte ligi) rămân cu placeholder-ul "predicții încă indisponibile" deja existent pe pagina de detaliu — fără cod nou pentru ele.

## Backfill și validare

- `scripts/backfill-fotbal.ts`: descarcă CSV-urile football-data.co.uk pentru ligile acoperite (câți sezoane sunt disponibile, de regulă ~10+), parsează în meciuri istorice, populează `echipe_alias` pentru fiecare nume nou întâlnit, rulează `estimeazaRatinguri` pe toată fereastra și scrie `ratinguri_fotbal`.
- **Backtest walk-forward**: pentru fiecare rundă din setul de validare, ratingurile se estimează strict din meciurile anterioare (fără look-ahead), apoi se compară probabilitatea prezisă cu rezultatul real (Brier score + log-loss, metodologie identică cu cea de la tenis). Împărțire similară train/validare/test; lungimea ferestrei glisante (implicit 3 sezoane) se validează prin grid-search pe setul de validare, nu se presupune fixă.
- Pagina `/predictii` se extinde cu o secțiune separată pentru fotbal (per ligă și per piață), arătând aceleași metrici de acuratețe/Brier/log-loss/calibrare ca la tenis.

## Actualizare zilnică

`lib/predictii/actualizare-zilnica-fotbal.ts`, apelată din `colecteaza.ts` alături de cea de tenis:

1. Meciurile de fotbal **terminate** din ziua colectată, într-o ligă acoperită, intră în istoricul folosit de regresie (nu există un pas separat "actualizare meci cu meci" — ele intră în fereastra glisantă la următoarea recalculare).
2. O dată pe zi, per ligă acoperită: se re-estimează `ratinguri_fotbal` din fereastra glisantă (folosind meciurile terminate din `evenimente` + istoricul de backfill).
3. Pentru meciurile de fotbal **viitoare**, într-o ligă acoperită, cu ambele echipe potrivite: se scriu predicții noi (`1x2_fotbal`, `total_goluri_2.5`) cu ratingurile proaspăt recalculate. Idempotent prin `meciuri_procesate` + constrângerea unică existentă pe `predictii`, ca la tenis.

## Integrare în `/meci/[id]`

Pentru `eveniment.sport === "fotbal"` cu ligă acoperită, secțiunea de statistici arată:

- Predicția 1X2 (3 procente) și total goluri 2.5 (2 procente).
- Ratingurile de atac/apărare ale celor două echipe (grilă similară cu `rating-grid` de la tenis).

Pentru ligile neacoperite, rămâne neschimbat placeholder-ul "Predicții încă indisponibile pentru acest sport" deja implementat.

## Testare

- Teste unitare `node:test` pentru `poisson-fotbal.ts` (regresie IRLS pe un set mic sintetic cu rezultat cunoscut), `1x2.ts`, `total-goluri.ts` (derivare din distribuții de probabilitate cunoscute), `potrivire-echipe.ts` (aliasuri + normalizare, analog testelor de la `potrivire-nume.ts`).
- Verificare live (ca la tenis): backfill rulat o dată, apoi o rulare a colectorului zilnic confirmată prin SQL direct că scrie predicții noi coerente.
