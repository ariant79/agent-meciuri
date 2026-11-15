import { supabaseAdmin } from "@/lib/supabase";
import { dataRoFromUtc } from "@/lib/date";
import { colecteazaFotbalEspn } from "@/colectoare/espn-fotbal";
import { colecteazaTenisEspn } from "@/colectoare/espn-tenis";
import { colecteazaAlteleEspn } from "@/colectoare/espn-altele";
import { clasifica } from "@/clasificator";
import { actualizeazaPredictiiTenis } from "@/lib/predictii/actualizare-zilnica";
import type { StareSursa } from "@/lib/types";

export async function executaColectare(dataRo: string) {
  const [fotbal, tenis, altele] = await Promise.all([
    colecteazaFotbalEspn(dataRo),
    colecteazaTenisEspn(dataRo),
    colecteazaAlteleEspn(dataRo),
  ]);

  const evenimente = [...fotbal.evenimente, ...tenis.evenimente, ...altele.evenimente];
  const stareSurse: Record<string, StareSursa> = { ...fotbal.stareSurse, ...tenis.stareSurse, ...altele.stareSurse };
  const scorate = clasifica(evenimente);

  const db = supabaseAdmin();
  let eroareSalvare: string | undefined;

  if (scorate.length > 0) {
    const randuri = scorate.map((e) => ({
      id: e.id,
      data_ro: dataRoFromUtc(e.start_utc),
      sursa: e.sursa,
      sport: e.sport,
      competitie: e.competitie,
      cod_competitie: e.cod_competitie,
      faza: e.faza,
      participant_1: e.participanti[0],
      participant_2: e.participanti[1],
      start_utc: e.start_utc,
      status: e.status,
      extra: e.extra,
      scor: e.scor,
      scor_detalii: e.scor_detalii,
      etichete: e.etichete,
      selectat: e.selectat,
    }));
    const { error } = await db.from("evenimente").upsert(randuri);
    if (error) eroareSalvare = error.message;
  }

  let predictii: { actualizariElo: number; predictiiNoi: number; jucatoriNepotriviti: string[] } | undefined;
  if (!eroareSalvare) {
    const tenisScorat = scorate.filter((e) => e.sport === "tenis");
    try {
      predictii = await actualizeazaPredictiiTenis(db, tenisScorat);
    } catch (err) {
      console.error("[predictii] eroare neprevăzută:", err);
    }
  }

  await db.from("rulari").insert({
    terminata_la: new Date().toISOString(),
    data_ro: dataRo,
    stare_surse: stareSurse,
    eroare: eroareSalvare ?? null,
  });

  return { dataRo, evenimente: scorate.length, stareSurse, eroareSalvare, predictii };
}
