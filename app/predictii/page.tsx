import { supabasePublic } from "@/lib/supabase";
import { oraRoFromUtc } from "@/lib/date";

export const dynamic = "force-dynamic";

interface RandEvaluare {
  id: number;
  eveniment_id: string;
  model: string;
  versiune_model: string;
  piata: string;
  selectie: string;
  probabilitate: number;
  start_utc: string;
  sport: string;
  competitie: string;
  participant_1: string;
  participant_2: string;
  castigator: string;
  corect: boolean;
  brier: number;
  log_loss: number;
}

const MARIME_PAGINA = 1000;

async function fetchToateEvaluarile(db: ReturnType<typeof supabasePublic>): Promise<RandEvaluare[]> {
  const toate: RandEvaluare[] = [];
  let start = 0;
  while (true) {
    const { data, error } = await db
      .from("evaluare_predictii")
      .select("*")
      .order("start_utc", { ascending: false })
      .range(start, start + MARIME_PAGINA - 1);
    if (error || !data) break;
    toate.push(...(data as RandEvaluare[]));
    if (data.length < MARIME_PAGINA) break;
    start += MARIME_PAGINA;
  }
  return toate;
}

function numeParticipant(r: RandEvaluare, selectie: string): string {
  return selectie === "p1" ? r.participant_1 : r.participant_2;
}

function SectiuneVersiune({ versiune, randuri }: { versiune: string; randuri: RandEvaluare[] }) {
  const favorite = randuri.filter((r) => r.probabilitate >= 0.5);
  const acuratete = favorite.length > 0 ? favorite.filter((r) => r.corect).length / favorite.length : null;
  const brierMediu = randuri.length > 0 ? randuri.reduce((s, r) => s + r.brier, 0) / randuri.length : null;
  const logLossMediu = randuri.length > 0 ? randuri.reduce((s, r) => s + r.log_loss, 0) / randuri.length : null;

  const galeti = Array.from({ length: 10 }, () => ({ n: 0, sumaP: 0, sumaCorect: 0 }));
  for (const r of randuri) {
    const idx = Math.min(9, Math.floor(r.probabilitate * 10));
    galeti[idx].n++;
    galeti[idx].sumaP += r.probabilitate;
    galeti[idx].sumaCorect += r.corect ? 1 : 0;
  }

  return (
    <section>
      <h2>elo-tenis · versiune {versiune}</h2>
      <ul className="lista-surse">
        <li>Meciuri evaluate: {favorite.length}</li>
        <li>Acuratețe (câștigă favoritul): {acuratete !== null ? `${(acuratete * 100).toFixed(1)}%` : "-"}</li>
        <li>Brier mediu: {brierMediu !== null ? brierMediu.toFixed(4) : "-"}</li>
        <li>Log-loss mediu: {logLossMediu !== null ? logLossMediu.toFixed(4) : "-"}</li>
      </ul>
      <div className="tabel-scroll">
        <table className="tabel-calibrare">
          <thead>
            <tr>
              <th>interval</th>
              <th>n</th>
              <th>prob. medie</th>
              <th>frecvență reală</th>
            </tr>
          </thead>
          <tbody>
            {galeti.map((g, i) => (
              <tr key={i}>
                <td>
                  {i * 10}-{(i + 1) * 10}%
                </td>
                <td>{g.n}</td>
                <td>{g.n > 0 ? `${((g.sumaP / g.n) * 100).toFixed(1)}%` : "-"}</td>
                <td>{g.n > 0 ? `${((g.sumaCorect / g.n) * 100).toFixed(1)}%` : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default async function Predictii() {
  const db = supabasePublic();
  const toate = await fetchToateEvaluarile(db);

  const peVersiune = new Map<string, RandEvaluare[]>();
  for (const r of toate) {
    if (!peVersiune.has(r.versiune_model)) peVersiune.set(r.versiune_model, []);
    peVersiune.get(r.versiune_model)!.push(r);
  }
  const versiuni = Array.from(peVersiune.keys()).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

  const istoric = toate.filter((r) => r.probabilitate >= 0.5).slice(0, 30);

  return (
    <main className="pagina">
      <header className="antet">
        <h1>Predicții</h1>
      </header>

      {toate.length === 0 ? (
        <section>
          <p className="gol">Niciun meci evaluat încă (se evaluează doar meciurile terminate cu predicție salvată).</p>
        </section>
      ) : (
        versiuni.map((v) => <SectiuneVersiune key={v} versiune={v} randuri={peVersiune.get(v)!} />)
      )}

      {istoric.length > 0 && (
        <section>
          <h2>Istoric recent</h2>
          <ul className="lista-evenimente">
            {istoric.map((r) => (
              <li key={r.id} className="card">
                <div className="card-randul1">
                  <span className="card-ora">{oraRoFromUtc(r.start_utc)}</span>
                  <span className={r.corect ? "predictie-corecta" : "predictie-gresita"}>{r.corect ? "✓" : "✗"}</span>
                </div>
                <div className="card-meci">
                  {r.participant_1} – {r.participant_2}
                </div>
                <div className="card-detalii">
                  v{r.versiune_model} · {r.competitie} · favorit {numeParticipant(r, r.selectie)} ({Math.round(r.probabilitate * 100)}%) ·
                  a câștigat {numeParticipant(r, r.castigator)}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="subsol">
        <p>Date istorice tenis: Jeff Sackmann / Tennis Abstract, CC BY-NC-SA 4.0.</p>
      </footer>
    </main>
  );
}
