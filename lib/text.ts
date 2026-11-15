const DIACRITIC_MIN = 0x0300;
const DIACRITIC_MAX = 0x036f;

/** fără diacritice, lowercase, fără cratime/puncte — potrivire robustă de nume între surse diferite */
export function normalizeazaText(text: string): string {
  return text
    .normalize("NFD")
    .split("")
    .filter((ch) => {
      const cod = ch.codePointAt(0) ?? 0;
      return cod < DIACRITIC_MIN || cod > DIACRITIC_MAX;
    })
    .join("")
    .toLowerCase()
    .replace(/[-.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
