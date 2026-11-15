import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeazaText } from "./text.ts";

test("normalizeazaText elimină diacritice combinate (NFD) și face lowercase", () => {
  assert.equal(normalizeazaText("Köln"), "koln");
  assert.equal(normalizeazaText("São Paulo"), "sao paulo");
});

test("normalizeazaText înlocuiește cratime și puncte cu spațiu, colapsează spațiile multiple", () => {
  assert.equal(normalizeazaText("Borussia M.Gladbach"), "borussia m gladbach");
  assert.equal(normalizeazaText("Saint-Étienne"), "saint etienne");
});

test("normalizeazaText taie spațiile de la capete", () => {
  assert.equal(normalizeazaText("  Ajax  "), "ajax");
});
