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
