/**
 * Backtest Elo tenis: antrenare cronologică 2015-2023, evaluare 2024-2026.
 * Ratingul folosit la fiecare predicție e strict cel dinaintea meciului (walk-forward).
 *
 * Rulare: npx tsx scripts/backtest-elo-tenis.ts
 * (necesită data/sackmann/ populat — npx tsx scripts/descarca-date-tenis.ts)
 */
import { incarcaIstoricSackmann } from "@/lib/predictii/sackmann";
import { creeazaStare, predictieCastigator, actualizeazaMeci } from "@/lib/predictii/modele/elo-tenis";
import type { Suprafata } from "@/lib/predictii/tipuri";

const AN_LIMITA_TEST = 2024; // 2015-2023 = antrenare, 2024-2026 = evaluare

function anDinDataISO(dataISO: string): number {
  return Number(dataISO.slice(0, 4));
}

interface RandEvaluare {
  tur: "atp" | "wta";
  suprafata: Suprafata;
  pX: number; // probabilitatea Elo ca "X" (jucătorul cu id-ul mai mic alfabetic) să câștige
  outcomeX: 0 | 1; // a câștigat X?
  baselineCorect: boolean | null; // "câștigă jucătorul mai bine clasat" — null dacă lipsește un rank
}

function clipProb(p: number): number {
  return Math.min(Math.max(p, 1e-6), 1 - 1e-6);
}

async function main() {
  console.log("Încarc meciurile Sackmann (2015-2026)...");
  const meciuri = await incarcaIstoricSackmann();
  console.log(`Total meciuri (ATP+WTA, tur+Slam+Finals, inclusiv calificări): ${meciuri.length}`);

  const stare = creeazaStare();
  const evaluari: RandEvaluare[] = [];
  let ignorateWalkover = 0;

  for (const meci of meciuri) {
    const an = anDinDataISO(meci.dataISO);

    if (meci.walkover) {
      ignorateWalkover++;
      continue; // nu se actualizează ratingul, nu se evaluează
    }

    if (an >= AN_LIMITA_TEST) {
      // X = jucătorul cu id mai mic alfabetic — alegere arbitrară, independentă de rezultat (altfel calibrarea e circulară)
      const xEsteCastigator = meci.castigatorId < meci.invinsId;
      const xId = xEsteCastigator ? meci.castigatorId : meci.invinsId;
      const altId = xEsteCastigator ? meci.invinsId : meci.castigatorId;
      const { pA: pX } = predictieCastigator(stare, xId, altId, meci.suprafata);

      const rankX = xEsteCastigator ? meci.castigatorRankCsv : meci.invinsRankCsv;
      const rankAlt = xEsteCastigator ? meci.invinsRankCsv : meci.castigatorRankCsv;
      const baselineCorect =
        rankX !== null && rankAlt !== null && rankX !== rankAlt
          ? (rankX < rankAlt) === xEsteCastigator
          : null;

      evaluari.push({
        tur: meci.tur,
        suprafata: meci.suprafata,
        pX: clipProb(pX),
        outcomeX: xEsteCastigator ? 1 : 0,
        baselineCorect,
      });
    }

    actualizeazaMeci(stare, meci.castigatorId, meci.invinsId, meci.suprafata);
  }

  console.log(`Walkover/retragere-înainte-de-start ignorate (fără actualizare rating): ${ignorateWalkover}`);
  console.log(`Meciuri evaluate (2024-2026): ${evaluari.length}\n`);

  raporteazaSegment("TOTAL", evaluari);
  for (const tur of ["atp", "wta"] as const) {
    raporteazaSegment(tur.toUpperCase(), evaluari.filter((e) => e.tur === tur));
  }
  for (const suprafata of ["hard", "clay", "grass"] as const) {
    raporteazaSegment(`suprafață=${suprafata}`, evaluari.filter((e) => e.suprafata === suprafata));
  }

  raporteazaCalibrare(evaluari);
}

function raporteazaSegment(eticheta: string, lista: RandEvaluare[]) {
  if (lista.length === 0) {
    console.log(`=== ${eticheta} (0 meciuri) ===\n`);
    return;
  }

  let corecte = 0;
  let sumaBrier = 0;
  let sumaLogLoss = 0;
  let baselineCorecte = 0;
  let baselineTotal = 0;

  for (const e of lista) {
    const predictieFavorizeazaX = e.pX >= 0.5;
    if (predictieFavorizeazaX === (e.outcomeX === 1)) corecte++;
    sumaBrier += (e.pX - e.outcomeX) ** 2;
    sumaLogLoss -= e.outcomeX === 1 ? Math.log(e.pX) : Math.log(1 - e.pX);
    if (e.baselineCorect !== null) {
      baselineTotal++;
      if (e.baselineCorect) baselineCorecte++;
    }
  }

  const n = lista.length;
  console.log(`=== ${eticheta} (${n} meciuri) ===`);
  console.log(`  acuratețe Elo:       ${((corecte / n) * 100).toFixed(2)}%`);
  console.log(`  Brier Elo:           ${(sumaBrier / n).toFixed(4)}`);
  console.log(`  log-loss Elo:        ${(sumaLogLoss / n).toFixed(4)}`);
  if (baselineTotal > 0) {
    const acuBaseline = baselineCorecte / baselineTotal;
    console.log(`  acuratețe baseline (rank mai bun câștigă): ${(acuBaseline * 100).toFixed(2)}% (${baselineTotal} meciuri cu rank pe ambii)`);
    console.log(`  Brier baseline (= 1 - acuratețe, pick determinist): ${(1 - acuBaseline).toFixed(4)}`);
  } else {
    console.log(`  baseline: fără date de rank`);
  }
  console.log();
}

function raporteazaCalibrare(lista: RandEvaluare[]) {
  const galeti: { n: number; sumaP: number; sumaOutcome: number }[] = Array.from({ length: 10 }, () => ({
    n: 0,
    sumaP: 0,
    sumaOutcome: 0,
  }));

  for (const e of lista) {
    const idx = Math.min(9, Math.floor(e.pX * 10));
    galeti[idx].n++;
    galeti[idx].sumaP += e.pX;
    galeti[idx].sumaOutcome += e.outcomeX;
  }

  console.log("=== Calibrare (bucket-uri de 10%, TOATE meciurile 2024-2026) ===");
  console.log("interval       n       prob. medie prezisă    frecvența reală de câștig");
  galeti.forEach((g, i) => {
    if (g.n === 0) {
      console.log(`${(i * 10).toString().padStart(3)}-${(i + 1) * 10}%     0       -                      -`);
      return;
    }
    const pMedie = ((g.sumaP / g.n) * 100).toFixed(1);
    const frecventa = ((g.sumaOutcome / g.n) * 100).toFixed(1);
    console.log(`${(i * 10).toString().padStart(3)}-${(i + 1) * 10}%   ${g.n.toString().padStart(5)}      ${pMedie.padStart(5)}%                 ${frecventa.padStart(5)}%`);
  });
}

main();
