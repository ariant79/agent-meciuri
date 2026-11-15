import type { DistributieScor } from "@/lib/predictii/modele/poisson-fotbal";
import type { PredictieSelectie } from "@/lib/predictii/tipuri";

/** piața "total_goluri_<linie>": peste/sub, derivată din grila de probabilități a scorului */
export function construiestePiataTotalGoluri(distributie: DistributieScor, linie: number): PredictieSelectie[] {
  let peste = 0;
  let sub = 0;
  const { probabilitati } = distributie;
  for (let ga = 0; ga < probabilitati.length; ga++) {
    for (let go = 0; go < probabilitati[ga].length; go++) {
      const p = probabilitati[ga][go];
      if (ga + go > linie) peste += p;
      else sub += p;
    }
  }
  return [
    { piata: `total_goluri_${linie}`, selectie: "peste", probabilitate: peste },
    { piata: `total_goluri_${linie}`, selectie: "sub", probabilitate: sub },
  ];
}
