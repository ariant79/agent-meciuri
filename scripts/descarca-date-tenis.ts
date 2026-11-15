/**
 * Descarcă CSV-urile Sackmann (ATP/WTA, 2015-2026, inclusiv calificări turnee tur/Slam/Finals)
 * în data/sackmann/ (gitignored). Repo-urile originale JeffSackmann/tennis_atp și tennis_wta
 * nu mai răspund (404) — folosim mirror-ul Aneeshers/tennis-sackmann-archive (CC BY-NC-SA 4.0).
 *
 * Rulare: npx tsx scripts/descarca-date-tenis.ts
 */
import { mkdir, writeFile } from "fs/promises";
import path from "path";

const BAZA = "https://raw.githubusercontent.com/Aneeshers/tennis-sackmann-archive/main";
const ANI = Array.from({ length: 2026 - 2015 + 1 }, (_, i) => 2015 + i);
const DIR_CACHE = path.join(process.cwd(), "data", "sackmann");

interface Fisier {
  tur: "atp" | "wta";
  url: string;
  destinatie: string;
}

function construiesteListaFisiere(): Fisier[] {
  const fisiere: Fisier[] = [];
  for (const an of ANI) {
    fisiere.push({ tur: "atp", url: `${BAZA}/atp/atp_matches_${an}.csv`, destinatie: `atp/atp_matches_${an}.csv` });
    fisiere.push({
      tur: "atp",
      url: `${BAZA}/atp/atp_matches_qual_chall_${an}.csv`,
      destinatie: `atp/atp_matches_qual_chall_${an}.csv`,
    });
    fisiere.push({ tur: "wta", url: `${BAZA}/wta/wta_matches_${an}.csv`, destinatie: `wta/wta_matches_${an}.csv` });
    fisiere.push({
      tur: "wta",
      url: `${BAZA}/wta/wta_matches_qual_itf_${an}.csv`,
      destinatie: `wta/wta_matches_qual_itf_${an}.csv`,
    });
  }
  return fisiere;
}

async function descarca(fisier: Fisier): Promise<void> {
  const caleCompleta = path.join(DIR_CACHE, fisier.destinatie);
  await mkdir(path.dirname(caleCompleta), { recursive: true });
  const res = await fetch(fisier.url);
  if (!res.ok) {
    console.warn(`  lipsă/eroare (${res.status}): ${fisier.destinatie}`);
    return;
  }
  const text = await res.text();
  await writeFile(caleCompleta, text, "utf8");
  console.log(`  ok: ${fisier.destinatie} (${(text.length / 1024).toFixed(0)} KB)`);
}

async function main() {
  const fisiere = construiesteListaFisiere();
  console.log(`Descarc ${fisiere.length} fișiere în ${DIR_CACHE}...`);
  // secvențial, ca să nu bombardăm GitHub cu 100 de cereri simultane
  for (const fisier of fisiere) {
    await descarca(fisier);
  }
  console.log("Terminat.");
}

main();
