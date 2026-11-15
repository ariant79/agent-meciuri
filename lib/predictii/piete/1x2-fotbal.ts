import type { DistributieScor } from "@/lib/predictii/modele/poisson-fotbal";
import type { PredictieSelectie } from "@/lib/predictii/tipuri";

/** piața "1x2_fotbal": acasă/egal/oaspete, derivată din grila de probabilități a scorului */
export function construiestePiata1x2(distributie: DistributieScor): PredictieSelectie[] {
  let acasa = 0;
  let egal = 0;
  let oaspete = 0;
  const { probabilitati } = distributie;
  for (let ga = 0; ga < probabilitati.length; ga++) {
    for (let go = 0; go < probabilitati[ga].length; go++) {
      const p = probabilitati[ga][go];
      if (ga > go) acasa += p;
      else if (ga < go) oaspete += p;
      else egal += p;
    }
  }
  return [
    { piata: "1x2_fotbal", selectie: "acasa", probabilitate: acasa },
    { piata: "1x2_fotbal", selectie: "egal", probabilitate: egal },
    { piata: "1x2_fotbal", selectie: "oaspete", probabilitate: oaspete },
  ];
}
