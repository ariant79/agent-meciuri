import { readFile } from "fs/promises";
import path from "path";
import predictiiConfig from "@/config/predictii.json";
import type { MeciIstoric, Suprafata } from "@/lib/predictii/tipuri";

export const DIR_CACHE_SACKMANN = path.join(process.cwd(), "data", "sackmann");
export const ANI_SACKMANN = Array.from({ length: 2026 - 2015 + 1 }, (_, i) => 2015 + i);

const ORDINE_RUNDA: Record<string, number> = {
  Q1: 0,
  Q2: 1,
  Q3: 2,
  R128: 3,
  R64: 4,
  R32: 5,
  R16: 6,
  RR: 6,
  QF: 7,
  BR: 7,
  SF: 8,
  F: 9,
};

function parseazaRanduriCsv(text: string): Record<string, string>[] {
  const linii = text.trim().split("\n");
  const header = linii[0].split(",");
  return linii.slice(1).map((linie) => {
    const coloane = linie.split(",");
    return Object.fromEntries(header.map((h, i) => [h, coloane[i] ?? ""]));
  });
}

function esteWalkover(score: string): boolean {
  const s = (score || "").toUpperCase();
  return s.includes("W/O") || s.includes("DEF") || s.trim() === "";
}

function mapeazaSuprafata(raw: string): Suprafata {
  const mapare = predictiiConfig.elo.mapare_suprafata_csv as Record<string, string>;
  const normalizata = mapare[raw];
  return (normalizata as Suprafata) ?? (predictiiConfig.suprafata_implicita as Suprafata);
}

function dataISODinYYYYMMDD(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

/**
 * parsează un fișier CSV Sackmann (atp_matches_YYYY.csv, wta_matches_YYYY.csv, sau varianta _qual_chall/_qual_itf)
 * și reține doar meciurile de la nivelurile din config (ATP/WTA tur + Grand Slam + Finals; fără Challenger/ITF/Davis Cup).
 */
export function parseazaMeciuriSackmann(text: string, tur: "atp" | "wta"): MeciIstoric[] {
  const niveluriPermise = new Set(predictiiConfig.niveluri_incluse[tur]);
  const randuri = parseazaRanduriCsv(text);
  const rezultate: MeciIstoric[] = [];

  for (const r of randuri) {
    if (!r.tourney_date || !r.winner_id || !r.loser_id) continue;
    if (!niveluriPermise.has(r.tourney_level)) continue;

    const ordineRunda = ORDINE_RUNDA[r.round] ?? 5;
    const dataNum = Number(r.tourney_date);
    if (!Number.isFinite(dataNum)) continue;

    rezultate.push({
      dataISO: dataISODinYYYYMMDD(r.tourney_date),
      ordineSort: dataNum * 100 + ordineRunda,
      tur,
      suprafata: mapeazaSuprafata(r.surface),
      castigatorId: r.winner_id,
      invinsId: r.loser_id,
      castigatorNume: r.winner_name,
      invinsNume: r.loser_name,
      castigatorRankCsv: r.winner_rank ? Number(r.winner_rank) : null,
      invinsRankCsv: r.loser_rank ? Number(r.loser_rank) : null,
      walkover: esteWalkover(r.score),
    });
  }

  return rezultate;
}

async function citesteOpt(caleRelativa: string): Promise<string | null> {
  try {
    return await readFile(path.join(DIR_CACHE_SACKMANN, caleRelativa), "utf8");
  } catch {
    return null;
  }
}

/** încarcă toate meciurile din cache-ul local (data/sackmann/), sortate cronologic; vezi scripts/descarca-date-tenis.ts */
export async function incarcaIstoricSackmann(): Promise<MeciIstoric[]> {
  const toate: MeciIstoric[] = [];
  for (const an of ANI_SACKMANN) {
    for (const [tur, fisiere] of [
      ["atp", [`atp/atp_matches_${an}.csv`, `atp/atp_matches_qual_chall_${an}.csv`]],
      ["wta", [`wta/wta_matches_${an}.csv`, `wta/wta_matches_qual_itf_${an}.csv`]],
    ] as const) {
      for (const fisier of fisiere) {
        const text = await citesteOpt(fisier);
        if (!text) continue;
        toate.push(...parseazaMeciuriSackmann(text, tur));
      }
    }
  }
  toate.sort((a, b) => a.ordineSort - b.ordineSort);
  return toate;
}
