/** reper probabilistic: regresie logistică pe log(rank_B) - log(rank_A) */

export interface ModelLogistic {
  intercept: number;
  panta: number;
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

/**
 * antrenează regresia logistică 1D (Newton-Raphson/IRLS) pentru P(y=1) = sigmoid(intercept + panta*x).
 * converge în câteva iterații — log-verosimilitatea e concavă pentru regresie logistică.
 */
export function antreneazaLogistic(x: number[], y: number[], iteratiiMax = 50): ModelLogistic {
  let b0 = 0;
  let b1 = 0;

  for (let it = 0; it < iteratiiMax; it++) {
    let g0 = 0;
    let g1 = 0;
    let h00 = 0;
    let h01 = 0;
    let h11 = 0;

    for (let i = 0; i < x.length; i++) {
      const p = sigmoid(b0 + b1 * x[i]);
      const eroare = p - y[i];
      g0 += eroare;
      g1 += eroare * x[i];
      const w = p * (1 - p);
      h00 += w;
      h01 += w * x[i];
      h11 += w * x[i] * x[i];
    }

    const det = h00 * h11 - h01 * h01;
    if (Math.abs(det) < 1e-12) break;

    const delta0 = (h11 * g0 - h01 * g1) / det;
    const delta1 = (h00 * g1 - h01 * g0) / det;
    b0 -= delta0;
    b1 -= delta1;

    if (Math.abs(delta0) < 1e-10 && Math.abs(delta1) < 1e-10) break;
  }

  return { intercept: b0, panta: b1 };
}

export function predictieLogistic(model: ModelLogistic, x: number): number {
  return sigmoid(model.intercept + model.panta * x);
}
