import type { Eveniment, StareSursa } from "@/lib/types";
import { dataRoFromUtc, deplaseazaYYYYMMDD, yyyymmddDinDataRo } from "@/lib/date";
import competitii from "@/config/competitii.json";

const STATUS_MAP: Record<string, Eveniment["status"]> = {
  pre: "programat",
  in: "live",
  post: "terminat",
};

interface EspnEvent {
  id: string;
  date: string;
  competitions: Array<{
    status: { type: { state: string; name: string } };
    group?: { name: string };
    competitors: Array<{ homeAway: "home" | "away"; score?: string; team: { id: string; displayName: string } }>;
  }>;
}

interface IntrareCalendar {
  label: string;
  startDate: string;
  endDate: string;
}

function mapStatus(state: string, name: string): Eveniment["status"] {
  if (name?.includes("POSTPONED")) return "amanat";
  return STATUS_MAP[state] ?? "programat";
}

/** ligile cu clasament clasic de campionat (nu cupe/turnee pe echipe naționale) */
function esteCampionat(cod: string): boolean {
  return cod.endsWith(".1");
}

const ETICHETE_FAZA: Record<string, string> = {
  "League Phase": "Faza ligii",
  "Knockout Round Playoffs": "Play-off optimi",
  "Round of 32": "16-imi de finală",
  "Rd of 16": "Optimi de finală",
  Quarterfinals: "Sferturi de finală",
  Semifinals: "Semifinală",
  Final: "Finală",
  "3rd-Place Match": "Finala mică",
  "Relegation Playoffs": "Play-off retrogradare",
};

function extrageCalendar(raw: any): IntrareCalendar[] {
  const cal = raw?.leagues?.[0]?.calendar;
  if (!Array.isArray(cal)) return [];
  return cal.flatMap((c: any) => (Array.isArray(c.entries) ? c.entries : []));
}

/** "Group C2" (Nations League: liga C, grupa 2) / "Group H" (grupă clasică) */
function numeGrupa(grup: string): string {
  const ligaNations = /^Group ([A-D])(\d+)$/.exec(grup);
  if (ligaNations) return `Liga ${ligaNations[1]}, grupa ${ligaNations[2]}`;
  const simplu = /^Group (.+)$/.exec(grup);
  return simplu ? `Grupa ${simplu[1]}` : grup;
}

function determinaFaza(ev: EspnEvent, cod: string, calendar: IntrareCalendar[]): string | null {
  const comp = ev.competitions[0];
  if (comp.group?.name) return numeGrupa(comp.group.name);

  const momentEv = new Date(ev.date).getTime();
  const intrare = calendar.find(
    (e) => momentEv >= new Date(e.startDate).getTime() && momentEv <= new Date(e.endDate).getTime()
  );
  if (intrare) return ETICHETE_FAZA[intrare.label] ?? intrare.label;

  return esteCampionat(cod) ? "Etapă de campionat" : null;
}

interface EntryClasament {
  team: { id: string };
  stats: Array<{ name: string; value: number }>;
}

function adunaIntrariClasament(nod: any): EntryClasament[] {
  const out: EntryClasament[] = [];
  if (nod?.standings?.entries) out.push(...nod.standings.entries);
  if (Array.isArray(nod?.children)) for (const copil of nod.children) out.push(...adunaIntrariClasament(copil));
  return out;
}

async function obtineClasament(cod: string): Promise<Map<string, number> | null> {
  try {
    const res = await fetch(`https://site.api.espn.com/apis/v2/sports/soccer/${cod}/standings`);
    if (!res.ok) return null;
    const data = await res.json();
    const intrari = adunaIntrariClasament(data);
    const harta = new Map<string, number>();
    intrari.forEach((e, i) => {
      const rankStat = e.stats?.find((s) => s.name === "rank");
      harta.set(e.team.id, typeof rankStat?.value === "number" ? rankStat.value : i + 1);
    });
    return harta.size > 0 ? harta : null;
  } catch {
    return null;
  }
}

function mapEvent(
  ev: EspnEvent,
  cod: string,
  nume: string,
  calendar: IntrareCalendar[],
  clasament: Map<string, number> | null
): Eveniment | null {
  const comp = ev.competitions?.[0];
  if (!comp) return null;
  const compAcasa = comp.competitors.find((c) => c.homeAway === "home");
  const compOaspete = comp.competitors.find((c) => c.homeAway === "away");
  const echipaAcasa = compAcasa?.team;
  const echipaOaspete = compOaspete?.team;
  if (!echipaAcasa || !echipaOaspete) return null;

  const extra: Record<string, unknown> = {};
  if (clasament) {
    extra.clasament = {
      acasa: clasament.get(echipaAcasa.id) ?? null,
      oaspete: clasament.get(echipaOaspete.id) ?? null,
    };
  }
  if (compAcasa?.score !== undefined && compOaspete?.score !== undefined) {
    extra.scor = [compAcasa.score, compOaspete.score];
  }

  return {
    id: `espn:${ev.id}`,
    sursa: "espn",
    sport: "fotbal",
    competitie: nume,
    cod_competitie: cod,
    faza: determinaFaza(ev, cod, calendar),
    participanti: [echipaAcasa.displayName, echipaOaspete.displayName],
    start_utc: ev.date,
    status: mapStatus(comp.status.type.state, comp.status.type.name),
    extra,
  };
}

async function obtineScoreboard(cod: string, dataYYYYMMDD: string): Promise<{ events: EspnEvent[]; raw: any }> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${cod}/scoreboard?dates=${dataYYYYMMDD}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return { events: Array.isArray(data.events) ? data.events : [], raw: data };
}

/**
 * dataRoTinta: ziua țintă, format YYYY-MM-DD, în Europe/Bucharest.
 * Se cer la ESPN ziua țintă ± 1 zi (meciurile de noapte pot cădea în altă zi UTC/locală ESPN),
 * apoi se filtrează după data reală în Europe/Bucharest calculată din start_utc.
 */
async function colecteazaLiga(
  cod: string,
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
    const [raspunsuri, clasament] = await Promise.all([
      Promise.all(zileDeInterogat.map((zi) => obtineScoreboard(cod, zi))),
      esteCampionat(cod) ? obtineClasament(cod) : Promise.resolve(null),
    ]);

    const calendar = raspunsuri.map((r) => extrageCalendar(r.raw)).find((c) => c.length > 0) ?? [];

    const evenimenteBrute = new Map<string, EspnEvent>();
    raspunsuri.flatMap((r) => r.events).forEach((ev) => evenimenteBrute.set(ev.id, ev));

    const evenimente = Array.from(evenimenteBrute.values())
      .map((ev) => mapEvent(ev, cod, nume, calendar, clasament))
      .filter((e): e is Eveniment => e !== null)
      .filter((e) => dataRoFromUtc(e.start_utc) === dataRoTinta);

    return { evenimente, stare: { ok: true, evenimente: evenimente.length } };
  } catch (err) {
    return { evenimente: [], stare: { ok: false, evenimente: 0, eroare: String(err) } };
  }
}

/** dataRoTinta: ziua țintă, format YYYY-MM-DD, în Europe/Bucharest */
export async function colecteazaFotbalEspn(dataRoTinta: string) {
  const ligiActive = competitii.fotbal.filter((liga: { activ?: boolean }) => liga.activ !== false);

  const rezultate = await Promise.all(
    ligiActive.map((liga) => colecteazaLiga(liga.cod, liga.nume, dataRoTinta))
  );

  const evenimente = rezultate.flatMap((r) => r.evenimente);
  const stareSurse: Record<string, StareSursa> = {};
  ligiActive.forEach((liga, i) => {
    stareSurse[`espn-fotbal:${liga.cod}`] = rezultate[i].stare;
  });

  return { evenimente, stareSurse };
}
