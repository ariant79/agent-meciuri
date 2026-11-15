import predictiiConfig from "@/config/predictii.json";
import type { DimensiuneRating, Suprafata } from "@/lib/predictii/tipuri";

const DIMENSIUNI: DimensiuneRating[] = ["general", "hard", "clay", "grass"];

interface IntrareRating {
  rating: number;
  nrMeciuri: number;
}

export type RatinguriJucator = Record<DimensiuneRating, IntrareRating>;

/** starea Elo: rating general + pe suprafață pentru fiecare jucător, ținută în memorie */
export type StareElo = Map<string, RatinguriJucator>;

export function creeazaStare(): StareElo {
  return new Map();
}

function intrareInitiala(): IntrareRating {
  return { rating: predictiiConfig.elo.rating_initial, nrMeciuri: 0 };
}

function obtineJucator(stare: StareElo, jucatorId: string): RatinguriJucator {
  let intrari = stare.get(jucatorId);
  if (!intrari) {
    intrari = {
      general: intrareInitiala(),
      hard: intrareInitiala(),
      clay: intrareInitiala(),
      grass: intrareInitiala(),
    };
    stare.set(jucatorId, intrari);
  }
  return intrari;
}

/** K dinamic, stil FiveThirtyEight: scade cu experiența jucătorului pe acea dimensiune */
function calculeazaK(nrMeciuri: number): number {
  const { k_baza, k_offset, k_exponent } = predictiiConfig.elo;
  return k_baza / Math.pow(nrMeciuri + k_offset, k_exponent);
}

function probabilitateElo(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/** ratingul folosit la predicție: 0.5 × general + 0.5 × suprafață (ponderea e configurabilă) */
export function ratingPredictie(stare: StareElo, jucatorId: string, suprafata: Suprafata): number {
  const intrari = obtineJucator(stare, jucatorId);
  const pondere = predictiiConfig.elo.pondere_suprafata;
  return pondere * intrari[suprafata].rating + (1 - pondere) * intrari.general.rating;
}

/** probabilitatea de câștig a lui A împotriva lui B, pe o suprafață dată, folosind doar ratingul dinaintea meciului */
export function predictieCastigator(
  stare: StareElo,
  jucatorAId: string,
  jucatorBId: string,
  suprafata: Suprafata
): { pA: number; pB: number } {
  const rA = ratingPredictie(stare, jucatorAId, suprafata);
  const rB = ratingPredictie(stare, jucatorBId, suprafata);
  const pA = probabilitateElo(rA, rB);
  return { pA, pB: 1 - pA };
}

/**
 * actualizează ratingul general și pe suprafață după un meci terminat.
 * walkover-urile nu trebuie trimise aici (vezi MeciIstoric.walkover) — abandonul în timpul meciului se actualizează normal.
 */
export function actualizeazaMeci(stare: StareElo, castigatorId: string, invinsId: string, suprafata: Suprafata): void {
  const dimensiuni: DimensiuneRating[] = ["general", suprafata];
  for (const dim of dimensiuni) {
    const castigator = obtineJucator(stare, castigatorId)[dim];
    const invins = obtineJucator(stare, invinsId)[dim];

    const eCastigator = probabilitateElo(castigator.rating, invins.rating);
    const kCastigator = calculeazaK(castigator.nrMeciuri);
    const kInvins = calculeazaK(invins.nrMeciuri);

    castigator.rating += kCastigator * (1 - eCastigator);
    invins.rating -= kInvins * (1 - eCastigator);

    castigator.nrMeciuri += 1;
    invins.nrMeciuri += 1;
  }
}

export function ratinguriJucator(stare: StareElo, jucatorId: string): RatinguriJucator {
  return obtineJucator(stare, jucatorId);
}

export const DIMENSIUNI_RATING = DIMENSIUNI;

export interface RandRatingDb {
  jucator_id: string;
  suprafata: DimensiuneRating;
  rating: number;
  nr_meciuri: number;
}

/** reconstituie starea Elo din rândurile salvate în Supabase (tabela ratinguri) */
export function incarcaStareDinRanduri(randuri: RandRatingDb[]): StareElo {
  const stare: StareElo = new Map();
  for (const r of randuri) {
    const intrari = obtineJucator(stare, r.jucator_id);
    intrari[r.suprafata] = { rating: r.rating, nrMeciuri: r.nr_meciuri };
  }
  return stare;
}
