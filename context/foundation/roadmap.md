---
project: "Pupilownik"
version: 2
status: active
created: 2026-06-27
updated: 2026-09-11
prd_version: 1
design_ref: "context/design/Pupilownik Hi-fi.html"
main_goal: speed
top_blocker: time
---

# Roadmap: Pupilownik

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline (stan na 2026-09-07).
> Regenerated 2026-09-07 — poprzednia wersja w `context/foundation/archive/2026-09-07-roadmap.md`.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

Pupilownik pozwala właścicielowi zwierząt rozłożyć opiekę na okres nieobecności między kilka zaufanych osób, zamiast pytać je seryjnie przez social media. Właściciel definiuje podopiecznych wraz z instrukcjami opieki, tworzy okres opieki ze slotami per pora dnia i wysyła jeden link zapraszający; zaproszeni samodzielnie i równolegle zapisują się na wolne sloty.

Rdzeń wartości — czyli ta jedna cecha, po usunięciu której produkt staje się zwykłym współdzielonym kalendarzem — to **wyłączny przydział slotu w obrębie zamkniętego kręgu**: aplikacja gwarantuje, że żaden slot nie zostanie obsadzony podwójnie i że wrażliwe instrukcje (adres, kody dostępu) odsłaniają się dopiero osobie, która faktycznie wzięła slot.

## North star

**S-03: Opiekun otwiera link i zajmuje wolny slot** — to najmniejsza pełna ścieżka, której dowiezienie udowadnia, że produkt działa, więc sekwencjonujemy ją tak wcześnie, jak pozwalają prerekwizyty. Jej prerekwizyty są już spełnione, więc jest to jednocześnie następny ruch.

> „Gwiazda przewodnia" oznacza tu najmniejszy przepływ od początku do końca, którego udane dowiezienie potwierdza główną hipotezę produktu — umieszczony najwcześniej, jak pozwalają zależności, bo cała reszta ma znaczenie tylko wtedy, gdy ten fragment zadziała. Tutaj jest to pierwszy samodzielny zapis opiekuna przez link, zgodny z kryterium sukcesu Primary z PRD.

## At a glance

| ID   | Change ID                   | Outcome (user can …)                                               | Prerequisites | PRD refs                      | Status   |
| ---- | --------------------------- | ------------------------------------------------------------------ | ------------- | ----------------------------- | -------- |
| F-01 | owner-data-rls-baseline     | (foundation) bezpieczny wzorzec dostępu do danych właściciela      | —             | NFR (privacy), Access Control | done     |
| S-01 | pet-and-instructions        | właściciel definiuje zwierzę z instrukcjami (publiczna+wrażliwa)   | F-01          | FR-001, FR-002, FR-003, US-01 | done     |
| S-02 | care-period-and-invite-link | właściciel tworzy okres ze slotami i generuje link zapraszający    | S-01          | FR-004, FR-005, US-01         | done     |
| S-08 | period-pets-relation        | właściciel wskazuje, które zwierzęta obejmuje wyjazd               | S-02          | FR-002, US-01                 | done     |
| S-07 | ui-design-system            | aplikacja wygląda wg hi-fi designu — system wizualny + reskin auth | —             | (UI wszystkich FR)            | done     |
| S-03 | caretaker-claims-slot       | opiekun otwiera link i zajmuje wolny slot (bez podwójnej obsady)   | S-08          | FR-007, FR-008, FR-009, US-02 | done     |
| S-04 | owner-occupancy-view        | właściciel widzi pełną obsadę okresu — kto zajął którą porę        | S-03          | FR-006, US-01                 | done     |
| S-05 | caretaker-names-visibility  | opiekun widzi imiona innych opiekunów w obrębie okresu             | S-03          | FR-011                        | proposed |
| S-06 | close-care-period           | właściciel zamyka/odwołuje okres i unieważnia link                 | S-02          | FR-012                        | done     |

Pozostała ścieżka must-have (czyli minimalny zestaw wymagań, bez których PRD nie uznaje MVP za działające): **S-03 → S-04**. Wszystko inne jest nice-to-have albo już wylądowało.

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                          | Chain                                               | Note                                                                                                                                               |
| ------ | ------------------------------ | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| A      | Rdzeń: od zwierzęcia do zapisu | `F-01` → `S-01` → `S-02` → `S-08` → `S-03` → `S-04` | Ścieżka must-have; zawiera gwiazdę przewodnią `S-03`. Pierwsze cztery ogniwa wylądowały — pozostaje `S-03` → `S-04`. Zgodna z celem `szybkość`.    |
| B      | Dodatki (nice-to-have)         | `S-06` / `S-05`                                     | `S-06` dołącza do Stream A przy `S-02` (już spełnione, więc jest plannowalny od dziś), `S-05` przy `S-03`. Równoległe względem siebie i do `S-03`. |
| C      | UI / system wizualny           | `S-07`                                              | Domknięty. Ekrany domenowe realizują swoje slice'y na jego komponentach (zob. Design reference).                                                   |

## Baseline

What's already in place in the codebase as of `2026-09-07` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 6 + React 19 + Tailwind 4 + shadcn/ui, przeskórowane wg hi-fi (S-07). Ekrany właściciela działają: `src/pages/pets/{index,new}.astro`, `src/pages/periods/{index,new,[id]}.astro`, plus read-only widok opiekuna `src/pages/invite/[token].astro`.
- **Backend / API:** present — Astro SSR; trasy `src/pages/api/auth/{signin,signup,signout}.ts`, `api/pets.ts`, `api/periods.ts`, `api/periods/[id]/token.ts`.
- **Data:** present — 9 migracji w `supabase/migrations/` z RLS per tabela: `profiles`, `pets`, `care_instructions`, `care_periods`, `care_slots`, `care_period_pets`; RPC `get_period_by_token`; `seed.sql`. Schemat jest już przygotowany pod S-03: constraint `care_slots_claim_complete` czyni zajęcie slotu rozstrzygalnie all-or-nothing, a `unique (period_id, slot_date, time_of_day)` daje slotowi jedną tożsamość.
- **Auth:** present — Supabase email+hasło (`src/lib/supabase.ts`), `src/middleware.ts` chroni trasy właściciela → `/auth/signin`; `/invite/**` celowo poza ochroną (model tokenowy).
- **Deploy / infra:** partial — Cloudflare Workers skonfigurowane (`wrangler.jsonc`, adapter `cloudflare()`), deploy ręczny. Brak jakiejkolwiek konfiguracji CI w repo (`.github/` nie istnieje), Workers Builds niepodpięte — mimo że `infrastructure.md` je opisuje.
- **Observability:** partial — tylko natywna obserwowalność Cloudflare (`wrangler.jsonc`); brak warstwy aplikacyjnej (logger, error tracking, metryki). Warstwę weryfikacji pokrywa natomiast suite `vitest` (24 pliki, w tym testy izolacji RLS per tabela oraz `tests/rls/invite-token.test.ts`).

## Design reference

Hi-fi design (`context/design/Pupilownik Hi-fi.html`, tryby: jasny / ciemny / trzeci) dostarcza wizualną referencję dla **całego** MVP. Każdy zaprojektowany ekran realizuje odpowiedni slice, używając systemu komponentów z **S-07**. Design nie jest osobną poziomą warstwą UI — poza S-07 (system + reskin auth) ekrany domenowe powstają w swoich slice'ach.

| Ekran w designie                    | Realizuje slice                              |
| ----------------------------------- | -------------------------------------------- |
| Logowanie / Logowanie · desktop     | S-07 (reskin istniejących `signin`/`signup`) |
| Panel właściciela                   | S-04 (widok obsady okresu)                   |
| Dodaj zwierzę + instrukcje          | S-01 (zwierzę + instrukcje public/sensitive) |
| Nowy wyjazd + link                  | S-02 (okres + link) + S-08 (wybór zwierząt)  |
| Kalendarz opiekuna (zapis na sloty) | S-03 (opiekun zajmuje slot)                  |
| Po zapisaniu · instrukcje           | S-03 (odsłonięcie wrażliwych instrukcji)     |

**Język wizualny, który rysuje design** (nie lista tego, co zbudowane): fonty **Quicksand** (nagłówki) + **Nunito** (tekst); akcent śliwkowo-różowy `#9C5470` (jasny) / `#E59AB6` (ciemny); tło ciepła biel `#FAF6F3` / ciemne `#211D24`; duże, miękkie zaokrąglenia i delikatne cienie; oraz komponenty: input (z „Pokaż" dla hasła), przycisk primary/outline/Google, karta pupila z okrągłym slotem zdjęcia, element listy instrukcji (badge pory + tytuł + opis), callout wrażliwych danych, chip, nagłówek sekcji, panel-hero (desktop), baner sukcesu.

**Co z tego istnieje w kodzie** (stan 2026-09-07, odczytany z `src/`, nie z opisu): tokeny kolorów, tokeny fontów, `--radius: 1rem` i tryb jasny/ciemny — z S-07. Komponenty: `ui/Input` (z „Pokaż"), `ui/ScreenHeading`, `ui/AuthScreen` — z S-07; `ui/Chip` — z **S-08**; `ui/button` — z bootstrapu; `ui/Textarea` — z S-03 fazy 1. **Brakuje:** calloutu wrażliwych danych, banera sukcesu (i tokenu sukcesu w `global.css` — jest tylko `--destructive`), badge'a pory, komponentu karty oraz jakiegokolwiek tokenu cienia. `Banner.astro` i `LibBadge.astro` to pozostałości ze startera — pierwszy ma warianty info/warning/error, drugi zero wywołań i kolory startera; **nie należy ich brać za powyższe.** Konsekwencja: slice'y konsumujące ten system budują brakujące komponenty same, na własnym koszcie.

Otwarty dług z designu: pole **`NOTATKA`** (wolny tekst na poziomie okresu) wypadło po cichu z S-02 i jest przypisane do S-03 — zob. Unknowns tego slice'a.

## Foundations

### F-01: Wzorzec dostępu do danych właściciela (migracje + RLS)

- **Outcome:** (foundation) ustalony bezpieczny wzorzec persystencji: działający przepływ migracji Supabase, polityki Row-Level Security izolujące dane do właściciela oraz typowany helper zapytań. Nie tworzy tabel domenowych — ustanawia kontrakt „jak bezpiecznie dotykamy danych".
- **Change ID:** owner-data-rls-baseline
- **PRD refs:** NFR (wrażliwe dane nie wyciekają poza krąg), Access Control (właściciel ma dostęp wyłącznie do własnych danych)
- **Unlocks:** S-01 (pierwsza warstwa danych domenowych, która zakłada izolację właściciela); redukuje ryzyko guardrail „pełny dostęp wyłącznie do własnych danych"; ustanawia wzorzec migracji i ścieżkę weryfikacji (`tests/rls/*.isolation.test.ts`) wymagane przez wszystkie kolejne slice'y danych.
- **Prerequisites:** —
- **Parallel with:** S-07
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Warstwa danych była w momencie sekwencjonowania jedyną nieobecną, a inwestycja celowo poszła tutaj — RLS przed pierwszą tabelą domenową zapobiega wyciekowi danych między właścicielami. Ryzyko przeinwestowania trzymane w ryzach: wzorzec + RLS, tabele dokładają slice'y.
- **Status:** done

## Slices

### S-01: Właściciel definiuje zwierzę z instrukcjami

- **Outcome:** zalogowany właściciel może dodać zwierzę (nazwa, gatunek / podstawowe dane) i zapisać instrukcje opieki jako wolny tekst z podziałem na część publiczną i część wrażliwą (odsłanianą później).
- **Change ID:** pet-and-instructions
- **PRD refs:** FR-001 (spełnione przez istniejący auth — tu eksponowane jako precondition zalogowanego właściciela), FR-002, FR-003, US-01 (część)
- **Prerequisites:** F-01
- **Parallel with:** S-07
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Pierwszy slice domenowy; sprawdza wzorzec z F-01 na realnej encji. Podział public/sensitive instrukcji musi być w modelu danych od początku, bo S-03 na nim polega — wprowadzenie go później wymusiłoby migrację danych.
- **Status:** done

### S-02: Właściciel tworzy okres opieki ze slotami i generuje link

- **Outcome:** właściciel może utworzyć okres opieki (zakres dat), który generuje sloty per pora dnia (rano / popołudnie / wieczór) dla każdego dnia, oraz wygenerować link zapraszający prowadzący wyłącznie do tego okresu.
- **Change ID:** care-period-and-invite-link
- **PRD refs:** FR-004, FR-005, US-01 (część)
- **Prerequisites:** S-01
- **Parallel with:** S-07
- **Blockers:** —
- **Unknowns:**
  - ~~Granularność/zakres pór dnia~~ — ROZSTRZYGNIĘTE 2026-09-06 przez użytkownika: **stały zestaw trzech pór — rano, popołudnie, wieczór.** Nie konfigurowalny w v1.
- **Risk:** Wprowadza model dostępu przez nieodgadywalny token linku (bez konta opiekuna) — kontrakt, na którym opiera się guardrail „dostęp tylko dla osób z linku". Sloty generowane z zakresu dat × pory dnia muszą być deterministyczne, by S-03 mógł je bezpiecznie zajmować.
- **Status:** done

### S-08: Okres opieki obejmuje wybrane zwierzęta

- **Outcome:** właściciel może wskazać, które ze swoich zwierząt obejmuje okres opieki, i widzi je na liście wyjazdów oraz w szczegółach okresu.
- **Change ID:** period-pets-relation
- **PRD refs:** FR-002 (rozstrzygnięcie: „jeden okres może obejmować kilka zwierząt o różnych instrukcjach"), US-01 (część — okres wie, kogo dotyczy)
- **Prerequisites:** S-02
- **Parallel with:** S-06
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Odblokowuje FR-008 dla S-03, który bez tej relacji nie ma jak dosięgnąć instrukcji — nic nie łączyło okresu ze zwierzęciem, a instrukcje wiszą na zwierzęciu. Zakres wyszedł po cichu z S-02, więc to domknięcie długu, nie nowa funkcjonalność. Główne ryzyko techniczne: predykat RLS na tabeli łączącej musi sprawdzać OBA końce — właściciela okresu i właściciela zwierzęcia — bo pojedynczy warunek jest IDOR-em, który ujawni się dopiero wtedy, gdy S-03 dowiezie odsłanianie instrukcji.
- **Status:** done

### S-07: Implementacja UI wg dostarczonego designu (system wizualny + reskin auth)

- **Outcome:** aplikacja wygląda zgodnie z hi-fi designem — ustanowiony system wizualny (tokeny kolorów, tokeny fontów Quicksand/Nunito przez pipeline Astro, `--radius`, tryb jasny/ciemny przez klasę `.dark` z fallbackiem `prefers-color-scheme`) oraz komponenty bazowe faktycznie potrzebne przez ekrany auth: `ui/Input` (z „Pokaż" hasła), `ui/ScreenHeading`, `ui/AuthScreen`. Istniejące ekrany logowania/rejestracji są przeskórowane do designu. Ekrany domenowe **nie** powstają tutaj — realizują je swoje slice'y przy użyciu tego systemu (zob. Design reference).
  > **Sprostowanie 2026-09-07** (weryfikacja z katalogu przy przeglądzie fazy 1 S-03). Pierwotny tekst tego pola wymieniał także kartę, chip, badge pory, callout wrażliwych danych, baner sukcesu i cienie. **Nic z tego nie wylądowało w S-07** — jego własny plan wykluczył je wprost w §What We're NOT Doing („No domain components. Pet card, instruction row with time badge, sensitive-data callout and chip… land with the slices that use them"). Stan faktyczny: `Chip` dowiózł **S-08** (`cc115c8`); `button.tsx` pochodzi z bootstrapu (`1242a53`), nie z S-07; calloutu, banera sukcesu i badge'a pory **nie ma wcale** (`Banner.astro` to pozostałość ze startera z wariantami info/warning/error, `LibBadge.astro` ma zero wywołań i zahardkodowane kolory startera); karta istnieje tylko jako token `bg-card`; w `global.css` nie ma żadnego tokenu cienia i `shadow-*` nie występuje w szablonach aplikacji. To pole było pisane aspiracyjnie na etapie planowania i `/10x-archive` skopiował je żywcem do `## Done` — stąd ten sam błąd w dwóch miejscach.
- **Change ID:** ui-design-system
- **PRD refs:** przekrojowo dla UI wszystkich FR (bez własnej reguły biznesowej); design: `context/design/Pupilownik Hi-fi.html`
- **Prerequisites:** — (nie zależy od warstwy danych; dotyka istniejących ekranów auth)
- **Parallel with:** F-01, S-01, S-02
- **Blockers:** —
- **Unknowns:**
  - ~~Wybór warstwy komponentów (shadcn/ui vs własne na tokenach Tailwind 4)~~ — rozstrzygnięte w implementacji.
  - ~~Mechanizm trybu ciemnego~~ — rozstrzygnięte: `src/lib/theme.ts` + cookie motywu; tryb jasny/ciemny w zakresie v1.
- **Risk:** Poziomy, przekrojowy slice — ryzyko przeinwestowania w system komponentów zanim istnieją ekrany domenowe, oraz driftu między systemem a późniejszymi slice'ami. To ryzyko zmaterializowało się i jest zapisane jako lekcja „Wylicz konsumentów, zanim zmienisz coś współdzielonego" (`context/foundation/lessons.md`).
- **Status:** done

### S-03: Opiekun otwiera link i zajmuje wolny slot

- **Outcome:** opiekun może wejść przez link bez logowania, zobaczyć publiczną część instrukcji i kalendarz okresu, a następnie podać imię i zająć wolny slot; przydział jest atomowy (nigdy podwójna obsada), a po zajęciu odsłaniają się wrażliwe instrukcje. (Gwiazda przewodnia.)
- **Change ID:** caretaker-claims-slot
- **PRD refs:** FR-007, FR-008, FR-009, US-02, NFR (atomowość zajęcia slotu), NFR (wrażliwe instrukcje nie wyciekają przed zajęciem)
- **Prerequisites:** S-08 (spełnione — relacja `care_period_pets` wylądowała 2026-09-06)
- **Parallel with:** S-06
- **Blockers:** —
- **Unknowns:**
  - ~~Mechanizm gwarancji atomowości przy równoległym zajęciu~~ — ROZSTRZYGNIĘTE 2026-09-06 w researchu: `update ... where id = $1 and claimed_by_name is null` pod READ COMMITTED daje dokładnie jednego zwycięzcę — przegrany blokuje się na wierszu, po commicie zwycięzcy ponownie sprawdza warunek WHERE i aktualizuje 0 wierszy. CHECK `care_slots_claim_complete` z S-02 czyni predykat „wolny" wiarygodnym. Uwaga: test współbieżności w tym harnessie dowodzi WYNIKU, nie zadziałania blokady wiersza.
  - ~~Jednostka odsłonięcia wrażliwych instrukcji: zdarzenie czy osoba~~ — ROZSTRZYGNIĘTE 2026-09-06 przez użytkownika: **per OSOBA, która zajęła slot** (nie każdy posiadacz linku). Wymaga sekretu per zajęcie i pierwszego w tym repo cookie ustawianego serwerowo. Przyjmuje lekką tożsamość opiekuna, którą PRD odłożyło do v2, jako capability — nie konto. Ograniczenie techniczne znalezione w researchu: `get_period_by_token` jest `STABLE`, więc zajęcie musi być osobną funkcją `VOLATILE`.
  - Pole `NOTATKA` z designu (wolny tekst na poziomie okresu, treścią zachodzący na `is_sensitive`) — wymaganie produktowe czy artefakt designu? Nie ma dla niego FR w PRD. Owner: użytkownik. Block: no.
- **Risk:** Najbardziej ryzykowny slice i sedno produktu: równoczesne zajęcie tego samego slotu musi dać dokładnie jednego zwycięzcę, a wrażliwe instrukcje nie mogą wyciec przed zajęciem. Research jest domknięty, a schemat przygotowany, więc ryzyko przeniosło się z „czy wiemy jak" na „czy poprawnie zaimplementujemy odsłonięcie per osoba" — to pierwsza w tym repo warstwa capability po stronie serwera, więc nie ma wzorca do skopiowania. Slice pozostaje niepodzielony celowo: zajęcie slotu i odsłonięcie instrukcji dzielą jeden kontrakt bezpieczeństwa (research §Decisions), a rozcięcie ich dałoby stan, w którym slot jest zajęty, ale nikt nie widzi instrukcji.
- **Status:** done

### S-04: Właściciel widzi pełną obsadę okresu

- **Outcome:** właściciel widzi w jednym miejscu obsadę całego okresu — które pory są wolne, które zajęte i przez kogo — aktualizowaną w miarę zapisów opiekunów.
- **Change ID:** owner-occupancy-view
- **PRD refs:** FR-006, US-01 (domknięcie)
- **Prerequisites:** S-03
- **Parallel with:** S-05
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Domyka pętlę wartości po stronie właściciela i jest ostatnim must-have. Zależy od istnienia zapisów (S-03), bo „przez kogo" wymaga zajętych slotów — sama obsada wolne/zajęte jest już widoczna w `/periods/[id]`, więc zakres to dołożenie imion i agregatu, nie nowy ekran. Aktualizacja niemal-natychmiastowa (NFR < 1 s) jest celem odczuwalnym, nie twardym SLA.
- **Status:** done

### S-05: Widoczność imion w obrębie kręgu

- **Outcome:** opiekun widzi imiona innych opiekunów, którzy zajęli sloty w tym samym okresie, co wspiera wzajemną koordynację (kryterium Secondary z PRD).
- **Change ID:** caretaker-names-visibility
- **PRD refs:** FR-011 (nice-to-have)
- **Prerequisites:** S-03
- **Parallel with:** S-04, S-06
- **Blockers:** —
- **Unknowns:**
  - Czy imiona widzi każdy posiadacz linku, czy tylko osoba, która sama zajęła slot? S-03 ustanawia capability per-osoba, więc oba warianty są tanie — ale to decyzja o prywatności, nie techniczna. Owner: użytkownik. Block: no.
- **Risk:** Nice-to-have wspierający kryterium Secondary; nie blokuje launchu. Konsumuje model odsłonięcia z S-03 — jeśli S-03 rozszerzy funkcję tokenową o imiona „za darmo", ten slice może się skurczyć do zmiany UI. Sekwencjonowany po gwieździe przewodniej zgodnie z celem `szybkość`.
- **Status:** proposed

### S-06: Właściciel zamyka / odwołuje okres

- **Outcome:** właściciel może **odwołać** okres opieki — jednym działaniem, które unieważnia link zapraszający (odwołany wyjazd, wrażliwy link) i jest nieodwracalne na każdej ścieżce produktowej: nie ma un-revoke, a `regenerate_period_token` odmawia odwołanemu okresowi. Jest to **decyzja produktowa, nie ograniczenie schematu** — `care_periods_update_own` nie ma granularności kolumnowej, więc bezpośredni UPDATE właściciela wciąż tę kolumnę czyści. Opiekun, który zajął termin **i wciąż ma swoją capability**, dowiaduje się przy wejściu na link, że wyjazd został odwołany, zamiast widzieć tę samą martwą stronę co obcy; po zwolnieniu jego terminu albo utracie ciasteczka wraca do strony generycznej.
- **Change ID:** close-care-period
- **PRD refs:** FR-012 (nice-to-have)
- **Prerequisites:** S-02 (spełnione)
- **Parallel with:** S-03, S-04, S-05
- **Blockers:** —
- **Unknowns:** **Sprostowane 2026-09-11 — to pole mówiło „—", i było to nieprawdą.** Slice niósł cztery decyzje produktowe, których repo nie rozstrzygało, a dwa komentarze migracji oddawały je S-06 **z nazwy** (`20260906003122:32,120-121`). Jak wylądowały: (1) **jedna akcja, nie dwie** — sekcja Access Control w `prd.md` traktuje zamknięcie i odwołanie jako jeden identyczny efekt, runda sokratejska przyjęła „okres mija sam", a schemat ma jedną oś lifecycle, więc „zamknąć" nie stało się osobnym działaniem; (2) **nieodwracalne** — brak un-revoke, decyzja produktowa, nie ograniczenie: predykat `revoked_at is null` w `revoke_period` czyni drugie wywołanie no-opem i chroni oryginalny znacznik czasu, a `regenerate_period_token` odmawia — ale bezpośredni UPDATE właściciela wciąż kolumnę czyści, bo polityka nie ma granularności kolumnowej; (3) **posiadacz claimu dostaje odrębną odpowiedź** — `get_claimed_details` rozwiązuje okres bez filtra i za bramką digestu odpowiada `{"revoked": true}`, co jest drugim świadomym poszerzeniem reguły 4 (`docs/reference/data-access.md`); (4) **zwalnianie zajętych terminów NIE weszło** — powód zapisany pierwotnie („404 powstaje, zanim `claim_digest` jest czytany") pochodził ze stanu przed fazą 2 i był odwrócony; **sprostowany 2026-09-11**: `release_slot` zeruje `claim_digest`, więc zwolnienie terminów odbiera opiekunowi kartę „wyjazd odwołany" i zwraca mu martwy link obcego — zmienia dokładnie to, co widzi, i na gorsze.
- **Risk:** Nice-to-have, ale prerekwizyty ma spełnione od 2026-09-06, więc był plannowalny od dziś — jedyna pozycja, którą dało się poprowadzić równolegle do gwiazdy przewodniej. Teza „ścieżka unieważnienia jest już częściowo pokryta" okazała się trafna co do mechanizmu i myląca co do kosztu: sam zapis był szablonem `release_slot`, ale slice'owi przypadło rozstrzygnięcie, **co odwołanie znaczy dla opiekuna**, co dotknęło funkcji dostępnej dla `anon` i wymagało wyrównania pracy wykonywanej przez tę funkcję (impl-review fazy 2, F2).
- **Status:** done

## Backlog Handoff

| Roadmap ID | Change ID                   | Suggested issue title                                           | Ready for `/10x-plan` | Notes                                            |
| ---------- | --------------------------- | --------------------------------------------------------------- | --------------------- | ------------------------------------------------ |
| F-01       | owner-data-rls-baseline     | Wzorzec dostępu do danych: migracje + RLS izolujące właściciela | done                  | Zarchiwizowane 2026-06-27                        |
| S-01       | pet-and-instructions        | Definicja zwierzęcia + instrukcje (public/sensitive)            | done                  | Zarchiwizowane 2026-09-05                        |
| S-02       | care-period-and-invite-link | Okres opieki ze slotami + link zapraszający                     | done                  | Zarchiwizowane 2026-09-06                        |
| S-08       | period-pets-relation        | Relacja okres ↔ zwierzęta (odblokowuje instrukcje opiekuna)     | done                  | Zarchiwizowane 2026-09-06                        |
| S-07       | ui-design-system            | System wizualny wg hi-fi designu + reskin ekranów auth          | done                  | Zarchiwizowane 2026-09-06                        |
| S-03       | caretaker-claims-slot       | Opiekun zajmuje slot przez link (atomowo)                       | done                  | Zarchiwizowane 2026-09-08                        |
| S-04       | owner-occupancy-view        | Widok obsady okresu dla właściciela                             | no                    | Ostatni must-have; po S-03                       |
| S-05       | caretaker-names-visibility  | Widoczność imion opiekunów w okresie                            | no                    | Nice-to-have; po S-03                            |
| S-06       | close-care-period           | Zamknięcie/odwołanie okresu + unieważnienie linku               | done                  | Nice-to-have, ale plannowalny równolegle do S-03 |

## Open Roadmap Questions

1. **Strukturalny harmonogram karmienia (obrotowa miska)** — czy/jak modelować godziny otwierania komór i gramaturę na komorę jako dane strukturalne zamiast wolnego tekstu. Odłożone z FR-003 do v2. Owner: użytkownik. Block: roadmap-wide (poza MVP — nie blokuje żadnego slice'a v1).
2. **Skalowanie reguły przydziału** — przy ~100× skali zasada „kto pierwszy, ten lepszy" może nie wystarczyć; rozważyć kolejkowanie / listę rezerwową. Kierunek na przyszłość, poza MVP. Owner: użytkownik. Block: roadmap-wide (poza MVP).
3. **Termin z PRD minął** — `timeline_budget.hard_deadline: 2026-07-18` upłynął, a gwiazda przewodnia nie wylądowała; okno MVP rozjechało się z 3 do ~10 tygodni. Cel `szybkość` i blokada `czas` zostały potwierdzone przez właściciela 2026-09-07, ale sam termin w PRD jest już nieaktualny i wymaga albo aktualizacji, albo usunięcia w PRD v2. Owner: użytkownik. Block: roadmap-wide (nie blokuje żadnego slice'a — dotyczy zgodności artefaktu).

## Parked

- **Konta i tożsamość opiekunów** — Why parked: PRD §Non-Goals — opiekun zostaje przy modelu „link + imię"; tarcie zabija adopcję. Uwaga: S-03 wprowadza sekret per zajęcie jako _capability_, nie konto — to celowo nie narusza tego Non-Goal.
- **Lista rezerwowa / kolejkowanie na zajęty slot** — Why parked: PRD §Non-Goals — obowiązuje wyłącznie „kto pierwszy, ten lepszy"; kierunek v2 (zob. Open Roadmap Questions #2).
- **Powiadomienia push/email** — Why parked: PRD §Non-Goals — widok obsady i samoobsługa wystarczają na v1 (nie dotyczy maila logowania właściciela).
- **Marketplace i płatności** — Why parked: PRD §Non-Goals — to zamknięty zaufany krąg, nie giełda opiekunów.
- **Opiekun zwalnia własny zapis (FR-010)** — Why parked: wycięte w rundzie Socratesa — bez tożsamości opiekuna trudne i ryzykowne; na v1 wypis robi właściciel ręcznie. Uwaga: capability per zajęcie z S-03 usuwa dokładnie tę przeszkodę, więc po S-03 ten punkt staje się wyraźnie tańszy — mocny kandydat do v2.
- **Strukturalny harmonogram karmienia (obrotowa miska)** — Why parked: odłożone z FR-003 do v2 (zob. Open Roadmap Questions #1).
- **CI / auto-deploy (Cloudflare Workers Builds)** — Why parked: baseline `partial` (deploy ręczny działa, `infrastructure.md` opisuje docelowy przepływ), ale żaden must-have FR tego nie wymaga, a cel `szybkość` przy blokadzie `czas` nie uzasadnia fundamentu. Nie tworzy F-NN.
- **Aplikacyjna warstwa obserwowalności (logger / error tracking / metryki)** — Why parked: baseline `partial` — natywna obserwowalność Cloudflare działa, a guardraile PRD (brak podwójnej obsady, brak wycieku wrażliwych instrukcji) są dziś pilnowane testami `vitest`/RLS, nie telemetrią. Do przeglądu po dowiezieniu S-03, kiedy wrażliwe instrukcje zaczną faktycznie krążyć.

## Done

- **F-01: (foundation) ustalony bezpieczny wzorzec persystencji: działający przepływ migracji Supabase, polityki Row-Level Security izolujące dane do właściciela-właściciela oraz typowany helper zapytań. Nie tworzy jeszcze tabel domenowych — ustanawia kontrakt „jak bezpiecznie dotykamy danych".** — Archived 2026-06-27 → `context/archive/2026-06-27-owner-data-rls-baseline/`. Lesson: —.
- **S-01: zalogowany właściciel może dodać zwierzę (nazwa, gatunek / podstawowe dane) i zapisać instrukcje opieki jako wolny tekst z podziałem na część publiczną i część wrażliwą (odsłanianą później).** — Archived 2026-09-05 → `context/archive/2026-07-12-pet-and-instructions/`. Lesson: —.
- **S-07: aplikacja wygląda zgodnie z hi-fi designem — ustanowiony system wizualny (tokeny kolorów, tokeny fontów Quicksand/Nunito, `--radius`, tryb jasny/ciemny) oraz komponenty bazowe potrzebne przez ekrany auth: `ui/Input` z „Pokaż" hasła, `ui/ScreenHeading`, `ui/AuthScreen`. Istniejące ekrany logowania/rejestracji (`src/pages/auth/signin.astro`, `signup.astro`) są przeskórowane do designu. Ekrany domenowe (pupile, okresy, kalendarz opiekuna, panel właściciela) **nie** powstają tutaj — są realizowane w swoich slice'ach (S-01…S-04) przy użyciu tego systemu (zob. Design reference).** — Archived 2026-09-06 → `context/archive/2026-09-05-ui-design-system/`. Lesson: „Wylicz konsumentów, zanim zmienisz coś współdzielonego" (`context/foundation/lessons.md`). **Sprostowane 2026-09-07**: ten wpis wymieniał wcześniej kartę, chip, badge pory, callout wrażliwych danych, baner sukcesu i cienie — żadne z nich nie wylądowało w S-07 (jego plan wykluczył je wprost). Pełne rozliczenie w polu `Outcome` slice'u S-07 powyżej.
- **S-02: właściciel może utworzyć okres opieki (zakres dat), który generuje sloty per pora dnia (rano / popołudnie / wieczór) dla każdego dnia, oraz wygenerować link zapraszający prowadzący wyłącznie do tego okresu.** — Archived 2026-09-06 → `context/archive/2026-09-06-care-period-and-invite-link/`. Lesson: —.
- **S-08: właściciel może wskazać, które ze swoich zwierząt obejmuje okres opieki, i widzi je na liście wyjazdów oraz w szczegółach okresu.** — Archived 2026-09-06 → `context/archive/2026-09-06-period-pets-relation/`. Lesson: „Ubij serwer dev, zanim uruchomisz `npm run build`" (`context/foundation/lessons.md`).
- **S-03: opiekun może wejść przez link bez logowania, zobaczyć publiczną część instrukcji i kalendarz okresu, a następnie podać imię i zająć wolny slot; przydział jest atomowy (nigdy podwójna obsada), a po zajęciu odsłaniają się wrażliwe instrukcje. (Gwiazda przewodnia.)** — Archived 2026-09-08 → `context/archive/2026-09-06-caretaker-claims-slot/`. Lesson: —.
- **S-04: właściciel widzi w jednym miejscu obsadę całego okresu — które pory są wolne, które zajęte i przez kogo — oraz może zwolnić zajęty termin.** — Archived 2026-09-09 → `context/archive/2026-09-08-owner-occupancy-view/`. Lesson: —. **Outcome przepisany przy zamknięciu, zgodnie z `lessons.md`:** pole `Outcome` slice'u mówi „aktualizowaną w miarę zapisów opiekunów", co czyta się jak odświeżanie na żywo — a plan wykluczył realtime **wprost** (§What We're NOT Doing): strona odświeża się po WŁASNEJ akcji właściciela, a zapis z innej przeglądarki wymaga ręcznego odświeżenia. Doszła za to rzecz, której `Outcome` nie zapowiadał: zwalnianie terminu przez właściciela (`release_slot` + trasa + wyspa), wciągnięte do tego slice'u decyzją z 2026-09-08 jako domknięcie FR-006.
- **S-06: właściciel może **odwołać** okres opieki — jednym działaniem, które unieważnia link zapraszający (odwołany wyjazd, wrażliwy link) i jest nieodwracalne na każdej ścieżce produktowej: nie ma un-revoke, a `regenerate_period_token` odmawia odwołanemu okresowi. Jest to **decyzja produktowa, nie ograniczenie schematu** — `care_periods_update_own` nie ma granularności kolumnowej, więc bezpośredni UPDATE właściciela wciąż tę kolumnę czyści. Opiekun, który zajął termin **i wciąż ma swoją capability**, dowiaduje się przy wejściu na link, że wyjazd został odwołany, zamiast widzieć tę samą martwą stronę co obcy; po zwolnieniu jego terminu albo utracie ciasteczka wraca do strony generycznej.** — Archived 2026-09-11 → `context/archive/2026-09-09-close-care-period/`. Lesson: —.
