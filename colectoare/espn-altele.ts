import type { Eveniment, StareSursa } from "@/lib/types";
import { dataRoFromUtc, deplaseazaYYYYMMDD, yyyymmddDinDataRo } from "@/lib/date";
import { fetchEspn } from "@/lib/fetch-espn";
import competitii from "@/config/competitii.json";

const STATUS_MAP: Record<string, Eveniment["status"]> = {
  pre: "programat",
  in: "live",
  post: "terminat",
};

interface EspnCompetitor {
  homeAway?: "home" | "away";
  score?: string;
  winner?: boolean;
  team?: { displayName: string };
  athlete?: { displayName: string };
}

interface EspnCompetition {
  date?: string;
  status: { type: { state: string; name: string } };
  competitors: EspnCompetitor[];
}

interface EspnEvent {
  id: string;
  date: string;
  name?: string;
  competitions: EspnCompetition[];
}

function mapStatus(state: string, name: string): Eveniment["status"] {
  if (name?.includes("POSTPONED") || name?.includes("CANCELED")) return "amanat";
  return STATUS_MAP[state] ?? "programat";
}

function numeParticipant(c: EspnCompetitor): string {
  return c.team?.displayName ?? c.athlete?.displayName ?? "?";
}

/** sporturi pe echipe (NBA/NHL/NFL/MLB): competitori cu homeAway */
function mapMeciEchipa(ev: EspnEvent, sport: string, liga: string, nume: string): Eveniment | null {
  const comp = ev.competitions?.[0];
  if (!comp) return null;
  const acasa = comp.competitors.find((c) => c.homeAway === "home");
  const oaspete = comp.competitors.find((c) => c.homeAway === "away");
  if (!acasa || !oaspete) return null;

  const extra: Record<string, unknown> = {};
  if (acasa.score !== undefined && oaspete.score !== undefined) {
    extra.scor = [acasa.score, oaspete.score];
  }

  return {
    id: `espn:${ev.id}`,
    sursa: "espn",
    sport,
    competitie: nume,
    cod_competitie: liga,
    faza: null,
    participanti: [numeParticipant(acasa), numeParticipant(oaspete)],
    start_utc: ev.date,
    status: mapStatus(comp.status.type.state, comp.status.type.name),
    extra,
  };
}

/** UFC: evenimentul ESPN e cardul întreg (13 lupte); reținem doar lupta principală (ultima din card) */
function mapCardUfc(ev: EspnEvent, liga: string, nume: string): Eveniment | null {
  const comp = ev.competitions?.[ev.competitions.length - 1];
  if (!comp) return null;
  const [a, b] = comp.competitors;
  if (!a || !b) return null;

  const status = mapStatus(comp.status.type.state, comp.status.type.name);
  const castigator = a.winner ? numeParticipant(a) : b.winner ? numeParticipant(b) : null;

  return {
    id: `espn:${ev.id}`,
    sursa: "espn",
    sport: "mma",
    competitie: ev.name ?? nume,
    cod_competitie: liga,
    faza: "Main Event",
    participanti: [numeParticipant(a), numeParticipant(b)],
    start_utc: comp.date ?? ev.date,
    status,
    extra: status === "terminat" && castigator ? { castigator } : {},
  };
}

async function obtineScoreboard(sport: string, liga: string, dataYYYYMMDD: string): Promise<EspnEvent[]> {
  const res = await fetchEspn(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${liga}/scoreboard?dates=${dataYYYYMMDD}`);
  const data = await res.json();
  return Array.isArray(data.events) ? data.events : [];
}

async function colecteazaLiga(
  sport: string,
  liga: string,
  nume: string,
  dataRoTinta: string
): Promise<{ evenimente: Eveniment[]; stare: StareSursa }> {
  const bazaYYYYMMDD = yyyymmddDinDataRo(dataRoTinta);
  const zileDeInterogat = [
    deplaseazaYYYYMMDD(bazaYYYYMMDD, -1),
    bazaYYYYMMDD,
    deplaseazaYYYYMMDD(bazaYYYYMMDD, 1),
  ];

  try {
    const liste = await Promise.all(zileDeInterogat.map((zi) => obtineScoreboard(sport, liga, zi)));
    const evenimenteBrute = new Map<string, EspnEvent>();
    liste.flat().forEach((ev) => evenimenteBrute.set(ev.id, ev));

    const mapeaza = liga === "ufc" ? (ev: EspnEvent) => mapCardUfc(ev, liga, nume) : (ev: EspnEvent) => mapMeciEchipa(ev, sport, liga, nume);

    const evenimente = Array.from(evenimenteBrute.values())
      .map(mapeaza)
      .filter((e): e is Eveniment => e !== null)
      .filter((e) => dataRoFromUtc(e.start_utc) === dataRoTinta);

    return { evenimente, stare: { ok: true, evenimente: evenimente.length } };
  } catch (err) {
    return { evenimente: [], stare: { ok: false, evenimente: 0, eroare: String(err) } };
  }
}

/** F1 nu are formă "1 vs 1" (sesiuni cu ~20 piloți) - nu se încadrează în modelul Eveniment, exclus din v1 */
const LIGI_SUPORTATE = competitii.altele.filter((a) => a.sport !== "racing");

/** dataRoTinta: ziua țintă, format YYYY-MM-DD, în Europe/Bucharest */
export async function colecteazaAlteleEspn(dataRoTinta: string) {
  const rezultate = await Promise.all(
    LIGI_SUPORTATE.map((liga) => colecteazaLiga(liga.sport, liga.liga, liga.nume, dataRoTinta))
  );

  const evenimente = rezultate.flatMap((r) => r.evenimente);
  const stareSurse: Record<string, StareSursa> = {};
  LIGI_SUPORTATE.forEach((liga, i) => {
    stareSurse[`espn-altele:${liga.liga}`] = rezultate[i].stare;
  });

  return { evenimente, stareSurse };
}
