/**
 * ESPN (API neoficială) poate răspunde temporar 403 sub rafale de cereri (observat empiric:
 * ~450 cereri în câteva minute au declanșat blocarea). O rulare zilnică normală (~60-70 cereri)
 * e mult sub acel prag, dar reîncercăm scurt ca rularea să nu pice la un 403 trecător.
 */
export async function fetchEspn(url: string, incercari = 2): Promise<Response> {
  let ultimaEroare: unknown;
  for (let i = 0; i <= incercari; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      ultimaEroare = new Error(`HTTP ${res.status}`);
    } catch (err) {
      ultimaEroare = err;
    }
    if (i < incercari) await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  throw ultimaEroare;
}
