import Link from "next/link";
import { supabasePublic } from "@/lib/supabase";
import { azi, deplaseazaDataRo, oraRoFromUtc } from "@/lib/date";
import { reimprospateazaAction } from "@/app/actions";
import { cheieFaza, type CheieFaza } from "@/clasificator";
import { esteNationale, numeNatiuneRo } from "@/lib/national";
import type { StareSursa } from "@/lib/types";

export const dynamic = "force-dynamic";

type RandEveniment = {
  id: string;
  sport: string;
  competitie: string;
  cod_competitie: string;
  faza: string | null;
  participant_1: string;
  participant_2: string;
  start_utc: string;
  status: string;
  scor: number | null;
  etichete: string[] | null;
  extra: Record<string, unknown> | null;
};

const NUME_SPORT: Record<string, string> = { fotbal: "Fotbal", tenis: "Tenis" };
const FAZA_RO: Record<CheieFaza, string> = {
  finala: "Finală",
  semifinala: "Semifinală",
  sferturi: "Sferturi",
  optimi: "Optimi",
  grupe_tur_final: "Faza grupelor",
  etapa_campionat: "Etapă",
  tur_initial: "Calificări",
};

function numeSport(sport: string): string {
  return NUME_SPORT[sport] ?? "Alte sporturi";
}

function afiseazaFaza(ev: RandEveniment): string | null {
  if (!ev.faza) return null;
  return ev.sport === "tenis" ? FAZA_RO[cheieFaza(ev.faza)] : ev.faza;
}

function afiseazaParticipant(ev: RandEveniment, nume: string): string {
  return esteNationale(ev.sport, ev.cod_competitie) ? numeNatiuneRo(nume) : nume;
}

/** indicator vizual de importanță, 1-3 puncte, derivat din scor (0-100) */
function puncteImportanta(scor: number | null): number {
  if (scor === null) return 1;
  if (scor >= 70) return 3;
  if (scor >= 50) return 2;
  return 1;
}

function rezultatText(ev: RandEveniment): string | null {
  const scor = ev.extra?.scor;
  if (Array.isArray(scor)) return `${scor[0]} – ${scor[1]}`;
  if (typeof scor === "string") return scor;
  const castigator = ev.extra?.castigator;
  if (typeof castigator === "string") return `Câștigă ${afiseazaParticipant(ev, castigator)}`;
  return null;
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

function CardEveniment({ ev }: { ev: RandEveniment }) {
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

function SectiuneSport({ titlu, evenimente }: { titlu: string; evenimente: RandEveniment[] }) {
  return (
    <section>
      <h2>{titlu}</h2>
      {evenimente.length ? (
        <ul className="lista-evenimente">
          {ordoneazaPentruAfisare(evenimente).map((ev) => (
            <CardEveniment key={ev.id} ev={ev} />
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
      <SectiuneSport titlu="Tenis" evenimente={tenis} />
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
    </main>
  );
}
