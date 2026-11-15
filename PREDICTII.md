# Predicții — brief (faza 1: tenis)

## Scop
Probabilități de câștig pentru meciurile selectate pe dashboard, salvate **înainte** de start și evaluate după rezultat.
Scopul este să vedem cât de bine prezicem (calibrare, acuratețe), **nu** să batem casele de pariuri.
Faza 1 = doar tenis (ATP + WTA, simplu). Fotbal și alte sporturi vin după ce faza 1 e validată.

## Model: Elo pe suprafață
- Rating inițial 1500 pentru fiecare jucător.
- K dinamic: `K = 250 / (nr_meciuri + 5)^0.4` (stil FiveThirtyEight).
- Două ratinguri per jucător: general și pe suprafață (Hard, Clay, Grass; Carpet → Hard).
- Rating folosit la predicție: `0.5 × general + 0.5 × suprafață`.
- `P(A) = 1 / (1 + 10^((R_B − R_A) / 400))`.
- Walkover / retragere înainte de start: nu se actualizează ratingul. Abandon în timpul meciului: se actualizează normal.
- Parametrii (rating inițial, constantele K, ponderea suprafeței) în `config/predictii.json`, ca să-i putem regla.

## Date istorice
- Jeff Sackmann, GitHub: `tennis_atp` → `atp_matches_YYYY.csv`, `tennis_wta` → `wta_matches_YYYY.csv`
  (descărcare raw de pe GitHub, anii 2015–2026; dacă repo-urile originale nu mai sunt actualizate, mirror-ul `Aneeshers/tennis-sackmann-archive`).
- Doar meciuri de tablou principal + calificări de la turneele ATP/WTA, Grand Slam, Finals; fără Davis Cup/BJK Cup în v1.
- Licență CC BY-NC-SA 4.0 → atribuire în footer-ul dashboard-ului: „Date istorice tenis: Jeff Sackmann / Tennis Abstract, CC BY-NC-SA 4.0".
- Sezonul curent poate avea întârzieri în CSV → completăm cu meciurile terminate din tabela `evenimente` (sursa ESPN).
- Suprafața turneului: din CSV pentru istoric; pentru meciurile ESPN, o mapare turneu → suprafață în `config/predictii.json` (ex. ATP Finals = Hard indoor), cu „Hard" implicit și log pentru turneele nemapate.

## Potrivirea numelor ESPN ↔ Sackmann
- Normalizare: fără diacritice, lowercase, fără cratime/puncte.
- Tabelă `jucatori_alias` (nume_sursa, sursa, jucator_id) pentru excepții.
- Raport cu jucătorii ESPN nepotriviți; meciurile cu un jucător nepotrivit nu primesc predicție (nu inventăm rating).

## Supabase — tabele noi (migrare `002_predictii.sql`)
- `ratinguri`: sport, jucator_id, nume, suprafata ('general' | 'hard' | 'clay' | 'grass'), rating, nr_meciuri, ultimul_meci, actualizat_la. PK (sport, jucator_id, suprafata).
- `predictii`: id, eveniment_id (FK evenimente), model ('elo-tenis'), versiune_model, piata, selectie, probabilitate, creat_la, start_utc.
  - Schema e pe piețe, ca să poată primi ulterior orice tip de predicție fără refactorizare:
    `piata` = 'castigator' (faza 1), mai târziu '1x2', 'peste_sub_2.5', 'ambele_marcheaza', 'handicap_-1.5', 'seturi_2-0' etc.;
    `selectie` = 'p1' / 'p2' (sau '1','X','2', 'peste', 'sub', 'da', 'nu'...).
  - Probabilitățile selecțiilor dintr-o piață însumează 1.
  - Unic pe (eveniment_id, model, piata, selectie).
  - Se inserează **doar dacă** `now() < start_utc`; nu se modifică după start (constrângere/trigger).
- `meciuri_procesate`: eveniment_id sau id_sackmann, ca actualizarea Elo să fie idempotentă.
- View `evaluare_predictii`: predicție + rezultat + Brier + log-loss + corect/greșit.
- RLS: citire publică, scriere doar service role (ca la tabelele existente).

## Flux
1. **Backfill (o singură dată, local):** `npm run backfill:tenis` — calculează Elo cronologic pe 2015–azi și scrie `ratinguri` în Supabase. Nu rulează pe Vercel.
2. **Zilnic, în colectare (după clasificator):**
   a. actualizează Elo cu meciurile de tenis terminate de la ultima rulare (din `evenimente`, idempotent);
   b. calculează și salvează predicții pentru meciurile de tenis **selectate** și încă neîncepute.
3. **Dashboard:**
   - pe cardurile de tenis: „Svitolina 41% · Andreeva 59%" + marcaj favorit;
   - la meciurile terminate: ✓/✗ dacă favoritul a câștigat;
   - pagină nouă `/predictii`: istoric, acuratețe, Brier mediu, tabel de calibrare (bucket-uri de câte 10%).

## Validare înainte de producție (backtest)
- Antrenare cronologică pe 2015–2023, evaluare pe 2024–2026 (fără să te uiți în viitor: ratingul folosit e cel dinaintea meciului).
- Raport: acuratețe, Brier, log-loss, calibrare pe bucket-uri, separat ATP/WTA și pe suprafață.
- Comparație cu baseline „câștigă jucătorul mai bine clasat" (ranking din CSV).
- Elo trebuie să bată baseline-ul pe Brier; dacă nu, ne oprim și ajustăm înainte de integrare.

## Direcția pentru piețe multiple (după faza 1)
- Modelele produc o **distribuție de rezultate**, iar piețele se derivă din ea:
  - fotbal: distribuția scorului (Poisson / Dixon-Coles) → 1X2, peste/sub, ambele marchează, handicap, scor exact;
  - tenis: probabilitatea de câștig pe punct la serviciu/retur → model Markov → câștigător, scor la seturi, total game-uri, handicap game-uri;
  - NBA/NFL/NHL: distribuția diferenței și a totalului de puncte → câștigător, handicap, total.
- Fiecare piață se evaluează separat (Brier/log-loss pe piață). O piață intră pe dashboard doar după ce e validată.

## În afara fazei 1
Fotbal (Elo + model pentru egal / Poisson), naționale, NBA/NFL/NHL, cote de piață ca reper (The Odds API, ~16 request-uri/zi gratuit).
