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
