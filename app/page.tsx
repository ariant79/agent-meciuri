import Link from "next/link";
import { supabasePublic } from "@/lib/supabase";
import { azi, deplaseazaDataRo, oraRoFromUtc } from "@/lib/date";
import { reimprospateazaAction } from "@/app/actions";
import {
  numeSport,
  afiseazaFaza,
  afiseazaParticipant,
  rezultatText,
  puncteImportanta,
  evalueazaPredictieTenis,
  type RandEvenimentDeBaza,
  type Predictie,
} from "@/lib/afisare-eveniment";
import type { StareSursa } from "@/lib/types";

export const dynamic = "force-dynamic";

type RandEveniment = RandEvenimentDeBaza & {
  id: string;
  start_utc: string;
  scor: number | null;
  etichete: string[] | null;
};

function PredictieTenis({ ev, predictie }: { ev: RandEveniment; predictie: Predictie }) {
  const { favorizeazaP1, corect } = evalueazaPredictieTenis(ev, predictie);

  return (
    <div className="card-predictie">
      <span className={favorizeazaP1 ? "predictie-favorit" : undefined}>
        {afiseazaParticipant(ev, ev.participant_1)} {Math.round(predictie.p1 * 100)}%
      </span>
      {" · "}
      <span className={!favorizeazaP1 ? "predictie-favorit" : undefined}>
        {afiseazaParticipant(ev, ev.participant_2)} {Math.round(predictie.p2 * 100)}%
      </span>
      {corect !== null && <span className={corect ? "predictie-corecta" : "predictie-gresita"}>{corect ? " ✓" : " ✗"}</span>}
    </div>
  );
}

function IndicatorImportanta({ scor }: { scor: number | null }) {
  const puncte = puncteImportanta(scor);
  return (
    <span className="importanta" title={`importanță ${puncte}/3`}>
      {"●".repeat(puncte)}
      {"○".repeat(3 - puncte)}
    </span>
  );
}

function CardEveniment({ ev, predictie }: { ev: RandEveniment; predictie?: Predictie }) {
  const terminat = ev.status === "terminat";
  const rezultat = terminat ? rezultatText(ev) : null;
  const faza = afiseazaFaza(ev);

  return (
    <li className={terminat ? "card card-terminat" : "card"}>
      <div className="card-randul1">
        <span className="card-ora">{oraRoFromUtc(ev.start_utc)}</span>
        <IndicatorImportanta scor={ev.scor} />
      </div>
      <div className="card-meci">
        {afiseazaParticipant(ev, ev.participant_1)} – {afiseazaParticipant(ev, ev.participant_2)}
      </div>
      <div className="card-detalii">
        {ev.competitie}
        {faza ? ` · ${faza}` : ""}
        {rezultat ? ` · ${rezultat}` : ""}
      </div>
      {predictie && <PredictieTenis ev={ev} predictie={predictie} />}
      {ev.etichete && ev.etichete.length > 0 && (
        <div className="card-etichete">
          {ev.etichete.map((et) => (
            <span key={et} className="eticheta">
              {et}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}

/** meciurile viitoare/live cronologic, apoi cele terminate (estompate) la final */
function ordoneazaPentruAfisare(lista: RandEveniment[]): RandEveniment[] {
  const cronologic = (a: RandEveniment, b: RandEveniment) => a.start_utc.localeCompare(b.start_utc);
  const viitoare = lista.filter((e) => e.status !== "terminat").sort(cronologic);
  const terminate = lista.filter((e) => e.status === "terminat").sort(cronologic);
  return [...viitoare, ...terminate];
}

function SectiuneSport({
  titlu,
  evenimente,
  predictii,
}: {
  titlu: string;
  evenimente: RandEveniment[];
  predictii?: Map<string, Predictie>;
}) {
  return (
    <section>
      <h2>{titlu}</h2>
      {evenimente.length ? (
        <ul className="lista-evenimente">
          {ordoneazaPentruAfisare(evenimente).map((ev) => (
            <CardEveniment key={ev.id} ev={ev} predictie={predictii?.get(ev.id)} />
          ))}
        </ul>
      ) : (
        <p className="gol">Niciun meci selectat pentru această zi.</p>
      )}
    </section>
  );
}

export default async function Home({ searchParams }: { searchParams: Promise<{ data?: string }> }) {
  const { data: dataParam } = await searchParams;
  const dataRo = dataParam && /^\d{4}-\d{2}-\d{2}$/.test(dataParam) ? dataParam : azi();
  const ieri = deplaseazaDataRo(dataRo, -1);
  const maine = deplaseazaDataRo(dataRo, 1);

  const db = supabasePublic();
  const [{ data: evenimente }, { data: rulari }] = await Promise.all([
    db
      .from("evenimente")
      .select("id,sport,competitie,cod_competitie,faza,participant_1,participant_2,start_utc,status,scor,etichete,extra")
      .eq("data_ro", dataRo)
      .eq("selectat", true)
      .order("scor", { ascending: false }),
    db.from("rulari").select("*").eq("data_ro", dataRo).order("pornita_la", { ascending: false }).limit(1),
  ]);

  const toate = (evenimente ?? []) as RandEveniment[];
  const fotbal = toate.filter((e) => e.sport === "fotbal");
  const tenis = toate.filter((e) => e.sport === "tenis");
  const altele = toate.filter((e) => e.sport !== "fotbal" && e.sport !== "tenis");

  const predictiiTenis = new Map<string, Predictie>();
  if (tenis.length > 0) {
    const { data: randuriPredictii } = await db
      .from("predictii")
      .select("eveniment_id,selectie,probabilitate")
      .eq("model", "elo-tenis")
      .eq("piata", "castigator")
      .in("eveniment_id", tenis.map((e) => e.id));

    for (const r of randuriPredictii ?? []) {
      const existent = predictiiTenis.get(r.eveniment_id) ?? { p1: 0, p2: 0 };
      existent[r.selectie as "p1" | "p2"] = r.probabilitate;
      predictiiTenis.set(r.eveniment_id, existent);
    }
  }

  const ultimaRulare = rulari?.[0] as
    | { terminata_la: string | null; stare_surse: Record<string, StareSursa>; eroare: string | null }
    | undefined;
  const surse = Object.entries(ultimaRulare?.stare_surse ?? {});
  const nrOk = surse.filter(([, s]) => s.ok).length;
  const toateOk = nrOk === surse.length;

  return (
    <main className="pagina">
      <header className="antet">
        <h1>Agent meciuri</h1>
        <nav className="navigare-zile">
          <Link href={`/?data=${ieri}`}>← Ieri</Link>
          <span className="data-curenta">{dataRo}</span>
          <Link href={`/?data=${maine}`}>Mâine →</Link>
        </nav>
        <form action={reimprospateazaAction}>
          <button type="submit">Reîmprospătează</button>
        </form>
      </header>

      <SectiuneSport titlu="Fotbal" evenimente={fotbal} />
      <SectiuneSport titlu="Tenis" evenimente={tenis} predictii={predictiiTenis} />
      <SectiuneSport titlu="Alte sporturi" evenimente={altele} />

      <section>
        <h2>Starea surselor</h2>
        {ultimaRulare ? (
          <details open={!toateOk}>
            <summary>
              {nrOk}/{surse.length} surse OK
              {ultimaRulare.terminata_la ? ` · ultima rulare ${oraRoFromUtc(ultimaRulare.terminata_la)}` : ""}
            </summary>
            {ultimaRulare.eroare && <p className="eroare">Eroare rulare: {ultimaRulare.eroare}</p>}
            <ul className="lista-surse">
              {surse.map(([sursa, stare]) => (
                <li key={sursa} className={stare.ok ? "sursa-ok" : "sursa-eroare"}>
                  {sursa}: {stare.ok ? `ok (${stare.evenimente})` : `eroare — ${stare.eroare}`}
                </li>
              ))}
            </ul>
          </details>
        ) : (
          <p className="gol">Nicio rulare înregistrată pentru această zi.</p>
        )}
      </section>

      <footer className="subsol">
        <Link href="/predictii">Predicții — istoric și acuratețe</Link>
        <p>Date istorice tenis: Jeff Sackmann / Tennis Abstract, CC BY-NC-SA 4.0.</p>
      </footer>
    </main>
  );
}
