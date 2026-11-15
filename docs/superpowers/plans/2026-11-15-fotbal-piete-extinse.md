# Fotbal: piețe extinse din modelul Poisson (Etapa 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Din distribuția de scor Poisson deja calculată pentru fotbal, derivă și salvează toate piețele cerute (1X2, peste/sub 1.5/2.5/3.5, ambele marchează, top 5 scoruri exacte, handicap asiatic -1.5), și extinde evaluarea pe `/predictii` să le acopere pe toate, separat pe piață și versiune de model.

**Architecture:** Fiecare piață nouă e un fișier pur în `lib/predictii/piete/`, exact ca piețele existente (`1x2-fotbal.ts`, `total-goluri.ts`) — primește `DistributieScor` și întoarce `PredictieSelectie[]`. `total-goluri.ts` se generalizează să accepte linia ca parametru (1.5/2.5/3.5 sunt trei apeluri ale aceleiași funcții, nu trei fișiere). Scrierea în `predictii` se face din același loc ca până acum (`actualizare-zilnica-fotbal.ts`, pasul 3), adunând toate selecțiile într-un singur upsert. View-ul `evaluare_predictii_fotbal` se generalizează printr-o migrare nouă ca să calculeze rezultatul real pentru toate piețele noi. Pagina `/predictii` grupează deja generic pe `(versiune_model, piata)` — nu are nevoie de cod nou pentru piețele noi, doar de un tabel de calibrare adăugat la secțiunea de fotbal (cerut explicit: "calibrare").

**Tech Stack:** TypeScript hand-rolled (fără librării noi), Postgres/Supabase (migrare SQL), Next.js server component.

**Context pentru implementator:** Acesta e primul task dintr-o cerere mai mare ("Etapa 1" din 4 etape); etapele 2-4 (Elo naționale, pagina de meci completă, verificare finală) NU fac parte din acest plan — vor avea planuri separate, scrise după ce utilizatorul confirmă rezultatele acestei etape. Nu anticipa cod pentru ele.

---

### Task 1: Generalizează `total-goluri.ts` cu parametru de linie

**Files:**
- Modify: `lib/predictii/piete/total-goluri.ts`
- Modify: `lib/predictii/piete/total-goluri.test.ts`
- Modify: `lib/predictii/actualizare-zilnica-fotbal.ts`
- Modify: `scripts/backtest-poisson-fotbal.ts`

- [ ] **Step 1: Rescrie testul pentru noua semnătură**

Înlocuiește conținutul `lib/predictii/piete/total-goluri.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { construiestePiataTotalGoluri } from "./total-goluri.ts";
import { distributieScor } from "../modele/poisson-fotbal.ts";

test("construiestePiataTotalGoluri: λ mari -> probabilitate mare pentru peste 2.5", () => {
  const distributie = distributieScor(2.0, 2.0);
  const selectii = construiestePiataTotalGoluri(distributie, 2.5);
  const peste = selectii.find((s) => s.selectie === "peste")!;
  assert.ok(peste.probabilitate > 0.5);
  assert.equal(peste.piata, "total_goluri_2.5");
});

test("construiestePiataTotalGoluri: λ mici -> probabilitate mare pentru sub 2.5", () => {
  const distributie = distributieScor(0.5, 0.4);
  const selectii = construiestePiataTotalGoluri(distributie, 2.5);
  const sub = selectii.find((s) => s.selectie === "sub")!;
  assert.ok(sub.probabilitate > 0.7);
});

test("construiestePiataTotalGoluri: selecțiile însumează la 1, pentru orice linie", () => {
  const distributie = distributieScor(1.4, 1.2);
  for (const linie of [1.5, 2.5, 3.5]) {
    const suma = construiestePiataTotalGoluri(distributie, linie).reduce((s, sel) => s + sel.probabilitate, 0);
    assert.ok(Math.abs(suma - 1) < 1e-6, `linia ${linie}: suma ${suma}`);
  }
});

test("construiestePiataTotalGoluri: linie mai mică -> probabilitate mai mare pentru peste", () => {
  const distributie = distributieScor(1.4, 1.2);
  const peste15 = construiestePiataTotalGoluri(distributie, 1.5).find((s) => s.selectie === "peste")!.probabilitate;
  const peste25 = construiestePiataTotalGoluri(distributie, 2.5).find((s) => s.selectie === "peste")!.probabilitate;
  const peste35 = construiestePiataTotalGoluri(distributie, 3.5).find((s) => s.selectie === "peste")!.probabilitate;
  assert.ok(peste15 > peste25);
  assert.ok(peste25 > peste35);
});
```

- [ ] **Step 2: Rulează testul și verifică eșuează (semnătura veche nu acceptă al doilea argument ca să schimbe rezultatul)**

Run: `npm test`
Expected: testele noi FAIL (piata rămâne `"total_goluri_2.5"` indiferent de linie, cu implementarea veche).

- [ ] **Step 3: Generalizează implementarea**

Înlocuiește conținutul `lib/predictii/piete/total-goluri.ts`:

```typescript
import type { DistributieScor } from "@/lib/predictii/modele/poisson-fotbal";
import type { PredictieSelectie } from "@/lib/predictii/tipuri";

/** piața "total_goluri_<linie>": peste/sub, derivată din grila de probabilități a scorului */
export function construiestePiataTotalGoluri(distributie: DistributieScor, linie: number): PredictieSelectie[] {
  let peste = 0;
  let sub = 0;
  const { probabilitati } = distributie;
  for (let ga = 0; ga < probabilitati.length; ga++) {
    for (let go = 0; go < probabilitati[ga].length; go++) {
      const p = probabilitati[ga][go];
      if (ga + go > linie) peste += p;
      else sub += p;
    }
  }
  return [
    { piata: `total_goluri_${linie}`, selectie: "peste", probabilitate: peste },
    { piata: `total_goluri_${linie}`, selectie: "sub", probabilitate: sub },
  ];
}
```

- [ ] **Step 4: Rulează testul și verifică trece**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Actualizează cele două locuri care apelau funcția cu semnătura veche**

În `lib/predictii/actualizare-zilnica-fotbal.ts`, linia care construiește `selectii` (în prezent `const selectii = [...construiestePiata1x2(distributie), ...construiestePiataTotalGoluri(distributie)];`) — las-o neschimbată pentru moment, va fi suprascrisă complet la Task 5. Pentru acum, doar fă-o să compileze adăugând linia implicită 2.5:

```typescript
const selectii = [...construiestePiata1x2(distributie), ...construiestePiataTotalGoluri(distributie, 2.5)];
```

În `scripts/backtest-poisson-fotbal.ts`, linia `for (const s of construiestePiataTotalGoluri(distributie)) {` devine:

```typescript
for (const s of construiestePiataTotalGoluri(distributie, 2.5)) {
```

(Backtestul evaluează doar piața 2.5 — nu face parte din scopul acestei etape să extindem backtestul la piețele noi.)

- [ ] **Step 6: Verifică typecheck + teste**

Run: `npx tsc --noEmit && npm test`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add lib/predictii/piete/total-goluri.ts lib/predictii/piete/total-goluri.test.ts lib/predictii/actualizare-zilnica-fotbal.ts scripts/backtest-poisson-fotbal.ts
git commit -m "Generalizează construiestePiataTotalGoluri cu parametru de linie (1.5/2.5/3.5)"
```

---

### Task 2: Piața "ambele marchează"

**Files:**
- Create: `lib/predictii/piete/ambele-marcheaza.ts`
- Create: `lib/predictii/piete/ambele-marcheaza.test.ts`

- [ ] **Step 1: Scrie testul**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { construiestePiataAmbeleMarcheaza } from "./ambele-marcheaza.ts";
import { distributieScor } from "../modele/poisson-fotbal.ts";

test("construiestePiataAmbeleMarcheaza: λ mari pentru ambele echipe -> probabilitate mare pentru da", () => {
  const distributie = distributieScor(1.8, 1.6);
  const selectii = construiestePiataAmbeleMarcheaza(distributie);
  const da = selectii.find((s) => s.selectie === "da")!;
  assert.ok(da.probabilitate > 0.5);
});

test("construiestePiataAmbeleMarcheaza: λ aproape de 0 pentru oaspete -> probabilitate mare pentru nu", () => {
  const distributie = distributieScor(2.0, 0.1);
  const selectii = construiestePiataAmbeleMarcheaza(distributie);
  const nu = selectii.find((s) => s.selectie === "nu")!;
  assert.ok(nu.probabilitate > 0.85);
});

test("construiestePiataAmbeleMarcheaza: selecțiile însumează la 1", () => {
  const distributie = distributieScor(1.4, 1.2);
  const suma = construiestePiataAmbeleMarcheaza(distributie).reduce((s, sel) => s + sel.probabilitate, 0);
  assert.ok(Math.abs(suma - 1) < 1e-6);
});
```

- [ ] **Step 2: Rulează testul și verifică eșuează**

Run: `npm test`
Expected: FAIL — modulul nu există.

- [ ] **Step 3: Scrie implementarea**

```typescript
import type { DistributieScor } from "@/lib/predictii/modele/poisson-fotbal";
import type { PredictieSelectie } from "@/lib/predictii/tipuri";

/** piața "ambele_marcheaza": da/nu, derivată din grila de probabilități a scorului */
export function construiestePiataAmbeleMarcheaza(distributie: DistributieScor): PredictieSelectie[] {
  let da = 0;
  let nu = 0;
  const { probabilitati } = distributie;
  for (let ga = 0; ga < probabilitati.length; ga++) {
    for (let go = 0; go < probabilitati[ga].length; go++) {
      const p = probabilitati[ga][go];
      if (ga >= 1 && go >= 1) da += p;
      else nu += p;
    }
  }
  return [
    { piata: "ambele_marcheaza", selectie: "da", probabilitate: da },
    { piata: "ambele_marcheaza", selectie: "nu", probabilitate: nu },
  ];
}
```

- [ ] **Step 4: Rulează testul și verifică trece**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/predictii/piete/ambele-marcheaza.ts lib/predictii/piete/ambele-marcheaza.test.ts
git commit -m "Adaugă piața ambele_marcheaza"
```

---

### Task 3: Piața "top 5 scoruri exacte"

**Files:**
- Create: `lib/predictii/piete/scor-exact.ts`
- Create: `lib/predictii/piete/scor-exact.test.ts`

- [ ] **Step 1: Scrie testul**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { construiestePiataScorExact } from "./scor-exact.ts";
import { distributieScor } from "../modele/poisson-fotbal.ts";

test("construiestePiataScorExact: întoarce exact 5 selecții", () => {
  const distributie = distributieScor(1.4, 1.2);
  const selectii = construiestePiataScorExact(distributie);
  assert.equal(selectii.length, 5);
});

test("construiestePiataScorExact: selecțiile sunt sortate descrescător după probabilitate", () => {
  const distributie = distributieScor(1.4, 1.2);
  const selectii = construiestePiataScorExact(distributie);
  for (let i = 1; i < selectii.length; i++) {
    assert.ok(selectii[i - 1].probabilitate >= selectii[i].probabilitate);
  }
});

test("construiestePiataScorExact: formatul selecției e 'golAcasa-golOaspete'", () => {
  const distributie = distributieScor(1.4, 1.2);
  const selectii = construiestePiataScorExact(distributie);
  for (const s of selectii) {
    assert.match(s.selectie, /^\d+-\d+$/);
    assert.equal(s.piata, "scor_exact");
  }
});

test("construiestePiataScorExact: pentru λ mici, 1-1 sau 1-0 e printre cele mai probabile", () => {
  const distributie = distributieScor(1.1, 1.0);
  const selectii = construiestePiataScorExact(distributie);
  const scoruri = selectii.map((s) => s.selectie);
  assert.ok(scoruri.includes("1-1") || scoruri.includes("1-0"));
});
```

- [ ] **Step 2: Rulează testul și verifică eșuează**

Run: `npm test`
Expected: FAIL — modulul nu există.

- [ ] **Step 3: Scrie implementarea**

```typescript
import type { DistributieScor } from "@/lib/predictii/modele/poisson-fotbal";
import type { PredictieSelectie } from "@/lib/predictii/tipuri";

const NR_SCORURI = 5;

/** piața "scor_exact": top NR_SCORURI cele mai probabile scoruri exacte, din grila de probabilități */
export function construiestePiataScorExact(distributie: DistributieScor): PredictieSelectie[] {
  const candidati: PredictieSelectie[] = [];
  const { probabilitati } = distributie;
  for (let ga = 0; ga < probabilitati.length; ga++) {
    for (let go = 0; go < probabilitati[ga].length; go++) {
      candidati.push({ piata: "scor_exact", selectie: `${ga}-${go}`, probabilitate: probabilitati[ga][go] });
    }
  }
  candidati.sort((a, b) => b.probabilitate - a.probabilitate);
  return candidati.slice(0, NR_SCORURI);
}
```

- [ ] **Step 4: Rulează testul și verifică trece**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/predictii/piete/scor-exact.ts lib/predictii/piete/scor-exact.test.ts
git commit -m "Adaugă piața scor_exact (top 5)"
```

---

### Task 4: Piața "handicap asiatic -1.5"

**Files:**
- Create: `lib/predictii/piete/handicap.ts`
- Create: `lib/predictii/piete/handicap.test.ts`

- [ ] **Step 1: Scrie testul**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { construiestePiataHandicap } from "./handicap.ts";
import { distributieScor } from "../modele/poisson-fotbal.ts";

test("construiestePiataHandicap(-1.5): gazdă mult mai puternică -> probabilitate mare să acopere", () => {
  const distributie = distributieScor(3.0, 0.3);
  const selectii = construiestePiataHandicap(distributie, -1.5);
  const acasa = selectii.find((s) => s.selectie === "acasa")!;
  assert.ok(acasa.probabilitate > 0.5);
  assert.equal(acasa.piata, "handicap_-1.5");
});

test("construiestePiataHandicap(-1.5): echipe apropiate -> probabilitate mare ca oaspetele să acopere", () => {
  const distributie = distributieScor(1.3, 1.2);
  const selectii = construiestePiataHandicap(distributie, -1.5);
  const oaspete = selectii.find((s) => s.selectie === "oaspete")!;
  assert.ok(oaspete.probabilitate > 0.7);
});

test("construiestePiataHandicap: selecțiile însumează la 1 (linie .5, fără push)", () => {
  const distributie = distributieScor(1.4, 1.2);
  const suma = construiestePiataHandicap(distributie, -1.5).reduce((s, sel) => s + sel.probabilitate, 0);
  assert.ok(Math.abs(suma - 1) < 1e-6);
});
```

- [ ] **Step 2: Rulează testul și verifică eșuează**

Run: `npm test`
Expected: FAIL — modulul nu există.

- [ ] **Step 3: Scrie implementarea**

```typescript
import type { DistributieScor } from "@/lib/predictii/modele/poisson-fotbal";
import type { PredictieSelectie } from "@/lib/predictii/tipuri";

/**
 * piața "handicap_<handicapAcasa>": handicap asiatic cu linie pe .5 (fără push posibil), din
 * perspectiva echipei de acasă — ex. handicapAcasa=-1.5 înseamnă acasă trebuie să câștige cu
 * 2+ goluri ca să acopere. Selecția "oaspete" e echivalentă matematic cu +1.5 pentru oaspete
 * (aceeași linie, cotată din cealaltă parte) — nu se dublează ca piață separată.
 */
export function construiestePiataHandicap(distributie: DistributieScor, handicapAcasa: number): PredictieSelectie[] {
  let acasa = 0;
  let oaspete = 0;
  const { probabilitati } = distributie;
  for (let ga = 0; ga < probabilitati.length; ga++) {
    for (let go = 0; go < probabilitati[ga].length; go++) {
      const p = probabilitati[ga][go];
      if (ga - go + handicapAcasa > 0) acasa += p;
      else oaspete += p;
    }
  }
  return [
    { piata: `handicap_${handicapAcasa}`, selectie: "acasa", probabilitate: acasa },
    { piata: `handicap_${handicapAcasa}`, selectie: "oaspete", probabilitate: oaspete },
  ];
}
```

- [ ] **Step 4: Rulează testul și verifică trece**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/predictii/piete/handicap.ts lib/predictii/piete/handicap.test.ts
git commit -m "Adaugă piața handicap_-1.5"
```

---

### Task 5: Scrie toate piețele noi în `predictii`

**Files:**
- Modify: `lib/predictii/actualizare-zilnica-fotbal.ts`

- [ ] **Step 1: Actualizează importurile**

În `lib/predictii/actualizare-zilnica-fotbal.ts`, lângă importurile existente pentru piețe:

```typescript
import { construiestePiata1x2 } from "@/lib/predictii/piete/1x2-fotbal";
import { construiestePiataTotalGoluri } from "@/lib/predictii/piete/total-goluri";
import { construiestePiataAmbeleMarcheaza } from "@/lib/predictii/piete/ambele-marcheaza";
import { construiestePiataScorExact } from "@/lib/predictii/piete/scor-exact";
import { construiestePiataHandicap } from "@/lib/predictii/piete/handicap";
```

- [ ] **Step 2: Extinde lista de selecții scrise**

Găsește linia (din pasul 3, scrierea predicțiilor):

```typescript
const distributie = distributieScor(lambda.lambdaAcasa, lambda.lambdaOaspete);
const selectii = [...construiestePiata1x2(distributie), ...construiestePiataTotalGoluri(distributie, 2.5)];
```

Înlocuiește-o cu:

```typescript
const distributie = distributieScor(lambda.lambdaAcasa, lambda.lambdaOaspete);
const selectii = [
  ...construiestePiata1x2(distributie),
  ...construiestePiataTotalGoluri(distributie, 1.5),
  ...construiestePiataTotalGoluri(distributie, 2.5),
  ...construiestePiataTotalGoluri(distributie, 3.5),
  ...construiestePiataAmbeleMarcheaza(distributie),
  ...construiestePiataScorExact(distributie),
  ...construiestePiataHandicap(distributie, -1.5),
];
```

Restul funcției (upsert-ul în `predictii`) nu se schimbă — mapează deja generic peste `selectii`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Build**

Run: `rm -rf .next tsconfig.tsbuildinfo && npx next build && rm -rf .next tsconfig.tsbuildinfo`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add lib/predictii/actualizare-zilnica-fotbal.ts
git commit -m "Scrie toate piețele fotbal (1X2, peste/sub 1.5/2.5/3.5, ambele marchează, scor exact, handicap) la actualizarea zilnică"
```

---

### Task 6: Migrare — generalizează view-ul de evaluare

**Files:**
- Create: `supabase/migrations/005_fotbal_piete.sql`

- [ ] **Step 1: Scrie migrarea**

```sql
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
```

- [ ] **Step 2: Aplică migrarea**

Folosește tool-ul MCP Supabase `apply_migration` (proiect `tdaslxptpxoiposcrsel`) pentru a rula fișierul de mai sus.

- [ ] **Step 3: Verifică**

```sql
select * from public.evaluare_predictii_fotbal limit 1;
```
Expected: interogarea rulează fără eroare (view-ul e valid sintactic), chiar dacă întoarce 0 rânduri (normal — nicio predicție de fotbal nu s-a scris încă pentru un meci terminat).

Rulează și `get_advisors` (tip `security`) — confirmă niciun avertisment nou.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/005_fotbal_piete.sql
git commit -m "Migrare: generalizează evaluare_predictii_fotbal pentru piețele noi"
```

---

### Task 7: Tabel de calibrare pentru secțiunile de fotbal pe `/predictii`

**Files:**
- Modify: `app/predictii/page.tsx`

- [ ] **Step 1: Adaugă tabelul de calibrare în `SectiuneVersiunePiataFotbal`**

Fișierul `app/predictii/page.tsx` grupează deja generic pe `(versiune_model, piata)` — orice piață nouă apare automat fără cod în plus. Lipsește doar tabelul de calibrare (cerut explicit), care există deja la secțiunea de tenis (`SectiuneVersiune`) dar nu la cea de fotbal.

Înlocuiește funcția `SectiuneVersiunePiataFotbal` existentă cu:

```tsx
function SectiuneVersiunePiataFotbal({ versiune, piata, randuri }: { versiune: string; piata: string; randuri: RandEvaluareFotbal[] }) {
  const favorite = celMaiProbabilPerMeci(randuri);
  const acuratete = favorite.length > 0 ? favorite.filter((r) => r.corect).length / favorite.length : null;
  const brierMediu = randuri.length > 0 ? randuri.reduce((s, r) => s + r.brier, 0) / randuri.length : null;
  const logLossMediu = favorite.length > 0 ? favorite.reduce((s, r) => s + r.log_loss, 0) / favorite.length : null;

  const galeti = Array.from({ length: 10 }, () => ({ n: 0, sumaP: 0, sumaCorect: 0 }));
  for (const r of favorite) {
    const idx = Math.min(9, Math.floor(r.probabilitate * 10));
    galeti[idx].n++;
    galeti[idx].sumaP += r.probabilitate;
    galeti[idx].sumaCorect += r.corect ? 1 : 0;
  }

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
      <div className="tabel-scroll">
        <table className="tabel-calibrare">
          <thead>
            <tr>
              <th>interval</th>
              <th>n</th>
              <th>prob. medie</th>
              <th>frecvență reală</th>
            </tr>
          </thead>
          <tbody>
            {galeti.map((g, i) => (
              <tr key={i}>
                <td>
                  {i * 10}-{(i + 1) * 10}%
                </td>
                <td>{g.n}</td>
                <td>{g.n > 0 ? `${((g.sumaP / g.n) * 100).toFixed(1)}%` : "-"}</td>
                <td>{g.n > 0 ? `${((g.sumaCorect / g.n) * 100).toFixed(1)}%` : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
```

(Singura schimbare față de varianta existentă: galeti se calculează din `favorite`, nu din `randuri` — ca la secțiunea de tenis, și pentru aceleași motive: pentru piețe cu 3+ selecții per meci, calibrarea pe toate rândurile ar număra de mai multe ori același meci.)

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && rm -rf .next tsconfig.tsbuildinfo && npx next build && rm -rf .next tsconfig.tsbuildinfo`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add app/predictii/page.tsx
git commit -m "Adaugă tabel de calibrare la secțiunile de evaluare fotbal pe /predictii"
```

---

### Task 8: Verificare finală, push, confirmare Vercel

**Files:** (niciun fișier nou)

- [ ] **Step 1: Suită completă de teste + typecheck + build**

```bash
npm test
npx tsc --noEmit
rm -rf .next tsconfig.tsbuildinfo
npx next build
rm -rf .next tsconfig.tsbuildinfo
```
Expected: toate verzi (teste noi: 4 total-goluri + 3 ambele-marcheaza + 4 scor-exact + 3 handicap = 14 teste noi, peste cele deja existente).

- [ ] **Step 2: Verifică autorul commit-urilor noi**

```bash
git log -1 --format=%ae
```
Expected: `traian_costache2007@yahoo.com` (nu `.comm`), confirmând fixul de la Etapa 0.

- [ ] **Step 3: Verificare live (opțională dacă există un meci real într-o ligă acoperită)**

Dacă în `evenimente` există vreun meci de fotbal programat într-o ligă acoperită (`eng.1`, `esp.1`, `ita.1`, `ger.1`, `fra.1`), declanșează colectorul (`curl` pe `/api/collect` cu `Authorization: Bearer $CRON_SECRET`, server local) și confirmă prin SQL (`select distinct piata from public.predictii where eveniment_id = '<id-ul meciului>'`) că apar toate cele 7 piețe noi (`1x2_fotbal`, `total_goluri_1.5`, `total_goluri_2.5`, `total_goluri_3.5`, `ambele_marcheaza`, `handicap_-1.5`, `scor_exact` — acesta din urmă cu 5 rânduri). Dacă nu există niciun meci acoperit disponibil (posibil, pauză internațională), notează acest lucru și mergi la pasul următor — nu e blocant.

- [ ] **Step 4: Push**

```bash
git push
```

- [ ] **Step 5: Confirmă deploy-ul pe Vercel**

Folosește tool-urile MCP Vercel (`list_deployments`/`get_deployment`, proiect `agent-meciuri`) pentru a confirma că cel mai recent deployment de producție (pe commit-ul ultimului push) are `readyState: READY`. Raportează rezultatul utilizatorului.
