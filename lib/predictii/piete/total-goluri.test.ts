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
