# Predicții fotbal (Poisson/Maher) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adaugă predicții de fotbal (1X2 + total goluri 2.5) pentru ligile de club acoperite de football-data.co.uk, pe modelul Poisson/Maher (atac/apărare per echipă), integrate în `/meci/[id]` și `/predictii`.

**Architecture:** Oglindă structurală a fazei de tenis: model pur în `lib/predictii/modele/poisson-fotbal.ts`, piețe derivate separat (`lib/predictii/piete/`), potrivire de echipe analog cu potrivirea de jucători, backfill istoric dintr-o sursă externă (football-data.co.uk în loc de Sackmann), actualizare zilnică integrată în `colecteaza.ts`. Diferență esențială față de tenis: ratingurile NU se actualizează incremental per meci (Elo), ci se **re-estimează complet, periodic**, printr-o regresie Poisson pe o fereastră glisantă de meciuri — de aceea e nevoie de un tabel nou, `meciuri_fotbal_istoric`, care păstrează meciurile brute (din backfill ȘI din ESPN) ca să poată fi re-filtrate pe fereastră la fiecare recalculare zilnică.

**Tech Stack:** Next.js 15 (App Router, server components), Supabase/Postgres, TypeScript hand-rolled (fără librării ML — regresie Poisson prin coordinate-ascent/IPF, aceeași filozofie ca regresia logistică de la tenis).

**Spec de referință:** `docs/superpowers/specs/2026-11-15-predictii-fotbal-design.md`

---

### Task 1: Extrage `lib/text.ts` (normalizare de text partajată)

Momentan `lib/predictii/potrivire-nume.ts` are propria normalizare de nume (fără diacritice, lowercase, fără cratime/puncte). Fotbalul are nevoie de exact aceeași logică pentru nume de echipe — o extragem într-un modul partajat, ca să nu o duplicăm.

**Files:**
- Create: `lib/text.ts`
- Create: `lib/text.test.ts`
- Modify: `lib/predictii/potrivire-nume.ts`

- [ ] **Step 1: Scrie `lib/text.ts`**

```typescript
const DIACRITIC_MIN = 0x0300;
const DIACRITIC_MAX = 0x036f;

/** fără diacritice, lowercase, fără cratime/puncte — potrivire robustă de nume între surse diferite */
export function normalizeazaText(text: string): string {
  return text
    .normalize("NFD")
    .split("")
    .filter((ch) => {
      const cod = ch.codePointAt(0) ?? 0;
      return cod < DIACRITIC_MIN || cod > DIACRITIC_MAX;
    })
    .join("")
    .toLowerCase()
    .replace(/[-.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
```

- [ ] **Step 2: Scrie testul**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeazaText } from "./text.ts";

test("normalizeazaText elimină diacritice combinate (NFD) și face lowercase", () => {
  assert.equal(normalizeazaText("Köln"), "koln");
  assert.equal(normalizeazaText("São Paulo"), "sao paulo");
});

test("normalizeazaText înlocuiește cratime și puncte cu spațiu, colapsează spațiile multiple", () => {
  assert.equal(normalizeazaText("Borussia M.Gladbach"), "borussia m gladbach");
  assert.equal(normalizeazaText("Saint-Étienne"), "saint etienne");
});

test("normalizeazaText taie spațiile de la capete", () => {
  assert.equal(normalizeazaText("  Ajax  "), "ajax");
});
```

- [ ] **Step 3: Rulează testul nou și verifică trece**

Run: `npm test`
Expected: toate testele trec, inclusiv cele 4 noi din `lib/text.test.ts`.

- [ ] **Step 4: Modifică `lib/predictii/potrivire-nume.ts` să reutilizeze `normalizeazaText`**

Înlocuiește conținutul fișierului (păstrează exact numele exporturilor existente, ca niciun consumator să nu se schimbe):

```typescript
import { normalizeazaText } from "@/lib/text";

/** fără diacritice, lowercase, fără cratime/puncte (cf. PREDICTII.md) */
export const normalizeazaNumeJucator = normalizeazaText;

export interface RezultatPotrivireNume {
  jucatorId: string | null;
  sursaPotrivire: "alias" | "nume" | null;
}

/**
 * potrivește un nume ESPN cu un jucător Sackmann: întâi alias explicit (jucatori_alias),
 * apoi nume normalizat exact (din ratinguri.nume). Fără potrivire aproximativă — un fals
 * pozitiv ar strica ratingul unui jucător nelegat.
 */
export function gasesteJucatorId(
  numeEspn: string,
  aliasuri: Map<string, string>,
  jucatoriCunoscuti: Map<string, string>
): RezultatPotrivireNume {
  const normalizat = normalizeazaNumeJucator(numeEspn);

  const dinAlias = aliasuri.get(normalizat);
  if (dinAlias) return { jucatorId: dinAlias, sursaPotrivire: "alias" };

  const dinNume = jucatoriCunoscuti.get(normalizat);
  if (dinNume) return { jucatorId: dinNume, sursaPotrivire: "nume" };

  return { jucatorId: null, sursaPotrivire: null };
}
```

- [ ] **Step 5: Verifică typecheck + teste**

Run: `npx tsc --noEmit && npm test`
Expected: clean; toate testele (inclusiv cele vechi din `h2h.test.ts`/`date.test.ts`) trec neschimbate — comportamentul lui `normalizeazaNumeJucator` e identic, doar sursa codului s-a mutat.

- [ ] **Step 6: Commit**

```bash
git add lib/text.ts lib/text.test.ts lib/predictii/potrivire-nume.ts
git commit -m "Extrage normalizarea de text în lib/text.ts (partajată tenis/fotbal)"
```

---

### Task 2: Migrare Supabase pentru fotbal

**Files:**
- Create: `supabase/migrations/004_fotbal.sql`

- [ ] **Step 1: Scrie migrarea**

```sql
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
```

- [ ] **Step 2: Aplică migrarea**

Foloseşte tool-ul MCP Supabase `apply_migration` (sau `supabase db push` dacă lucrezi din CLI local) pentru a rula fișierul de mai sus pe proiectul live. Verifică apoi cu `list_tables` că `ratinguri_fotbal`, `meciuri_fotbal_istoric`, `echipe_alias` există și că `evaluare_predictii_fotbal` apare în `list(views)` sau într-un query `select * from information_schema.views where table_name = 'evaluare_predictii_fotbal'`.

- [ ] **Step 3: Verifică advisories de securitate**

Rulează `get_advisors` (tip `security`) și confirmă că nu apar avertismente noi legate de `ratinguri_fotbal`, `meciuri_fotbal_istoric`, `echipe_alias` sau `evaluare_predictii_fotbal` (view-ul are deja `security_invoker = true`, ca la `evaluare_predictii`).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/004_fotbal.sql
git commit -m "Migrare: tabele fotbal (ratinguri_fotbal, meciuri_fotbal_istoric, echipe_alias) + view evaluare_predictii_fotbal"
```

---

### Task 3: Tip `MeciIstoricFotbal` + `lib/predictii/potrivire-echipe.ts`

**Files:**
- Modify: `lib/predictii/tipuri.ts`
- Create: `lib/predictii/potrivire-echipe.ts`

- [ ] **Step 1: Adaugă tipul în `lib/predictii/tipuri.ts`**

Adaugă la finalul fișierului (după `PredictieSelectie`):

```typescript

/** un meci istoric de fotbal normalizat, independent de sursă (football-data.co.uk azi, poate ESPN mai târziu) */
export interface MeciIstoricFotbal {
  data: string; // YYYY-MM-DD
  liga: string; // cod competiție ESPN (ex. "eng.1")
  echipaAcasaId: string;
  echipaOaspeteId: string;
  echipaAcasaNume: string;
  echipaOaspeteNume: string;
  golAcasa: number;
  golOaspete: number;
}
```

- [ ] **Step 2: Scrie `lib/predictii/potrivire-echipe.ts`**

```typescript
import { normalizeazaText } from "@/lib/text";

export interface RezultatPotrivireEchipa {
  echipaId: string | null;
  sursaPotrivire: "alias" | "nume" | null;
}

/**
 * potrivește un nume de echipă ESPN cu echipa_id canonic (football-data.co.uk): întâi alias
 * explicit (echipe_alias), apoi nume normalizat exact (din ratinguri_fotbal.nume). Fără
 * potrivire aproximativă — un fals pozitiv ar strica ratingul unei echipe nelegate.
 */
export function gasesteEchipaId(
  numeEspn: string,
  aliasuri: Map<string, string>,
  echipeCunoscute: Map<string, string>
): RezultatPotrivireEchipa {
  const normalizat = normalizeazaText(numeEspn);

  const dinAlias = aliasuri.get(normalizat);
  if (dinAlias) return { echipaId: dinAlias, sursaPotrivire: "alias" };

  const dinNume = echipeCunoscute.get(normalizat);
  if (dinNume) return { echipaId: dinNume, sursaPotrivire: "nume" };

  return { echipaId: null, sursaPotrivire: null };
}
```

- [ ] **Step 3: Verifică typecheck**

Run: `npx tsc --noEmit`
Expected: clean (fișier nou, fără consumatori încă — nu afectează alte fișiere).

- [ ] **Step 4: Commit**

```bash
git add lib/predictii/tipuri.ts lib/predictii/potrivire-echipe.ts
git commit -m "Adaugă MeciIstoricFotbal + lib/predictii/potrivire-echipe.ts"
```

---

### Task 4: Modelul Poisson/Maher (`lib/predictii/modele/poisson-fotbal.ts`)

**Files:**
- Create: `lib/predictii/modele/poisson-fotbal.ts`
- Create: `lib/predictii/modele/poisson-fotbal.test.ts`

- [ ] **Step 1: Scrie testul (TDD — scrie-l înainte de implementare)**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { estimeazaRatinguri, distributieScor, lambdaMeci } from "./poisson-fotbal.ts";

test("estimeazaRatinguri: o echipă care marchează sistematic mai mult capătă atac mai mare", () => {
  // A marchează 3-0 acasă și 3-0 în oaspeți împotriva lui B, de mai multe ori — A e clar mai bun
  const meciuri = [
    { echipaAcasaId: "A", echipaOaspeteId: "B", golAcasa: 3, golOaspete: 0 },
    { echipaAcasaId: "B", echipaOaspeteId: "A", golAcasa: 0, golOaspete: 3 },
    { echipaAcasaId: "A", echipaOaspeteId: "B", golAcasa: 3, golOaspete: 0 },
    { echipaAcasaId: "B", echipaOaspeteId: "A", golAcasa: 0, golOaspete: 3 },
  ];
  const stare = estimeazaRatinguri(meciuri);
  const a = stare.ratinguri.get("A")!;
  const b = stare.ratinguri.get("B")!;
  assert.ok(a.atac > b.atac, `atac A (${a.atac}) ar trebui să fie mai mare decât atac B (${b.atac})`);
  assert.ok(a.aparare > b.aparare, `apărare A (${a.aparare}) ar trebui să fie mai mare (mai puține goluri primite) decât B (${b.aparare})`);
  assert.equal(a.nrMeciuri, 4);
  assert.equal(b.nrMeciuri, 4);
});

test("estimeazaRatinguri: echipe perfect egale (meciuri simetrice) dau ratinguri egale", () => {
  const meciuri = [
    { echipaAcasaId: "A", echipaOaspeteId: "B", golAcasa: 1, golOaspete: 1 },
    { echipaAcasaId: "B", echipaOaspeteId: "A", golAcasa: 1, golOaspete: 1 },
  ];
  const stare = estimeazaRatinguri(meciuri);
  const a = stare.ratinguri.get("A")!;
  const b = stare.ratinguri.get("B")!;
  assert.ok(Math.abs(a.atac - b.atac) < 1e-6);
  assert.ok(Math.abs(a.aparare - b.aparare) < 1e-6);
});

test("distributieScor însumează la ~1 (masă de probabilitate completă pe grilă)", () => {
  const { probabilitati } = distributieScor(1.5, 1.1);
  const suma = probabilitati.flat().reduce((s, p) => s + p, 0);
  assert.ok(Math.abs(suma - 1) < 1e-6, `suma probabilităților (${suma}) ar trebui să fie ~1`);
});

test("lambdaMeci: null pentru o echipă necunoscută", () => {
  const stare = estimeazaRatinguri([{ echipaAcasaId: "A", echipaOaspeteId: "B", golAcasa: 1, golOaspete: 0 }]);
  assert.equal(lambdaMeci(stare, "A", "necunoscuta"), null);
});
```

- [ ] **Step 2: Rulează testul și verifică eșuează**

Run: `npm test`
Expected: FAIL — `Cannot find module './poisson-fotbal.ts'` (fișierul nu există încă).

- [ ] **Step 3: Scrie implementarea**

```typescript
export interface RatingEchipa {
  atac: number;
  aparare: number;
  nrMeciuri: number;
}

export interface StarePoisson {
  avantajGazda: number;
  ratinguri: Map<string, RatingEchipa>;
}

export interface RezultatMeciPoisson {
  echipaAcasaId: string;
  echipaOaspeteId: string;
  golAcasa: number;
  golOaspete: number;
}

const ITERATII_MAX = 200;
const PRAG_CONVERGENTA = 1e-6;
const GOLURI_MIN = 1e-6; // evită log(0) pentru echipe cu 0 goluri marcate/primite în fereastră

/**
 * estimează ratingurile de atac/apărare per echipă + avantajul de gazdă al ligii, prin
 * coordinate-ascent (iterative proportional fitting) pe modelul Poisson (Maher):
 *   λ_acasa = exp(atac_acasa - aparare_oaspete + avantajGazda)
 *   λ_oaspete = exp(atac_oaspete - aparare_acasa)
 * Fiecare coordonată are o formulă MLE închisă dată celelalte fixe (derivata log-verosimilității
 * Poisson e liniară în parametrul respectiv), deci nu e nevoie de inversare de matrice Hessiană —
 * mult mai simplu decât Newton-Raphson multivariat, la fel de riguros (crește verosimilitatea la
 * fiecare pas). Parametrizarea are un grad de libertate redundant (atac_i+c, aparare_i+c pentru
 * toate echipele simultan dă aceleași λ) — recentrăm la fiecare tură ca să nu deriveze numeric.
 */
export function estimeazaRatinguri(meciuri: RezultatMeciPoisson[]): StarePoisson {
  const echipe = new Set<string>();
  const nrMeciuri = new Map<string, number>();
  for (const m of meciuri) {
    echipe.add(m.echipaAcasaId);
    echipe.add(m.echipaOaspeteId);
    nrMeciuri.set(m.echipaAcasaId, (nrMeciuri.get(m.echipaAcasaId) ?? 0) + 1);
    nrMeciuri.set(m.echipaOaspeteId, (nrMeciuri.get(m.echipaOaspeteId) ?? 0) + 1);
  }

  const atac = new Map<string, number>(Array.from(echipe, (id) => [id, 0]));
  const aparare = new Map<string, number>(Array.from(echipe, (id) => [id, 0]));
  let avantajGazda = 0;

  for (let iter = 0; iter < ITERATII_MAX; iter++) {
    let schimbareMaxima = 0;

    for (const id of echipe) {
      let goluriReale = 0;
      let sumaExp = 0;
      for (const m of meciuri) {
        if (m.echipaAcasaId === id) {
          goluriReale += m.golAcasa;
          sumaExp += Math.exp(-aparare.get(m.echipaOaspeteId)! + avantajGazda);
        } else if (m.echipaOaspeteId === id) {
          goluriReale += m.golOaspete;
          sumaExp += Math.exp(-aparare.get(m.echipaAcasaId)!);
        }
      }
      const nouAtac = Math.log(Math.max(goluriReale, GOLURI_MIN) / sumaExp);
      schimbareMaxima = Math.max(schimbareMaxima, Math.abs(nouAtac - atac.get(id)!));
      atac.set(id, nouAtac);
    }

    for (const id of echipe) {
      let goluriPrimite = 0;
      let sumaExp = 0;
      for (const m of meciuri) {
        if (m.echipaAcasaId === id) {
          goluriPrimite += m.golOaspete;
          sumaExp += Math.exp(atac.get(m.echipaOaspeteId)!);
        } else if (m.echipaOaspeteId === id) {
          goluriPrimite += m.golAcasa;
          sumaExp += Math.exp(atac.get(m.echipaAcasaId)! + avantajGazda);
        }
      }
      const nouaAparare = Math.log(sumaExp / Math.max(goluriPrimite, GOLURI_MIN));
      schimbareMaxima = Math.max(schimbareMaxima, Math.abs(nouaAparare - aparare.get(id)!));
      aparare.set(id, nouaAparare);
    }

    {
      let goluriAcasaReale = 0;
      let sumaExp = 0;
      for (const m of meciuri) {
        goluriAcasaReale += m.golAcasa;
        sumaExp += Math.exp(atac.get(m.echipaAcasaId)! - aparare.get(m.echipaOaspeteId)!);
      }
      const nouAvantaj = Math.log(Math.max(goluriAcasaReale, GOLURI_MIN) / sumaExp);
      schimbareMaxima = Math.max(schimbareMaxima, Math.abs(nouAvantaj - avantajGazda));
      avantajGazda = nouAvantaj;
    }

    // recentrare: atac_i - aparare_j e invariant la shift comun -> previne driftul numeric
    const mediaAtac = Array.from(atac.values()).reduce((s, v) => s + v, 0) / echipe.size;
    for (const id of echipe) {
      atac.set(id, atac.get(id)! - mediaAtac);
      aparare.set(id, aparare.get(id)! - mediaAtac);
    }

    if (schimbareMaxima < PRAG_CONVERGENTA) break;
  }

  const ratinguri = new Map<string, RatingEchipa>();
  for (const id of echipe) {
    ratinguri.set(id, { atac: atac.get(id)!, aparare: aparare.get(id)!, nrMeciuri: nrMeciuri.get(id)! });
  }
  return { avantajGazda, ratinguri };
}

export function lambdaMeci(
  stare: StarePoisson,
  echipaAcasaId: string,
  echipaOaspeteId: string
): { lambdaAcasa: number; lambdaOaspete: number } | null {
  const acasa = stare.ratinguri.get(echipaAcasaId);
  const oaspete = stare.ratinguri.get(echipaOaspeteId);
  if (!acasa || !oaspete) return null;
  return {
    lambdaAcasa: Math.exp(acasa.atac - oaspete.aparare + stare.avantajGazda),
    lambdaOaspete: Math.exp(oaspete.atac - acasa.aparare),
  };
}

export const MAX_GOLURI_GRILA = 9; // acoperă >99.9% din masa de probabilitate pentru λ realiste de fotbal

function factorial(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function poissonPmf(lambda: number, k: number): number {
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
}

export interface DistributieScor {
  /** probabilitati[golAcasa][golOaspete] */
  probabilitati: number[][];
}

/** grilă de probabilități peste toate scorurile posibile (0..MAX_GOLURI_GRILA pentru fiecare echipă) */
export function distributieScor(lambdaAcasa: number, lambdaOaspete: number): DistributieScor {
  const probAcasa = Array.from({ length: MAX_GOLURI_GRILA + 1 }, (_, k) => poissonPmf(lambdaAcasa, k));
  const probOaspete = Array.from({ length: MAX_GOLURI_GRILA + 1 }, (_, k) => poissonPmf(lambdaOaspete, k));
  return { probabilitati: probAcasa.map((pa) => probOaspete.map((po) => pa * po)) };
}
```

- [ ] **Step 4: Rulează testul și verifică trece**

Run: `npm test`
Expected: PASS pentru toate cele 4 teste noi din `poisson-fotbal.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add lib/predictii/modele/poisson-fotbal.ts lib/predictii/modele/poisson-fotbal.test.ts
git commit -m "Adaugă modelul Poisson/Maher pentru fotbal (atac/apărare per echipă, coordinate-ascent)"
```

---

### Task 5: Piețele 1X2 și total goluri

**Files:**
- Create: `lib/predictii/piete/1x2-fotbal.ts`
- Create: `lib/predictii/piete/1x2-fotbal.test.ts`
- Create: `lib/predictii/piete/total-goluri.ts`
- Create: `lib/predictii/piete/total-goluri.test.ts`

- [ ] **Step 1: Scrie testele (TDD)**

`lib/predictii/piete/1x2-fotbal.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { construiestePiata1x2 } from "./1x2-fotbal.ts";
import { distributieScor } from "../modele/poisson-fotbal.ts";

test("construiestePiata1x2: echipă gazdă mult mai puternică -> probabilitate mare pentru acasă", () => {
  const distributie = distributieScor(3.0, 0.3);
  const selectii = construiestePiata1x2(distributie);
  const acasa = selectii.find((s) => s.selectie === "acasa")!;
  const oaspete = selectii.find((s) => s.selectie === "oaspete")!;
  assert.ok(acasa.probabilitate > oaspete.probabilitate);
  assert.ok(acasa.probabilitate > 0.6);
});

test("construiestePiata1x2: selecțiile însumează la 1", () => {
  const distributie = distributieScor(1.4, 1.2);
  const suma = construiestePiata1x2(distributie).reduce((s, sel) => s + sel.probabilitate, 0);
  assert.ok(Math.abs(suma - 1) < 1e-6);
});

test("construiestePiata1x2: λ egale -> acasă și oaspete simetrice", () => {
  const distributie = distributieScor(1.3, 1.3);
  const selectii = construiestePiata1x2(distributie);
  const acasa = selectii.find((s) => s.selectie === "acasa")!;
  const oaspete = selectii.find((s) => s.selectie === "oaspete")!;
  assert.ok(Math.abs(acasa.probabilitate - oaspete.probabilitate) < 1e-9);
});
```

`lib/predictii/piete/total-goluri.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { construiestePiataTotalGoluri } from "./total-goluri.ts";
import { distributieScor } from "../modele/poisson-fotbal.ts";

test("construiestePiataTotalGoluri: λ mari -> probabilitate mare pentru peste 2.5", () => {
  const distributie = distributieScor(2.0, 2.0);
  const selectii = construiestePiataTotalGoluri(distributie);
  const peste = selectii.find((s) => s.selectie === "peste")!;
  assert.ok(peste.probabilitate > 0.5);
});

test("construiestePiataTotalGoluri: λ mici -> probabilitate mare pentru sub 2.5", () => {
  const distributie = distributieScor(0.5, 0.4);
  const selectii = construiestePiataTotalGoluri(distributie);
  const sub = selectii.find((s) => s.selectie === "sub")!;
  assert.ok(sub.probabilitate > 0.7);
});

test("construiestePiataTotalGoluri: selecțiile însumează la 1", () => {
  const distributie = distributieScor(1.4, 1.2);
  const suma = construiestePiataTotalGoluri(distributie).reduce((s, sel) => s + sel.probabilitate, 0);
  assert.ok(Math.abs(suma - 1) < 1e-6);
});
```

- [ ] **Step 2: Rulează și verifică eșuează**

Run: `npm test`
Expected: FAIL — modulele `./1x2-fotbal.ts` și `./total-goluri.ts` nu există.

- [ ] **Step 3: Scrie `lib/predictii/piete/1x2-fotbal.ts`**

```typescript
import type { DistributieScor } from "@/lib/predictii/modele/poisson-fotbal";
import type { PredictieSelectie } from "@/lib/predictii/tipuri";

/** piața "1x2_fotbal": acasă/egal/oaspete, derivată din grila de probabilități a scorului */
export function construiestePiata1x2(distributie: DistributieScor): PredictieSelectie[] {
  let acasa = 0;
  let egal = 0;
  let oaspete = 0;
  const { probabilitati } = distributie;
  for (let ga = 0; ga < probabilitati.length; ga++) {
    for (let go = 0; go < probabilitati[ga].length; go++) {
      const p = probabilitati[ga][go];
      if (ga > go) acasa += p;
      else if (ga < go) oaspete += p;
      else egal += p;
    }
  }
  return [
    { piata: "1x2_fotbal", selectie: "acasa", probabilitate: acasa },
    { piata: "1x2_fotbal", selectie: "egal", probabilitate: egal },
    { piata: "1x2_fotbal", selectie: "oaspete", probabilitate: oaspete },
  ];
}
```

- [ ] **Step 4: Scrie `lib/predictii/piete/total-goluri.ts`**

```typescript
import type { DistributieScor } from "@/lib/predictii/modele/poisson-fotbal";
import type { PredictieSelectie } from "@/lib/predictii/tipuri";

/** piața "total_goluri_2.5": peste/sub, derivată din grila de probabilități a scorului */
export function construiestePiataTotalGoluri(distributie: DistributieScor): PredictieSelectie[] {
  let peste = 0;
  let sub = 0;
  const { probabilitati } = distributie;
  for (let ga = 0; ga < probabilitati.length; ga++) {
    for (let go = 0; go < probabilitati[ga].length; go++) {
      const p = probabilitati[ga][go];
      if (ga + go >= 3) peste += p;
      else sub += p;
    }
  }
  return [
    { piata: "total_goluri_2.5", selectie: "peste", probabilitate: peste },
    { piata: "total_goluri_2.5", selectie: "sub", probabilitate: sub },
  ];
}
```

- [ ] **Step 5: Rulează testele și verifică trec**

Run: `npm test`
Expected: PASS pentru toate testele noi.

- [ ] **Step 6: Commit**

```bash
git add lib/predictii/piete/1x2-fotbal.ts lib/predictii/piete/1x2-fotbal.test.ts lib/predictii/piete/total-goluri.ts lib/predictii/piete/total-goluri.test.ts
git commit -m "Adaugă piețele 1x2_fotbal și total_goluri_2.5"
```

---

### Task 6: Config + parsare CSV football-data.co.uk

**Files:**
- Create: `config/fotbal.json`
- Create: `lib/predictii/football-data.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Scrie `config/fotbal.json`**

```json
{
  "_nota": "Configurație predicții fotbal (sub-proiectul B). Fereastra glisantă implicit 3 sezoane; validată prin scripts/backtest-poisson-fotbal.ts.",
  "model": "poisson-fotbal",
  "versiune_model": "1",
  "fereastra_sezoane": 3,
  "ligi_acoperite": {
    "eng.1": { "divizie_football_data": "E0", "nume": "Premier League" },
    "esp.1": { "divizie_football_data": "SP1", "nume": "La Liga" },
    "ita.1": { "divizie_football_data": "I1", "nume": "Serie A" },
    "ger.1": { "divizie_football_data": "D1", "nume": "Bundesliga" },
    "fra.1": { "divizie_football_data": "F1", "nume": "Ligue 1" }
  }
}
```

- [ ] **Step 2: Scrie `lib/predictii/football-data.ts`**

```typescript
import { readFile } from "fs/promises";
import path from "path";
import fotbalConfig from "@/config/fotbal.json";
import { normalizeazaText } from "@/lib/text";
import type { MeciIstoricFotbal } from "@/lib/predictii/tipuri";

export const DIR_CACHE_FOOTBALL_DATA = path.join(process.cwd(), "data", "football-data");
export const SEZOANE_IMPLICITE = coduriSezon(2015, 2026);

const LIGI_ACOPERITE = fotbalConfig.ligi_acoperite as Record<string, { divizie_football_data: string; nume: string }>;

/** codurile de sezon football-data.co.uk pentru anii [anInceput, anSfarsit] (ex. 2015 -> "1516") */
export function coduriSezon(anInceput: number, anSfarsit: number): string[] {
  const coduri: string[] = [];
  for (let an = anInceput; an <= anSfarsit; an++) {
    const yy1 = String(an % 100).padStart(2, "0");
    const yy2 = String((an + 1) % 100).padStart(2, "0");
    coduri.push(`${yy1}${yy2}`);
  }
  return coduri;
}

function parseazaRanduriCsv(text: string): Record<string, string>[] {
  const linii = text.trim().split("\n").filter((l) => l.trim().length > 0);
  if (linii.length === 0) return [];
  const header = linii[0].split(",").map((h) => h.trim());
  return linii.slice(1).map((linie) => {
    const coloane = linie.split(",");
    return Object.fromEntries(header.map((h, i) => [h, (coloane[i] ?? "").trim()]));
  });
}

/** "dd/mm/yy" sau "dd/mm/yyyy" -> "yyyy-mm-dd"; null dacă formatul e nerecunoscut */
function dataISODinDDMMYY(data: string): string | null {
  const parti = data.split("/");
  if (parti.length !== 3) return null;
  const [zi, luna, anRaw] = parti;
  if (!zi || !luna || !anRaw) return null;
  const an = anRaw.length === 2 ? `20${anRaw}` : anRaw;
  return `${an}-${luna.padStart(2, "0")}-${zi.padStart(2, "0")}`;
}

/**
 * parsează un CSV football-data.co.uk (un sezon, o ligă): coloanele cerute sunt Date, HomeTeam,
 * AwayTeam, FTHG, FTAG (goluri la final). Rânduri incomplete sunt ignorate. echipa_id canonic =
 * numele echipei normalizat (consistent în cadrul sursei football-data, de la an la an).
 */
export function parseazaMeciuriFootballData(text: string, codLiga: string): MeciIstoricFotbal[] {
  const randuri = parseazaRanduriCsv(text);
  const rezultate: MeciIstoricFotbal[] = [];

  for (const r of randuri) {
    if (!r.Date || !r.HomeTeam || !r.AwayTeam || r.FTHG === "" || r.FTAG === "") continue;
    const data = dataISODinDDMMYY(r.Date);
    const golAcasa = Number(r.FTHG);
    const golOaspete = Number(r.FTAG);
    if (!data || !Number.isFinite(golAcasa) || !Number.isFinite(golOaspete)) continue;

    rezultate.push({
      data,
      liga: codLiga,
      echipaAcasaId: normalizeazaText(r.HomeTeam),
      echipaOaspeteId: normalizeazaText(r.AwayTeam),
      echipaAcasaNume: r.HomeTeam,
      echipaOaspeteNume: r.AwayTeam,
      golAcasa,
      golOaspete,
    });
  }

  return rezultate;
}

async function citesteOpt(caleRelativa: string): Promise<string | null> {
  try {
    return await readFile(path.join(DIR_CACHE_FOOTBALL_DATA, caleRelativa), "utf8");
  } catch {
    return null;
  }
}

/** încarcă tot istoricul din cache-ul local (data/football-data/) pentru ligile acoperite și sezoanele date */
export async function incarcaIstoricFootballData(sezoane: string[]): Promise<MeciIstoricFotbal[]> {
  const toate: MeciIstoricFotbal[] = [];
  for (const codLiga of Object.keys(LIGI_ACOPERITE)) {
    for (const sezon of sezoane) {
      const text = await citesteOpt(`${codLiga}/${sezon}.csv`);
      if (!text) continue;
      toate.push(...parseazaMeciuriFootballData(text, codLiga));
    }
  }
  toate.sort((a, b) => a.data.localeCompare(b.data));
  return toate;
}

/** reține doar meciurile din ultimii `fereastraSezoane` ani calendaristici față de `aziISO` (YYYY-MM-DD) */
export function filtreazaFereastra(
  meciuri: MeciIstoricFotbal[],
  aziISO: string,
  fereastraSezoane: number
): MeciIstoricFotbal[] {
  const limita = new Date(aziISO);
  limita.setFullYear(limita.getFullYear() - fereastraSezoane);
  const limitaISO = limita.toISOString().slice(0, 10);
  return meciuri.filter((m) => m.data >= limitaISO);
}
```

- [ ] **Step 3: Adaugă `data/football-data` în `.gitignore`**

Adaugă o linie nouă la finalul `.gitignore`:

```
data/football-data
```

- [ ] **Step 4: Verifică typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add config/fotbal.json lib/predictii/football-data.ts .gitignore
git commit -m "Adaugă config/fotbal.json + parsare CSV football-data.co.uk"
```

---

### Task 7: Script de descărcare istoric football-data.co.uk

**Files:**
- Create: `scripts/descarca-date-fotbal.ts`
- Modify: `package.json`

- [ ] **Step 1: Scrie scriptul**

```typescript
/**
 * Descarcă CSV-urile football-data.co.uk pentru ligile acoperite (ultimii sezoane 2015-2026)
 * în data/football-data/ (gitignored).
 *
 * Rulare: npm run descarca:fotbal
 */
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import fotbalConfig from "@/config/fotbal.json";
import { coduriSezon, DIR_CACHE_FOOTBALL_DATA } from "@/lib/predictii/football-data";

const BAZA = "https://www.football-data.co.uk/mmz4281";
const SEZOANE = coduriSezon(2015, 2026);

async function descarca(codLiga: string, divizie: string, sezon: string): Promise<void> {
  const destinatie = path.join(DIR_CACHE_FOOTBALL_DATA, codLiga, `${sezon}.csv`);
  await mkdir(path.dirname(destinatie), { recursive: true });
  const res = await fetch(`${BAZA}/${sezon}/${divizie}.csv`);
  if (!res.ok) {
    console.warn(`  lipsă/eroare (${res.status}): ${codLiga}/${sezon}`);
    return;
  }
  const text = await res.text();
  await writeFile(destinatie, text, "utf8");
  console.log(`  ok: ${codLiga}/${sezon}.csv (${(text.length / 1024).toFixed(0)} KB)`);
}

async function main() {
  const ligi = Object.entries(fotbalConfig.ligi_acoperite as Record<string, { divizie_football_data: string }>);
  console.log(`Descarc ${ligi.length} ligi x ${SEZOANE.length} sezoane din football-data.co.uk...`);
  for (const [codLiga, info] of ligi) {
    for (const sezon of SEZOANE) {
      await descarca(codLiga, info.divizie_football_data, sezon);
    }
  }
  console.log("Terminat.");
}

main();
```

- [ ] **Step 2: Adaugă scriptul npm**

În `package.json`, în `scripts`, adaugă:

```json
"descarca:fotbal": "tsx scripts/descarca-date-fotbal.ts",
```

- [ ] **Step 3: Rulează scriptul**

Run: `npm run descarca:fotbal`
Expected: descarcă fișiere CSV în `data/football-data/<cod-liga>/<sezon>.csv` pentru fiecare din cele 5 ligi acoperite; sezoanele care nu există încă (ex. viitorul) dau `lipsă/eroare (404)`, ceea ce e normal — scriptul continuă.

**Notă:** acest pas face cereri de rețea reale; dacă execuția e blocată de clasificatorul de permisiuni al mediului în care rulează acest task, raportează BLOCKED cu restul pașilor compleți — coordonatorul va rula acest pas manual.

- [ ] **Step 4: Commit**

```bash
git add scripts/descarca-date-fotbal.ts package.json
git commit -m "Adaugă scriptul de descărcare istoric football-data.co.uk"
```

---

### Task 8: Backfill fotbal (scrie `ratinguri_fotbal` + `meciuri_fotbal_istoric`)

**Precondiție:** `npm run descarca:fotbal` trebuie rulat înainte (Task 7), altfel `data/football-data/` e gol și backfill-ul scrie 0 rânduri.

**Files:**
- Create: `scripts/backfill-fotbal.ts`
- Modify: `package.json`

- [ ] **Step 1: Scrie scriptul**

```typescript
/**
 * Backfill o singură dată, local: calculează ratingurile Poisson (atac/apărare) per ligă din
 * istoricul football-data.co.uk cache-uit local, pe fereastra glisantă din config, și scrie
 * rezultatul + istoricul brut complet în Supabase. Nu rulează pe Vercel.
 *
 * Rulare: npm run backfill:fotbal
 * (necesită data/football-data/ populat — npm run descarca:fotbal — și .env.local cu
 * SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
 */
import { readFileSync, existsSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import fotbalConfig from "@/config/fotbal.json";
import { incarcaIstoricFootballData, filtreazaFereastra, SEZOANE_IMPLICITE } from "@/lib/predictii/football-data";
import { estimeazaRatinguri } from "@/lib/predictii/modele/poisson-fotbal";
import { azi } from "@/lib/date";

function incarcaEnvLocal(): void {
  if (!existsSync(".env.local")) return;
  for (const linie of readFileSync(".env.local", "utf8").split("\n")) {
    const separator = linie.indexOf("=");
    if (separator === -1) continue;
    const cheie = linie.slice(0, separator).trim();
    if (cheie && process.env[cheie] === undefined) {
      process.env[cheie] = linie.slice(separator + 1).trim();
    }
  }
}
incarcaEnvLocal();

const MARIME_LOT = 500;

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Lipsesc SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY din mediu (.env.local).");
    process.exit(1);
  }

  console.log("Încarc istoricul football-data.co.uk din cache local...");
  const toateMeciurile = await incarcaIstoricFootballData(SEZOANE_IMPLICITE);
  console.log(`Total meciuri încărcate: ${toateMeciurile.length}`);
  if (toateMeciurile.length === 0) {
    console.error("Niciun meci încărcat — ai rulat `npm run descarca:fotbal` înainte?");
    process.exit(1);
  }

  const meciuriInFereastra = filtreazaFereastra(toateMeciurile, azi(), fotbalConfig.fereastra_sezoane);
  console.log(`Meciuri în fereastra de ${fotbalConfig.fereastra_sezoane} sezoane: ${meciuriInFereastra.length}`);

  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const randuriRatinguri: Array<{
    liga: string;
    echipa_id: string;
    nume: string;
    atac: number;
    aparare: number;
    avantaj_gazda: number;
    nr_meciuri: number;
  }> = [];
  const numePerEchipa = new Map<string, string>();

  for (const codLiga of Object.keys(fotbalConfig.ligi_acoperite)) {
    const meciuriLiga = meciuriInFereastra.filter((m) => m.liga === codLiga);
    if (meciuriLiga.length === 0) {
      console.log(`  ${codLiga}: niciun meci în fereastră, sar peste.`);
      continue;
    }
    for (const m of meciuriLiga) {
      numePerEchipa.set(m.echipaAcasaId, m.echipaAcasaNume);
      numePerEchipa.set(m.echipaOaspeteId, m.echipaOaspeteNume);
    }

    const { avantajGazda, ratinguri } = estimeazaRatinguri(meciuriLiga);
    console.log(`  ${codLiga}: ${meciuriLiga.length} meciuri, ${ratinguri.size} echipe, avantaj gazdă ${avantajGazda.toFixed(3)}`);

    for (const [echipaId, r] of ratinguri) {
      randuriRatinguri.push({
        liga: codLiga,
        echipa_id: echipaId,
        nume: numePerEchipa.get(echipaId) ?? echipaId,
        atac: Math.round(r.atac * 10000) / 10000,
        aparare: Math.round(r.aparare * 10000) / 10000,
        avantaj_gazda: Math.round(avantajGazda * 10000) / 10000,
        nr_meciuri: r.nrMeciuri,
      });
    }
  }

  // istoric brut complet (toate sezoanele descărcate, nu doar fereastra) — ca actualizarea
  // zilnică să poată re-filtra fereastra fără să re-descarce CSV-urile
  const randuriIstoric = toateMeciurile.map((m) => ({
    liga: m.liga,
    data: m.data,
    echipa_acasa_id: m.echipaAcasaId,
    echipa_oaspete_id: m.echipaOaspeteId,
    gol_acasa: m.golAcasa,
    gol_oaspete: m.golOaspete,
    sursa: "football-data",
  }));

  console.log(`Rânduri de scris în ratinguri_fotbal: ${randuriRatinguri.length}`);
  for (let i = 0; i < randuriRatinguri.length; i += MARIME_LOT) {
    const lot = randuriRatinguri.slice(i, i + MARIME_LOT);
    const { error } = await db.from("ratinguri_fotbal").upsert(lot, { onConflict: "liga,echipa_id" });
    if (error) {
      console.error(`Eroare la lotul ratinguri_fotbal ${i}-${i + lot.length}:`, error.message);
      process.exit(1);
    }
    console.log(`  scris ${Math.min(i + MARIME_LOT, randuriRatinguri.length)}/${randuriRatinguri.length}`);
  }

  console.log(`Rânduri de scris în meciuri_fotbal_istoric: ${randuriIstoric.length}`);
  for (let i = 0; i < randuriIstoric.length; i += MARIME_LOT) {
    const lot = randuriIstoric.slice(i, i + MARIME_LOT);
    const { error } = await db
      .from("meciuri_fotbal_istoric")
      .upsert(lot, { onConflict: "liga,data,echipa_acasa_id,echipa_oaspete_id" });
    if (error) {
      console.error(`Eroare la lotul meciuri_fotbal_istoric ${i}-${i + lot.length}:`, error.message);
      process.exit(1);
    }
    console.log(`  scris ${Math.min(i + MARIME_LOT, randuriIstoric.length)}/${randuriIstoric.length}`);
  }

  console.log("Backfill terminat.");
}

main();
```

- [ ] **Step 2: Adaugă scriptul npm**

În `package.json`, în `scripts`:

```json
"backfill:fotbal": "tsx scripts/backfill-fotbal.ts",
```

- [ ] **Step 3: Rulează backfill-ul**

Run: `npm run backfill:fotbal`
Expected: printează per ligă numărul de meciuri/echipe/avantaj gazdă, apoi scrie în loturi de 500 în `ratinguri_fotbal` și `meciuri_fotbal_istoric`, terminând cu "Backfill terminat."

**Notă:** acest pas scrie live în Supabase. Dacă execuția e blocată de clasificatorul de permisiuni al mediului în care rulează acest task, raportează BLOCKED cu restul pașilor compleți — coordonatorul va rula acest pas manual (la fel ca la `npm run backfill:tenis` în faza de tenis).

- [ ] **Step 4: Verifică live prin SQL**

Rulează (prin tool-ul MCP Supabase `execute_sql` sau coordonator):

```sql
select liga, count(*) as nr_echipe, round(avg(nr_meciuri)) as medie_meciuri
from public.ratinguri_fotbal
group by liga
order by liga;
```

Expected: câte un rând per ligă acoperită, cu ~18-20 echipe fiecare (dimensiunea tipică a unei ligi europene de club) și o medie de meciuri per echipă plauzibilă pentru fereastra de 3 sezoane (ordinul a ~100 de meciuri per echipă, nu 0 și nu mii).

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill-fotbal.ts package.json
git commit -m "Adaugă scriptul de backfill fotbal + rulare live (ratinguri_fotbal, meciuri_fotbal_istoric)"
```

---

### Task 9: Actualizare zilnică fotbal + integrare în `colecteaza.ts`

**Files:**
- Create: `lib/predictii/actualizare-zilnica-fotbal.ts`
- Modify: `colecteaza.ts`

- [ ] **Step 1: Scrie `lib/predictii/actualizare-zilnica-fotbal.ts`**

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import fotbalConfig from "@/config/fotbal.json";
import { dataRoFromUtc, azi } from "@/lib/date";
import { normalizeazaText } from "@/lib/text";
import type { EvenimentScorat } from "@/lib/types";
import { fetchToateRanduri } from "@/lib/supabase-paginat";
import { gasesteEchipaId } from "@/lib/predictii/potrivire-echipe";
import {
  estimeazaRatinguri,
  lambdaMeci,
  distributieScor,
  type StarePoisson,
  type RezultatMeciPoisson,
} from "@/lib/predictii/modele/poisson-fotbal";
import { construiestePiata1x2 } from "@/lib/predictii/piete/1x2-fotbal";
import { construiestePiataTotalGoluri } from "@/lib/predictii/piete/total-goluri";

const MODEL = "poisson-fotbal";
const VERSIUNE_MODEL = fotbalConfig.versiune_model;
const LIGI_ACOPERITE = fotbalConfig.ligi_acoperite as Record<string, { nume: string }>;

export interface RezultatActualizarePredictiiFotbal {
  meciuriAdaugateIstoric: number;
  predictiiNoi: number;
  echipeNepotrivite: string[];
}

function esteLigaAcoperita(codCompetitie: string): boolean {
  return codCompetitie in LIGI_ACOPERITE;
}

function limitaFereastra(): string {
  const limita = new Date(azi());
  limita.setFullYear(limita.getFullYear() - fotbalConfig.fereastra_sezoane);
  return limita.toISOString().slice(0, 10);
}

interface RandIstoricDb {
  echipa_acasa_id: string;
  echipa_oaspete_id: string;
  gol_acasa: number;
  gol_oaspete: number;
}

async function incarcaMeciuriPerLiga(db: SupabaseClient, codLiga: string, limitaISO: string): Promise<RezultatMeciPoisson[]> {
  const randuri = await fetchToateRanduri<RandIstoricDb>((start, end) =>
    db
      .from("meciuri_fotbal_istoric")
      .select("echipa_acasa_id,echipa_oaspete_id,gol_acasa,gol_oaspete")
      .eq("liga", codLiga)
      .gte("data", limitaISO)
      .range(start, end)
  );
  return randuri.map((r) => ({
    echipaAcasaId: r.echipa_acasa_id,
    echipaOaspeteId: r.echipa_oaspete_id,
    golAcasa: r.gol_acasa,
    golOaspete: r.gol_oaspete,
  }));
}

/**
 * adaugă meciurile de fotbal terminate azi (din ligile acoperite) la istoricul brut
 * (idempotent via meciuri_procesate), re-estimează ratingurile Poisson pe fereastra glisantă
 * pentru ligile afectate, apoi calculează predicții pentru meciurile viitoare selectate.
 */
export async function actualizeazaPredictiiFotbal(
  db: SupabaseClient,
  evenimenteFotbal: EvenimentScorat[]
): Promise<RezultatActualizarePredictiiFotbal> {
  const evenimenteAcoperite = evenimenteFotbal.filter((ev) => esteLigaAcoperita(ev.cod_competitie));
  if (evenimenteAcoperite.length === 0) {
    return { meciuriAdaugateIstoric: 0, predictiiNoi: 0, echipeNepotrivite: [] };
  }

  const [randuriAlias, randuriRatinguri, randuriProcesate] = await Promise.all([
    fetchToateRanduri<{ nume_sursa: string; echipa_id: string }>((start, end) =>
      db.from("echipe_alias").select("nume_sursa,echipa_id").eq("sursa", "espn").range(start, end)
    ),
    fetchToateRanduri<{ echipa_id: string; nume: string }>((start, end) =>
      db.from("ratinguri_fotbal").select("echipa_id,nume").range(start, end)
    ),
    fetchToateRanduri<{ id_sursa: string }>((start, end) =>
      db.from("meciuri_procesate").select("id_sursa").eq("sursa", "espn-fotbal").range(start, end)
    ),
  ]);

  const aliasuri = new Map(randuriAlias.map((r) => [r.nume_sursa, r.echipa_id]));
  const echipeCunoscute = new Map<string, string>();
  const numePerEchipa = new Map<string, string>();
  for (const r of randuriRatinguri) {
    echipeCunoscute.set(normalizeazaText(r.nume), r.echipa_id);
    numePerEchipa.set(r.echipa_id, r.nume);
  }
  const idProcesate = new Set(randuriProcesate.map((r) => r.id_sursa));

  const echipeNepotrivite = new Set<string>();
  function potrivesteSauLogheaza(nume: string): string | null {
    const rezultat = gasesteEchipaId(nume, aliasuri, echipeCunoscute);
    if (!rezultat.echipaId) {
      echipeNepotrivite.add(nume);
      return null;
    }
    numePerEchipa.set(rezultat.echipaId, nume);
    return rezultat.echipaId;
  }

  // pasul 1: adaugă meciurile terminate noi la istoricul brut
  const randuriIstoricNoi: Array<{
    liga: string;
    data: string;
    echipa_acasa_id: string;
    echipa_oaspete_id: string;
    gol_acasa: number;
    gol_oaspete: number;
    sursa: string;
  }> = [];
  const deMarcatProcesate: string[] = [];
  const ligiAfectate = new Set<string>();

  for (const ev of evenimenteAcoperite) {
    if (ev.status !== "terminat" || idProcesate.has(ev.id)) continue;
    deMarcatProcesate.push(ev.id);

    const scor = ev.extra?.scor as [string, string] | undefined;
    if (!scor) continue; // fără scor cunoscut — nu inventăm rezultatul
    const golAcasa = Number(scor[0]);
    const golOaspete = Number(scor[1]);
    if (!Number.isFinite(golAcasa) || !Number.isFinite(golOaspete)) continue;

    const idAcasa = potrivesteSauLogheaza(ev.participanti[0]);
    const idOaspete = potrivesteSauLogheaza(ev.participanti[1]);
    if (!idAcasa || !idOaspete) continue;

    randuriIstoricNoi.push({
      liga: ev.cod_competitie,
      data: dataRoFromUtc(ev.start_utc),
      echipa_acasa_id: idAcasa,
      echipa_oaspete_id: idOaspete,
      gol_acasa: golAcasa,
      gol_oaspete: golOaspete,
      sursa: "espn",
    });
    ligiAfectate.add(ev.cod_competitie);
  }

  if (randuriIstoricNoi.length > 0) {
    const { error } = await db
      .from("meciuri_fotbal_istoric")
      .upsert(randuriIstoricNoi, { onConflict: "liga,data,echipa_acasa_id,echipa_oaspete_id" });
    if (error) console.error("[predictii-fotbal] eroare la scrierea istoricului:", error.message);
  }

  if (deMarcatProcesate.length > 0) {
    const { error } = await db
      .from("meciuri_procesate")
      .upsert(
        deMarcatProcesate.map((id) => ({ sursa: "espn-fotbal", id_sursa: id })),
        { onConflict: "sursa,id_sursa", ignoreDuplicates: true }
      );
    if (error) console.error("[predictii-fotbal] eroare la marcarea meciuri_procesate:", error.message);
  }

  // pasul 2: re-estimează ratingurile pentru ligile cu meciuri nou-terminate sau programate
  const ligiDeRecalculat = new Set<string>([
    ...ligiAfectate,
    ...evenimenteAcoperite.filter((ev) => ev.status === "programat").map((ev) => ev.cod_competitie),
  ]);

  const limitaISO = limitaFereastra();
  const stariPerLiga = new Map<string, StarePoisson>();

  for (const codLiga of ligiDeRecalculat) {
    const meciuriLiga = await incarcaMeciuriPerLiga(db, codLiga, limitaISO);
    if (meciuriLiga.length === 0) continue;

    const stare = estimeazaRatinguri(meciuriLiga);
    stariPerLiga.set(codLiga, stare);

    const randuriDeScris = Array.from(stare.ratinguri.entries()).map(([echipaId, r]) => ({
      liga: codLiga,
      echipa_id: echipaId,
      nume: numePerEchipa.get(echipaId) ?? echipaId,
      atac: Math.round(r.atac * 10000) / 10000,
      aparare: Math.round(r.aparare * 10000) / 10000,
      avantaj_gazda: Math.round(stare.avantajGazda * 10000) / 10000,
      nr_meciuri: r.nrMeciuri,
    }));
    const { error } = await db.from("ratinguri_fotbal").upsert(randuriDeScris, { onConflict: "liga,echipa_id" });
    if (error) console.error(`[predictii-fotbal] eroare la scrierea ratinguri_fotbal pentru ${codLiga}:`, error.message);
  }

  // pasul 3: predicții pentru meciurile viitoare selectate
  let predictiiNoi = 0;
  for (const ev of evenimenteAcoperite) {
    if (!ev.selectat || ev.status !== "programat") continue;

    const stare = stariPerLiga.get(ev.cod_competitie);
    if (!stare) continue;

    const idAcasa = potrivesteSauLogheaza(ev.participanti[0]);
    const idOaspete = potrivesteSauLogheaza(ev.participanti[1]);
    if (!idAcasa || !idOaspete) continue;

    const lambda = lambdaMeci(stare, idAcasa, idOaspete);
    if (!lambda) continue;

    const distributie = distributieScor(lambda.lambdaAcasa, lambda.lambdaOaspete);
    const selectii = [...construiestePiata1x2(distributie), ...construiestePiataTotalGoluri(distributie)];

    const { data, error } = await db
      .from("predictii")
      .upsert(
        selectii.map((s) => ({
          eveniment_id: ev.id,
          model: MODEL,
          versiune_model: VERSIUNE_MODEL,
          piata: s.piata,
          selectie: s.selectie,
          probabilitate: s.probabilitate,
          start_utc: ev.start_utc,
        })),
        { onConflict: "eveniment_id,model,piata,selectie", ignoreDuplicates: true }
      )
      .select("eveniment_id");
    if (error) console.error(`[predictii-fotbal] eroare la predicție pentru ${ev.id}:`, error.message);
    else predictiiNoi += data?.length ?? 0;
  }

  return {
    meciuriAdaugateIstoric: randuriIstoricNoi.length,
    predictiiNoi,
    echipeNepotrivite: Array.from(echipeNepotrivite),
  };
}
```

- [ ] **Step 2: Integrează în `colecteaza.ts`**

Modifică fișierul `colecteaza.ts`:

```typescript
import { supabaseAdmin } from "@/lib/supabase";
import { dataRoFromUtc } from "@/lib/date";
import { colecteazaFotbalEspn } from "@/colectoare/espn-fotbal";
import { colecteazaTenisEspn } from "@/colectoare/espn-tenis";
import { colecteazaAlteleEspn } from "@/colectoare/espn-altele";
import { clasifica } from "@/clasificator";
import { actualizeazaPredictiiTenis } from "@/lib/predictii/actualizare-zilnica";
import { actualizeazaPredictiiFotbal } from "@/lib/predictii/actualizare-zilnica-fotbal";
import type { StareSursa } from "@/lib/types";

export async function executaColectare(dataRo: string) {
  const [fotbal, tenis, altele] = await Promise.all([
    colecteazaFotbalEspn(dataRo),
    colecteazaTenisEspn(dataRo),
    colecteazaAlteleEspn(dataRo),
  ]);

  const evenimente = [...fotbal.evenimente, ...tenis.evenimente, ...altele.evenimente];
  const stareSurse: Record<string, StareSursa> = { ...fotbal.stareSurse, ...tenis.stareSurse, ...altele.stareSurse };
  const scorate = clasifica(evenimente);

  const db = supabaseAdmin();
  let eroareSalvare: string | undefined;

  if (scorate.length > 0) {
    const randuri = scorate.map((e) => ({
      id: e.id,
      data_ro: dataRoFromUtc(e.start_utc),
      sursa: e.sursa,
      sport: e.sport,
      competitie: e.competitie,
      cod_competitie: e.cod_competitie,
      faza: e.faza,
      participant_1: e.participanti[0],
      participant_2: e.participanti[1],
      start_utc: e.start_utc,
      status: e.status,
      extra: e.extra,
      scor: e.scor,
      scor_detalii: e.scor_detalii,
      etichete: e.etichete,
      selectat: e.selectat,
    }));
    const { error } = await db.from("evenimente").upsert(randuri);
    if (error) eroareSalvare = error.message;
  }

  let predictiiTenis: Awaited<ReturnType<typeof actualizeazaPredictiiTenis>> | undefined;
  let predictiiFotbal: Awaited<ReturnType<typeof actualizeazaPredictiiFotbal>> | undefined;
  if (!eroareSalvare) {
    const tenisScorat = scorate.filter((e) => e.sport === "tenis");
    const fotbalScorat = scorate.filter((e) => e.sport === "fotbal");
    try {
      predictiiTenis = await actualizeazaPredictiiTenis(db, tenisScorat);
    } catch (err) {
      console.error("[predictii] eroare neprevăzută (tenis):", err);
    }
    try {
      predictiiFotbal = await actualizeazaPredictiiFotbal(db, fotbalScorat);
    } catch (err) {
      console.error("[predictii] eroare neprevăzută (fotbal):", err);
    }
  }

  await db.from("rulari").insert({
    terminata_la: new Date().toISOString(),
    data_ro: dataRo,
    stare_surse: stareSurse,
    eroare: eroareSalvare ?? null,
  });

  return { dataRo, evenimente: scorate.length, stareSurse, eroareSalvare, predictiiTenis, predictiiFotbal };
}
```

- [ ] **Step 3: Verifică typecheck + build**

Run: `npx tsc --noEmit && npx next build`
Expected: clean build.

- [ ] **Step 4: Verificare live**

Rulează colectorul pe o zi reală (prin `npm run dev` + `curl http://localhost:PORT/api/collect` cu header-ul `Authorization: Bearer $CRON_SECRET` dacă e setat, sau direct `reimprospateazaAction` din UI) și confirmă în output JSON că `predictiiFotbal` apare cu forma `{ meciuriAdaugateIstoric, predictiiNoi, echipeNepotrivite }`. Dacă `echipeNepotrivite` conține nume de echipe din ligile acoperite, e normal la prima rulare — se adaugă manual în `echipe_alias` pe măsură ce apar (ca la tenis).

**Notă:** acest pas poate fi blocat de clasificatorul de permisiuni pentru scrieri live — dacă așa, raportează BLOCKED cu restul complet, coordonatorul rulează manual.

- [ ] **Step 5: Commit**

```bash
git add lib/predictii/actualizare-zilnica-fotbal.ts colecteaza.ts
git commit -m "Actualizare zilnică fotbal: istoric incremental + re-estimare Poisson + predicții 1x2/total goluri"
```

---

### Task 10: Integrare în `/meci/[id]`

**Files:**
- Modify: `app/meci/[id]/page.tsx`

- [ ] **Step 1: Adaugă importurile și funcția `obtineStatisticiFotbal`**

În `app/meci/[id]/page.tsx`, adaugă la importuri:

```typescript
import fotbalConfig from "@/config/fotbal.json";
import { gasesteEchipaId } from "@/lib/predictii/potrivire-echipe";
import { normalizeazaText } from "@/lib/text";
```

Adaugă, după funcția `obtineStatisticiTenis` existentă, un tip și o funcție nouă:

```typescript
type RandRatingFotbal = {
  echipa_id: string;
  nume: string;
  atac: number;
  aparare: number;
  avantaj_gazda: number;
  nr_meciuri: number;
};

async function obtineStatisticiFotbal(db: ReturnType<typeof supabasePublic>, ev: RandEveniment) {
  const ligiAcoperite = fotbalConfig.ligi_acoperite as Record<string, { nume: string }>;
  if (!(ev.cod_competitie in ligiAcoperite)) return null;

  const [randuriAlias, randuriRating] = await Promise.all([
    fetchToateRanduri<{ nume_sursa: string; echipa_id: string }>((start, end) =>
      db.from("echipe_alias").select("nume_sursa,echipa_id").eq("sursa", "espn").range(start, end)
    ),
    fetchToateRanduri<RandRatingFotbal>((start, end) =>
      db
        .from("ratinguri_fotbal")
        .select("echipa_id,nume,atac,aparare,avantaj_gazda,nr_meciuri")
        .eq("liga", ev.cod_competitie)
        .range(start, end)
    ),
  ]);

  const aliasuri = new Map(randuriAlias.map((r) => [r.nume_sursa, r.echipa_id]));
  const echipeCunoscute = new Map(randuriRating.map((r) => [normalizeazaText(r.nume), r.echipa_id]));

  const r1 = gasesteEchipaId(ev.participant_1, aliasuri, echipeCunoscute);
  const r2 = gasesteEchipaId(ev.participant_2, aliasuri, echipeCunoscute);
  if (!r1.echipaId || !r2.echipaId) return null;

  const ratingAcasa = randuriRating.find((r) => r.echipa_id === r1.echipaId);
  const ratingOaspete = randuriRating.find((r) => r.echipa_id === r2.echipaId);
  if (!ratingAcasa || !ratingOaspete) return null;

  const { data: randuriPredictie } = await db
    .from("predictii")
    .select("piata,selectie,probabilitate")
    .eq("eveniment_id", ev.id)
    .in("piata", ["1x2_fotbal", "total_goluri_2.5"]);

  const predictie1x2: Partial<Record<"acasa" | "egal" | "oaspete", number>> = {};
  const predictieTotalGoluri: Partial<Record<"peste" | "sub", number>> = {};
  for (const r of randuriPredictie ?? []) {
    if (r.piata === "1x2_fotbal") predictie1x2[r.selectie as "acasa" | "egal" | "oaspete"] = r.probabilitate;
    else if (r.piata === "total_goluri_2.5") predictieTotalGoluri[r.selectie as "peste" | "sub"] = r.probabilitate;
  }

  return { ratingAcasa, ratingOaspete, predictie1x2, predictieTotalGoluri };
}
```

- [ ] **Step 2: Calculează statisticile de fotbal în componentă**

În `PaginaMeci`, lângă linia existentă `const statisticiTenis = ...`, adaugă:

```typescript
const statisticiFotbal = eveniment.sport === "fotbal" ? await obtineStatisticiFotbal(db, eveniment) : null;
```

- [ ] **Step 3: Adaugă ramura de randare pentru fotbal**

Schimbă blocul condițional `{eveniment.sport === "tenis" ? (...) : (...)}` dintr-un if/else în if/else-if/else cu trei ramuri — adaugă ramura de fotbal între cea de tenis și cea implicită:

```tsx
      {eveniment.sport === "tenis" ? (
        <section>
          {/* ... conținutul existent de tenis, neschimbat ... */}
        </section>
      ) : eveniment.sport === "fotbal" && statisticiFotbal ? (
        <section>
          <h2>Statistici fotbal</h2>
          {Object.keys(statisticiFotbal.predictie1x2).length > 0 && (
            <p>
              1X2: {afiseazaParticipant(eveniment, eveniment.participant_1)}{" "}
              {Math.round((statisticiFotbal.predictie1x2.acasa ?? 0) * 100)}% · egal{" "}
              {Math.round((statisticiFotbal.predictie1x2.egal ?? 0) * 100)}% ·{" "}
              {afiseazaParticipant(eveniment, eveniment.participant_2)}{" "}
              {Math.round((statisticiFotbal.predictie1x2.oaspete ?? 0) * 100)}%
            </p>
          )}
          {Object.keys(statisticiFotbal.predictieTotalGoluri).length > 0 && (
            <p>
              Total goluri 2.5: peste {Math.round((statisticiFotbal.predictieTotalGoluri.peste ?? 0) * 100)}% · sub{" "}
              {Math.round((statisticiFotbal.predictieTotalGoluri.sub ?? 0) * 100)}%
            </p>
          )}
          <div className="rating-grid">
            {(
              [
                { nume: eveniment.participant_1, rating: statisticiFotbal.ratingAcasa },
                { nume: eveniment.participant_2, rating: statisticiFotbal.ratingOaspete },
              ] as Array<{ nume: string; rating: RandRatingFotbal }>
            ).map(({ nume, rating }) => (
              <div key={nume} className="rating-jucator">
                <h3>{afiseazaParticipant(eveniment, nume)}</h3>
                <div className="rating-linie">
                  <span>Atac</span>
                  <span>{rating.atac.toFixed(2)}</span>
                </div>
                <div className="rating-linie">
                  <span>Apărare</span>
                  <span>{rating.aparare.toFixed(2)}</span>
                </div>
                <div className="rating-linie">
                  <span>Meciuri în fereastră</span>
                  <span>{rating.nr_meciuri}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section>
          <h2>Statistici</h2>
          {clasament && (
            <p>
              Clasament: {afiseazaParticipant(eveniment, eveniment.participant_1)} #{clasament.acasa ?? "?"} ·{" "}
              {afiseazaParticipant(eveniment, eveniment.participant_2)} #{clasament.oaspete ?? "?"}
            </p>
          )}
          <p className="gol">Predicții încă indisponibile pentru acest sport.</p>
        </section>
      )}
```

- [ ] **Step 4: Adaugă sursa în subsol**

În `<footer className="subsol">`, adaugă sub linia existentă de tenis:

```tsx
        {eveniment.sport === "fotbal" && statisticiFotbal && <p>Date istorice fotbal: football-data.co.uk.</p>}
```

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc --noEmit && rm -rf .next tsconfig.tsbuildinfo && npx next build && rm -rf .next tsconfig.tsbuildinfo`
Expected: build curat.

- [ ] **Step 6: Verificare live**

Pornește `npx next dev -p 3916` și verifică:
- un meci de fotbal dintr-o ligă acoperită (ex. Premier League), cu echipele potrivite → apare "Statistici fotbal" cu atac/apărare și predicții 1X2/total goluri;
- un meci de fotbal dintr-o ligă neacoperită (ex. Champions League) → rămâne placeholder-ul "Predicții încă indisponibile pentru acest sport" (comportament neschimbat).

Dacă rularea serverului dev e blocată de clasificator, raportează BLOCKED cu pașii compleți — coordonatorul verifică manual.

- [ ] **Step 7: Commit**

```bash
git add app/meci/[id]/page.tsx
git commit -m "Pagina /meci/[id]: statistici fotbal (Poisson atac/apărare + 1x2/total goluri)"
```

---

### Task 11: Secțiune fotbal în `/predictii`

**Files:**
- Modify: `app/predictii/page.tsx`

- [ ] **Step 1: Adaugă tip + fetch pentru evaluarea de fotbal**

Adaugă în `app/predictii/page.tsx`, după interfața `RandEvaluare` existentă:

```typescript
interface RandEvaluareFotbal {
  id: number;
  eveniment_id: string;
  model: string;
  versiune_model: string;
  piata: string;
  selectie: string;
  probabilitate: number;
  start_utc: string;
  competitie: string;
  participant_1: string;
  participant_2: string;
  rezultat: string;
  corect: boolean;
  brier: number;
  log_loss: number;
}

async function fetchToateEvaluarileFotbal(db: ReturnType<typeof supabasePublic>): Promise<RandEvaluareFotbal[]> {
  const toate: RandEvaluareFotbal[] = [];
  let start = 0;
  while (true) {
    const { data, error } = await db
      .from("evaluare_predictii_fotbal")
      .select("*")
      .order("start_utc", { ascending: false })
      .range(start, start + MARIME_PAGINA - 1);
    if (error || !data) break;
    toate.push(...(data as RandEvaluareFotbal[]));
    if (data.length < MARIME_PAGINA) break;
    start += MARIME_PAGINA;
  }
  return toate;
}

/** pentru piețe cu mai mult de 2 selecții (1x2_fotbal), "favoritul" e selecția cu probabilitatea maximă din grup */
function celMaiProbabilPerMeci(randuri: RandEvaluareFotbal[]): RandEvaluareFotbal[] {
  const grupuri = new Map<string, RandEvaluareFotbal>();
  for (const r of randuri) {
    const cheie = `${r.eveniment_id}|${r.piata}`;
    const curent = grupuri.get(cheie);
    if (!curent || r.probabilitate > curent.probabilitate) grupuri.set(cheie, r);
  }
  return Array.from(grupuri.values());
}

function SectiuneVersiunePiataFotbal({ versiune, piata, randuri }: { versiune: string; piata: string; randuri: RandEvaluareFotbal[] }) {
  const favorite = celMaiProbabilPerMeci(randuri);
  const acuratete = favorite.length > 0 ? favorite.filter((r) => r.corect).length / favorite.length : null;
  const brierMediu = randuri.length > 0 ? randuri.reduce((s, r) => s + r.brier, 0) / randuri.length : null;
  const logLossMediu = favorite.length > 0 ? favorite.reduce((s, r) => s + r.log_loss, 0) / favorite.length : null;

  return (
    <section>
      <h2>
        poisson-fotbal · versiune {versiune} · {piata}
      </h2>
      <ul className="lista-surse">
        <li>Meciuri evaluate: {favorite.length}</li>
        <li>Acuratețe (câștigă favoritul): {acuratete !== null ? `${(acuratete * 100).toFixed(1)}%` : "-"}</li>
        <li>Brier mediu: {brierMediu !== null ? brierMediu.toFixed(4) : "-"}</li>
        <li>Log-loss mediu: {logLossMediu !== null ? logLossMediu.toFixed(4) : "-"}</li>
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: Randează secțiunile de fotbal în componenta `Predictii`**

În funcția `export default async function Predictii()`, după liniile existente care încarcă `toate`/`peVersiune`/`versiuni` pentru tenis, adaugă:

```typescript
  const toateFotbal = await fetchToateEvaluarileFotbal(db);
  const peVersiunePiataFotbal = new Map<string, RandEvaluareFotbal[]>();
  for (const r of toateFotbal) {
    const cheie = `${r.versiune_model}|${r.piata}`;
    if (!peVersiunePiataFotbal.has(cheie)) peVersiunePiataFotbal.set(cheie, []);
    peVersiunePiataFotbal.get(cheie)!.push(r);
  }
  const grupuriFotbal = Array.from(peVersiunePiataFotbal.keys()).sort();
```

Și adaugă randarea lor, imediat după secțiunile de tenis existente (`versiuni.map(...)`):

```tsx
      {grupuriFotbal.map((cheie) => {
        const [versiune, piata] = cheie.split("|");
        return (
          <SectiuneVersiunePiataFotbal key={cheie} versiune={versiune} piata={piata} randuri={peVersiunePiataFotbal.get(cheie)!} />
        );
      })}
```

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && rm -rf .next tsconfig.tsbuildinfo && npx next build && rm -rf .next tsconfig.tsbuildinfo`
Expected: build curat.

- [ ] **Step 4: Verificare live**

Pornește dev server și accesează `/predictii` — dacă există deja predicții de fotbal pentru meciuri terminate, apar secțiuni noi `poisson-fotbal · versiune 1 · 1x2_fotbal` și `poisson-fotbal · versiune 1 · total_goluri_2.5`; dacă nu există încă (meciurile viitoare nu s-au terminat), pagina rămâne neschimbată pentru fotbal (array gol, nicio secțiune randată) — comportament corect, nu o eroare.

- [ ] **Step 5: Commit**

```bash
git add app/predictii/page.tsx
git commit -m "Pagina /predictii: secțiune evaluare poisson-fotbal (1x2 + total goluri, per versiune)"
```

---

### Task 12: Backtest walk-forward (validare fereastră glisantă)

**Files:**
- Create: `scripts/backtest-poisson-fotbal.ts`
- Modify: `package.json`

- [ ] **Step 1: Scrie scriptul**

```typescript
/**
 * Backtest walk-forward al modelului Poisson de fotbal: pentru o listă de ferestre candidate
 * (sezoane), simulează re-estimarea periodică a ratingurilor strict pe meciuri anterioare
 * (fără look-ahead) și evaluează predicțiile pe ultimele SEZOANE_TEST sezoane din cache-ul
 * local, per ligă și piață (1X2, total goluri 2.5). Re-estimarea se face o dată per lot de
 * MARIME_LOT_TEST meciuri (nu meci-cu-meci), ca aproximare a recalculării zilnice — suficient
 * de fin pentru a evita look-ahead semnificativ, suficient de grosier ca runtime-ul să fie
 * practic. Nu rulează pe Vercel.
 *
 * Rulare: npm run backtest:fotbal
 */
import fotbalConfig from "@/config/fotbal.json";
import { incarcaIstoricFootballData, SEZOANE_IMPLICITE } from "@/lib/predictii/football-data";
import { estimeazaRatinguri, lambdaMeci, distributieScor } from "@/lib/predictii/modele/poisson-fotbal";
import { construiestePiata1x2 } from "@/lib/predictii/piete/1x2-fotbal";
import { construiestePiataTotalGoluri } from "@/lib/predictii/piete/total-goluri";
import type { MeciIstoricFotbal } from "@/lib/predictii/tipuri";

const FERESTRE_CANDIDATE = [2, 3, 4]; // sezoane
const MARIME_LOT_TEST = 30;
const SEZOANE_TEST = 2;

function rezultat1x2(golAcasa: number, golOaspete: number): "acasa" | "egal" | "oaspete" {
  if (golAcasa > golOaspete) return "acasa";
  if (golAcasa < golOaspete) return "oaspete";
  return "egal";
}
function rezultatTotalGoluri(golAcasa: number, golOaspete: number): "peste" | "sub" {
  return golAcasa + golOaspete >= 3 ? "peste" : "sub";
}
function brier(p: number, corect: boolean): number {
  return (p - (corect ? 1 : 0)) ** 2;
}
function logLoss(p: number, corect: boolean): number {
  return -Math.log(corect ? p : 1 - p);
}
function filtreazaFereastraZile(meciuri: MeciIstoricFotbal[], dataLimitaInf: string, dataLimitaSup: string): MeciIstoricFotbal[] {
  return meciuri.filter((m) => m.data >= dataLimitaInf && m.data < dataLimitaSup);
}

async function main() {
  console.log("Încarc istoricul football-data.co.uk...");
  const toateMeciurile = await incarcaIstoricFootballData(SEZOANE_IMPLICITE);
  console.log(`Total meciuri: ${toateMeciurile.length}`);

  const dataLimitaTest = new Date();
  dataLimitaTest.setFullYear(dataLimitaTest.getFullYear() - SEZOANE_TEST);
  const dataLimitaTestISO = dataLimitaTest.toISOString().slice(0, 10);

  for (const codLiga of Object.keys(fotbalConfig.ligi_acoperite)) {
    const meciuriLiga = toateMeciurile.filter((m) => m.liga === codLiga).sort((a, b) => a.data.localeCompare(b.data));
    const meciuriTest = meciuriLiga.filter((m) => m.data >= dataLimitaTestISO);
    if (meciuriTest.length === 0) {
      console.log(`${codLiga}: niciun meci de test, sar peste.`);
      continue;
    }
    console.log(`\n${codLiga}: ${meciuriTest.length} meciuri de test`);

    for (const fereastraSezoane of FERESTRE_CANDIDATE) {
      let suma1x2Brier = 0;
      let suma1x2LogLoss = 0;
      let sumaTotalBrier = 0;
      let sumaTotalLogLoss = 0;
      let nrEvaluate = 0;

      for (let i = 0; i < meciuriTest.length; i += MARIME_LOT_TEST) {
        const lot = meciuriTest.slice(i, i + MARIME_LOT_TEST);
        const dataLot = lot[0].data;
        const limitaFereastra = new Date(dataLot);
        limitaFereastra.setFullYear(limitaFereastra.getFullYear() - fereastraSezoane);
        const limitaFereastraISO = limitaFereastra.toISOString().slice(0, 10);

        const meciuriTrain = filtreazaFereastraZile(meciuriLiga, limitaFereastraISO, dataLot);
        if (meciuriTrain.length === 0) continue;
        const stare = estimeazaRatinguri(meciuriTrain);

        for (const m of lot) {
          const lambda = lambdaMeci(stare, m.echipaAcasaId, m.echipaOaspeteId);
          if (!lambda) continue; // echipă nou-promovată, fără istoric în fereastra de train

          const distributie = distributieScor(lambda.lambdaAcasa, lambda.lambdaOaspete);
          const rez1x2 = rezultat1x2(m.golAcasa, m.golOaspete);
          const rezTotal = rezultatTotalGoluri(m.golAcasa, m.golOaspete);

          for (const s of construiestePiata1x2(distributie)) {
            suma1x2Brier += brier(s.probabilitate, s.selectie === rez1x2);
            if (s.selectie === rez1x2) suma1x2LogLoss += logLoss(s.probabilitate, true);
          }
          for (const s of construiestePiataTotalGoluri(distributie)) {
            sumaTotalBrier += brier(s.probabilitate, s.selectie === rezTotal);
            if (s.selectie === rezTotal) sumaTotalLogLoss += logLoss(s.probabilitate, true);
          }
          nrEvaluate++;
        }
      }

      if (nrEvaluate === 0) {
        console.log(`  fereastră ${fereastraSezoane} sezoane: niciun meci evaluat`);
        continue;
      }
      console.log(
        `  fereastră ${fereastraSezoane} sezoane (${nrEvaluate} meciuri): ` +
          `1X2 brier=${(suma1x2Brier / nrEvaluate).toFixed(4)} logloss=${(suma1x2LogLoss / nrEvaluate).toFixed(4)} · ` +
          `total2.5 brier=${(sumaTotalBrier / nrEvaluate).toFixed(4)} logloss=${(sumaTotalLogLoss / nrEvaluate).toFixed(4)}`
      );
    }
  }

  console.log("\nActualizează manual config/fotbal.json -> fereastra_sezoane cu valoarea cu cel mai mic log-loss mediu (însumat pe ligi și piețe).");
}

main();
```

- [ ] **Step 2: Adaugă scriptul npm**

În `package.json`:

```json
"backtest:fotbal": "tsx scripts/backtest-poisson-fotbal.ts",
```

- [ ] **Step 3: Rulează backtestul**

Run: `npm run backtest:fotbal`
Expected: pentru fiecare ligă acoperită, un tabel cu Brier/log-loss pentru cele 3 ferestre candidate (2/3/4 sezoane), pe ambele piețe.

- [ ] **Step 4: Actualizează `config/fotbal.json` cu fereastra optimă**

Pe baza output-ului de la Step 3, alege fereastra cu log-loss mediu minim (însumat/mediat pe toate ligile și cele două piețe) și actualizează `"fereastra_sezoane"` în `config/fotbal.json` cu acea valoare, dacă diferă de 3. Adaugă o notă în `_nota` cu rezultatul (ex. "v1: backtest 2026-11, fereastră 3 sezoane confirmată optimă pe toate ligile").

- [ ] **Step 5: Dacă fereastra s-a schimbat, re-rulează backfill-ul**

Dacă `fereastra_sezoane` s-a schimbat la Step 4: `npm run backfill:fotbal` din nou, ca `ratinguri_fotbal` să reflecte noua fereastră (idempotent — upsert pe `(liga, echipa_id)`).

- [ ] **Step 6: Commit**

```bash
git add scripts/backtest-poisson-fotbal.ts package.json config/fotbal.json
git commit -m "Adaugă backtest walk-forward pentru fereastra glisantă Poisson fotbal"
```

---

### Task 13: Verificare finală + push

**Files:** (niciun fișier nou — verificare și handoff)

- [ ] **Step 1: Rulează suita completă de teste + build**

```bash
npm test
npx tsc --noEmit
rm -rf .next tsconfig.tsbuildinfo
npx next build
rm -rf .next tsconfig.tsbuildinfo
```
Expected: toate verzi.

- [ ] **Step 2: Verifică starea git**

```bash
git log origin/main..HEAD --oneline
git status
```

- [ ] **Step 3: Cere confirmarea utilizatorului înainte de push**

**NU rulează `git push` automat.** Întreabă explicit utilizatorul dacă vrea să facă push la commit-urile acumulate, la fel ca la finalul sub-proiectului A (pagina `/meci/[id]`).
