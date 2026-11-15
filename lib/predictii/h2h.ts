/**
 * Head-to-head agregat (victorii/jucător), NU istoric meci-cu-meci — suficient pentru
 * "X conduce N-M" pe pagina de detaliu. Vezi docs/superpowers/specs/2026-11-15-pagina-detaliu-meci-design.md.
 */

export interface RandH2hDb {
  jucator_id_1: string;
  jucator_id_2: string;
  victorii_1: number;
  victorii_2: number;
  ultimul_meci: string | null;
}

/** id-ul mai mic alfabetic primul — aceeași convenție ca restul lui lib/predictii/ */
export function ordineCanonica(idA: string, idB: string): [string, string] {
  return idA < idB ? [idA, idB] : [idB, idA];
}

/** rândul h2h actualizat după o victorie, pornind de la rândul existent (sau null dacă e prima întâlnire) */
export function incrementeazaH2h(
  randExistent: RandH2hDb | null,
  castigatorId: string,
  invinsId: string,
  dataMeciISO: string
): RandH2hDb {
  const [id1, id2] = ordineCanonica(castigatorId, invinsId);
  const victorii_1 = (randExistent?.victorii_1 ?? 0) + (castigatorId === id1 ? 1 : 0);
  const victorii_2 = (randExistent?.victorii_2 ?? 0) + (castigatorId === id2 ? 1 : 0);
  return { jucator_id_1: id1, jucator_id_2: id2, victorii_1, victorii_2, ultimul_meci: dataMeciISO };
}

/** orientează un rând h2h (sau lipsa lui) relativ la (idA, idB), indiferent de ordinea canonică din DB */
export function orienteazaH2h(
  rand: RandH2hDb | null,
  idA: string,
  idB: string
): { victoriiA: number; victoriiB: number; ultimulMeci: string | null } {
  if (!rand) return { victoriiA: 0, victoriiB: 0, ultimulMeci: null };
  const [id1] = ordineCanonica(idA, idB);
  return idA === id1
    ? { victoriiA: rand.victorii_1, victoriiB: rand.victorii_2, ultimulMeci: rand.ultimul_meci }
    : { victoriiA: rand.victorii_2, victoriiB: rand.victorii_1, ultimulMeci: rand.ultimul_meci };
}

// --- replay în masă (doar pentru backfill — vezi scripts/backfill-tenis.ts) ---

export type StareH2h = Map<string, RandH2hDb>;

export function creeazaStareH2h(): StareH2h {
  return new Map();
}

function cheiePereche(id1: string, id2: string): string {
  return `${id1}|${id2}`;
}

export function actualizeazaH2hBulk(stare: StareH2h, castigatorId: string, invinsId: string, dataMeciISO: string): void {
  const [id1, id2] = ordineCanonica(castigatorId, invinsId);
  const existent = stare.get(cheiePereche(id1, id2)) ?? null;
  stare.set(cheiePereche(id1, id2), incrementeazaH2h(existent, castigatorId, invinsId, dataMeciISO));
}

export function randuriH2h(stare: StareH2h): RandH2hDb[] {
  return Array.from(stare.values());
}
