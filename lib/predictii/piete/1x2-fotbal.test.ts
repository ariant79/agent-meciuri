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
