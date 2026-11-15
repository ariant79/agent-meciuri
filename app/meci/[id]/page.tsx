import { notFound } from "next/navigation";
import Link from "next/link";
import { supabasePublic } from "@/lib/supabase";
import { oraRoFromUtc } from "@/lib/date";
import { afiseazaFaza, afiseazaParticipant, rezultatText, type RandEvenimentDeBaza } from "@/lib/afisare-eveniment";
import type { ScorDetalii } from "@/lib/types";
import { determinaSuprafata } from "@/lib/predictii/actualizare-zilnica";
import { gasesteJucatorId, normalizeazaNumeJucator } from "@/lib/predictii/potrivire-nume";
import { ordineCanonica, orienteazaH2h, type RandH2hDb } from "@/lib/predictii/h2h";
import { fetchToateRanduri } from "@/lib/supabase-paginat";
import type { DimensiuneRating } from "@/lib/predictii/tipuri";
import fotbalConfig from "@/config/fotbal.json";
import { gasesteEchipaId } from "@/lib/predictii/potrivire-echipe";
import { normalizeazaText } from "@/lib/text";

export const dynamic = "force-dynamic";

interface RandEveniment extends RandEvenimentDeBaza {
  id: string;
  start_utc: string;
  scor: number | null;
  scor_detalii: ScorDetalii | null;
  etichete: string[] | null;
  data_ro: string;
}

type RandRatingGeneral = { jucator_id: string; nume: string };
type RandRatingComplet = { jucator_id: string; suprafata: DimensiuneRating; rating: number; nr_meciuri: number };

async function obtineStatisticiTenis(db: ReturnType<typeof supabasePublic>, ev: RandEveniment) {
  const [randuriAlias, randuriGeneral] = await Promise.all([
    fetchToateRanduri<{ nume_sursa: string; jucator_id: string }>((start, end) =>
      db.from("jucatori_alias").select("nume_sursa,jucator_id").eq("sursa", "espn").range(start, end)
    ),
    fetchToateRanduri<RandRatingGeneral>((start, end) =>
      db.from("ratinguri").select("jucator_id,nume").eq("sport", "tenis").eq("suprafata", "general").range(start, end)
    ),
  ]);

  const aliasuri = new Map(randuriAlias.map((r) => [r.nume_sursa, r.jucator_id]));
  const jucatoriCunoscuti = new Map(randuriGeneral.map((r) => [normalizeazaNumeJucator(r.nume), r.jucator_id]));

  const r1 = gasesteJucatorId(ev.participant_1, aliasuri, jucatoriCunoscuti);
  const r2 = gasesteJucatorId(ev.participant_2, aliasuri, jucatoriCunoscuti);
  if (!r1.jucatorId || !r2.jucatorId) return null;

  const suprafata = determinaSuprafata(ev.competitie);

  const [{ data: randuriRating }, { data: randH2hBrut }, { data: randuriPredictie }] = await Promise.all([
    db
      .from("ratinguri")
      .select("jucator_id,suprafata,rating,nr_meciuri")
      .eq("sport", "tenis")
      .in("jucator_id", [r1.jucatorId, r2.jucatorId]),
    (() => {
      const [id1, id2] = ordineCanonica(r1.jucatorId!, r2.jucatorId!);
      return db
        .from("h2h_tenis")
        .select("jucator_id_1,jucator_id_2,victorii_1,victorii_2,ultimul_meci")
        .eq("jucator_id_1", id1)
        .eq("jucator_id_2", id2)
        .maybeSingle();
    })(),
    db.from("predictii").select("selectie,probabilitate").eq("eveniment_id", ev.id).eq("piata", "castigator"),
  ]);

  const ratinguriPerJucator = (ratinguri: RandRatingComplet[], jucatorId: string): Record<string, RandRatingComplet> =>
    Object.fromEntries(
      ratinguri.filter((r) => r.jucator_id === jucatorId).map((r): [string, RandRatingComplet] => [r.suprafata, r])
    );

  const h2h = orienteazaH2h((randH2hBrut as RandH2hDb | null) ?? null, r1.jucatorId, r2.jucatorId);

  let predictie: { p1: number; p2: number } | null = null;
  for (const r of randuriPredictie ?? []) {
    predictie = predictie ?? { p1: 0, p2: 0 };
    predictie[r.selectie as "p1" | "p2"] = r.probabilitate;
  }

  return {
    suprafata,
    h2h,
    predictie,
    ratinguri1: ratinguriPerJucator((randuriRating ?? []) as RandRatingComplet[], r1.jucatorId),
    ratinguri2: ratinguriPerJucator((randuriRating ?? []) as RandRatingComplet[], r2.jucatorId),
  };
}

type RandRatingFotbal = {
  echipa_id: string;
  nume: string;
  atac: number;
  aparare: number;
  avantaj_gazda: number;
  nr_meciuri: number;
};

async function obtineStatisticiFotbal(db: ReturnType<typeof supabasePublic>, ev: RandEveniment) {
  const ligiAcoperite = fotbalConfig.ligi_acoperite as Record<string, { nume: string }>;
  if (!(ev.cod_competitie in ligiAcoperite)) return null;

  const [randuriAlias, randuriRating] = await Promise.all([
    fetchToateRanduri<{ nume_sursa: string; echipa_id: string }>((start, end) =>
      db.from("echipe_alias").select("nume_sursa,echipa_id").eq("sursa", "espn").range(start, end)
    ),
    fetchToateRanduri<RandRatingFotbal>((start, end) =>
      db
        .from("ratinguri_fotbal")
        .select("echipa_id,nume,atac,aparare,avantaj_gazda,nr_meciuri")
        .eq("liga", ev.cod_competitie)
        .range(start, end)
    ),
  ]);

  const aliasuri = new Map(randuriAlias.map((r) => [r.nume_sursa, r.echipa_id]));
  const echipeCunoscute = new Map(randuriRating.map((r) => [normalizeazaText(r.nume), r.echipa_id]));

  const r1 = gasesteEchipaId(ev.participant_1, aliasuri, echipeCunoscute);
  const r2 = gasesteEchipaId(ev.participant_2, aliasuri, echipeCunoscute);
  if (!r1.echipaId || !r2.echipaId) return null;

  const ratingAcasa = randuriRating.find((r) => r.echipa_id === r1.echipaId);
  const ratingOaspete = randuriRating.find((r) => r.echipa_id === r2.echipaId);
  if (!ratingAcasa || !ratingOaspete) return null;

  const { data: randuriPredictie } = await db
    .from("predictii")
    .select("piata,selectie,probabilitate")
    .eq("eveniment_id", ev.id)
    .in("piata", ["1x2_fotbal", "total_goluri_2.5"]);

  const predictie1x2: Partial<Record<"acasa" | "egal" | "oaspete", number>> = {};
  const predictieTotalGoluri: Partial<Record<"peste" | "sub", number>> = {};
  for (const r of randuriPredictie ?? []) {
    if (r.piata === "1x2_fotbal") predictie1x2[r.selectie as "acasa" | "egal" | "oaspete"] = r.probabilitate;
    else if (r.piata === "total_goluri_2.5") predictieTotalGoluri[r.selectie as "peste" | "sub"] = r.probabilitate;
  }

  return { ratingAcasa, ratingOaspete, predictie1x2, predictieTotalGoluri };
}

export default async function PaginaMeci({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = supabasePublic();

  const { data: ev } = await db
    .from("evenimente")
    .select(
      "id,sport,competitie,cod_competitie,faza,participant_1,participant_2,start_utc,status,scor,scor_detalii,etichete,extra,data_ro"
    )
    .eq("id", decodeURIComponent(id))
    .maybeSingle();

  if (!ev) notFound();
  const eveniment = ev as RandEveniment;

  const statisticiTenis = eveniment.sport === "tenis" ? await obtineStatisticiTenis(db, eveniment) : null;
  const statisticiFotbal = eveniment.sport === "fotbal" ? await obtineStatisticiFotbal(db, eveniment) : null;
  const terminat = eveniment.status === "terminat";
  const rezultat = terminat ? rezultatText(eveniment) : null;
  const faza = afiseazaFaza(eveniment);
  const clasament = eveniment.extra?.clasament as { acasa: number | null; oaspete: number | null } | undefined;

  return (
    <main className="pagina">
      <header className="antet">
        <h1>
          {afiseazaParticipant(eveniment, eveniment.participant_1)} – {afiseazaParticipant(eveniment, eveniment.participant_2)}
        </h1>
        <Link href={`/?data=${eveniment.data_ro}`}>← Înapoi</Link>
      </header>

      <section>
        <p className="card-detalii">
          {eveniment.competitie}
          {faza ? ` · ${faza}` : ""} · {oraRoFromUtc(eveniment.start_utc)}
          {rezultat ? ` · ${rezultat}` : ""}
        </p>
        {eveniment.etichete && eveniment.etichete.length > 0 && (
          <div className="card-etichete">
            {eveniment.etichete.map((et) => (
              <span key={et} className="eticheta">
                {et}
              </span>
            ))}
          </div>
        )}
      </section>

      {eveniment.scor_detalii && (
        <section>
          <h2>Scor</h2>
          <ul className="lista-surse">
            <li>Valoare: {eveniment.scor_detalii.valoare}</li>
            <li>Rivalitate: {eveniment.scor_detalii.rivalitate}</li>
            <li>Tradiție: {eveniment.scor_detalii.traditie}</li>
          </ul>
        </section>
      )}

      {eveniment.sport === "tenis" ? (
        <section>
          <h2>Statistici tenis</h2>
          {statisticiTenis ? (
            <>
              {statisticiTenis.predictie && (
                <p>
                  Predicție: {afiseazaParticipant(eveniment, eveniment.participant_1)}{" "}
                  {Math.round(statisticiTenis.predictie.p1 * 100)}% · {afiseazaParticipant(eveniment, eveniment.participant_2)}{" "}
                  {Math.round(statisticiTenis.predictie.p2 * 100)}%
                </p>
              )}
              <div className="rating-grid">
                {(
                  [
                    { nume: eveniment.participant_1, ratinguri: statisticiTenis.ratinguri1 },
                    { nume: eveniment.participant_2, ratinguri: statisticiTenis.ratinguri2 },
                  ] as Array<{ nume: string; ratinguri: Record<string, RandRatingComplet> }>
                ).map(({ nume, ratinguri }) => (
                  <div key={nume} className="rating-jucator">
                    <h3>{afiseazaParticipant(eveniment, nume)}</h3>
                    {ratinguri.general && (
                      <div className="rating-linie">
                        <span>Elo general</span>
                        <span>
                          {Math.round(ratinguri.general.rating)} ({ratinguri.general.nr_meciuri} meciuri)
                        </span>
                      </div>
                    )}
                    {ratinguri[statisticiTenis.suprafata] && (
                      <div className="rating-linie">
                        <span>Elo {statisticiTenis.suprafata}</span>
                        <span>
                          {Math.round(ratinguri[statisticiTenis.suprafata].rating)} ({ratinguri[statisticiTenis.suprafata].nr_meciuri}{" "}
                          meciuri)
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <p className="h2h">
                {statisticiTenis.h2h.victoriiA === 0 && statisticiTenis.h2h.victoriiB === 0
                  ? "Prima întâlnire între cei doi jucători."
                  : `Head-to-head: ${afiseazaParticipant(eveniment, eveniment.participant_1)} ${statisticiTenis.h2h.victoriiA} - ${statisticiTenis.h2h.victoriiB} ${afiseazaParticipant(eveniment, eveniment.participant_2)}`}
              </p>
            </>
          ) : (
            <p className="gol">Cel puțin unul dintre jucători nu e potrivit cu baza de date Sackmann — fără statistici.</p>
          )}
        </section>
      ) : eveniment.sport === "fotbal" && statisticiFotbal ? (
        <section>
          <h2>Statistici fotbal</h2>
          {Object.keys(statisticiFotbal.predictie1x2).length > 0 && (
            <p>
              1X2: {afiseazaParticipant(eveniment, eveniment.participant_1)}{" "}
              {Math.round((statisticiFotbal.predictie1x2.acasa ?? 0) * 100)}% · egal{" "}
              {Math.round((statisticiFotbal.predictie1x2.egal ?? 0) * 100)}% ·{" "}
              {afiseazaParticipant(eveniment, eveniment.participant_2)}{" "}
              {Math.round((statisticiFotbal.predictie1x2.oaspete ?? 0) * 100)}%
            </p>
          )}
          {Object.keys(statisticiFotbal.predictieTotalGoluri).length > 0 && (
            <p>
              Total goluri 2.5: peste {Math.round((statisticiFotbal.predictieTotalGoluri.peste ?? 0) * 100)}% · sub{" "}
              {Math.round((statisticiFotbal.predictieTotalGoluri.sub ?? 0) * 100)}%
            </p>
          )}
          <div className="rating-grid">
            {(
              [
                { nume: eveniment.participant_1, rating: statisticiFotbal.ratingAcasa },
                { nume: eveniment.participant_2, rating: statisticiFotbal.ratingOaspete },
              ] as Array<{ nume: string; rating: RandRatingFotbal }>
            ).map(({ nume, rating }) => (
              <div key={nume} className="rating-jucator">
                <h3>{afiseazaParticipant(eveniment, nume)}</h3>
                <div className="rating-linie">
                  <span>Atac</span>
                  <span>{rating.atac.toFixed(2)}</span>
                </div>
                <div className="rating-linie">
                  <span>Apărare</span>
                  <span>{rating.aparare.toFixed(2)}</span>
                </div>
                <div className="rating-linie">
                  <span>Meciuri în fereastră</span>
                  <span>{rating.nr_meciuri}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section>
          <h2>Statistici</h2>
          {clasament && (
            <p>
              Clasament: {afiseazaParticipant(eveniment, eveniment.participant_1)} #{clasament.acasa ?? "?"} ·{" "}
              {afiseazaParticipant(eveniment, eveniment.participant_2)} #{clasament.oaspete ?? "?"}
            </p>
          )}
          <p className="gol">Predicții încă indisponibile pentru acest sport.</p>
        </section>
      )}

      <footer className="subsol">
        {eveniment.sport === "tenis" && <p>Date istorice tenis: Jeff Sackmann / Tennis Abstract, CC BY-NC-SA 4.0.</p>}
        {eveniment.sport === "fotbal" && statisticiFotbal && <p>Date istorice fotbal: football-data.co.uk.</p>}
      </footer>
    </main>
  );
}
