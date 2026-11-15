/** temperature scaling (Guo et al. 2017): corectează supraîncrederea fără să schimbe ordinea predicțiilor */

function logit(p: number): number {
  const clipat = Math.min(Math.max(p, 1e-9), 1 - 1e-9);
  return Math.log(clipat / (1 - clipat));
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

/** T > 1 atenuează încrederea (trage spre 0.5); T < 1 o accentuează; T = 1 = neschimbat */
export function aplicaTemperatura(p: number, temperatura: number): number {
  return sigmoid(logit(p) / temperatura);
}

function logLossMediu(probabilitati: number[], outcomes: number[], temperatura: number): number {
  let suma = 0;
  for (let i = 0; i < probabilitati.length; i++) {
    const pT = Math.min(Math.max(aplicaTemperatura(probabilitati[i], temperatura), 1e-9), 1 - 1e-9);
    suma -= outcomes[i] === 1 ? Math.log(pT) : Math.log(1 - pT);
  }
  return suma / probabilitati.length;
}

/** căutare ternară pe T ∈ [0.3, 4] care minimizează log-loss — NLL(T) e convexă aici */
export function fiteazaTemperatura(probabilitati: number[], outcomes: number[]): number {
  let lo = 0.3;
  let hi = 4.0;
  for (let i = 0; i < 60; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (logLossMediu(probabilitati, outcomes, m1) < logLossMediu(probabilitati, outcomes, m2)) {
      hi = m2;
    } else {
      lo = m1;
    }
  }
  return (lo + hi) / 2;
}
