import { cheieFaza, type CheieFaza } from "@/clasificator";
import { esteNationale, numeNatiuneRo } from "@/lib/national";

export interface RandEvenimentDeBaza {
  sport: string;
  competitie: string;
  cod_competitie: string;
  faza: string | null;
  participant_1: string;
  participant_2: string;
  status: string;
  extra: Record<string, unknown> | null;
}

export interface Predictie {
  p1: number;
  p2: number;
}

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

export function numeSport(sport: string): string {
  return NUME_SPORT[sport] ?? "Alte sporturi";
}

export function afiseazaFaza(ev: RandEvenimentDeBaza): string | null {
  if (!ev.faza) return null;
  return ev.sport === "tenis" ? FAZA_RO[cheieFaza(ev.faza)] : ev.faza;
}

export function afiseazaParticipant(ev: RandEvenimentDeBaza, nume: string): string {
  return esteNationale(ev.sport, ev.cod_competitie) ? numeNatiuneRo(nume) : nume;
}

export function rezultatText(ev: RandEvenimentDeBaza): string | null {
  const scor = ev.extra?.scor;
  if (Array.isArray(scor)) return `${scor[0]} – ${scor[1]}`;
  if (typeof scor === "string") return scor;
  const castigator = ev.extra?.castigator;
  if (typeof castigator === "string") return `Câștigă ${afiseazaParticipant(ev, castigator)}`;
  return null;
}

/** indicator vizual de importanță, 1-3 puncte, derivat din scor (0-100) */
export function puncteImportanta(scor: number | null): number {
  if (scor === null) return 1;
  if (scor >= 70) return 3;
  if (scor >= 50) return 2;
  return 1;
}

/** cine e favoritul și, dacă meciul s-a terminat, dacă favoritul a câștigat */
export function evalueazaPredictieTenis(
  ev: RandEvenimentDeBaza,
  predictie: Predictie
): { favorizeazaP1: boolean; corect: boolean | null } {
  const favorizeazaP1 = predictie.p1 >= predictie.p2;
  const castigator = ev.extra?.castigator;
  const corect =
    ev.status === "terminat" && typeof castigator === "string" ? castigator === (favorizeazaP1 ? "p1" : "p2") : null;
  return { favorizeazaP1, corect };
}
