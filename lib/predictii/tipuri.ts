export type Suprafata = "hard" | "clay" | "grass";
export type DimensiuneRating = "general" | Suprafata;

/** un meci istoric normalizat, independent de sursă (Sackmann azi, poate ESPN mai târziu) */
export interface MeciIstoric {
  dataISO: string; // YYYY-MM-DD, informativ
  ordineSort: number; // cheie de sortare cronologică (an*lună*zi + ordinea rundei)
  tur: "atp" | "wta";
  suprafata: Suprafata;
  castigatorId: string;
  invinsId: string;
  castigatorNume: string;
  invinsNume: string;
  castigatorRankCsv: number | null;
  invinsRankCsv: number | null;
  /** walkover / retragere înainte de start — nu actualizează ratingul */
  walkover: boolean;
  /** rundă de calificări (Q1/Q2/Q3), pentru raportul cu/fără calificări */
  esteCalificare: boolean;
}

/**
 * o selecție dintr-o piață de pariere, cu probabilitatea ei.
 * selecțiile aceleiași piețe (același eveniment+model+piata) trebuie să însumeze 1.
 */
export interface PredictieSelectie {
  piata: string;
  selectie: string;
  probabilitate: number;
}

/** un meci istoric de fotbal normalizat, independent de sursă (football-data.co.uk azi, poate ESPN mai târziu) */
export interface MeciIstoricFotbal {
  data: string; // YYYY-MM-DD
  liga: string; // cod competiție ESPN (ex. "eng.1")
  echipaAcasaId: string;
  echipaOaspeteId: string;
  echipaAcasaNume: string;
  echipaOaspeteNume: string;
  golAcasa: number;
  golOaspete: number;
}
