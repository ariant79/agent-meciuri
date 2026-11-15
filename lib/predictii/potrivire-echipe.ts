import { normalizeazaText } from "@/lib/text";

export interface RezultatPotrivireEchipa {
  echipaId: string | null;
  sursaPotrivire: "alias" | "nume" | null;
}

/**
 * potrivește un nume de echipă ESPN cu echipa_id canonic (football-data.co.uk): întâi alias
 * explicit (echipe_alias), apoi nume normalizat exact (din ratinguri_fotbal.nume). Fără
 * potrivire aproximativă — un fals pozitiv ar strica ratingul unei echipe nelegate.
 */
export function gasesteEchipaId(
  numeEspn: string,
  aliasuri: Map<string, string>,
  echipeCunoscute: Map<string, string>
): RezultatPotrivireEchipa {
  const normalizat = normalizeazaText(numeEspn);

  const dinAlias = aliasuri.get(normalizat);
  if (dinAlias) return { echipaId: dinAlias, sursaPotrivire: "alias" };

  const dinNume = echipeCunoscute.get(normalizat);
  if (dinNume) return { echipaId: dinNume, sursaPotrivire: "nume" };

  return { echipaId: null, sursaPotrivire: null };
}
