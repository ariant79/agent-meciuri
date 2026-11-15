import type { DistributieScor } from "@/lib/predictii/modele/poisson-fotbal";
import type { PredictieSelectie } from "@/lib/predictii/tipuri";

/** piața "ambele_marcheaza": da/nu, derivată din grila de probabilități a scorului */
export function construiestePiataAmbeleMarcheaza(distributie: DistributieScor): PredictieSelectie[] {
  let da = 0;
  let nu = 0;
  const { probabilitati } = distributie;
  for (let ga = 0; ga < probabilitati.length; ga++) {
    for (let go = 0; go < probabilitati[ga].length; go++) {
      const p = probabilitati[ga][go];
      if (ga >= 1 && go >= 1) da += p;
      else nu += p;
    }
  }
  return [
    { piata: "ambele_marcheaza", selectie: "da", probabilitate: da },
    { piata: "ambele_marcheaza", selectie: "nu", probabilitate: nu },
  ];
}
