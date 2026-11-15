import { readFile } from "fs/promises";
import path from "path";
import fotbalConfig from "@/config/fotbal.json";
import { normalizeazaText } from "@/lib/text";
import type { MeciIstoricFotbal } from "@/lib/predictii/tipuri";

export const DIR_CACHE_FOOTBALL_DATA = path.join(process.cwd(), "data", "football-data");
export const SEZOANE_IMPLICITE = coduriSezon(2015, 2026);

const LIGI_ACOPERITE = fotbalConfig.ligi_acoperite as Record<string, { divizie_football_data: string; nume: string }>;

/** codurile de sezon football-data.co.uk pentru anii [anInceput, anSfarsit] (ex. 2015 -> "1516") */
export function coduriSezon(anInceput: number, anSfarsit: number): string[] {
  const coduri: string[] = [];
  for (let an = anInceput; an <= anSfarsit; an++) {
    const yy1 = String(an % 100).padStart(2, "0");
    const yy2 = String((an + 1) % 100).padStart(2, "0");
    coduri.push(`${yy1}${yy2}`);
  }
  return coduri;
}

function parseazaRanduriCsv(text: string): Record<string, string>[] {
  const linii = text.trim().split("\n").filter((l) => l.trim().length > 0);
  if (linii.length === 0) return [];
  const header = linii[0].split(",").map((h) => h.trim());
  return linii.slice(1).map((linie) => {
    const coloane = linie.split(",");
    return Object.fromEntries(header.map((h, i) => [h, (coloane[i] ?? "").trim()]));
  });
}

/** "dd/mm/yy" sau "dd/mm/yyyy" -> "yyyy-mm-dd"; null dacă formatul e nerecunoscut */
function dataISODinDDMMYY(data: string): string | null {
  const parti = data.split("/");
  if (parti.length !== 3) return null;
  const [zi, luna, anRaw] = parti;
  if (!zi || !luna || !anRaw) return null;
  const an = anRaw.length === 2 ? `20${anRaw}` : anRaw;
  return `${an}-${luna.padStart(2, "0")}-${zi.padStart(2, "0")}`;
}

/**
 * parsează un CSV football-data.co.uk (un sezon, o ligă): coloanele cerute sunt Date, HomeTeam,
 * AwayTeam, FTHG, FTAG (goluri la final). Rânduri incomplete sunt ignorate. echipa_id canonic =
 * numele echipei normalizat (consistent în cadrul sursei football-data, de la an la an).
 */
export function parseazaMeciuriFootballData(text: string, codLiga: string): MeciIstoricFotbal[] {
  const randuri = parseazaRanduriCsv(text);
  const rezultate: MeciIstoricFotbal[] = [];

  for (const r of randuri) {
    if (!r.Date || !r.HomeTeam || !r.AwayTeam || r.FTHG === "" || r.FTAG === "") continue;
    const data = dataISODinDDMMYY(r.Date);
    const golAcasa = Number(r.FTHG);
    const golOaspete = Number(r.FTAG);
    if (!data || !Number.isFinite(golAcasa) || !Number.isFinite(golOaspete)) continue;

    rezultate.push({
      data,
      liga: codLiga,
      echipaAcasaId: normalizeazaText(r.HomeTeam),
      echipaOaspeteId: normalizeazaText(r.AwayTeam),
      echipaAcasaNume: r.HomeTeam,
      echipaOaspeteNume: r.AwayTeam,
      golAcasa,
      golOaspete,
    });
  }

  return rezultate;
}

async function citesteOpt(caleRelativa: string): Promise<string | null> {
  try {
    return await readFile(path.join(DIR_CACHE_FOOTBALL_DATA, caleRelativa), "utf8");
  } catch {
    return null;
  }
}

/** încarcă tot istoricul din cache-ul local (data/football-data/) pentru ligile acoperite și sezoanele date */
export async function incarcaIstoricFootballData(sezoane: string[]): Promise<MeciIstoricFotbal[]> {
  const toate: MeciIstoricFotbal[] = [];
  for (const codLiga of Object.keys(LIGI_ACOPERITE)) {
    for (const sezon of sezoane) {
      const text = await citesteOpt(`${codLiga}/${sezon}.csv`);
      if (!text) continue;
      toate.push(...parseazaMeciuriFootballData(text, codLiga));
    }
  }
  toate.sort((a, b) => a.data.localeCompare(b.data));
  return toate;
}

/** reține doar meciurile din ultimii `fereastraSezoane` ani calendaristici față de `aziISO` (YYYY-MM-DD) */
export function filtreazaFereastra(
  meciuri: MeciIstoricFotbal[],
  aziISO: string,
  fereastraSezoane: number
): MeciIstoricFotbal[] {
  const limita = new Date(aziISO);
  limita.setFullYear(limita.getFullYear() - fereastraSezoane);
  const limitaISO = limita.toISOString().slice(0, 10);
  return meciuri.filter((m) => m.data >= limitaISO);
}
