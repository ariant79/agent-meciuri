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
