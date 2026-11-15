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
