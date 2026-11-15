export type Sursa = "espn" | "football-data";
export type Status = "programat" | "live" | "terminat" | "amanat";

export interface Eveniment {
  id: string;
  sursa: Sursa;
  sport: string;
  competitie: string;
  cod_competitie: string;
  faza: string | null;
  participanti: [string, string];
  start_utc: string;
  status: Status;
  extra: Record<string, unknown>;
}

export interface ScorDetalii {
  valoare: number;
  rivalitate: number;
  traditie: number;
}

export interface EvenimentScorat extends Eveniment {
  scor: number;
  scor_detalii: ScorDetalii;
  etichete: string[];
  selectat: boolean;
}

export interface StareSursa {
  ok: boolean;
  evenimente: number;
  eroare?: string;
}
