/**
 * Validare + reglaj Elo tenis, fără să ne uităm la setul de test:
 *   - antrenare 2015-2021, validare 2022-2023, test 2024-2026
 *   - grid search pe validare (K, pondere suprafață); temperature scaling fitat pe validare
 *   - raport final pe test: Elo reglat vs. regresie logistică pe rank vs. baseline 0/1 vechi
 *
 * Rulare: npx tsx scripts/reglaj-elo-tenis.ts
 */
import { incarcaIstoricSackmann } from "@/lib/predictii/sackmann";
import { creeazaStare, actualizeazaMeci, predictieCastigator, type ParametriElo } from "@/lib/predictii/modele/elo-tenis";
import { antreneazaLogistic, predictieLogistic, type ModelLogistic } from "@/lib/predictii/modele/logistic-rank";
import { aplicaTemperatura, fiteazaTemperatura } from "@/lib/predictii/temperatura";
import type { MeciIstoric, Suprafata } from "@/lib/predictii/tipuri";

const AN_TRAIN_START = 2015;
const AN_TRAIN_END = 2021;
const AN_VAL_START = 2022;
const AN_VAL_END = 2023;
const AN_TEST_START = 2024;
const AN_TEST_END = 2026;

function anDin(dataISO: string): number {
  return Number(dataISO.slice(0, 4));
}

function clip(p: number): number {
  return Math.min(Math.max(p, 1e-9), 1 - 1e-9);
}

interface Evaluare {
  meci: MeciIstoric;
  xEsteCastigator: boolean;
  pXEloRaw: number;
}

/** replay cronologic al listei date; evaluează (fără lookahead) meciurile din [anStart,anEnd], actualizează mereu */
function ruleazaElo(meciuri: MeciIstoric[], params: ParametriElo, anEvalStart: number, anEvalEnd: number): Evaluare[] {
  const stare = creeazaStare();
  const evaluari: Evaluare[] = [];

  for (const m of meciuri) {
    const an = anDin(m.dataISO);
    if (an >= anEvalStart && an <= anEvalEnd) {
      const xEsteCastigator = m.castigatorId < m.invinsId;
      const xId = xEsteCastigator ? m.castigatorId : m.invinsId;
      const altId = xEsteCastigator ? m.invinsId : m.castigatorId;
      const { pA } = predictieCastigator(stare, xId, altId, m.suprafata, params);
      evaluari.push({ meci: m, xEsteCastigator, pXEloRaw: clip(pA) });
    }
    actualizeazaMeci(stare, m.castigatorId, m.invinsId, m.suprafata, params);
  }

  return evaluari;
}

interface Metrici {
  n: number;
  acuratete: number;
  brier: number;
  logLoss: number;
}

function calculeazaMetrici(p: number[], outcome: number[]): Metrici {
  let corecte = 0;
  let brier = 0;
  let logLoss = 0;
  for (let i = 0; i < p.length; i++) {
    const pi = p[i];
    const oi = outcome[i];
    if (pi >= 0.5 === (oi === 1)) corecte++;
    brier += (pi - oi) ** 2;
    const pc = clip(pi);
    logLoss -= oi === 1 ? Math.log(pc) : Math.log(1 - pc);
  }
  const n = p.length;
  return { n, acuratete: corecte / n, brier: brier / n, logLoss: logLoss / n };
}

function formateazaMetrici(m: Metrici): string {
  return `n=${m.n.toString().padStart(6)}  acuratețe=${(m.acuratete * 100).toFixed(2)}%  Brier=${m.brier.toFixed(4)}  log-loss=${m.logLoss.toFixed(4)}`;
}

// ---------- grid search ----------

const GRID = {
  k_baza: [150, 200, 250, 300, 350],
  k_offset: [2, 5, 10, 20],
  k_exponent: [0.3, 0.4, 0.5, 0.6],
  pondere_suprafata: [0.2, 0.35, 0.5, 0.65, 0.8],
};

interface RezultatGrid {
  params: ParametriElo;
  brier: number;
  evaluari: Evaluare[];
}

function grideazaElo(meciuriTrainVal: MeciIstoric[]): RezultatGrid {
  let best: RezultatGrid | null = null;
  let incercari = 0;

  for (const k_baza of GRID.k_baza) {
    for (const k_offset of GRID.k_offset) {
      for (const k_exponent of GRID.k_exponent) {
        for (const pondere_suprafata of GRID.pondere_suprafata) {
          incercari++;
          const params: ParametriElo = { rating_initial: 1500, k_baza, k_offset, k_exponent, pondere_suprafata };
          const evaluari = ruleazaElo(meciuriTrainVal, params, AN_VAL_START, AN_VAL_END);
          const brier = evaluari.reduce((s, e) => s + (e.pXEloRaw - (e.xEsteCastigator ? 1 : 0)) ** 2, 0) / evaluari.length;
          if (!best || brier < best.brier) best = { params, brier, evaluari };
        }
      }
    }
  }

  console.log(`Grid search: ${incercari} combinații testate pe validare (${AN_VAL_START}-${AN_VAL_END}).`);
  return best!;
}

function verificaRatingInitialEsteInert(meciuriTrainVal: MeciIstoric[], paramsFaraInitial: Omit<ParametriElo, "rating_initial">) {
  const brieruri = [1000, 1500, 2000].map((rating_initial) => {
    const evaluari = ruleazaElo(meciuriTrainVal, { ...paramsFaraInitial, rating_initial }, AN_VAL_START, AN_VAL_END);
    return evaluari.reduce((s, e) => s + (e.pXEloRaw - (e.xEsteCastigator ? 1 : 0)) ** 2, 0) / evaluari.length;
  });
  const toateEgale = Math.abs(brieruri[0] - brieruri[2]) < 1e-9;
  console.log(
    `Verificare rating_initial (1000/1500/2000) cu restul parametrilor fixați: Brier = ${brieruri.map((b) => b.toFixed(6)).join(" / ")}` +
      (toateEgale
        ? " — identic (până la eroarea de rotunjire în virgulă mobilă), cum era de așteptat: e doar o constantă aditivă, se anulează în diferențele de rating."
        : " — diferă mai mult decât rotunjirea float, neașteptat, de investigat.")
  );
}

// ---------- logistic baseline ----------

function construiesteSetLogistic(meciuri: MeciIstoric[]): { x: number[]; y: number[]; refs: Evaluare[] } {
  const x: number[] = [];
  const y: number[] = [];
  const refs: Evaluare[] = [];
  for (const m of meciuri) {
    if (!m.castigatorRankCsv || !m.invinsRankCsv) continue;
    const xEsteCastigator = m.castigatorId < m.invinsId;
    const rankX = xEsteCastigator ? m.castigatorRankCsv : m.invinsRankCsv;
    const rankAlt = xEsteCastigator ? m.invinsRankCsv : m.castigatorRankCsv;
    x.push(Math.log(rankAlt) - Math.log(rankX));
    y.push(xEsteCastigator ? 1 : 0);
    refs.push({ meci: m, xEsteCastigator, pXEloRaw: NaN });
  }
  return { x, y, refs };
}

// ---------- raport pe segmente ----------

function segmenteaza(evaluari: Evaluare[]) {
  return {
    TOTAL: evaluari,
    ATP: evaluari.filter((e) => e.meci.tur === "atp"),
    WTA: evaluari.filter((e) => e.meci.tur === "wta"),
    hard: evaluari.filter((e) => e.meci.suprafata === "hard"),
    clay: evaluari.filter((e) => e.meci.suprafata === "clay"),
    grass: evaluari.filter((e) => e.meci.suprafata === "grass"),
    "fără calificări": evaluari.filter((e) => !e.meci.esteCalificare),
    "doar calificări": evaluari.filter((e) => e.meci.esteCalificare),
  };
}

function raporteazaSegmente(
  evaluariTest: Evaluare[],
  modelLogistic: ModelLogistic,
  temperatura: number
): void {
  const segmente = segmenteaza(evaluariTest);

  for (const [nume, lista] of Object.entries(segmente)) {
    if (lista.length === 0) {
      console.log(`\n=== ${nume} (0 meciuri) ===`);
      continue;
    }
    const outcome = lista.map((e) => (e.xEsteCastigator ? 1 : 0));
    const pEloRaw = lista.map((e) => e.pXEloRaw);
    const pEloTemp = lista.map((e) => aplicaTemperatura(e.pXEloRaw, temperatura));
    const pLogistic = lista.map((e) => {
      const rankX = e.xEsteCastigator ? e.meci.castigatorRankCsv! : e.meci.invinsRankCsv!;
      const rankAlt = e.xEsteCastigator ? e.meci.invinsRankCsv! : e.meci.castigatorRankCsv!;
      return predictieLogistic(modelLogistic, Math.log(rankAlt) - Math.log(rankX));
    });
    const pBaseline01 = lista.map((e) => {
      const rankX = e.xEsteCastigator ? e.meci.castigatorRankCsv! : e.meci.invinsRankCsv!;
      const rankAlt = e.xEsteCastigator ? e.meci.invinsRankCsv! : e.meci.castigatorRankCsv!;
      return rankX < rankAlt ? 1 : 0;
    });

    console.log(`\n=== ${nume} (${lista.length} meciuri, toate cu rank CSV cunoscut pe ambii) ===`);
    console.log(`  Elo (reglat, brut):      ${formateazaMetrici(calculeazaMetrici(pEloRaw, outcome))}`);
    console.log(`  Elo (reglat + temp=${temperatura.toFixed(2)}): ${formateazaMetrici(calculeazaMetrici(pEloTemp, outcome))}`);
    console.log(`  Regresie logistică/rank: ${formateazaMetrici(calculeazaMetrici(pLogistic, outcome))}`);
    console.log(`  Baseline vechi (0/1):    ${formateazaMetrici(calculeazaMetrici(pBaseline01, outcome))}`);
  }
}

function raporteazaCalibrare(titlu: string, p: number[], outcome: number[]) {
  const galeti = Array.from({ length: 10 }, () => ({ n: 0, sumaP: 0, sumaOutcome: 0 }));
  for (let i = 0; i < p.length; i++) {
    const idx = Math.min(9, Math.floor(p[i] * 10));
    galeti[idx].n++;
    galeti[idx].sumaP += p[i];
    galeti[idx].sumaOutcome += outcome[i];
  }
  console.log(`\n=== Calibrare: ${titlu} ===`);
  console.log("interval       n    prob. medie    frecvență reală");
  galeti.forEach((g, i) => {
    if (g.n === 0) {
      console.log(`${(i * 10).toString().padStart(3)}-${(i + 1) * 10}%     0      -              -`);
      return;
    }
    console.log(
      `${(i * 10).toString().padStart(3)}-${(i + 1) * 10}%   ${g.n.toString().padStart(5)}    ${((g.sumaP / g.n) * 100).toFixed(1).padStart(5)}%        ${((g.sumaOutcome / g.n) * 100).toFixed(1).padStart(5)}%`
    );
  });
}

async function main() {
  console.log("Încarc meciurile Sackmann (2015-2026)...");
  const toate = await incarcaIstoricSackmann();
  const fara_wo = toate.filter((m) => !m.walkover);
  console.log(`Total (fără walkover): ${fara_wo.length}`);

  const trainVal = fara_wo.filter((m) => anDin(m.dataISO) <= AN_VAL_END); // 2015-2023
  const testSet = fara_wo.filter((m) => anDin(m.dataISO) >= AN_TEST_START); // 2024-2026
  console.log(`Antrenare+validare (${AN_TRAIN_START}-${AN_VAL_END}): ${trainVal.length}`);
  console.log(`Test (${AN_TEST_START}-${AN_TEST_END}): ${testSet.length}\n`);

  // 1. verificare rating_initial (folosind valorile implicite pentru restul, înainte de grid search)
  verificaRatingInitialEsteInert(trainVal, { k_baza: 250, k_offset: 5, k_exponent: 0.4, pondere_suprafata: 0.5 });

  // 2. grid search pe validare (2022-2023)
  const rezultatGrid = grideazaElo(trainVal);
  console.log(`\nCei mai buni parametri (Brier pe validare = ${rezultatGrid.brier.toFixed(4)}):`);
  console.log(`  ${JSON.stringify(rezultatGrid.params)}`);

  // 3. temperature scaling, fitat pe aceleași predicții de validare ale combinației câștigătoare
  const pValRaw = rezultatGrid.evaluari.map((e) => e.pXEloRaw);
  const outcomeVal = rezultatGrid.evaluari.map((e) => (e.xEsteCastigator ? 1 : 0));
  const temperatura = fiteazaTemperatura(pValRaw, outcomeVal);
  console.log(`\nTemperatură fitată pe validare: T = ${temperatura.toFixed(3)}`);
  raporteazaCalibrare("validare, ÎNAINTE de temperature scaling", pValRaw, outcomeVal);
  raporteazaCalibrare(
    "validare, DUPĂ temperature scaling",
    pValRaw.map((p) => aplicaTemperatura(p, temperatura)),
    outcomeVal
  );

  // 4. regresie logistică, antrenată pe 2015-2023 (train+val, ca în cerință)
  const setLogisticTrain = construiesteSetLogistic(trainVal);
  const modelLogistic = antreneazaLogistic(setLogisticTrain.x, setLogisticTrain.y);
  console.log(`\nRegresie logistică (antrenată pe ${AN_TRAIN_START}-${AN_VAL_END}, n=${setLogisticTrain.x.length}):`);
  console.log(`  intercept=${modelLogistic.intercept.toFixed(4)}  pantă=${modelLogistic.panta.toFixed(4)}`);

  // 5. evaluare finală pe test (2024-2026), cu parametrii aleși prin grid search — replay complet 2015-2026
  const evaluariTestBrute = ruleazaElo(fara_wo, rezultatGrid.params, AN_TEST_START, AN_TEST_END);
  const evaluariTest = evaluariTestBrute.filter((e) => e.meci.castigatorRankCsv && e.meci.invinsRankCsv);
  console.log(
    `\n\n########## RAPORT FINAL PE TEST (${AN_TEST_START}-${AN_TEST_END}), doar meciuri cu rank CSV cunoscut pe ambii: ${evaluariTest.length}/${evaluariTestBrute.length} ##########`
  );
  raporteazaSegmente(evaluariTest, modelLogistic, temperatura);

  const pTestRaw = evaluariTest.map((e) => e.pXEloRaw);
  const outcomeTest = evaluariTest.map((e) => (e.xEsteCastigator ? 1 : 0));
  raporteazaCalibrare(`TEST (${AN_TEST_START}-${AN_TEST_END}), ÎNAINTE de temperature scaling`, pTestRaw, outcomeTest);
  raporteazaCalibrare(
    `TEST (${AN_TEST_START}-${AN_TEST_END}), DUPĂ temperature scaling`,
    pTestRaw.map((p) => aplicaTemperatura(p, temperatura)),
    outcomeTest
  );

  // 6. verdict
  const metriciEloTemp = calculeazaMetrici(pTestRaw.map((p) => aplicaTemperatura(p, temperatura)), outcomeTest);
  const pLogisticTest = evaluariTest.map((e) => {
    const rankX = e.xEsteCastigator ? e.meci.castigatorRankCsv! : e.meci.invinsRankCsv!;
    const rankAlt = e.xEsteCastigator ? e.meci.invinsRankCsv! : e.meci.castigatorRankCsv!;
    return predictieLogistic(modelLogistic, Math.log(rankAlt) - Math.log(rankX));
  });
  const metriciLogistic = calculeazaMetrici(pLogisticTest, outcomeTest);

  console.log(`\n\n########## VERDICT (TOTAL, test) ##########`);
  console.log(`Elo reglat + temp: Brier=${metriciEloTemp.brier.toFixed(4)}  log-loss=${metriciEloTemp.logLoss.toFixed(4)}`);
  console.log(`Regresie logistică: Brier=${metriciLogistic.brier.toFixed(4)}  log-loss=${metriciLogistic.logLoss.toFixed(4)}`);

  const bateBrier = metriciEloTemp.brier < metriciLogistic.brier;
  const bateLogLoss = metriciEloTemp.logLoss < metriciLogistic.logLoss;
  if (bateBrier && bateLogLoss) {
    console.log(`\n✅ Elo reglat bate reperul logistic pe AMBELE (Brier și log-loss). Se poate trece la aplicare.`);
  } else {
    console.log(
      `\n❌ Elo reglat NU bate reperul logistic pe ${!bateBrier ? "Brier" : ""}${!bateBrier && !bateLogLoss ? " și " : ""}${!bateLogLoss ? "log-loss" : ""}. Ne oprim aici.`
    );
  }

  console.log(`\nParametri finali recomandați: ${JSON.stringify({ ...rezultatGrid.params, temperatura })}`);
}

main();
