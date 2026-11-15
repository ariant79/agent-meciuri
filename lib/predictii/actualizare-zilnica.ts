import type { SupabaseClient } from "@supabase/supabase-js";
import predictiiConfig from "@/config/predictii.json";
import { dataRoFromUtc } from "@/lib/date";
import type { EvenimentScorat } from "@/lib/types";
import type { Suprafata } from "@/lib/predictii/tipuri";
import {
  actualizeazaMeci,
  predictieCastigator,
  ratinguriJucator,
  incarcaStareDinRanduri,
  DIMENSIUNI_RATING,
  type StareElo,
} from "@/lib/predictii/modele/elo-tenis";
import { construiestePiataCastigator } from "@/lib/predictii/piete/castigator";
import { gasesteJucatorId, normalizeazaNumeJucator } from "@/lib/predictii/potrivire-nume";
import { aplicaTemperatura } from "@/lib/predictii/temperatura";

const MODEL = "elo-tenis";
const VERSIUNE_MODEL = predictiiConfig.versiune_model;
const MARIME_PAGINA = 1000; // PostgREST limitează implicit selecturile la 1000 de rânduri

/** PostgREST plafonează select-urile la 1000 rânduri implicit — paginăm ca să le luăm pe toate */
async function fetchToateRanduri<T>(
  construieste: (start: number, end: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const toate: T[] = [];
  let start = 0;
  while (true) {
    const { data, error } = await construieste(start, start + MARIME_PAGINA - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    toate.push(...data);
    if (data.length < MARIME_PAGINA) break;
    start += MARIME_PAGINA;
  }
  return toate;
}

export interface RezultatActualizarePredictii {
  actualizariElo: number;
  predictiiNoi: number;
  jucatoriNepotriviti: string[];
}

function determinaSuprafata(competitie: string): Suprafata {
  const mapare = predictiiConfig.turnee_suprafata_espn as Record<string, string>;
  const gasita = mapare[competitie];
  if (gasita) return gasita as Suprafata;
  console.warn(`[predictii] turneu nemapat la suprafață: "${competitie}" — folosesc implicit`);
  return predictiiConfig.suprafata_implicita as Suprafata;
}

/**
 * actualizează ratingurile Elo din meciurile de tenis terminate azi (idempotent via meciuri_procesate),
 * apoi calculează predicții pentru meciurile de tenis selectate și încă neîncepute.
 */
export async function actualizeazaPredictiiTenis(
  db: SupabaseClient,
  evenimenteTenis: EvenimentScorat[]
): Promise<RezultatActualizarePredictii> {
  const [randuriRating, randuriAlias, randuriProcesate] = await Promise.all([
    fetchToateRanduri<{ jucator_id: string; nume: string; suprafata: "general" | "hard" | "clay" | "grass"; rating: number; nr_meciuri: number }>(
      (start, end) =>
        db.from("ratinguri").select("jucator_id,nume,suprafata,rating,nr_meciuri").eq("sport", "tenis").range(start, end)
    ),
    fetchToateRanduri<{ nume_sursa: string; jucator_id: string }>((start, end) =>
      db.from("jucatori_alias").select("nume_sursa,jucator_id").eq("sursa", "espn").range(start, end)
    ),
    fetchToateRanduri<{ id_sursa: string }>((start, end) =>
      db.from("meciuri_procesate").select("id_sursa").eq("sursa", "espn").range(start, end)
    ),
  ]);

  const stare: StareElo = incarcaStareDinRanduri(randuriRating);
  const jucatoriCunoscuti = new Map<string, string>();
  const numePerJucator = new Map<string, string>();
  for (const r of randuriRating) {
    jucatoriCunoscuti.set(normalizeazaNumeJucator(r.nume), r.jucator_id);
    numePerJucator.set(r.jucator_id, r.nume);
  }
  const aliasuri = new Map(randuriAlias.map((r) => [r.nume_sursa, r.jucator_id]));
  const idProcesate = new Set(randuriProcesate.map((r) => r.id_sursa));

  const jucatoriNepotriviti = new Set<string>();
  const jucatoriAfectati = new Set<string>();
  const ultimulMeciPerJucator = new Map<string, string>();
  const deMarcatProcesate: string[] = [];
  let actualizariElo = 0;

  function potrivesteSauLogheaza(nume: string): string | null {
    const rezultat = gasesteJucatorId(nume, aliasuri, jucatoriCunoscuti);
    if (!rezultat.jucatorId) {
      jucatoriNepotriviti.add(nume);
      return null;
    }
    numePerJucator.set(rezultat.jucatorId, nume);
    return rezultat.jucatorId;
  }

  for (const ev of evenimenteTenis) {
    if (ev.status !== "terminat" || idProcesate.has(ev.id)) continue;
    deMarcatProcesate.push(ev.id);

    const castigatorSelectie = ev.extra?.castigator as "p1" | "p2" | undefined;
    if (!castigatorSelectie) continue; // fără câștigător cunoscut — nu inventăm rezultatul

    const id1 = potrivesteSauLogheaza(ev.participanti[0]);
    const id2 = potrivesteSauLogheaza(ev.participanti[1]);
    if (!id1 || !id2) continue;

    const suprafata = determinaSuprafata(ev.competitie);
    const castigatorId = castigatorSelectie === "p1" ? id1 : id2;
    const invinsId = castigatorSelectie === "p1" ? id2 : id1;

    actualizeazaMeci(stare, castigatorId, invinsId, suprafata);
    jucatoriAfectati.add(castigatorId);
    jucatoriAfectati.add(invinsId);
    const dataMeci = dataRoFromUtc(ev.start_utc);
    ultimulMeciPerJucator.set(castigatorId, dataMeci);
    ultimulMeciPerJucator.set(invinsId, dataMeci);
    actualizariElo++;
  }

  if (jucatoriAfectati.size > 0) {
    const randuriDeScris = [];
    for (const jucatorId of jucatoriAfectati) {
      const ratinguri = ratinguriJucator(stare, jucatorId);
      const nume = numePerJucator.get(jucatorId) ?? jucatorId;
      const ultimulMeci = ultimulMeciPerJucator.get(jucatorId) ?? null;
      for (const dim of DIMENSIUNI_RATING) {
        if (ratinguri[dim].nrMeciuri === 0) continue;
        randuriDeScris.push({
          sport: "tenis",
          jucator_id: jucatorId,
          nume,
          suprafata: dim,
          rating: Math.round(ratinguri[dim].rating * 100) / 100,
          nr_meciuri: ratinguri[dim].nrMeciuri,
          ultimul_meci: ultimulMeci,
        });
      }
    }
    if (randuriDeScris.length > 0) {
      const { error } = await db.from("ratinguri").upsert(randuriDeScris, { onConflict: "sport,jucator_id,suprafata" });
      if (error) console.error("[predictii] eroare la scrierea ratinguri:", error.message);
    }
  }

  if (deMarcatProcesate.length > 0) {
    const { error } = await db
      .from("meciuri_procesate")
      .upsert(
        deMarcatProcesate.map((id) => ({ sursa: "espn", id_sursa: id })),
        { onConflict: "sursa,id_sursa", ignoreDuplicates: true }
      );
    if (error) console.error("[predictii] eroare la marcarea meciuri_procesate:", error.message);
  }

  let predictiiNoi = 0;
  for (const ev of evenimenteTenis) {
    if (!ev.selectat || ev.status !== "programat") continue;

    const id1 = potrivesteSauLogheaza(ev.participanti[0]);
    const id2 = potrivesteSauLogheaza(ev.participanti[1]);
    if (!id1 || !id2) continue;

    const suprafata = determinaSuprafata(ev.competitie);
    const { pA } = predictieCastigator(stare, id1, id2, suprafata);
    const pACalibrat = aplicaTemperatura(pA, predictiiConfig.elo.temperatura);
    const selectii = construiestePiataCastigator(pACalibrat, 1 - pACalibrat);

    const { data, error } = await db
      .from("predictii")
      .upsert(
        selectii.map((s) => ({
          eveniment_id: ev.id,
          model: MODEL,
          versiune_model: VERSIUNE_MODEL,
          piata: s.piata,
          selectie: s.selectie,
          probabilitate: s.probabilitate,
          start_utc: ev.start_utc,
        })),
        { onConflict: "eveniment_id,model,piata,selectie", ignoreDuplicates: true }
      )
      .select("eveniment_id"); // DO NOTHING pe conflict -> RETURNING reflectă doar rândurile efectiv inserate
    if (error) console.error(`[predictii] eroare la predicție pentru ${ev.id}:`, error.message);
    else predictiiNoi += data?.length ?? 0;
  }

  return { actualizariElo, predictiiNoi, jucatoriNepotriviti: Array.from(jucatoriNepotriviti) };
}
