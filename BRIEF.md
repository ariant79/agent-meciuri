# Agent meciuri — brief de pornire

## Scop
Dashboard web, accesibil de oriunde, care arată în fiecare dimineață **meciurile importante de azi**:
- **Fotbal**: top meciuri ale zilei
- **Tenis**: top meciuri ATP + WTA
- **Alte sporturi**: 3–5 meciuri, alese automat (fără sporturi preferate) — cele cu scorul cel mai mare

„Important" = **valoare + rivalitate + tradiție**. Fiecare meci afișat are etichete care explică de ce e în top.

## Stack
- **Next.js (App Router) pe Vercel** — dashboard + rute API
- **Supabase (Postgres)** — meciuri, scoruri, jurnal rulări
- **Vercel Cron** — o rulare zilnică (~06:00–07:00 ora României) care apelează `/api/collect`; plus buton „Reîmprospătează" pe dashboard
- Fără LLM / Claude API — etichetele vin din reguli
- Toate orele stocate în UTC, afișate în `Europe/Bucharest`

## Arhitectură (module = „agenți")
```
/api/collect
  ├─ colectoare/        un modul per sursă+sport, toate întorc același format (Eveniment)
  │   ├─ espn-fotbal.ts      ligile din config/competitii.json
  │   ├─ espn-tenis.ts       tennis/atp, tennis/wta
  │   └─ espn-altele.ts      NBA, NHL, NFL, UFC, F1 etc. (listă în config)
  ├─ context/           clasamente (fotbal: ESPN standings; tenis: ranking)
  ├─ clasificator.ts    scor = Σ pondere × criteriu, etichete, selecție top
  └─ salvare în Supabase + rând în `rulari` (stare per sursă)
/  (dashboard)          Azi: Fotbal | Tenis | Alte sporturi + starea surselor
```
Un colector care pică nu oprește rularea; starea lui apare pe dashboard („Tenis: sursa nu a răspuns").

## Surse de date (gratuite)
1. **ESPN (neoficial, fără cheie)** — sursa principală
   - Tipar: `https://site.api.espn.com/apis/site/v2/sports/{sport}/{liga}/scoreboard?dates=YYYYMMDD`
   - Clasamente fotbal: `https://site.api.espn.com/apis/v2/sports/soccer/{liga}/standings`
   - Tenis: `tennis/atp`, `tennis/wta`
   - Nedocumentat, se poate schimba fără anunț → validare de format + alertă pe dashboard
2. **football-data.org** (token gratuit, 12 competiții, 10 apeluri/min) — verificare/rezervă pentru fotbal și clasamente. Atribuire obligatorie în footer: „Football data provided by the Football-Data.org API".
- **NU** API-Football (cont suspendat).
- Slug-urile ESPN din config sunt de verificat la primul pas (un request de probă per ligă).

## Format comun (Eveniment)
```ts
{
  id: string;            // sursa + id extern
  sursa: 'espn' | 'football-data';
  sport: 'fotbal' | 'tenis' | string;
  competitie: string;    // ex. "UEFA Champions League", "ATP Finals"
  cod_competitie: string;// slug, legat de config/competitii.json
  faza: string | null;   // etapă, rundă, sfert, finală
  participanti: [string, string];
  start_utc: string;
  status: 'programat' | 'live' | 'terminat' | 'amanat';
  extra: Record<string, unknown>; // poziții clasament, ranking etc.
}
```

## Scorul de importanță
Ponderi și praguri în `config/scor.json` (reglabile fără cod).
- **Valoare**: nivelul competiției (`config/competitii.json`) + faza (finală > semifinală > … ) + context (fotbal: ambele echipe în top N / meci direct pentru loc; tenis: ranking ambii jucători)
- **Rivalitate**: `config/rivalitati.json` (derby-uri fotbal, rivalități din alte sporturi, perechi tenis)
- **Tradiție**: cluburi/francize istorice și turnee cu istorie (`config/competitii.json` → `traditie`, `config/rivalitati.json` → `cluburi_istorice`)

Selecție: fotbal top 6, tenis top 4, alte sporturi top 5 (cel mult 2 din același sport). Valori în config.

Etichete afișate, ex.: `Derby`, `1 vs 2`, `Finală`, `Sferturi Masters`, `Nopți europene`, `Clasic`.

## Supabase
Vezi `supabase/migrations/001_init.sql`: `evenimente`, `rulari`. RLS: citire publică doar pentru dashboard (anon select), scriere doar cu service role din `/api/collect`.

## Pași de implementare
1. Schelet Next.js + Supabase, migrarea, variabile de mediu (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `FOOTBALL_DATA_TOKEN`, `CRON_SECRET`)
2. Colector fotbal ESPN + clasamente → verificat pe ziua curentă
3. Colector tenis ESPN (ATP/WTA)
4. Clasificator + etichete, cu teste pe câteva zile reale
5. Dashboard „Azi" (+ navigare ieri/mâine)
6. Colectoare alte sporturi
7. Vercel Cron + protecție `/api/collect` cu `CRON_SECRET` + deploy
8. O săptămână de observare → reglat ponderile

## În afara v1
Agent de context cu explicații în text liber, notificări, istoric/statistici, cote.
