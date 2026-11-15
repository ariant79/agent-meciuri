/**
 * Descarcă CSV-urile football-data.co.uk pentru ligile acoperite (ultimii sezoane 2015-2026)
 * în data/football-data/ (gitignored).
 *
 * Rulare: npm run descarca:fotbal
 */
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import fotbalConfig from "@/config/fotbal.json";
import { coduriSezon, DIR_CACHE_FOOTBALL_DATA } from "@/lib/predictii/football-data";

const BAZA = "https://www.football-data.co.uk/mmz4281";
const SEZOANE = coduriSezon(2015, 2026);

async function descarca(codLiga: string, divizie: string, sezon: string): Promise<void> {
  const destinatie = path.join(DIR_CACHE_FOOTBALL_DATA, codLiga, `${sezon}.csv`);
  await mkdir(path.dirname(destinatie), { recursive: true });
  const res = await fetch(`${BAZA}/${sezon}/${divizie}.csv`);
  if (!res.ok) {
    console.warn(`  lipsă/eroare (${res.status}): ${codLiga}/${sezon}`);
    return;
  }
  const text = await res.text();
  await writeFile(destinatie, text, "utf8");
  console.log(`  ok: ${codLiga}/${sezon}.csv (${(text.length / 1024).toFixed(0)} KB)`);
}

async function main() {
  const ligi = Object.entries(fotbalConfig.ligi_acoperite as Record<string, { divizie_football_data: string }>);
  console.log(`Descarc ${ligi.length} ligi x ${SEZOANE.length} sezoane din football-data.co.uk...`);
  for (const [codLiga, info] of ligi) {
    for (const sezon of SEZOANE) {
      await descarca(codLiga, info.divizie_football_data, sezon);
    }
  }
  console.log("Terminat.");
}

main();
