import type { Eveniment, EvenimentScorat, ScorDetalii } from "@/lib/types";
import competitii from "@/config/competitii.json";
import rivalitati from "@/config/rivalitati.json";
import scorConfig from "@/config/scor.json";
import { esteNationale as esteNationaleCod } from "@/lib/national";

const DIACRITIC_MIN = 0x0300;
const DIACRITIC_MAX = 0x036f;

function normalizeaza(s: string): string {
  return s
    .normalize("NFD")
    .split("")
    .filter((ch) => {
      const cod = ch.codePointAt(0) ?? 0;
      return cod < DIACRITIC_MIN || cod > DIACRITIC_MAX;
    })
    .join("")
    .toLowerCase()
    .trim();
}

function perechiEgale(a: [string, string], b: [string, string]): boolean {
  const [a1, a2] = a.map(normalizeaza);
  const [b1, b2] = b.map(normalizeaza);
  return (a1 === b1 && a2 === b2) || (a1 === b2 && a2 === b1);
}

interface IntrareRivalitate {
  eticheta?: string;
  echipe?: string[];
  jucatori?: string[];
  intensitate: number;
}

function gasesteRivalitate(participanti: [string, string], lista: IntrareRivalitate[]): IntrareRivalitate | null {
  for (const intrare of lista) {
    const perechea = (intrare.echipe ?? intrare.jucatori) as [string, string] | undefined;
    if (perechea && perechea.length === 2 && perechiEgale(participanti, perechea as [string, string])) {
      return intrare;
    }
  }
  return null;
}

function esteClubIstoric(nume: string): boolean {
  return rivalitati.cluburi_istorice.some((c) => normalizeaza(c) === normalizeaza(nume));
}

function esteNationalaIstorica(nume: string): boolean {
  return rivalitati.nationale_istorice.some((c) => normalizeaza(c) === normalizeaza(nume));
}

/** doar cupele europene inter-cluburi primesc eticheta "Nopți europene" */
const CODURI_NOPTI_EUROPENE = new Set(["uefa.champions", "uefa.europa", "uefa.europa.conf"]);

function esteNationale(ev: Eveniment): boolean {
  return esteNationaleCod(ev.sport, ev.cod_competitie);
}

/** "Liga A, grupa 2" -> "a" */
function ligaNationsLeague(faza: string | null): "a" | "b" | "c" | "d" | null {
  if (!faza) return null;
  const m = /^liga ([a-d]),/.exec(normalizeaza(faza));
  return (m?.[1] as "a" | "b" | "c" | "d") ?? null;
}

export type CheieFaza = keyof typeof scorConfig.faze;

/**
 * leagă textul liber de fază al ESPN (RO/EN) de cheile din config/scor.json → faze.
 * ordinea contează: verificată de sus în jos, prima regulă care se potrivește câștigă
 * (ex. "Qualifying Final" conține "final" dar trebuie prinsă de regula "qualif", nu de "final").
 */
const REGULI_FAZA: Array<[RegExp, CheieFaza]> = [
  [/qualif|play-?off|round of 32|\bround \d/, "tur_initial"],
  [/round of 16|rd of 16|optimi/, "optimi"],
  [/quarterfinal|sferturi/, "sferturi"],
  [/3rd-place|finala mica/, "semifinala"],
  [/semifinal/, "semifinala"],
  [/\bfinal\b/, "finala"],
  [/group|grupa|liga |faza ligii/, "grupe_tur_final"],
  [/etapa/, "etapa_campionat"],
];

export function cheieFaza(faza: string | null): CheieFaza {
  if (!faza) return "etapa_campionat";
  const f = normalizeaza(faza);
  for (const [regex, cheie] of REGULI_FAZA) {
    if (regex.test(f)) return cheie;
  }
  return "etapa_campionat";
}

/** valoarea numerică (0-100) din config/scor.json → faze pentru cheia corespunzătoare */
function valoareFaza(faza: string | null): number {
  return scorConfig.faze[cheieFaza(faza)];
}

interface InfoCompetitie {
  nivel: number;
  traditie: number;
  categorieNume?: string;
}

function infoCompetitieFotbal(cod: string): InfoCompetitie {
  const liga = competitii.fotbal.find((l) => l.cod === cod);
  return liga ? { nivel: liga.nivel, traditie: liga.traditie } : { nivel: 40, traditie: 40 };
}

const CATEGORIE_SCURT: Record<string, string> = {
  "Grand Slam": "Grand Slam",
  "Turneul Campionilor": "Finals",
  "Masters 1000 / WTA 1000": "Masters",
  "Echipe / Olimpiadă": "Echipe",
};

function infoCompetitieTenis(numeTurneu: string): InfoCompetitie {
  const numeNorm = normalizeaza(numeTurneu);
  for (const cat of competitii.tenis.categorii) {
    if (cat.potrivire.some((p) => numeNorm.includes(normalizeaza(p)))) {
      return { nivel: cat.nivel, traditie: cat.traditie, categorieNume: cat.categorie };
    }
  }
  const implicit = competitii.tenis.implicit;
  return { nivel: implicit.nivel, traditie: implicit.traditie, categorieNume: implicit.categorie };
}

function infoCompetitie(ev: Eveniment): InfoCompetitie {
  if (ev.sport === "fotbal") return infoCompetitieFotbal(ev.cod_competitie);
  if (ev.sport === "tenis") return infoCompetitieTenis(ev.competitie);
  const altul = competitii.altele.find((a) => a.liga === ev.cod_competitie);
  return altul ? { nivel: altul.nivel, traditie: altul.traditie } : { nivel: 40, traditie: 40 };
}

interface ContextFotbal {
  bonus: number;
  ambeleTop: boolean;
  luptaTitlu: boolean;
  luptaRetrogradare: boolean;
  rankAcasa: number | null;
  rankOaspete: number | null;
}

function contextFotbal(ev: Eveniment): ContextFotbal {
  const clasament = ev.extra?.clasament as { acasa: number | null; oaspete: number | null } | undefined;
  const cfg = scorConfig.fotbal;
  const rankAcasa = clasament?.acasa ?? null;
  const rankOaspete = clasament?.oaspete ?? null;

  if (rankAcasa === null || rankOaspete === null) {
    return { bonus: 0, ambeleTop: false, luptaTitlu: false, luptaRetrogradare: false, rankAcasa, rankOaspete };
  }

  const ambeleTop = rankAcasa <= cfg.top_n_clasament && rankOaspete <= cfg.top_n_clasament;
  // ponytail: nu avem mărimea exactă a ligii aici fără un fetch suplimentar;
  // aproximăm lupta de titlu/retrogradare doar din pozițiile din top/coadă apropiate.
  const luptaTitlu = rankAcasa <= 3 && rankOaspete <= 3 && Math.abs(rankAcasa - rankOaspete) <= 2;
  const luptaRetrogradare = rankAcasa >= 16 && rankOaspete >= 16 && Math.abs(rankAcasa - rankOaspete) <= 3;

  const bonus = ambeleTop
    ? cfg.bonus_top_vs_top
    : luptaTitlu || luptaRetrogradare
    ? cfg.bonus_lupta_titlu_retrogradare
    : 0;

  return { bonus, ambeleTop, luptaTitlu, luptaRetrogradare, rankAcasa, rankOaspete };
}

interface ContextTenis {
  bonus: number;
  ambiiTop: boolean;
  unulTop: boolean;
  rankAcasa: number | null;
  rankOaspete: number | null;
}

function contextTenis(ev: Eveniment): ContextTenis {
  const ranking = ev.extra?.ranking as { acasa: number | null; oaspete: number | null } | undefined;
  const cfg = scorConfig.tenis;
  const rankAcasa = ranking?.acasa ?? null;
  const rankOaspete = ranking?.oaspete ?? null;

  const acasaTop = rankAcasa !== null && rankAcasa <= cfg.top_ranking;
  const oaspeteTop = rankOaspete !== null && rankOaspete <= cfg.top_ranking;
  const ambiiTop = acasaTop && oaspeteTop;
  const unulTop = (acasaTop || oaspeteTop) && !ambiiTop;

  const bonus = ambiiTop ? cfg.bonus_ambii_top : unulTop ? cfg.bonus_unul_top : 0;
  return { bonus, ambiiTop, unulTop, rankAcasa, rankOaspete };
}

function bonusLigaNationsLeague(ev: Eveniment): number {
  if (ev.cod_competitie !== "uefa.nations") return 0;
  const liga = ligaNationsLeague(ev.faza);
  if (!liga) return 0;
  return (scorConfig.uefa_nations_liga_bonus as Record<string, number>)[liga] ?? 0;
}

function calculeazaValoare(ev: Eveniment, info: InfoCompetitie): { valoare: number; bonusContext: number } {
  const bazaFaza = valoareFaza(ev.faza);
  const bazaNivel = info.nivel;
  const bonusContext =
    (ev.sport === "fotbal" ? contextFotbal(ev).bonus : ev.sport === "tenis" ? contextTenis(ev).bonus : 0) +
    bonusLigaNationsLeague(ev);
  const valoare = Math.min(100, Math.round((bazaNivel + bazaFaza) / 2) + bonusContext);
  return { valoare, bonusContext };
}

function calculeazaRivalitate(ev: Eveniment): { rivalitate: number; intrare: IntrareRivalitate | null } {
  let lista: IntrareRivalitate[] = [];
  if (esteNationale(ev)) lista = rivalitati.nationale;
  else if (ev.sport === "fotbal") lista = rivalitati.fotbal;
  else if (ev.sport === "tenis") lista = rivalitati.tenis.perechi;
  else lista = rivalitati.altele;

  const intrare = gasesteRivalitate(ev.participanti, lista);
  return { rivalitate: intrare?.intensitate ?? 0, intrare };
}

function calculeazaTraditie(
  ev: Eveniment,
  info: InfoCompetitie
): { traditie: number; unClubIstoric: boolean; ambeleCluburiIstorice: boolean } {
  const verificaIstoric = esteNationale(ev) ? esteNationalaIstorica : esteClubIstoric;
  const istorice = ev.participanti.filter(verificaIstoric).length;
  const traditie = istorice > 0 ? Math.max(info.traditie, 100) : info.traditie;
  return { traditie, unClubIstoric: istorice > 0, ambeleCluburiIstorice: istorice === 2 };
}

function construiesteEtichete(
  ev: Eveniment,
  info: InfoCompetitie,
  rivalitate: { rivalitate: number; intrare: IntrareRivalitate | null },
  traditie: { traditie: number; unClubIstoric: boolean; ambeleCluburiIstorice: boolean },
  contextF: ContextFotbal | null,
  contextT: ContextTenis | null
): string[] {
  const etichete: string[] = [];
  const national = esteNationale(ev);

  if (national) {
    etichete.push("Naționale");
    if (rivalitate.intrare) etichete.push("Rivalitate");
  } else if (rivalitate.intrare?.eticheta) {
    etichete.push(rivalitate.intrare.eticheta);
  }

  if (contextF?.ambeleTop && contextF.rankAcasa !== null && contextF.rankOaspete !== null) {
    etichete.push(`${contextF.rankAcasa} vs ${contextF.rankOaspete}`);
  }
  if (contextF?.luptaTitlu) etichete.push("Luptă titlu");
  if (contextF?.luptaRetrogradare) etichete.push("Luptă retrogradare");

  if (contextT?.ambiiTop && contextT.rankAcasa !== null && contextT.rankOaspete !== null) {
    etichete.push(`Nr. ${contextT.rankAcasa} vs Nr. ${contextT.rankOaspete}`);
  }

  const faza = cheieFaza(ev.faza);
  if (faza === "finala") etichete.push("Finală");
  else if (faza === "semifinala") etichete.push("Semifinală");
  else if (faza === "sferturi") {
    const scurt = info.categorieNume ? CATEGORIE_SCURT[info.categorieNume] : undefined;
    etichete.push(scurt ? `Sferturi ${scurt}` : "Sferturi");
  }

  if (CODURI_NOPTI_EUROPENE.has(ev.cod_competitie)) etichete.push("Nopți europene");

  if (traditie.ambeleCluburiIstorice && !rivalitate.intrare && !national) etichete.push("Clasic");

  return Array.from(new Set(etichete));
}

export function calculeazaScor(ev: Eveniment): EvenimentScorat {
  const info = infoCompetitie(ev);
  const { valoare } = calculeazaValoare(ev, info);
  const rivalitate = calculeazaRivalitate(ev);
  const traditie = calculeazaTraditie(ev, info);

  const ponderi = scorConfig.ponderi;
  const scor = Math.round(valoare * ponderi.valoare + rivalitate.rivalitate * ponderi.rivalitate + traditie.traditie * ponderi.traditie);

  const contextF = ev.sport === "fotbal" ? contextFotbal(ev) : null;
  const contextT = ev.sport === "tenis" ? contextTenis(ev) : null;
  const etichete = construiesteEtichete(ev, info, rivalitate, traditie, contextF, contextT);

  const scor_detalii: ScorDetalii = { valoare, rivalitate: rivalitate.rivalitate, traditie: traditie.traditie };

  return { ...ev, scor, scor_detalii, etichete, selectat: false };
}

/** scorează toate evenimentele și marchează top-ul per sport conform config/scor.json → selectie + prag_minim */
/** "fotbal" și "tenis" au grupă proprie; orice alt sport (basketball, hockey, mma, ...) intră în grupa comună "altele" */
function grupaSelectie(sport: string): "fotbal" | "tenis" | "altele" {
  return sport === "fotbal" || sport === "tenis" ? sport : "altele";
}

export function clasifica(evenimente: Eveniment[]): EvenimentScorat[] {
  const scorate = evenimente.map(calculeazaScor);
  const pragMinim = scorConfig.prag_minim as Record<string, number>;
  const selectie = scorConfig.selectie as Record<string, number>;

  const peGrupa = new Map<string, EvenimentScorat[]>();
  for (const ev of scorate) {
    const g = grupaSelectie(ev.sport);
    if (!peGrupa.has(g)) peGrupa.set(g, []);
    peGrupa.get(g)!.push(ev);
  }

  for (const [grupa, lista] of peGrupa) {
    lista.sort((a, b) => b.scor - a.scor);
    const limita = grupa === "fotbal" ? selectie.fotbal : grupa === "tenis" ? selectie.tenis : selectie.altele;
    const prag = grupa === "fotbal" ? pragMinim.fotbal : grupa === "tenis" ? pragMinim.tenis : pragMinim.altele;
    const maxPerSport = grupa === "altele" ? selectie.altele_max_per_sport : Infinity;

    let selectate = 0;
    const perSport = new Map<string, number>();
    for (const ev of lista) {
      if (selectate >= limita) break;
      if (ev.scor < prag) break;
      const curent = perSport.get(ev.sport) ?? 0;
      if (curent >= maxPerSport) continue;
      ev.selectat = true;
      perSport.set(ev.sport, curent + 1);
      selectate++;
    }
  }

  return scorate;
}
