import type { SupabaseClient } from "@supabase/supabase-js";
import fotbalConfig from "@/config/fotbal.json";
import { dataRoFromUtc, azi } from "@/lib/date";
import { normalizeazaText } from "@/lib/text";
import type { EvenimentScorat } from "@/lib/types";
import { fetchToateRanduri } from "@/lib/supabase-paginat";
import { gasesteEchipaId } from "@/lib/predictii/potrivire-echipe";
import {
  estimeazaRatinguri,
  lambdaMeci,
  distributieScor,
  type StarePoisson,
  type RezultatMeciPoisson,
} from "@/lib/predictii/modele/poisson-fotbal";
import { construiestePiata1x2 } from "@/lib/predictii/piete/1x2-fotbal";
import { construiestePiataTotalGoluri } from "@/lib/predictii/piete/total-goluri";

const MODEL = "poisson-fotbal";
const VERSIUNE_MODEL = fotbalConfig.versiune_model;
const LIGI_ACOPERITE = fotbalConfig.ligi_acoperite as Record<string, { nume: string }>;

export interface RezultatActualizarePredictiiFotbal {
  meciuriAdaugateIstoric: number;
  predictiiNoi: number;
  echipeNepotrivite: string[];
}

function esteLigaAcoperita(codCompetitie: string): boolean {
  return codCompetitie in LIGI_ACOPERITE;
}

function limitaFereastra(): string {
  const limita = new Date(azi());
  limita.setFullYear(limita.getFullYear() - fotbalConfig.fereastra_sezoane);
  return limita.toISOString().slice(0, 10);
}

interface RandIstoricDb {
  echipa_acasa_id: string;
  echipa_oaspete_id: string;
  gol_acasa: number;
  gol_oaspete: number;
}

async function incarcaMeciuriPerLiga(db: SupabaseClient, codLiga: string, limitaISO: string): Promise<RezultatMeciPoisson[]> {
  const randuri = await fetchToateRanduri<RandIstoricDb>((start, end) =>
    db
      .from("meciuri_fotbal_istoric")
      .select("echipa_acasa_id,echipa_oaspete_id,gol_acasa,gol_oaspete")
      .eq("liga", codLiga)
      .gte("data", limitaISO)
      .range(start, end)
  );
  return randuri.map((r) => ({
    echipaAcasaId: r.echipa_acasa_id,
    echipaOaspeteId: r.echipa_oaspete_id,
    golAcasa: r.gol_acasa,
    golOaspete: r.gol_oaspete,
  }));
}

/**
 * adaugă meciurile de fotbal terminate azi (din ligile acoperite) la istoricul brut
 * (idempotent via meciuri_procesate), re-estimează ratingurile Poisson pe fereastra glisantă
 * pentru ligile afectate, apoi calculează predicții pentru meciurile viitoare selectate.
 */
export async function actualizeazaPredictiiFotbal(
  db: SupabaseClient,
  evenimenteFotbal: EvenimentScorat[]
): Promise<RezultatActualizarePredictiiFotbal> {
  const evenimenteAcoperite = evenimenteFotbal.filter((ev) => esteLigaAcoperita(ev.cod_competitie));
  if (evenimenteAcoperite.length === 0) {
    return { meciuriAdaugateIstoric: 0, predictiiNoi: 0, echipeNepotrivite: [] };
  }

  const [randuriAlias, randuriRatinguri, randuriProcesate] = await Promise.all([
    fetchToateRanduri<{ nume_sursa: string; echipa_id: string }>((start, end) =>
      db.from("echipe_alias").select("nume_sursa,echipa_id").eq("sursa", "espn").range(start, end)
    ),
    fetchToateRanduri<{ echipa_id: string; nume: string }>((start, end) =>
      db.from("ratinguri_fotbal").select("echipa_id,nume").range(start, end)
    ),
    fetchToateRanduri<{ id_sursa: string }>((start, end) =>
      db.from("meciuri_procesate").select("id_sursa").eq("sursa", "espn-fotbal").range(start, end)
    ),
  ]);

  const aliasuri = new Map(randuriAlias.map((r) => [r.nume_sursa, r.echipa_id]));
  const echipeCunoscute = new Map<string, string>();
  const numePerEchipa = new Map<string, string>();
  for (const r of randuriRatinguri) {
    echipeCunoscute.set(normalizeazaText(r.nume), r.echipa_id);
    numePerEchipa.set(r.echipa_id, r.nume);
  }
  const idProcesate = new Set(randuriProcesate.map((r) => r.id_sursa));

  const echipeNepotrivite = new Set<string>();
  function potrivesteSauLogheaza(nume: string): string | null {
    const rezultat = gasesteEchipaId(nume, aliasuri, echipeCunoscute);
    if (!rezultat.echipaId) {
      echipeNepotrivite.add(nume);
      return null;
    }
    numePerEchipa.set(rezultat.echipaId, nume);
    return rezultat.echipaId;
  }

  // pasul 1: adaugă meciurile terminate noi la istoricul brut
  const randuriIstoricNoi: Array<{
    liga: string;
    data: string;
    echipa_acasa_id: string;
    echipa_oaspete_id: string;
    gol_acasa: number;
    gol_oaspete: number;
    sursa: string;
  }> = [];
  const deMarcatProcesate: string[] = [];
  const ligiAfectate = new Set<string>();

  for (const ev of evenimenteAcoperite) {
    if (ev.status !== "terminat" || idProcesate.has(ev.id)) continue;
    deMarcatProcesate.push(ev.id);

    const scor = ev.extra?.scor as [string, string] | undefined;
    if (!scor) continue; // fără scor cunoscut — nu inventăm rezultatul
    const golAcasa = Number(scor[0]);
    const golOaspete = Number(scor[1]);
    if (!Number.isFinite(golAcasa) || !Number.isFinite(golOaspete)) continue;

    const idAcasa = potrivesteSauLogheaza(ev.participanti[0]);
    const idOaspete = potrivesteSauLogheaza(ev.participanti[1]);
    if (!idAcasa || !idOaspete) continue;

    randuriIstoricNoi.push({
      liga: ev.cod_competitie,
      data: dataRoFromUtc(ev.start_utc),
      echipa_acasa_id: idAcasa,
      echipa_oaspete_id: idOaspete,
      gol_acasa: golAcasa,
      gol_oaspete: golOaspete,
      sursa: "espn",
    });
    ligiAfectate.add(ev.cod_competitie);
  }

  if (randuriIstoricNoi.length > 0) {
    const { error } = await db
      .from("meciuri_fotbal_istoric")
      .upsert(randuriIstoricNoi, { onConflict: "liga,data,echipa_acasa_id,echipa_oaspete_id" });
    if (error) console.error("[predictii-fotbal] eroare la scrierea istoricului:", error.message);
  }

  if (deMarcatProcesate.length > 0) {
    const { error } = await db
      .from("meciuri_procesate")
      .upsert(
        deMarcatProcesate.map((id) => ({ sursa: "espn-fotbal", id_sursa: id })),
        { onConflict: "sursa,id_sursa", ignoreDuplicates: true }
      );
    if (error) console.error("[predictii-fotbal] eroare la marcarea meciuri_procesate:", error.message);
  }

  // pasul 2: re-estimează ratingurile pentru ligile cu meciuri nou-terminate sau programate
  const ligiDeRecalculat = new Set<string>([
    ...ligiAfectate,
    ...evenimenteAcoperite.filter((ev) => ev.status === "programat").map((ev) => ev.cod_competitie),
  ]);

  const limitaISO = limitaFereastra();
  const stariPerLiga = new Map<string, StarePoisson>();

  for (const codLiga of ligiDeRecalculat) {
    const meciuriLiga = await incarcaMeciuriPerLiga(db, codLiga, limitaISO);
    if (meciuriLiga.length === 0) continue;

    const stare = estimeazaRatinguri(meciuriLiga);
    stariPerLiga.set(codLiga, stare);

    const randuriDeScris = Array.from(stare.ratinguri.entries()).map(([echipaId, r]) => ({
      liga: codLiga,
      echipa_id: echipaId,
      nume: numePerEchipa.get(echipaId) ?? echipaId,
      atac: Math.round(r.atac * 10000) / 10000,
      aparare: Math.round(r.aparare * 10000) / 10000,
      avantaj_gazda: Math.round(stare.avantajGazda * 10000) / 10000,
      nr_meciuri: r.nrMeciuri,
    }));
    const { error } = await db.from("ratinguri_fotbal").upsert(randuriDeScris, { onConflict: "liga,echipa_id" });
    if (error) console.error(`[predictii-fotbal] eroare la scrierea ratinguri_fotbal pentru ${codLiga}:`, error.message);
  }

  // pasul 3: predicții pentru meciurile viitoare selectate
  let predictiiNoi = 0;
  for (const ev of evenimenteAcoperite) {
    if (!ev.selectat || ev.status !== "programat") continue;

    const stare = stariPerLiga.get(ev.cod_competitie);
    if (!stare) continue;

    const idAcasa = potrivesteSauLogheaza(ev.participanti[0]);
    const idOaspete = potrivesteSauLogheaza(ev.participanti[1]);
    if (!idAcasa || !idOaspete) continue;

    const lambda = lambdaMeci(stare, idAcasa, idOaspete);
    if (!lambda) continue;

    const distributie = distributieScor(lambda.lambdaAcasa, lambda.lambdaOaspete);
    const selectii = [...construiestePiata1x2(distributie), ...construiestePiataTotalGoluri(distributie, 2.5)];

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
      .select("eveniment_id");
    if (error) console.error(`[predictii-fotbal] eroare la predicție pentru ${ev.id}:`, error.message);
    else predictiiNoi += data?.length ?? 0;
  }

  return {
    meciuriAdaugateIstoric: randuriIstoricNoi.length,
    predictiiNoi,
    echipeNepotrivite: Array.from(echipeNepotrivite),
  };
}
