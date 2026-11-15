/**
 * Backtest walk-forward al modelului Poisson de fotbal: pentru o listă de ferestre candidate
 * (sezoane), simulează re-estimarea periodică a ratingurilor strict pe meciuri anterioare
 * (fără look-ahead) și evaluează predicțiile pe ultimele SEZOANE_TEST sezoane din cache-ul
 * local, per ligă și piață (1X2, total goluri 2.5). Re-estimarea se face o dată per lot de
 * MARIME_LOT_TEST meciuri (nu meci-cu-meci), ca aproximare a recalculării zilnice — suficient
 * de fin pentru a evita look-ahead semnificativ, suficient de grosier ca runtime-ul să fie
 * practic. Nu rulează pe Vercel.
 *
 * Rulare: npm run backtest:fotbal
 */
import fotbalConfig from "@/config/fotbal.json";
import { incarcaIstoricFootballData, SEZOANE_IMPLICITE } from "@/lib/predictii/football-data";
import { estimeazaRatinguri, lambdaMeci, distributieScor } from "@/lib/predictii/modele/poisson-fotbal";
import { construiestePiata1x2 } from "@/lib/predictii/piete/1x2-fotbal";
import { construiestePiataTotalGoluri } from "@/lib/predictii/piete/total-goluri";
import type { MeciIstoricFotbal } from "@/lib/predictii/tipuri";

const FERESTRE_CANDIDATE = [2, 3, 4]; // sezoane
const MARIME_LOT_TEST = 30;
const SEZOANE_TEST = 2;

function rezultat1x2(golAcasa: number, golOaspete: number): "acasa" | "egal" | "oaspete" {
  if (golAcasa > golOaspete) return "acasa";
  if (golAcasa < golOaspete) return "oaspete";
  return "egal";
}
function rezultatTotalGoluri(golAcasa: number, golOaspete: number): "peste" | "sub" {
  return golAcasa + golOaspete >= 3 ? "peste" : "sub";
}
function brier(p: number, corect: boolean): number {
  return (p - (corect ? 1 : 0)) ** 2;
}
function logLoss(p: number, corect: boolean): number {
  return -Math.log(corect ? p : 1 - p);
}
function filtreazaFereastraZile(meciuri: MeciIstoricFotbal[], dataLimitaInf: string, dataLimitaSup: string): MeciIstoricFotbal[] {
  return meciuri.filter((m) => m.data >= dataLimitaInf && m.data < dataLimitaSup);
}

async function main() {
  console.log("Încarc istoricul football-data.co.uk...");
  const toateMeciurile = await incarcaIstoricFootballData(SEZOANE_IMPLICITE);
  console.log(`Total meciuri: ${toateMeciurile.length}`);

  const dataLimitaTest = new Date();
  dataLimitaTest.setFullYear(dataLimitaTest.getFullYear() - SEZOANE_TEST);
  const dataLimitaTestISO = dataLimitaTest.toISOString().slice(0, 10);

  for (const codLiga of Object.keys(fotbalConfig.ligi_acoperite)) {
    const meciuriLiga = toateMeciurile.filter((m) => m.liga === codLiga).sort((a, b) => a.data.localeCompare(b.data));
    const meciuriTest = meciuriLiga.filter((m) => m.data >= dataLimitaTestISO);
    if (meciuriTest.length === 0) {
      console.log(`${codLiga}: niciun meci de test, sar peste.`);
      continue;
    }
    console.log(`\n${codLiga}: ${meciuriTest.length} meciuri de test`);

    for (const fereastraSezoane of FERESTRE_CANDIDATE) {
      let suma1x2Brier = 0;
      let suma1x2LogLoss = 0;
      let sumaTotalBrier = 0;
      let sumaTotalLogLoss = 0;
      let nrEvaluate = 0;

      for (let i = 0; i < meciuriTest.length; i += MARIME_LOT_TEST) {
        const lot = meciuriTest.slice(i, i + MARIME_LOT_TEST);
        const dataLot = lot[0].data;
        const limitaFereastra = new Date(dataLot);
        limitaFereastra.setFullYear(limitaFereastra.getFullYear() - fereastraSezoane);
        const limitaFereastraISO = limitaFereastra.toISOString().slice(0, 10);

        const meciuriTrain = filtreazaFereastraZile(meciuriLiga, limitaFereastraISO, dataLot);
        if (meciuriTrain.length === 0) continue;
        const stare = estimeazaRatinguri(meciuriTrain);

        for (const m of lot) {
          const lambda = lambdaMeci(stare, m.echipaAcasaId, m.echipaOaspeteId);
          if (!lambda) continue; // echipă nou-promovată, fără istoric în fereastra de train

          const distributie = distributieScor(lambda.lambdaAcasa, lambda.lambdaOaspete);
          const rez1x2 = rezultat1x2(m.golAcasa, m.golOaspete);
          const rezTotal = rezultatTotalGoluri(m.golAcasa, m.golOaspete);

          for (const s of construiestePiata1x2(distributie)) {
            suma1x2Brier += brier(s.probabilitate, s.selectie === rez1x2);
            if (s.selectie === rez1x2) suma1x2LogLoss += logLoss(s.probabilitate, true);
          }
          for (const s of construiestePiataTotalGoluri(distributie, 2.5)) {
            sumaTotalBrier += brier(s.probabilitate, s.selectie === rezTotal);
            if (s.selectie === rezTotal) sumaTotalLogLoss += logLoss(s.probabilitate, true);
          }
          nrEvaluate++;
        }
      }

      if (nrEvaluate === 0) {
        console.log(`  fereastră ${fereastraSezoane} sezoane: niciun meci evaluat`);
        continue;
      }
      console.log(
        `  fereastră ${fereastraSezoane} sezoane (${nrEvaluate} meciuri): ` +
          `1X2 brier=${(suma1x2Brier / nrEvaluate).toFixed(4)} logloss=${(suma1x2LogLoss / nrEvaluate).toFixed(4)} · ` +
          `total2.5 brier=${(sumaTotalBrier / nrEvaluate).toFixed(4)} logloss=${(sumaTotalLogLoss / nrEvaluate).toFixed(4)}`
      );
    }
  }

  console.log("\nActualizează manual config/fotbal.json -> fereastra_sezoane cu valoarea cu cel mai mic log-loss mediu (însumat pe ligi și piețe).");
}

main();
