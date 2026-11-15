# Pagina de detaliu meci — design

## Scop
Sub-proiectul A dintr-un plan mai larg: predicții pentru alte sporturi (fotbal/Poisson, NBA/NHL/NFL, UFC) +
o pagină de detaliu per meci. Acest spec cuprinde **doar** pagina de detaliu — fundația pe care se vor
așeza sub-proiectele B/C/D (predicții pe celelalte sporturi), construite și specificate separat, pe rând.

Context: dashboard-ul (`app/page.tsx`) arată azi carduri de meciuri selectate (fotbal/tenis/altele), cu
procente de predicție doar pentru tenis (model Elo, vezi `PREDICTII.md`). Vrem ca fiecare card să fie
clickabil și să deschidă o pagină cu statistici + predicții pentru acel meci — utilă azi (tenis), care se
umple natural când apar modelele pentru celelalte sporturi.

## În afara acestui spec
- Modelele de predicție pentru fotbal, NBA/NHL/NFL, UFC (sub-proiecte separate, B/C/D)
- Istoric meci-cu-meci (doar agregat head-to-head, vezi mai jos)

## Arhitectură
- Rută nouă, server component: `app/meci/[id]/page.tsx` — același tipar ca `/predictii` (SSR, `supabasePublic()`,
  `export const dynamic = "force-dynamic"`), zero JS client nou.
- `id`-ul din URL e `evenimente.id` (ex. `espn:187505`), encodat cu `encodeURIComponent` în `href`,
  citit direct din `params` (Next.js îl decodează automat).
- În `app/page.tsx`, `CardEveniment` se înfășoară într-un `<Link href={...}>` — universul de meciuri
  clickabile e deja scopat corect (doar cele `selectat=true`, afișate azi pe dashboard).
- Pentru tenis, potrivirea nume→jucător (`lib/predictii/potrivire-nume.ts`) se re-rulează la randarea
  paginii (query pe `ratinguri` + `jucatori_alias`, aceeași logică ca în `actualizare-zilnica.ts`) — **nu**
  stocăm `jucator_id` pe tabela `predictii`, care rămâne pe-piață-generică, neschimbată arhitectural.

## Date noi — migrare `003_h2h_tenis.sql`
```sql
create table public.h2h_tenis (
  jucator_id_1  text not null,  -- id mai mic alfabetic (ordine canonică, ca la celelalte potriviri)
  jucator_id_2  text not null,
  victorii_1    integer not null default 0,
  victorii_2    integer not null default 0,
  ultimul_meci  date,
  actualizat_la timestamptz not null default now(),
  primary key (jucator_id_1, jucator_id_2)
);
```
- RLS: citire publică (anon/authenticated), scriere doar service role — ca restul tabelelor.
- Populat o dată la backfill (`npm run backfill:tenis`): tally pe toate meciurile Sackmann, folosind
  aceeași ordine canonică (id mai mic = jucator_id_1) ca restul codului din `lib/predictii/`.
- Actualizat zilnic în `lib/predictii/actualizare-zilnica.ts`, exact unde se actualizează `ratinguri` —
  când un meci de tenis selectat se termină și ambii jucători sunt potriviți, se incrementează perechea.
- Nu e un istoric meci-cu-meci (nu stocăm 87k rânduri individuale) — doar agregatul victorii/jucător,
  suficient pentru „X conduce N-M” pe pagina de detaliu.

## Conținutul paginii `/meci/[id]`
1. **Antet**: participanți, competiție, fază, oră (Europe/Bucharest), status (+ rezultat dacă terminat).
   `rezultatText`/`afiseazaFaza`/`afiseazaParticipant`/`numeSport` se extrag din `app/page.tsx` într-un
   modul partajat (`lib/afisare-eveniment.ts`), folosit de ambele pagini — evită duplicare, aceeași logică
   de afișare peste tot. Link „← Înapoi” spre `/?data=<data_ro a meciului>`.
2. **Scor**: valoare / rivalitate / tradiție (din `evenimente.scor_detalii`) + etichete — aceleași date
   deja calculate de `clasificator.ts`, doar afișate expandat (nu doar punctele ●●●).
3. **Secțiune specifică sportului**:
   - **Tenis**: dacă există o predicție (`predictii` where `eveniment_id` + `piata='castigator'`) — %
     + favorit; rating Elo general + pe suprafața meciului pentru ambii jucători (din `ratinguri`);
     număr de meciuri jucate (experiență Elo); head-to-head din `h2h_tenis` (ex. „Alcaraz conduce 3-1”).
     Dacă un jucător nu e potrivit (ca în `jucatoriNepotriviti`), secțiunea arată doar ce se poate.
   - **Celelalte sporturi** (fotbal/altele): ce există deja în `extra` (clasament, ranking, scor) +
     mesajul „Predicții încă indisponibile pentru acest sport”.
4. Atribuire Sackmann în footer, ca pe celelalte pagini, doar dacă secțiunea de tenis e prezentă.

## Gestionare erori
- `id` inexistent în `evenimente` → `notFound()` (pagina 404 standard Next.js).
- Jucător tenis nepotrivit / fără rating încă (ex. jucător nou, fără meciuri Sackmann) → secțiunea de
  statistici arată doar partea disponibilă, fără să ascundă restul paginii.
- Pereche fără istoric în `h2h_tenis` → „Prima întâlnire” în loc de scor 0-0 (ambiguu altfel).

## Testare
- Un test minim (`lib/predictii/h2h.test.ts`, `node --test`, ca restul suitei) pentru funcția pură de
  tally head-to-head (ordine canonică, incrementare corectă), în stilul `lib/date.test.ts` existent.
- Verificare manuală live pe un meci de tenis real (card → pagină → date corecte) și pe un meci de
  fotbal/altele (card → pagină → mesaj „predicții indisponibile”, fără crash).
