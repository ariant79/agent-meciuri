const FORMATTER_RO = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest" });

/** YYYY-MM-DD, ziua curentă în Europe/Bucharest */
export function azi(): string {
  return FORMATTER_RO.format(new Date());
}

/** YYYY-MM-DD în Europe/Bucharest pentru un moment UTC dat */
export function dataRoFromUtc(iso: string): string {
  return FORMATTER_RO.format(new Date(iso));
}

/** deplasează o dată YYYYMMDD cu `zile` (poate fi negativ), fără interpretare de fus orar */
export function deplaseazaYYYYMMDD(dataYYYYMMDD: string, zile: number): string {
  const an = Number(dataYYYYMMDD.slice(0, 4));
  const luna = Number(dataYYYYMMDD.slice(4, 6));
  const zi = Number(dataYYYYMMDD.slice(6, 8));
  const d = new Date(Date.UTC(an, luna - 1, zi + zile));
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

export function yyyymmddDinDataRo(dataRo: string): string {
  return dataRo.replace(/-/g, "");
}

function dataRoDinYYYYMMDD(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

/** deplasează o dată YYYY-MM-DD cu `zile` (poate fi negativ) */
export function deplaseazaDataRo(dataRo: string, zile: number): string {
  return dataRoDinYYYYMMDD(deplaseazaYYYYMMDD(yyyymmddDinDataRo(dataRo), zile));
}

/** ora în Europe/Bucharest, format HH:mm, pentru un moment UTC dat */
export function oraRoFromUtc(iso: string): string {
  return new Intl.DateTimeFormat("ro-RO", {
    timeZone: "Europe/Bucharest",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}
