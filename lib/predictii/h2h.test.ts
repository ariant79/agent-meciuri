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
