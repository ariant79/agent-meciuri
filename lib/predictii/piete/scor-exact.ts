import type { DistributieScor } from "@/lib/predictii/modele/poisson-fotbal";
import type { PredictieSelectie } from "@/lib/predictii/tipuri";

const NR_SCORURI = 5;

/** piața "scor_exact": top NR_SCORURI cele mai probabile scoruri exacte, din grila de probabilități */
export function construiestePiataScorExact(distributie: DistributieScor): PredictieSelectie[] {
  const candidati: PredictieSelectie[] = [];
  const { probabilitati } = distributie;
  for (let ga = 0; ga < probabilitati.length; ga++) {
    for (let go = 0; go < probabilitati[ga].length; go++) {
      candidati.push({ piata: "scor_exact", selectie: `${ga}-${go}`, probabilitate: probabilitati[ga][go] });
    }
  }
  candidati.sort((a, b) => b.probabilitate - a.probabilitate);
  return candidati.slice(0, NR_SCORURI);
}
