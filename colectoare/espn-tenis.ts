import type { Eveniment, StareSursa } from "@/lib/types";
import { dataRoFromUtc, deplaseazaYYYYMMDD, yyyymmddDinDataRo } from "@/lib/date";
import { fetchEspn } from "@/lib/fetch-espn";

const STATUS_MAP: Record<string, Eveniment["status"]> = {
  pre: "programat",
  in: "live",
  post: "terminat",
};

interface EspnAthleteCompetitor {
  homeAway: "home" | "away";
  curatedRank?: { current: number };
  athlete: { id: string; displayName: string };
  linescores?: Array<{ value: number; tiebreak?: number }>;
}

/** "6-4, 3-6, 7-6(9-7)" din seturile ambilor jucători */
function formateazaScorSeturi(acasa: EspnAthleteCompetitor, oaspete: EspnAthleteCompetitor): string | null {
  const seturi = acasa.linescores;
  if (!seturi || !oaspete.linescores || seturi.length === 0) return null;
  return seturi
    .map((set, i) => {
      const altSet = oaspete.linescores![i];
      if (!altSet) return null;
      const tiebreak = set.tiebreak ?? altSet.tiebreak;
      const baza = `${set.value}-${altSet.value}`;
      return tiebreak !== undefined ? `${baza}(${tiebreak})` : baza;
    })
    .filter((s): s is string => s !== null)
    .join(", ");
}

interface EspnMatch {
  id: string;
  date: string;
  status: { type: { state: string; name: string } };
  round?: { displayName: string };
  competitors: EspnAthleteCompetitor[];
}

interface EspnTournament {
  name: string;
  groupings: Array<{
    grouping: { slug: string };
    competitions: EspnMatch[];
  }>;
}

function mapStatus(state: string, name: string): Eveniment["status"] {
  if (name?.includes("POSTPONED") || name?.includes("CANCELED")) return "amanat";
  return STATUS_MAP[state] ?? "programat";
}

async function obtineClasament(sursa: "atp" | "wta"): Promise<Map<string, number>> {
  const harta = new Map<string, number>();
  try {
    const res = await fetchEspn(`https://site.api.espn.com/apis/site/v2/sports/tennis/${sursa}/rankings`);
    const data = await res.json();
    const ranks = data.rankings?.[0]?.ranks ?? [];
    for (const r of ranks) harta.set(r.athlete.id, r.current);
  } catch {
    // ok, harta goală - fallback pe curatedRank per meci
  }
  return harta;
}

async function obtineTurnee(sursa: "atp" | "wta", dataYYYYMMDD: string): Promise<EspnTournament[]> {
  const res = await fetchEspn(`https://site.api.espn.com/apis/site/v2/sports/tennis/${sursa}/scoreboard?dates=${dataYYYYMMDD}`);
  const data = await res.json();
  return Array.isArray(data.events) ? data.events : [];
}

function mapMatch(
  match: EspnMatch,
  turneu: string,
  sursa: "atp" | "wta",
  clasament: Map<string, number>
): Eveniment | null {
  const acasa = match.competitors.find((c) => c.homeAway === "home");
  const oaspete = match.competitors.find((c) => c.homeAway === "away");
  if (!acasa || !oaspete) return null;

  const rankAcasa = acasa.curatedRank?.current ?? clasament.get(acasa.athlete.id) ?? null;
  const rankOaspete = oaspete.curatedRank?.current ?? clasament.get(oaspete.athlete.id) ?? null;
  const status = mapStatus(match.status.type.state, match.status.type.name);
  const scorSeturi = status !== "programat" ? formateazaScorSeturi(acasa, oaspete) : null;

  const extra: Record<string, unknown> = {};
  if (rankAcasa !== null || rankOaspete !== null) extra.ranking = { acasa: rankAcasa, oaspete: rankOaspete };
  if (scorSeturi) extra.scor = scorSeturi;

  return {
    id: `espn:${match.id}`,
    sursa: "espn",
    sport: "tenis",
    competitie: turneu,
    cod_competitie: sursa,
    faza: match.round?.displayName ?? null,
    participanti: [acasa.athlete.displayName, oaspete.athlete.displayName],
    start_utc: match.date,
    status,
    extra,
  };
}

async function colecteazaSursa(
  sursa: "atp" | "wta",
  dataRoTinta: string
): Promise<{ evenimente: Eveniment[]; stare: StareSursa }> {
  const bazaYYYYMMDD = yyyymmddDinDataRo(dataRoTinta);
  const zileDeInterogat = [
    deplaseazaYYYYMMDD(bazaYYYYMMDD, -1),
    bazaYYYYMMDD,
    deplaseazaYYYYMMDD(bazaYYYYMMDD, 1),
  ];

  try {
    const [listeTurnee, clasament] = await Promise.all([
      Promise.all(zileDeInterogat.map((zi) => obtineTurnee(sursa, zi))),
      obtineClasament(sursa),
    ]);

    const meciuriBrute = new Map<string, Eveniment>();
    for (const turnee of listeTurnee) {
      for (const turneu of turnee) {
        const singles = turneu.groupings.filter(
          (g) => g.grouping.slug === "mens-singles" || g.grouping.slug === "womens-singles"
        );
        for (const grupare of singles) {
          for (const match of grupare.competitions) {
            const ev = mapMatch(match, turneu.name, sursa, clasament);
            if (ev) meciuriBrute.set(ev.id, ev);
          }
        }
      }
    }

    const evenimente = Array.from(meciuriBrute.values()).filter(
      (e) => dataRoFromUtc(e.start_utc) === dataRoTinta
    );

    return { evenimente, stare: { ok: true, evenimente: evenimente.length } };
  } catch (err) {
    return { evenimente: [], stare: { ok: false, evenimente: 0, eroare: String(err) } };
  }
}

/** dataRoTinta: ziua țintă, format YYYY-MM-DD, în Europe/Bucharest */
export async function colecteazaTenisEspn(dataRoTinta: string) {
  const [atp, wta] = await Promise.all([
    colecteazaSursa("atp", dataRoTinta),
    colecteazaSursa("wta", dataRoTinta),
  ]);

  return {
    evenimente: [...atp.evenimente, ...wta.evenimente],
    stareSurse: {
      "espn-tenis:atp": atp.stare,
      "espn-tenis:wta": wta.stare,
    } as Record<string, StareSursa>,
  };
}
