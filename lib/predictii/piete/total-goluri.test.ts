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
