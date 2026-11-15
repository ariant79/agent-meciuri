import { normalizeazaText } from "@/lib/text";

/** fără diacritice, lowercase, fără cratime/puncte (cf. PREDICTII.md) */
export const normalizeazaNumeJucator = normalizeazaText;

export interface RezultatPotrivireNume {
  jucatorId: string | null;
  sursaPotrivire: "alias" | "nume" | null;
}

/**
 * potrivește un nume ESPN cu un jucător Sackmann: întâi alias explicit (jucatori_alias),
 * apoi nume normalizat exact (din ratinguri.nume). Fără potrivire aproximativă — un fals
 * pozitiv ar strica ratingul unui jucător nelegat.
 */
export function gasesteJucatorId(
  numeEspn: string,
  aliasuri: Map<string, string>,
  jucatoriCunoscuti: Map<string, string>
): RezultatPotrivireNume {
  const normalizat = normalizeazaNumeJucator(numeEspn);

  const dinAlias = aliasuri.get(normalizat);
  if (dinAlias) return { jucatorId: dinAlias, sursaPotrivire: "alias" };

  const dinNume = jucatoriCunoscuti.get(normalizat);
  if (dinNume) return { jucatorId: dinNume, sursaPotrivire: "nume" };

  return { jucatorId: null, sursaPotrivire: null };
}
