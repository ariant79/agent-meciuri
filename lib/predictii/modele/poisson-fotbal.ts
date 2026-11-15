export interface RatingEchipa {
  atac: number;
  aparare: number;
  nrMeciuri: number;
}

export interface StarePoisson {
  avantajGazda: number;
  ratinguri: Map<string, RatingEchipa>;
}

export interface RezultatMeciPoisson {
  echipaAcasaId: string;
  echipaOaspeteId: string;
  golAcasa: number;
  golOaspete: number;
}

const ITERATII_MAX = 200;
const PRAG_CONVERGENTA = 1e-6;
const GOLURI_MIN = 1e-6; // evită log(0) pentru echipe cu 0 goluri marcate/primite în fereastră

/**
 * estimează ratingurile de atac/apărare per echipă + avantajul de gazdă al ligii, prin
 * coordinate-ascent (iterative proportional fitting) pe modelul Poisson (Maher):
 *   λ_acasa = exp(atac_acasa - aparare_oaspete + avantajGazda)
 *   λ_oaspete = exp(atac_oaspete - aparare_acasa)
 * Fiecare coordonată are o formulă MLE închisă dată celelalte fixe (derivata log-verosimilității
 * Poisson e liniară în parametrul respectiv), deci nu e nevoie de inversare de matrice Hessiană —
 * mult mai simplu decât Newton-Raphson multivariat, la fel de riguros (crește verosimilitatea la
 * fiecare pas). Parametrizarea are un grad de libertate redundant (atac_i+c, aparare_i+c pentru
 * toate echipele simultan dă aceleași λ) — recentrăm la fiecare tură ca să nu deriveze numeric.
 */
export function estimeazaRatinguri(meciuri: RezultatMeciPoisson[]): StarePoisson {
  const echipe = new Set<string>();
  const nrMeciuri = new Map<string, number>();
  for (const m of meciuri) {
    echipe.add(m.echipaAcasaId);
    echipe.add(m.echipaOaspeteId);
    nrMeciuri.set(m.echipaAcasaId, (nrMeciuri.get(m.echipaAcasaId) ?? 0) + 1);
    nrMeciuri.set(m.echipaOaspeteId, (nrMeciuri.get(m.echipaOaspeteId) ?? 0) + 1);
  }

  const atac = new Map<string, number>(Array.from(echipe, (id) => [id, 0]));
  const aparare = new Map<string, number>(Array.from(echipe, (id) => [id, 0]));
  let avantajGazda = 0;

  for (let iter = 0; iter < ITERATII_MAX; iter++) {
    let schimbareMaxima = 0;

    for (const id of echipe) {
      let goluriReale = 0;
      let sumaExp = 0;
      for (const m of meciuri) {
        if (m.echipaAcasaId === id) {
          goluriReale += m.golAcasa;
          sumaExp += Math.exp(-aparare.get(m.echipaOaspeteId)! + avantajGazda);
        } else if (m.echipaOaspeteId === id) {
          goluriReale += m.golOaspete;
          sumaExp += Math.exp(-aparare.get(m.echipaAcasaId)!);
        }
      }
      const nouAtac = Math.log(Math.max(goluriReale, GOLURI_MIN) / sumaExp);
      schimbareMaxima = Math.max(schimbareMaxima, Math.abs(nouAtac - atac.get(id)!));
      atac.set(id, nouAtac);
    }

    for (const id of echipe) {
      let goluriPrimite = 0;
      let sumaExp = 0;
      for (const m of meciuri) {
        if (m.echipaAcasaId === id) {
          goluriPrimite += m.golOaspete;
          sumaExp += Math.exp(atac.get(m.echipaOaspeteId)!);
        } else if (m.echipaOaspeteId === id) {
          goluriPrimite += m.golAcasa;
          sumaExp += Math.exp(atac.get(m.echipaAcasaId)! + avantajGazda);
        }
      }
      const nouaAparare = Math.log(sumaExp / Math.max(goluriPrimite, GOLURI_MIN));
      schimbareMaxima = Math.max(schimbareMaxima, Math.abs(nouaAparare - aparare.get(id)!));
      aparare.set(id, nouaAparare);
    }

    {
      let goluriAcasaReale = 0;
      let sumaExp = 0;
      for (const m of meciuri) {
        goluriAcasaReale += m.golAcasa;
        sumaExp += Math.exp(atac.get(m.echipaAcasaId)! - aparare.get(m.echipaOaspeteId)!);
      }
      const nouAvantaj = Math.log(Math.max(goluriAcasaReale, GOLURI_MIN) / sumaExp);
      schimbareMaxima = Math.max(schimbareMaxima, Math.abs(nouAvantaj - avantajGazda));
      avantajGazda = nouAvantaj;
    }

    // recentrare: atac_i - aparare_j e invariant la shift comun -> previne driftul numeric
    const mediaAtac = Array.from(atac.values()).reduce((s, v) => s + v, 0) / echipe.size;
    for (const id of echipe) {
      atac.set(id, atac.get(id)! - mediaAtac);
      aparare.set(id, aparare.get(id)! - mediaAtac);
    }

    if (schimbareMaxima < PRAG_CONVERGENTA) break;
  }

  const ratinguri = new Map<string, RatingEchipa>();
  for (const id of echipe) {
    ratinguri.set(id, { atac: atac.get(id)!, aparare: aparare.get(id)!, nrMeciuri: nrMeciuri.get(id)! });
  }
  return { avantajGazda, ratinguri };
}

export function lambdaMeci(
  stare: StarePoisson,
  echipaAcasaId: string,
  echipaOaspeteId: string
): { lambdaAcasa: number; lambdaOaspete: number } | null {
  const acasa = stare.ratinguri.get(echipaAcasaId);
  const oaspete = stare.ratinguri.get(echipaOaspeteId);
  if (!acasa || !oaspete) return null;
  return {
    lambdaAcasa: Math.exp(acasa.atac - oaspete.aparare + stare.avantajGazda),
    lambdaOaspete: Math.exp(oaspete.atac - acasa.aparare),
  };
}

export const MAX_GOLURI_GRILA = 12; // coada reziduală <1e-8 pentru λ realiste de fotbal (vezi test suma~1)

function factorial(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function poissonPmf(lambda: number, k: number): number {
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
}

export interface DistributieScor {
  /** probabilitati[golAcasa][golOaspete] */
  probabilitati: number[][];
}

/** grilă de probabilități peste toate scorurile posibile (0..MAX_GOLURI_GRILA pentru fiecare echipă) */
export function distributieScor(lambdaAcasa: number, lambdaOaspete: number): DistributieScor {
  const probAcasa = Array.from({ length: MAX_GOLURI_GRILA + 1 }, (_, k) => poissonPmf(lambdaAcasa, k));
  const probOaspete = Array.from({ length: MAX_GOLURI_GRILA + 1 }, (_, k) => poissonPmf(lambdaOaspete, k));
  return { probabilitati: probAcasa.map((pa) => probOaspete.map((po) => pa * po)) };
}
