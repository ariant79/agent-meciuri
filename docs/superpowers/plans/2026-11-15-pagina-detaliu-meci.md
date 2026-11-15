# Pagina de detaliu meci — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fiecare card de meci de pe dashboard devine clickabil și deschide `/meci/[id]`, o pagină cu scor_detalii expandat și, pentru tenis, rating Elo + head-to-head + predicția salvată; celelalte sporturi arată ce există deja plus un mesaj clar că predicțiile nu sunt încă disponibile.

**Architecture:** Rută nouă server-component (`app/meci/[id]/page.tsx`, același tipar ca `/predictii`). Tabelă nouă `h2h_tenis` (agregat victorii, nu istoric meci-cu-meci), populată la backfill și actualizată zilnic alături de `ratinguri`. Logica de afișare comună dashboard/detaliu se extrage în `lib/afisare-eveniment.ts`; paginarea Supabase comună se extrage în `lib/supabase-paginat.ts`. Zero JS client nou.

**Tech Stack:** Next.js 15 App Router (server components), Supabase (Postgres + supabase-js), TypeScript, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-15-pagina-detaliu-meci-design.md`

---

### Task 1: Migrare `003_h2h_tenis.sql`

**Files:**
- Create: `supabase/migrations/003_h2h_tenis.sql`

- [ ] **Step 1: Scrie fișierul de migrare**

```sql
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
```

- [ ] **Step 2: Aplică migrarea pe proiectul Supabase live**

Folosește tool-ul `mcp__claude_ai_Supabase__apply_migration` cu `project_id: "tdaslxptpxoiposcrsel"`, `name: "h2h_tenis"`, și conținutul SQL de mai sus ca `query`.

- [ ] **Step 3: Verifică**

Folosește `mcp__claude_ai_Supabase__list_tables` cu `project_id: "tdaslxptpxoiposcrsel"`, `verbose: true` — confirmă că `public.h2h_tenis` apare cu `rls_enabled: true` și primary key `["jucator_id_1", "jucator_id_2"]`.

Rulează și `mcp__claude_ai_Supabase__get_advisors` cu `type: "security"` pe același `project_id` — confirmă listă goală (fără avertismente noi, ca la migrarea 002).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/003_h2h_tenis.sql
git commit -m "Migrare h2h_tenis: agregat head-to-head pentru tenis"
```

---

### Task 2: `lib/predictii/h2h.ts` — logica pură head-to-head

**Files:**
- Create: `lib/predictii/h2h.ts`
- Create: `lib/predictii/h2h.test.ts`

- [ ] **Step 1: Scrie testul (va pica — modulul nu există încă)**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ordineCanonica,
  incrementeazaH2h,
  orienteazaH2h,
  creeazaStareH2h,
  actualizeazaH2hBulk,
  randuriH2h,
} from "./h2h.ts";

test("ordineCanonica pune mereu id-ul mai mic alfabetic primul, indiferent de ordinea dată", () => {
  assert.deepEqual(ordineCanonica("200", "100"), ["100", "200"]);
  assert.deepEqual(ordineCanonica("100", "200"), ["100", "200"]);
});

test("incrementeazaH2h de la zero: câștigătorul capătă victoria pe poziția lui canonică", () => {
  const rand = incrementeazaH2h(null, "200", "100", "2026-01-01");
  assert.deepEqual(rand, { jucator_id_1: "100", jucator_id_2: "200", victorii_1: 0, victorii_2: 1, ultimul_meci: "2026-01-01" });
});

test("incrementeazaH2h pe un rând existent adaugă la contorul corect", () => {
  const existent = { jucator_id_1: "100", jucator_id_2: "200", victorii_1: 2, victorii_2: 1, ultimul_meci: "2025-01-01" };
  const rand = incrementeazaH2h(existent, "100", "200", "2026-01-01");
  assert.deepEqual(rand, { jucator_id_1: "100", jucator_id_2: "200", victorii_1: 3, victorii_2: 1, ultimul_meci: "2026-01-01" });
});

test("orienteazaH2h: fără rând în DB, prima întâlnire", () => {
  const rezultat = orienteazaH2h(null, "200", "100");
  assert.deepEqual(rezultat, { victoriiA: 0, victoriiB: 0, ultimulMeci: null });
});

test("orienteazaH2h orientează relativ la (idA, idB), indiferent de ordinea canonică din DB", () => {
  const randDb = { jucator_id_1: "100", jucator_id_2: "200", victorii_1: 3, victorii_2: 1, ultimul_meci: "2026-01-01" };
  // A=200 (al doilea canonic), B=100 (primul canonic) -> victoriile lui A sunt victorii_2, ale lui B victorii_1
  assert.deepEqual(orienteazaH2h(randDb, "200", "100"), { victoriiA: 1, victoriiB: 3, ultimulMeci: "2026-01-01" });
  // ordinea inversă dă rezultatul simetric
  assert.deepEqual(orienteazaH2h(randDb, "100", "200"), { victoriiA: 3, victoriiB: 1, ultimulMeci: "2026-01-01" });
});

test("actualizeazaH2hBulk + randuriH2h: trei victorii ale lui 100 împotriva lui 200", () => {
  const stare = creeazaStareH2h();
  actualizeazaH2hBulk(stare, "100", "200", "2026-01-01");
  actualizeazaH2hBulk(stare, "200", "100", "2026-02-01");
  actualizeazaH2hBulk(stare, "100", "200", "2026-03-01");
  const randuri = randuriH2h(stare);
  assert.equal(randuri.length, 1);
  assert.deepEqual(randuri[0], { jucator_id_1: "100", jucator_id_2: "200", victorii_1: 2, victorii_2: 1, ultimul_meci: "2026-03-01" });
});
```

- [ ] **Step 2: Rulează testul, confirmă că pică**

```bash
node --test lib/predictii/h2h.test.ts
```
Rezultat așteptat: eroare, `Cannot find module './h2h.ts'` (sau fișier inexistent).

- [ ] **Step 3: Scrie implementarea**

```typescript
/**
 * Head-to-head agregat (victorii/jucător), NU istoric meci-cu-meci — suficient pentru
 * "X conduce N-M" pe pagina de detaliu. Vezi docs/superpowers/specs/2026-11-15-pagina-detaliu-meci-design.md.
 */

export interface RandH2hDb {
  jucator_id_1: string;
  jucator_id_2: string;
  victorii_1: number;
  victorii_2: number;
  ultimul_meci: string | null;
}

/** id-ul mai mic alfabetic primul — aceeași convenție ca restul lui lib/predictii/ */
export function ordineCanonica(idA: string, idB: string): [string, string] {
  return idA < idB ? [idA, idB] : [idB, idA];
}

/** rândul h2h actualizat după o victorie, pornind de la rândul existent (sau null dacă e prima întâlnire) */
export function incrementeazaH2h(
  randExistent: RandH2hDb | null,
  castigatorId: string,
  invinsId: string,
  dataMeciISO: string
): RandH2hDb {
  const [id1, id2] = ordineCanonica(castigatorId, invinsId);
  const victorii_1 = (randExistent?.victorii_1 ?? 0) + (castigatorId === id1 ? 1 : 0);
  const victorii_2 = (randExistent?.victorii_2 ?? 0) + (castigatorId === id2 ? 1 : 0);
  return { jucator_id_1: id1, jucator_id_2: id2, victorii_1, victorii_2, ultimul_meci: dataMeciISO };
}

/** orientează un rând h2h (sau lipsa lui) relativ la (idA, idB), indiferent de ordinea canonică din DB */
export function orienteazaH2h(
  rand: RandH2hDb | null,
  idA: string,
  idB: string
): { victoriiA: number; victoriiB: number; ultimulMeci: string | null } {
  if (!rand) return { victoriiA: 0, victoriiB: 0, ultimulMeci: null };
  const [id1] = ordineCanonica(idA, idB);
  return idA === id1
    ? { victoriiA: rand.victorii_1, victoriiB: rand.victorii_2, ultimulMeci: rand.ultimul_meci }
    : { victoriiA: rand.victorii_2, victoriiB: rand.victorii_1, ultimulMeci: rand.ultimul_meci };
}

// --- replay în masă (doar pentru backfill — vezi scripts/backfill-tenis.ts) ---

export type StareH2h = Map<string, RandH2hDb>;

export function creeazaStareH2h(): StareH2h {
  return new Map();
}

function cheiePereche(id1: string, id2: string): string {
  return `${id1}|${id2}`;
}

export function actualizeazaH2hBulk(stare: StareH2h, castigatorId: string, invinsId: string, dataMeciISO: string): void {
  const [id1, id2] = ordineCanonica(castigatorId, invinsId);
  const existent = stare.get(cheiePereche(id1, id2)) ?? null;
  stare.set(cheiePereche(id1, id2), incrementeazaH2h(existent, castigatorId, invinsId, dataMeciISO));
}

export function randuriH2h(stare: StareH2h): RandH2hDb[] {
  return Array.from(stare.values());
}
```

- [ ] **Step 4: Rulează testul, confirmă că trece**

```bash
node --test lib/predictii/h2h.test.ts
```
Rezultat așteptat: `pass 6`, `fail 0`.

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add lib/predictii/h2h.ts lib/predictii/h2h.test.ts
git commit -m "Adaugă logica pură head-to-head (lib/predictii/h2h.ts)"
```

---

### Task 3: Extrage `lib/afisare-eveniment.ts` din `app/page.tsx`

Refactor pur — nicio schimbare de comportament. Scopul: `app/meci/[id]/page.tsx` (Task 6) va avea nevoie de aceleași funcții (`numeSport`, `afiseazaFaza`, `afiseazaParticipant`, `rezultatText`) fără să le duplice.

**Files:**
- Create: `lib/afisare-eveniment.ts`
- Modify: `app/page.tsx:1-96` (importuri + ștergerea definițiilor locale mutate)

- [ ] **Step 1: Scrie modulul nou**

```typescript
import { cheieFaza, type CheieFaza } from "@/clasificator";
import { esteNationale, numeNatiuneRo } from "@/lib/national";

export interface RandEvenimentDeBaza {
  sport: string;
  competitie: string;
  cod_competitie: string;
  faza: string | null;
  participant_1: string;
  participant_2: string;
  status: string;
  extra: Record<string, unknown> | null;
}

export interface Predictie {
  p1: number;
  p2: number;
}

const NUME_SPORT: Record<string, string> = { fotbal: "Fotbal", tenis: "Tenis" };
const FAZA_RO: Record<CheieFaza, string> = {
  finala: "Finală",
  semifinala: "Semifinală",
  sferturi: "Sferturi",
  optimi: "Optimi",
  grupe_tur_final: "Faza grupelor",
  etapa_campionat: "Etapă",
  tur_initial: "Calificări",
};

export function numeSport(sport: string): string {
  return NUME_SPORT[sport] ?? "Alte sporturi";
}

export function afiseazaFaza(ev: RandEvenimentDeBaza): string | null {
  if (!ev.faza) return null;
  return ev.sport === "tenis" ? FAZA_RO[cheieFaza(ev.faza)] : ev.faza;
}

export function afiseazaParticipant(ev: RandEvenimentDeBaza, nume: string): string {
  return esteNationale(ev.sport, ev.cod_competitie) ? numeNatiuneRo(nume) : nume;
}

export function rezultatText(ev: RandEvenimentDeBaza): string | null {
  const scor = ev.extra?.scor;
  if (Array.isArray(scor)) return `${scor[0]} – ${scor[1]}`;
  if (typeof scor === "string") return scor;
  const castigator = ev.extra?.castigator;
  if (typeof castigator === "string") return `Câștigă ${afiseazaParticipant(ev, castigator)}`;
  return null;
}

/** indicator vizual de importanță, 1-3 puncte, derivat din scor (0-100) */
export function puncteImportanta(scor: number | null): number {
  if (scor === null) return 1;
  if (scor >= 70) return 3;
  if (scor >= 50) return 2;
  return 1;
}

/** cine e favoritul și, dacă meciul s-a terminat, dacă favoritul a câștigat */
export function evalueazaPredictieTenis(
  ev: RandEvenimentDeBaza,
  predictie: Predictie
): { favorizeazaP1: boolean; corect: boolean | null } {
  const favorizeazaP1 = predictie.p1 >= predictie.p2;
  const castigator = ev.extra?.castigator;
  const corect =
    ev.status === "terminat" && typeof castigator === "string" ? castigator === (favorizeazaP1 ? "p1" : "p2") : null;
  return { favorizeazaP1, corect };
}
```

- [ ] **Step 2: Typecheck modulul nou (independent, înainte de a toca `app/page.tsx`)**

```bash
npx tsc --noEmit
```
Trebuie să treacă curat — modulul nou nu e încă folosit nicăieri, nu poate crea erori noi.

- [ ] **Step 3: Actualizează `app/page.tsx` ca să folosească modulul nou**

Înlocuiește liniile 1-96 (de la primul import până la finalul funcției `IndicatorImportanta`, inclusiv) cu:

```typescript
import Link from "next/link";
import { supabasePublic } from "@/lib/supabase";
import { azi, deplaseazaDataRo, oraRoFromUtc } from "@/lib/date";
import { reimprospateazaAction } from "@/app/actions";
import {
  numeSport,
  afiseazaFaza,
  afiseazaParticipant,
  rezultatText,
  puncteImportanta,
  evalueazaPredictieTenis,
  type RandEvenimentDeBaza,
  type Predictie,
} from "@/lib/afisare-eveniment";
import type { StareSursa } from "@/lib/types";

export const dynamic = "force-dynamic";

type RandEveniment = RandEvenimentDeBaza & {
  id: string;
  start_utc: string;
  scor: number | null;
  etichete: string[] | null;
};

function PredictieTenis({ ev, predictie }: { ev: RandEveniment; predictie: Predictie }) {
  const { favorizeazaP1, corect } = evalueazaPredictieTenis(ev, predictie);

  return (
    <div className="card-predictie">
      <span className={favorizeazaP1 ? "predictie-favorit" : undefined}>
        {afiseazaParticipant(ev, ev.participant_1)} {Math.round(predictie.p1 * 100)}%
      </span>
      {" · "}
      <span className={!favorizeazaP1 ? "predictie-favorit" : undefined}>
        {afiseazaParticipant(ev, ev.participant_2)} {Math.round(predictie.p2 * 100)}%
      </span>
      {corect !== null && <span className={corect ? "predictie-corecta" : "predictie-gresita"}>{corect ? " ✓" : " ✗"}</span>}
    </div>
  );
}

function IndicatorImportanta({ scor }: { scor: number | null }) {
  const puncte = puncteImportanta(scor);
  return (
    <span className="importanta" title={`importanță ${puncte}/3`}>
      {"●".repeat(puncte)}
      {"○".repeat(3 - puncte)}
    </span>
  );
}
```

Restul fișierului (`CardEveniment`, `ordoneazaPentruAfisare`, `SectiuneSport`, `Home`) rămâne neschimbat **pentru moment** — se modifică în Task 6 (link-ul pe card).

- [ ] **Step 4: Build + test, confirmă că nimic nu s-a stricat**

```bash
npx tsc --noEmit
rm -rf .next tsconfig.tsbuildinfo
npx next build
node --test lib/**/*.test.ts
```
Toate trei trebuie să treacă curat (buildul arată aceleași rute ca înainte, testele trec).

- [ ] **Step 5: Verificare manuală live (serverul de dev al utilizatorului, dacă rulează, sau un build local)**

```bash
rm -rf .next
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3002/
```
Dacă nu răspunde, nu e un blocaj — userul își pornește dev server-ul separat; treci la commit.

- [ ] **Step 6: Commit**

```bash
rm -rf .next tsconfig.tsbuildinfo
git add lib/afisare-eveniment.ts app/page.tsx
git commit -m "Extrage lib/afisare-eveniment.ts din app/page.tsx (refactor, fără schimbare de comportament)"
```

---

### Task 4: Head-to-head în backfill

**Files:**
- Modify: `scripts/backfill-tenis.ts`

- [ ] **Step 1: Adaugă importul și starea h2h**

În `scripts/backfill-tenis.ts`, lângă importul existent din `elo-tenis`:

```typescript
import { creeazaStare, actualizeazaMeci, ratinguriJucator, DIMENSIUNI_RATING } from "@/lib/predictii/modele/elo-tenis";
import { creeazaStareH2h, actualizeazaH2hBulk, randuriH2h } from "@/lib/predictii/h2h";
```

În funcția `main()`, imediat după `const stare = creeazaStare();`:

```typescript
  const stare = creeazaStare();
  const stareH2h = creeazaStareH2h();
```

- [ ] **Step 2: Actualizează h2h în bucla principală**

În bucla `for (const meci of meciuri) { ... }`, imediat după linia `actualizeazaMeci(stare, meci.castigatorId, meci.invinsId, meci.suprafata);`, adaugă:

```typescript
    actualizeazaH2hBulk(stareH2h, meci.castigatorId, meci.invinsId, meci.dataISO);
```

(Rămâne în interiorul blocului care rulează doar pentru meciurile non-walkover — după `if (meci.walkover) { ignorateWalkover++; continue; }`.)

- [ ] **Step 3: Scrie rândurile h2h în Supabase, după cele de ratinguri**

Imediat după bucla `for (let i = 0; i < randuri.length; i += MARIME_LOT) { ... }` (scrierea `ratinguri`) și înainte de `console.log("Backfill terminat.");`, adaugă:

```typescript
  const randuriH2hDeScris = randuriH2h(stareH2h);
  console.log(`Rânduri de scris în h2h_tenis: ${randuriH2hDeScris.length}`);

  for (let i = 0; i < randuriH2hDeScris.length; i += MARIME_LOT) {
    const lot = randuriH2hDeScris.slice(i, i + MARIME_LOT);
    const { error } = await db.from("h2h_tenis").upsert(lot, { onConflict: "jucator_id_1,jucator_id_2" });
    if (error) {
      console.error(`Eroare la lotul h2h ${i}-${i + lot.length}:`, error.message);
      process.exit(1);
    }
    console.log(`  scris h2h ${Math.min(i + MARIME_LOT, randuriH2hDeScris.length)}/${randuriH2hDeScris.length}`);
  }
```

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Rulează backfill-ul live (rescrie `ratinguri` cu aceiași parametri + populează `h2h_tenis`)**

```bash
npm run backfill:tenis
```
Așteaptă mesajele `Rânduri de scris în h2h_tenis: N` și `scris h2h .../N` până la finalul listei, apoi `Backfill terminat.`

- [ ] **Step 6: Verifică live în Supabase**

Folosește `mcp__claude_ai_Supabase__execute_sql` cu `project_id: "tdaslxptpxoiposcrsel"`:

```sql
select count(*) as total_perechi from public.h2h_tenis;
select r1.nume, r2.nume, h.victorii_1, h.victorii_2
from public.h2h_tenis h
join public.ratinguri r1 on r1.jucator_id = h.jucator_id_1 and r1.suprafata = 'general'
join public.ratinguri r2 on r2.jucator_id = h.jucator_id_2 and r2.suprafata = 'general'
where h.victorii_1 + h.victorii_2 >= 10
order by h.victorii_1 + h.victorii_2 desc
limit 5;
```
Rezultat așteptat: `total_perechi` în zecile de mii; al doilea query arată perechi cu multe meciuri reciproce (rivalități reale, ex. nume cunoscute din ATP/WTA) — confirmă sanity-check-ul.

- [ ] **Step 7: Commit**

```bash
git add scripts/backfill-tenis.ts
git commit -m "Populează h2h_tenis la backfill (agregat victorii, calculat alături de ratinguri)"
```

---

### Task 5: Head-to-head în actualizarea zilnică + extrage paginarea comună

**Files:**
- Create: `lib/supabase-paginat.ts`
- Modify: `lib/predictii/actualizare-zilnica.ts`

- [ ] **Step 1: Extrage helper-ul de paginare într-un fișier partajat**

Creează `lib/supabase-paginat.ts`:

```typescript
const MARIME_PAGINA = 1000; // PostgREST limitează implicit select-urile la 1000 de rânduri

/** paginează orice query Supabase ca să luăm toate rândurile, nu doar primele 1000 */
export async function fetchToateRanduri<T>(
  construieste: (start: number, end: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const toate: T[] = [];
  let start = 0;
  while (true) {
    const { data, error } = await construieste(start, start + MARIME_PAGINA - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    toate.push(...data);
    if (data.length < MARIME_PAGINA) break;
    start += MARIME_PAGINA;
  }
  return toate;
}
```

- [ ] **Step 2: Actualizează `lib/predictii/actualizare-zilnica.ts` să importe helper-ul în loc să-l definească local**

Șterge din `lib/predictii/actualizare-zilnica.ts` constanta `MARIME_PAGINA` și funcția `fetchToateRanduri` definite local (liniile cu comentariul `// PostgREST limitează implicit selecturile la 1000 de rânduri` și funcția de sub ea), și adaugă în loc, lângă celelalte importuri:

```typescript
import { fetchToateRanduri } from "@/lib/supabase-paginat";
```

- [ ] **Step 3: Exportă `determinaSuprafata`**

În același fișier, schimbă:
```typescript
function determinaSuprafata(competitie: string): Suprafata {
```
în:
```typescript
export function determinaSuprafata(competitie: string): Suprafata {
```

- [ ] **Step 4: Typecheck + test, confirmă că refactorul nu a stricat nimic**

```bash
npx tsc --noEmit
node --test lib/**/*.test.ts
```

- [ ] **Step 5: Commit refactorul de paginare, separat de pasul următor (h2h)**

```bash
git add lib/supabase-paginat.ts lib/predictii/actualizare-zilnica.ts
git commit -m "Extrage fetchToateRanduri în lib/supabase-paginat.ts (partajat); exportă determinaSuprafata"
```

- [ ] **Step 6: Adaugă actualizarea h2h în bucla zilnică**

În `lib/predictii/actualizare-zilnica.ts`, adaugă importul:

```typescript
import { ordineCanonica, incrementeazaH2h, type RandH2hDb } from "@/lib/predictii/h2h";
```

Imediat după linia `actualizeazaMeci(stare, castigatorId, invinsId, suprafata);` (în bucla care procesează meciurile terminate), adaugă:

```typescript
    const [h2hId1, h2hId2] = ordineCanonica(castigatorId, invinsId);
    const { data: randH2hExistent } = await db
      .from("h2h_tenis")
      .select("jucator_id_1,jucator_id_2,victorii_1,victorii_2,ultimul_meci")
      .eq("jucator_id_1", h2hId1)
      .eq("jucator_id_2", h2hId2)
      .maybeSingle();
    const randH2hNou = incrementeazaH2h(
      (randH2hExistent as RandH2hDb | null) ?? null,
      castigatorId,
      invinsId,
      dataRoFromUtc(ev.start_utc)
    );
    const { error: eroareH2h } = await db.from("h2h_tenis").upsert(randH2hNou, { onConflict: "jucator_id_1,jucator_id_2" });
    if (eroareH2h) console.error(`[predictii] eroare la h2h pentru ${castigatorId}/${invinsId}:`, eroareH2h.message);
```

(`dataRoFromUtc` e deja importat în fișier din `@/lib/date`.)

- [ ] **Step 7: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 8: Verificare live — rulează o colectare reală și confirmă că nu crapă**

Creează temporar `scripts/_verif_h2h.ts`:

```typescript
import { readFileSync, existsSync } from "fs";
function incarcaEnvLocal(): void {
  if (!existsSync(".env.local")) return;
  for (const linie of readFileSync(".env.local", "utf8").split("\n")) {
    const separator = linie.indexOf("=");
    if (separator === -1) continue;
    const cheie = linie.slice(0, separator).trim();
    if (cheie && process.env[cheie] === undefined) process.env[cheie] = linie.slice(separator + 1).trim();
  }
}
incarcaEnvLocal();
import { executaColectare } from "@/colecteaza";
import { azi } from "@/lib/date";
async function main() {
  const r = await executaColectare(azi());
  console.log(JSON.stringify(r.predictii, null, 2));
}
main();
```

```bash
npx tsx scripts/_verif_h2h.ts
```
Rezultat așteptat: `{ "actualizariElo": ..., "predictiiNoi": ..., "jucatoriNepotriviti": [] }` — fără erori aruncate. (`actualizariElo` poate fi 0 dacă niciun meci de tenis nu s-a terminat încă azi — e normal, logica de h2h nu rulează decât odată cu o actualizare Elo reală.)

Șterge scriptul temporar:
```bash
rm -f scripts/_verif_h2h.ts
```

- [ ] **Step 9: Commit**

```bash
git add lib/predictii/actualizare-zilnica.ts
git commit -m "Actualizează h2h_tenis zilnic, odată cu ratinguri, pentru meciurile de tenis terminate"
```

---

### Task 6: Pagina `/meci/[id]`

**Files:**
- Create: `app/meci/[id]/page.tsx`
- Modify: `app/page.tsx` (cardurile devin linkuri)
- Modify: `app/globals.css`

- [ ] **Step 1: Scrie pagina nouă**

```typescript
import { notFound } from "next/navigation";
import Link from "next/link";
import { supabasePublic } from "@/lib/supabase";
import { oraRoFromUtc } from "@/lib/date";
import { numeSport, afiseazaFaza, afiseazaParticipant, rezultatText, type RandEvenimentDeBaza } from "@/lib/afisare-eveniment";
import { determinaSuprafata } from "@/lib/predictii/actualizare-zilnica";
import { gasesteJucatorId, normalizeazaNumeJucator } from "@/lib/predictii/potrivire-nume";
import { ordineCanonica, orienteazaH2h, type RandH2hDb } from "@/lib/predictii/h2h";
import { fetchToateRanduri } from "@/lib/supabase-paginat";
import type { DimensiuneRating } from "@/lib/predictii/tipuri";

export const dynamic = "force-dynamic";

interface RandEveniment extends RandEvenimentDeBaza {
  id: string;
  start_utc: string;
  scor: number | null;
  scor_detalii: { valoare: number; rivalitate: number; traditie: number } | null;
  etichete: string[] | null;
  data_ro: string;
}

type RandRatingGeneral = { jucator_id: string; nume: string };
type RandRatingComplet = { jucator_id: string; suprafata: DimensiuneRating; rating: number; nr_meciuri: number };

async function obtineStatisticiTenis(db: ReturnType<typeof supabasePublic>, ev: RandEveniment) {
  const [randuriAlias, randuriGeneral] = await Promise.all([
    fetchToateRanduri<{ nume_sursa: string; jucator_id: string }>((start, end) =>
      db.from("jucatori_alias").select("nume_sursa,jucator_id").eq("sursa", "espn").range(start, end)
    ),
    fetchToateRanduri<RandRatingGeneral>((start, end) =>
      db.from("ratinguri").select("jucator_id,nume").eq("sport", "tenis").eq("suprafata", "general").range(start, end)
    ),
  ]);

  const aliasuri = new Map(randuriAlias.map((r) => [r.nume_sursa, r.jucator_id]));
  const jucatoriCunoscuti = new Map(randuriGeneral.map((r) => [normalizeazaNumeJucator(r.nume), r.jucator_id]));

  const r1 = gasesteJucatorId(ev.participant_1, aliasuri, jucatoriCunoscuti);
  const r2 = gasesteJucatorId(ev.participant_2, aliasuri, jucatoriCunoscuti);
  if (!r1.jucatorId || !r2.jucatorId) return null;

  const suprafata = determinaSuprafata(ev.competitie);

  const [{ data: randuriRating }, { data: randH2hBrut }, { data: randuriPredictie }] = await Promise.all([
    db
      .from("ratinguri")
      .select("jucator_id,suprafata,rating,nr_meciuri")
      .eq("sport", "tenis")
      .in("jucator_id", [r1.jucatorId, r2.jucatorId]),
    (() => {
      const [id1, id2] = ordineCanonica(r1.jucatorId!, r2.jucatorId!);
      return db
        .from("h2h_tenis")
        .select("jucator_id_1,jucator_id_2,victorii_1,victorii_2,ultimul_meci")
        .eq("jucator_id_1", id1)
        .eq("jucator_id_2", id2)
        .maybeSingle();
    })(),
    db.from("predictii").select("selectie,probabilitate").eq("eveniment_id", ev.id).eq("piata", "castigator"),
  ]);

  const ratinguriPerJucator = (ratinguri: RandRatingComplet[], jucatorId: string): Record<string, RandRatingComplet> =>
    Object.fromEntries(
      ratinguri.filter((r) => r.jucator_id === jucatorId).map((r): [string, RandRatingComplet] => [r.suprafata, r])
    );

  const h2h = orienteazaH2h((randH2hBrut as RandH2hDb | null) ?? null, r1.jucatorId, r2.jucatorId);

  let predictie: { p1: number; p2: number } | null = null;
  for (const r of randuriPredictie ?? []) {
    predictie = predictie ?? { p1: 0, p2: 0 };
    predictie[r.selectie as "p1" | "p2"] = r.probabilitate;
  }

  return {
    suprafata,
    h2h,
    predictie,
    ratinguri1: ratinguriPerJucator((randuriRating ?? []) as RandRatingComplet[], r1.jucatorId),
    ratinguri2: ratinguriPerJucator((randuriRating ?? []) as RandRatingComplet[], r2.jucatorId),
  };
}

export default async function PaginaMeci({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = supabasePublic();

  const { data: ev } = await db
    .from("evenimente")
    .select(
      "id,sport,competitie,cod_competitie,faza,participant_1,participant_2,start_utc,status,scor,scor_detalii,etichete,extra,data_ro"
    )
    .eq("id", id)
    .maybeSingle();

  if (!ev) notFound();
  const eveniment = ev as RandEveniment;

  const statisticiTenis = eveniment.sport === "tenis" ? await obtineStatisticiTenis(db, eveniment) : null;
  const terminat = eveniment.status === "terminat";
  const rezultat = terminat ? rezultatText(eveniment) : null;
  const faza = afiseazaFaza(eveniment);
  const clasament = eveniment.extra?.clasament as { acasa: number | null; oaspete: number | null } | undefined;

  return (
    <main className="pagina">
      <header className="antet">
        <h1>
          {afiseazaParticipant(eveniment, eveniment.participant_1)} – {afiseazaParticipant(eveniment, eveniment.participant_2)}
        </h1>
        <Link href={`/?data=${eveniment.data_ro}`}>← Înapoi</Link>
      </header>

      <section>
        <p className="card-detalii">
          {eveniment.competitie}
          {faza ? ` · ${faza}` : ""} · {oraRoFromUtc(eveniment.start_utc)}
          {rezultat ? ` · ${rezultat}` : ""}
        </p>
        {eveniment.etichete && eveniment.etichete.length > 0 && (
          <div className="card-etichete">
            {eveniment.etichete.map((et) => (
              <span key={et} className="eticheta">
                {et}
              </span>
            ))}
          </div>
        )}
      </section>

      {eveniment.scor_detalii && (
        <section>
          <h2>Scor</h2>
          <ul className="lista-surse">
            <li>Valoare: {eveniment.scor_detalii.valoare}</li>
            <li>Rivalitate: {eveniment.scor_detalii.rivalitate}</li>
            <li>Tradiție: {eveniment.scor_detalii.traditie}</li>
          </ul>
        </section>
      )}

      {eveniment.sport === "tenis" ? (
        <section>
          <h2>Statistici tenis</h2>
          {statisticiTenis ? (
            <>
              {statisticiTenis.predictie && (
                <p>
                  Predicție: {afiseazaParticipant(eveniment, eveniment.participant_1)}{" "}
                  {Math.round(statisticiTenis.predictie.p1 * 100)}% · {afiseazaParticipant(eveniment, eveniment.participant_2)}{" "}
                  {Math.round(statisticiTenis.predictie.p2 * 100)}%
                </p>
              )}
              <div className="rating-grid">
                {(
                  [
                    { nume: eveniment.participant_1, ratinguri: statisticiTenis.ratinguri1 },
                    { nume: eveniment.participant_2, ratinguri: statisticiTenis.ratinguri2 },
                  ] as Array<{ nume: string; ratinguri: Record<string, RandRatingComplet> }>
                ).map(({ nume, ratinguri }) => (
                  <div key={nume} className="rating-jucator">
                    <h3>{afiseazaParticipant(eveniment, nume)}</h3>
                    {ratinguri.general && (
                      <div className="rating-linie">
                        <span>Elo general</span>
                        <span>
                          {Math.round(ratinguri.general.rating)} ({ratinguri.general.nr_meciuri} meciuri)
                        </span>
                      </div>
                    )}
                    {ratinguri[statisticiTenis.suprafata] && (
                      <div className="rating-linie">
                        <span>Elo {statisticiTenis.suprafata}</span>
                        <span>
                          {Math.round(ratinguri[statisticiTenis.suprafata].rating)} ({ratinguri[statisticiTenis.suprafata].nr_meciuri}{" "}
                          meciuri)
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <p className="h2h">
                {statisticiTenis.h2h.victoriiA === 0 && statisticiTenis.h2h.victoriiB === 0
                  ? "Prima întâlnire între cei doi jucători."
                  : `Head-to-head: ${afiseazaParticipant(eveniment, eveniment.participant_1)} ${statisticiTenis.h2h.victoriiA} - ${statisticiTenis.h2h.victoriiB} ${afiseazaParticipant(eveniment, eveniment.participant_2)}`}
              </p>
            </>
          ) : (
            <p className="gol">Cel puțin unul dintre jucători nu e potrivit cu baza de date Sackmann — fără statistici.</p>
          )}
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

      <footer className="subsol">
        {eveniment.sport === "tenis" && <p>Date istorice tenis: Jeff Sackmann / Tennis Abstract, CC BY-NC-SA 4.0.</p>}
      </footer>
    </main>
  );
}
```

- [ ] **Step 2: Fă cardurile din `app/page.tsx` clickabile**

În `app/page.tsx`, funcția `CardEveniment` arată azi (după Task 3) așa:

```tsx
function CardEveniment({ ev, predictie }: { ev: RandEveniment; predictie?: Predictie }) {
  const terminat = ev.status === "terminat";
  const rezultat = terminat ? rezultatText(ev) : null;
  const faza = afiseazaFaza(ev);

  return (
    <li className={terminat ? "card card-terminat" : "card"}>
      ...
    </li>
  );
}
```

Înlocuiește cu:

```tsx
function CardEveniment({ ev, predictie }: { ev: RandEveniment; predictie?: Predictie }) {
  const terminat = ev.status === "terminat";
  const rezultat = terminat ? rezultatText(ev) : null;
  const faza = afiseazaFaza(ev);

  return (
    <li>
      <Link href={`/meci/${encodeURIComponent(ev.id)}`} className={terminat ? "card card-terminat" : "card"}>
        <div className="card-randul1">
          <span className="card-ora">{oraRoFromUtc(ev.start_utc)}</span>
          <IndicatorImportanta scor={ev.scor} />
        </div>
        <div className="card-meci">
          {afiseazaParticipant(ev, ev.participant_1)} – {afiseazaParticipant(ev, ev.participant_2)}
        </div>
        <div className="card-detalii">
          {ev.competitie}
          {faza ? ` · ${faza}` : ""}
          {rezultat ? ` · ${rezultat}` : ""}
        </div>
        {predictie && <PredictieTenis ev={ev} predictie={predictie} />}
        {ev.etichete && ev.etichete.length > 0 && (
          <div className="card-etichete">
            {ev.etichete.map((et) => (
              <span key={et} className="eticheta">
                {et}
              </span>
            ))}
          </div>
        )}
      </Link>
    </li>
  );
}
```

(Doar `<li className=...>` → `<li>` + `<Link ...>` înfășurând conținutul; restul JSX e identic.)

- [ ] **Step 3: Adaugă stilurile noi în `app/globals.css`**

Modifică regula existentă `.card` (adaugă două declarații, nu schimbă restul):

```css
.card {
  background: #171a21;
  border: 1px solid #262b35;
  border-radius: 8px;
  padding: 0.7rem 0.9rem;
  display: block;
  text-decoration: none;
  color: inherit;
}
```

Adaugă la finalul fișierului:

```css
.rating-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  margin-top: 0.75rem;
}

.rating-jucator h3 {
  font-size: 0.95rem;
  margin: 0 0 0.4rem;
}

.rating-linie {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.15rem 0;
  color: #9aa3b2;
  font-size: 0.85rem;
}

.h2h {
  margin-top: 0.75rem;
  font-size: 0.9rem;
}
```

- [ ] **Step 4: Typecheck + build**

```bash
npx tsc --noEmit
rm -rf .next tsconfig.tsbuildinfo
npx next build
```
Rezultat așteptat: build curat, ruta nouă `ƒ /meci/[id]` apare în lista de rute afișată de `next build`.

- [ ] **Step 5: Verificare live — un meci de tenis real**

```bash
rm -rf .next
npx tsx node_modules/next/dist/bin/next dev -p 3915 > /tmp/dev_meci.log 2>&1 &
sleep 5
```

Găsește un `id` real de meci de tenis din ziua curentă (folosește `mcp__claude_ai_Supabase__execute_sql` cu `project_id: "tdaslxptpxoiposcrsel"`: `select id from public.evenimente where sport='tenis' and selectat=true limit 1;`), apoi:

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3915/meci/<id-ul-gasit-encodat>"
```
Rezultat așteptat: `200`. Verifică și conținutul (`curl -s ... | grep -o 'Elo general'` sau similar) — trebuie să apară rating-urile, nu mesajul de "nepotrivit".

- [ ] **Step 6: Verificare live — un meci fără model (fotbal/altele)**

```bash
# id real de meci de fotbal sau altele din evenimente, la fel ca mai sus
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3915/meci/<id-fotbal-encodat>"
curl -s "http://localhost:3915/meci/<id-fotbal-encodat>" | grep -o "Predicții încă indisponibile"
```
Rezultat așteptat: `200` + mesajul de indisponibilitate apare, fără crash.

- [ ] **Step 7: Verificare live — id inexistent**

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3915/meci/espn:nu-exista-123"
```
Rezultat așteptat: `404`.

- [ ] **Step 8: Oprește serverul de test**

```bash
kill %1 2>/dev/null
rm -f /tmp/dev_meci.log
```

- [ ] **Step 9: Rulează suita de teste completă + build final**

```bash
node --test lib/**/*.test.ts
rm -rf .next tsconfig.tsbuildinfo
npx next build
rm -rf .next tsconfig.tsbuildinfo
```

- [ ] **Step 10: Commit**

```bash
git add app/meci app/page.tsx app/globals.css
git commit -m "Pagina /meci/[id]: carduri clickabile, statistici tenis (Elo + head-to-head), placeholder pentru celelalte sporturi"
```

---

### Task 7: Push

- [ ] **Step 1: Verifică starea git**

```bash
git log origin/main..HEAD --oneline
git status
```

- [ ] **Step 2: Cere confirmarea utilizatorului înainte de push**

Nu face `git push` automat — e o acțiune vizibilă în producție (Vercel redeployează din `main`). Arată lista de commit-uri din Step 1 și întreabă explicit dacă să le trimită.
