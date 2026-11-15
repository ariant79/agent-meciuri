import type { DistributieScor } from "@/lib/predictii/modele/poisson-fotbal";
import type { PredictieSelectie } from "@/lib/predictii/tipuri";

/**
 * piața "handicap_<handicapAcasa>": handicap asiatic cu linie pe .5 (fără push posibil), din
 * perspectiva echipei de acasă — ex. handicapAcasa=-1.5 înseamnă acasă trebuie să câștige cu
 * 2+ goluri ca să acopere. Selecția "oaspete" e echivalentă matematic cu +1.5 pentru oaspete
 * (aceeași linie, cotată din cealaltă parte) — nu se dublează ca piață separată.
 */
export function construiestePiataHandicap(distributie: DistributieScor, handicapAcasa: number): PredictieSelectie[] {
  let acasa = 0;
  let oaspete = 0;
  const { probabilitati } = distributie;
  for (let ga = 0; ga < probabilitati.length; ga++) {
    for (let go = 0; go < probabilitati[ga].length; go++) {
      const p = probabilitati[ga][go];
      if (ga - go + handicapAcasa > 0) acasa += p;
      else oaspete += p;
    }
  }
  return [
    { piata: `handicap_${handicapAcasa}`, selectie: "acasa", probabilitate: acasa },
    { piata: `handicap_${handicapAcasa}`, selectie: "oaspete", probabilitate: oaspete },
  ];
}
