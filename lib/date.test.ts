import { test } from "node:test";
import assert from "node:assert/strict";
import { dataRoFromUtc, deplaseazaDataRo, deplaseazaYYYYMMDD } from "./date.ts";

test("meci la 21:59:59 UTC cade încă pe ziua precedentă în Europe/Bucharest (UTC+2, noiembrie)", () => {
  assert.equal(dataRoFromUtc("2026-11-14T21:59:59Z"), "2026-11-14");
});

test("meci la exact 22:00:00 UTC trece pe ziua următoare în Europe/Bucharest (granița zilei)", () => {
  // acesta e cazul real Noskova–Svitolina: 2026-11-14T22:00Z = 2026-11-15T00:00 Europe/Bucharest
  assert.equal(dataRoFromUtc("2026-11-14T22:00:00Z"), "2026-11-15");
});

test("meci la 23:59:59 UTC e clar pe ziua următoare în Europe/Bucharest", () => {
  assert.equal(dataRoFromUtc("2026-11-14T23:59:59Z"), "2026-11-15");
});

test("deplaseazaDataRo pe granița de lună/an", () => {
  assert.equal(deplaseazaDataRo("2026-11-30", 1), "2026-12-01");
  assert.equal(deplaseazaDataRo("2027-01-01", -1), "2026-12-31");
});

test("deplaseazaYYYYMMDD simetric (+1 apoi -1 dă data inițială)", () => {
  assert.equal(deplaseazaYYYYMMDD(deplaseazaYYYYMMDD("20261115", 1), -1), "20261115");
});
