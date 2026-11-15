import type { PredictieSelectie } from "@/lib/predictii/tipuri";

/**
 * piața "câștigător": derivă cele două selecții (p1/p2) dintr-o probabilitate de model.
 * p1 = primul participant (acasă), p2 = al doilea (oaspete) — convenția folosită deja în Eveniment.participanti.
 */
export function construiestePiataCastigator(pP1: number, pP2: number): PredictieSelectie[] {
  return [
    { piata: "castigator", selectie: "p1", probabilitate: pP1 },
    { piata: "castigator", selectie: "p2", probabilitate: pP2 },
  ];
}
