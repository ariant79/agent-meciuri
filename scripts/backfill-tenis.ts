/**
 * Backfill o singură dată, local: calculează Elo cronologic pe tot istoricul Sackmann
 * disponibil (2015 - azi) și scrie ratingurile finale în Supabase. Nu rulează pe Vercel.
 *
 * Rulare: npm run backfill:tenis
 * (necesită data/sackmann/ populat — npx tsx scripts/descarca-date-tenis.ts — și .env.local cu
 * SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
 */
import { readFileSync, existsSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import { incarcaIstoricSackmann } from "@/lib/predictii/sackmann";
import { creeazaStare, actualizeazaMeci, ratinguriJucator, DIMENSIUNI_RATING } from "@/lib/predictii/modele/elo-tenis";

/** încarcă .env.local manual, fără dependență nouă (nu rulează prin Next.js, care face asta automat) */
function incarcaEnvLocal(): void {
  if (!existsSync(".env.local")) return;
  for (const linie of readFileSync(".env.local", "utf8").split("\n")) {
    const separator = linie.indexOf("=");
    if (separator === -1) continue;
    const cheie = linie.slice(0, separator).trim();
    if (cheie && process.env[cheie] === undefined) {
      process.env[cheie] = linie.slice(separator + 1).trim();
    }
  }
}
incarcaEnvLocal();

const MARIME_LOT = 500;

interface InfoJucator {
  nume: string;
  tur: "atp" | "wta";
  ultimulMeci: Partial<Record<(typeof DIMENSIUNI_RATING)[number], string>>;
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Lipsesc SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY din mediu (.env.local).");
    process.exit(1);
  }

  console.log("Încarc meciurile Sackmann (2015-2026)...");
  const meciuri = await incarcaIstoricSackmann();
  console.log(`Total meciuri de procesat: ${meciuri.length}`);

  const stare = creeazaStare();
  const infoJucatori = new Map<string, InfoJucator>();
  let ignorateWalkover = 0;

  function noteazaInfo(id: string, nume: string, tur: "atp" | "wta", dataISO: string, suprafata: string) {
    let info = infoJucatori.get(id);
    if (!info) {
      info = { nume, tur, ultimulMeci: {} };
      infoJucatori.set(id, info);
    }
    info.nume = nume; // reținem numele cel mai recent întâlnit
    info.tur = tur;
    info.ultimulMeci.general = dataISO;
    info.ultimulMeci[suprafata as "hard" | "clay" | "grass"] = dataISO;
  }

  for (const meci of meciuri) {
    if (meci.walkover) {
      ignorateWalkover++;
      continue;
    }
    noteazaInfo(meci.castigatorId, meci.castigatorNume, meci.tur, meci.dataISO, meci.suprafata);
    noteazaInfo(meci.invinsId, meci.invinsNume, meci.tur, meci.dataISO, meci.suprafata);
    actualizeazaMeci(stare, meci.castigatorId, meci.invinsId, meci.suprafata);
  }

  console.log(`Walkover/retragere-înainte-de-start ignorate: ${ignorateWalkover}`);
  console.log(`Jucători unici: ${infoJucatori.size}`);

  const randuri: Array<{
    sport: string;
    jucator_id: string;
    nume: string;
    suprafata: string;
    rating: number;
    nr_meciuri: number;
    ultimul_meci: string | null;
  }> = [];

  for (const [jucatorId, info] of infoJucatori) {
    const ratinguri = ratinguriJucator(stare, jucatorId);
    for (const dim of DIMENSIUNI_RATING) {
      if (ratinguri[dim].nrMeciuri === 0) continue; // nu scriem dimensiuni neatinse (ex. jucător doar pe iarbă)
      randuri.push({
        sport: "tenis",
        jucator_id: jucatorId,
        nume: info.nume,
        suprafata: dim,
        rating: Math.round(ratinguri[dim].rating * 100) / 100,
        nr_meciuri: ratinguri[dim].nrMeciuri,
        ultimul_meci: info.ultimulMeci[dim] ?? null,
      });
    }
  }

  console.log(`Rânduri de scris în ratinguri: ${randuri.length}`);

  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  for (let i = 0; i < randuri.length; i += MARIME_LOT) {
    const lot = randuri.slice(i, i + MARIME_LOT);
    const { error } = await db.from("ratinguri").upsert(lot, { onConflict: "sport,jucator_id,suprafata" });
    if (error) {
      console.error(`Eroare la lotul ${i}-${i + lot.length}:`, error.message);
      process.exit(1);
    }
    console.log(`  scris ${Math.min(i + MARIME_LOT, randuri.length)}/${randuri.length}`);
  }

  console.log("Backfill terminat.");
}

main();
