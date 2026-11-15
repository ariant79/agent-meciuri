/**
 * Backfill o singură dată, local: calculează ratingurile Poisson (atac/apărare) per ligă din
 * istoricul football-data.co.uk cache-uit local, pe fereastra glisantă din config, și scrie
 * rezultatul + istoricul brut complet în Supabase. Nu rulează pe Vercel.
 *
 * Rulare: npm run backfill:fotbal
 * (necesită data/football-data/ populat — npm run descarca:fotbal — și .env.local cu
 * SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
 */
import { readFileSync, existsSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import fotbalConfig from "@/config/fotbal.json";
import { incarcaIstoricFootballData, filtreazaFereastra, SEZOANE_IMPLICITE } from "@/lib/predictii/football-data";
import { estimeazaRatinguri } from "@/lib/predictii/modele/poisson-fotbal";
import { azi } from "@/lib/date";

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

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Lipsesc SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY din mediu (.env.local).");
    process.exit(1);
  }

  console.log("Încarc istoricul football-data.co.uk din cache local...");
  const toateMeciurile = await incarcaIstoricFootballData(SEZOANE_IMPLICITE);
  console.log(`Total meciuri încărcate: ${toateMeciurile.length}`);
  if (toateMeciurile.length === 0) {
    console.error("Niciun meci încărcat — ai rulat `npm run descarca:fotbal` înainte?");
    process.exit(1);
  }

  const meciuriInFereastra = filtreazaFereastra(toateMeciurile, azi(), fotbalConfig.fereastra_sezoane);
  console.log(`Meciuri în fereastra de ${fotbalConfig.fereastra_sezoane} sezoane: ${meciuriInFereastra.length}`);

  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const randuriRatinguri: Array<{
    liga: string;
    echipa_id: string;
    nume: string;
    atac: number;
    aparare: number;
    avantaj_gazda: number;
    nr_meciuri: number;
  }> = [];
  const numePerEchipa = new Map<string, string>();

  for (const codLiga of Object.keys(fotbalConfig.ligi_acoperite)) {
    const meciuriLiga = meciuriInFereastra.filter((m) => m.liga === codLiga);
    if (meciuriLiga.length === 0) {
      console.log(`  ${codLiga}: niciun meci în fereastră, sar peste.`);
      continue;
    }
    for (const m of meciuriLiga) {
      numePerEchipa.set(m.echipaAcasaId, m.echipaAcasaNume);
      numePerEchipa.set(m.echipaOaspeteId, m.echipaOaspeteNume);
    }

    const { avantajGazda, ratinguri } = estimeazaRatinguri(meciuriLiga);
    console.log(`  ${codLiga}: ${meciuriLiga.length} meciuri, ${ratinguri.size} echipe, avantaj gazdă ${avantajGazda.toFixed(3)}`);

    for (const [echipaId, r] of ratinguri) {
      randuriRatinguri.push({
        liga: codLiga,
        echipa_id: echipaId,
        nume: numePerEchipa.get(echipaId) ?? echipaId,
        atac: Math.round(r.atac * 10000) / 10000,
        aparare: Math.round(r.aparare * 10000) / 10000,
        avantaj_gazda: Math.round(avantajGazda * 10000) / 10000,
        nr_meciuri: r.nrMeciuri,
      });
    }
  }

  const randuriIstoric = toateMeciurile.map((m) => ({
    liga: m.liga,
    data: m.data,
    echipa_acasa_id: m.echipaAcasaId,
    echipa_oaspete_id: m.echipaOaspeteId,
    gol_acasa: m.golAcasa,
    gol_oaspete: m.golOaspete,
    sursa: "football-data",
  }));

  console.log(`Rânduri de scris în ratinguri_fotbal: ${randuriRatinguri.length}`);
  for (let i = 0; i < randuriRatinguri.length; i += MARIME_LOT) {
    const lot = randuriRatinguri.slice(i, i + MARIME_LOT);
    const { error } = await db.from("ratinguri_fotbal").upsert(lot, { onConflict: "liga,echipa_id" });
    if (error) {
      console.error(`Eroare la lotul ratinguri_fotbal ${i}-${i + lot.length}:`, error.message);
      process.exit(1);
    }
    console.log(`  scris ${Math.min(i + MARIME_LOT, randuriRatinguri.length)}/${randuriRatinguri.length}`);
  }

  console.log(`Rânduri de scris în meciuri_fotbal_istoric: ${randuriIstoric.length}`);
  for (let i = 0; i < randuriIstoric.length; i += MARIME_LOT) {
    const lot = randuriIstoric.slice(i, i + MARIME_LOT);
    const { error } = await db
      .from("meciuri_fotbal_istoric")
      .upsert(lot, { onConflict: "liga,data,echipa_acasa_id,echipa_oaspete_id" });
    if (error) {
      console.error(`Eroare la lotul meciuri_fotbal_istoric ${i}-${i + lot.length}:`, error.message);
      process.exit(1);
    }
    console.log(`  scris ${Math.min(i + MARIME_LOT, randuriIstoric.length)}/${randuriIstoric.length}`);
  }

  console.log("Backfill terminat.");
}

main();
