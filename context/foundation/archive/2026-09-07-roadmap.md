---
project: "Pupilownik"
version: 1
status: draft
created: 2026-06-27
updated: 2026-09-06
prd_version: 1
design_ref: "context/design/Pupilownik Hi-fi.html"
main_goal: speed
top_blocker: time
---

# Roadmap: Pupilownik

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline (project już zbootstrapowany z 10x-astro-starter).
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

Pupilownik pozwala właścicielowi zwierząt rozłożyć opiekę na okres nieobecności między kilka zaufanych osób, zamiast pytać je seryjnie przez social media. Właściciel definiuje podopiecznych wraz z instrukcjami opieki, tworzy okres opieki ze slotami per pora dnia i wysyła jeden link zapraszający; zaproszeni samodzielnie i równolegle zapisują się na wolne sloty. Rdzeń wartości (to, co odróżnia produkt od zwykłego współdzielonego kalendarza) to **wyłączny przydział slotu w obrębie zamkniętego kręgu** — aplikacja gwarantuje, że żaden slot nie zostanie obsadzony podwójnie i że wrażliwe instrukcje (adres, kody) odsłaniają się dopiero osobie, która faktycznie wzięła slot.

## North star

**S-03: Opiekun otwiera link i zajmuje wolny slot** — to najmniejsza pełna (end-to-end) ścieżka, której dowiezienie udowadnia, że produkt działa, więc sekwencjonujemy ją tak wcześnie, jak pozwalają prerekwizyty.

> „Gwiazda przewodnia" oznacza tu najmniejszy przepływ od początku do końca, którego udane dowiezienie potwierdza główną hipotezę produktu — umieszczony najwcześniej, jak pozwalają zależności, bo cała reszta ma znaczenie tylko wtedy, gdy ten fragment zadziała. Tutaj jest to pierwszy samodzielny zapis opiekuna przez link, zgodny z kryterium sukcesu Primary z PRD.

## At a glance

| ID   | Change ID                   | Outcome (user can …)                                             | Prerequisites | PRD refs                      | Status   |
| ---- | --------------------------- | ---------------------------------------------------------------- | ------------- | ----------------------------- | -------- |
| F-01 | owner-data-rls-baseline     | (foundation) bezpieczny wzorzec dostępu do danych właściciela    | —             | NFR (privacy), Access Control | done     |
| S-01 | pet-and-instructions        | właściciel definiuje zwierzę z instrukcjami (publiczna+wrażliwa) | F-01          | FR-001, FR-002, FR-003, US-01 | done     |
| S-02 | care-period-and-invite-link | właściciel tworzy okres ze slotami i generuje link zapraszający  | S-01          | FR-004, FR-005, US-01         | done     |
| S-08 | period-pets-relation        | właściciel wskazuje, które zwierzęta obejmuje wyjazd             | S-02          | FR-002, US-01                 | done     |
| S-03 | caretaker-claims-slot       | opiekun otwiera link i zajmuje wolny slot (bez podwójnej obsady) | S-08          | FR-007, FR-008, FR-009, US-02 | proposed |
| S-04 | owner-occupancy-view        | właściciel widzi pełną obsadę okresu — kto zajął którą porę      | S-03          | FR-006, US-01                 | proposed |
| S-05 | caretaker-names-visibility  | opiekun widzi imiona innych opiekunów w obrębie okresu           | S-03          | FR-011                        | proposed |
| S-06 | close-care-period           | właściciel zamyka/odwołuje okres i unieważnia link               | S-02          | FR-012                        | proposed |
| S-07 | ui-design-system            | aplikacja wygląda wg hi-fi designu — system wizualny + reskin auth | —             | (UI wszystkich FR)            | done     |

## Design reference

Hi-fi design (`context/design/Pupilownik Hi-fi.html`, tryby: jasny / ciemny / trzeci) dostarcza wizualną referencję dla **całego** MVP, nie tylko logowania. Każdy zaprojektowany ekran realizuje odpowiedni slice, używając systemu komponentów z **S-07**. Design nie jest osobną poziomą warstwą UI — poza S-07 (system + reskin auth) ekrany domenowe powstają w swoich slice'ach.

| Ekran w designie                     | Realizuje slice                                  |
| ------------------------------------ | ------------------------------------------------ |
| Logowanie / Logowanie · desktop      | S-07 (reskin istniejących `signin`/`signup`)     |
| Panel właściciela                    | S-04 (widok obsady okresu)                        |
| Dodaj zwierzę + instrukcje           | S-01 (zwierzę + instrukcje public/sensitive)      |
| Nowy wyjazd + link                   | S-02 (okres + link) + S-08 (wybór zwierząt)       |
| Kalendarz opiekuna (zapis na sloty)  | S-03 (opiekun zajmuje slot)                       |
| Po zapisaniu · instrukcje            | S-03 (odsłonięcie wrażliwych instrukcji) / S-01   |

System wizualny (z S-07): fonty **Quicksand** (nagłówki) + **Nunito** (tekst); akcent śliwkowo-różowy `#9C5470` (jasny) / `#E59AB6` (ciemny); tło ciepła biel `#FAF6F3` / ciemne `#211D24`; duże, miękkie zaokrąglenia i delikatne cienie; komponenty: input (z „Pokaż" dla hasła), przycisk primary/outline/Google, karta pupila z okrągłym slotem zdjęcia, element listy instrukcji (badge pory + tytuł + opis), callout wrażliwych danych, chip, nagłówek sekcji, panel-hero (desktop), baner sukcesu; pełne wsparcie trybu jasnego i ciemnego.

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                          | Chain                                      | Note                                                                                    |
| ------ | ------------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------- |
| A      | Rdzeń: od zwierzęcia do zapisu | `F-01` → `S-01` → `S-02` → `S-08` → `S-03` → `S-04` | Ścieżka must-have; zawiera gwiazdę przewodnią `S-03`. Zgodna z celem `szybkość`.        |
| B      | Dodatki (nice-to-have)         | `S-05` / `S-06`                            | `S-06` dołącza do Stream A przy `S-02`, `S-05` przy `S-03`; równoległe względem siebie. |
| C      | UI / system wizualny           | `S-07`                                     | Bez prerekwizytów; powinien wylądować wcześnie (równolegle z/przed `S-01`), bo slice'y domenowe konsumują jego komponenty. Ekrany domenowe realizują swoje slice'y wg designu (zob. Design reference). |

## Baseline

What's already in place in the codebase as of `2026-06-27` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 6 + React 19 + Tailwind 4 + shadcn/ui; ekrany auth (`src/pages/auth/signin.astro`, `signup.astro`, `dashboard.astro`) działają. Brak ekranów domenowych Pupilownika.
- **Backend / API:** present — Astro SSR (`astro.config.mjs:11`); trasy `src/pages/api/auth/{signin,signup,signout}.ts` z realną logiką Supabase. Brak endpointów domenowych.
- **Data:** absent — `supabase/` zawiera tylko `config.toml`; brak migracji, brak tabel domenowych (pets, okresy, sloty, instrukcje), zero zapytań `.from()`.
- **Auth:** present — Supabase email+hasło w pełni podpięte (`src/lib/supabase.ts`, `src/middleware.ts:4-25` chroni `/dashboard` → `/auth/signin`).
- **Deploy / infra:** present — Cloudflare Workers skonfigurowane (`wrangler.jsonc`, adapter `cloudflare()`, `dist/` zbudowane, deploy ręczny). CI/CD opisane w `infrastructure.md`, ale brak `.github/workflows/` / Workers Builds podpiętego.
- **Observability:** partial — natywna obserwowalność Cloudflare włączona (`wrangler.jsonc:12-14`); brak warstwy aplikacyjnej (logger, error tracking, metryki).

## Foundations

### F-01: Wzorzec dostępu do danych właściciela (migracje + RLS)

- **Outcome:** (foundation) ustalony bezpieczny wzorzec persystencji: działający przepływ migracji Supabase, polityki Row-Level Security izolujące dane do właściciela-właściciela oraz typowany helper zapytań. Nie tworzy jeszcze tabel domenowych — ustanawia kontrakt „jak bezpiecznie dotykamy danych".
- **Change ID:** owner-data-rls-baseline
- **PRD refs:** NFR (wrażliwe dane nie wyciekają poza krąg), Access Control (właściciel ma dostęp wyłącznie do własnych danych)
- **Unlocks:** S-01 (pierwsza warstwa danych domenowych, która zakłada izolację właściciela); redukuje ryzyko guardrail „pełny dostęp wyłącznie do własnych danych"; ustanawia wzorzec migracji wymagany przez wszystkie kolejne slice'y danych.
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Warstwa danych jest jedyną nieobecną (`supabase/` ma tylko `config.toml`), a inwestycja celowo idzie tutaj — RLS przed pierwszą tabelą domenową zapobiega wyciekowi danych między właścicielami. Ryzyko: przeinwestowanie w schemat z góry; trzymane minimalnie (wzorzec + RLS, tabele dokładają slice'y).
- **Status:** done

## Slices

### S-01: Właściciel definiuje zwierzę z instrukcjami

- **Outcome:** zalogowany właściciel może dodać zwierzę (nazwa, gatunek / podstawowe dane) i zapisać instrukcje opieki jako wolny tekst z podziałem na część publiczną i część wrażliwą (odsłanianą później).
- **Change ID:** pet-and-instructions
- **PRD refs:** FR-001 (spełnione przez istniejący auth — tu eksponowane jako precondition zalogowanego właściciela), FR-002, FR-003, US-01 (część)
- **Prerequisites:** F-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Pierwszy slice domenowy; sprawdza wzorzec z F-01 na realnej encji. Podział public/sensitive instrukcji musi być w modelu danych od początku, bo S-03 na nim polega — wprowadzenie go później wymusiłoby migrację danych.
- **Status:** done

### S-02: Właściciel tworzy okres opieki ze slotami i generuje link

- **Outcome:** właściciel może utworzyć okres opieki (zakres dat), który generuje sloty per pora dnia (rano / popołudnie / wieczór) dla każdego dnia, oraz wygenerować link zapraszający prowadzący wyłącznie do tego okresu.
- **Change ID:** care-period-and-invite-link
- **PRD refs:** FR-004, FR-005, US-01 (część)
- **Prerequisites:** S-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - ~~Granularność/zakres pór dnia~~ — ROZSTRZYGNIĘTE 2026-09-06 przez użytkownika: **stały zestaw trzech pór — rano, popołudnie, wieczór.** Nie konfigurowalny w v1. Uwaga: wcześniejsza treść tego punktu zakładała dwie pory (rano/wieczór); są trzy, co zmienia liczbę slotów generowanych na dzień.
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
- **Risk:** Odblokowuje FR-008 dla S-03, który bez tej relacji nie ma jak dosięgnąć instrukcji — nic nie łączy okresu ze zwierzęciem, a instrukcje wiszą na zwierzęciu. Zakres wyszedł po cichu z S-02 (selektor „KTÓRE ZWIERZĘTA" z ekranu „Nowy wyjazd + link"), więc to domknięcie długu, nie nowa funkcjonalność. Główne ryzyko techniczne: predykat RLS na tabeli łączącej musi sprawdzać OBA końce — właściciela okresu i właściciela zwierzęcia — bo pojedynczy warunek jest IDOR-em, który ujawni się dopiero wtedy, gdy S-03 dowiezie odsłanianie instrukcji.
- **Status:** done

### S-03: Opiekun otwiera link i zajmuje wolny slot

- **Outcome:** opiekun może wejść przez link bez logowania, zobaczyć publiczną część instrukcji i kalendarz okresu, a następnie podać imię i zająć wolny slot; przydział jest atomowy (nigdy podwójna obsada), a po zajęciu odsłaniają się wrażliwe instrukcje. (Gwiazda przewodnia.)
- **Change ID:** caretaker-claims-slot
- **PRD refs:** FR-007, FR-008, FR-009, US-02, NFR (atomowość zajęcia slotu)
- **Prerequisites:** S-08
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - ~~Mechanizm gwarancji atomowości przy równoległym zajęciu~~ — ROZSTRZYGNIĘTE 2026-09-06 w researchu: `update ... where id = $1 and claimed_by_name is null` pod READ COMMITTED daje dokładnie jednego zwycięzcę — przegrany blokuje się na wierszu, po commicie zwycięzcy ponownie sprawdza warunek WHERE i aktualizuje 0 wierszy. CHECK `care_slots_claim_complete` z S-02 czyni predykat „wolny" wiarygodnym. Uwaga: test współbieżności w tym harnessie dowodzi WYNIKU, nie zadziałania blokady wiersza.
  - ~~Jednostka odsłonięcia wrażliwych instrukcji: zdarzenie czy osoba~~ — ROZSTRZYGNIĘTE 2026-09-06 przez użytkownika: **per OSOBA, która zajęła slot** (nie każdy posiadacz linku). Wymaga sekretu per zajęcie — digest w bazie, surowa wartość raz do przeglądarki — i pierwszego w tym repo cookie ustawianego serwerowo. Przyjmuje lekką tożsamość opiekuna, którą PRD odłożyło do v2 (`prd.md:116`), jako capability, nie konto. Ograniczenie techniczne: `get_period_by_token` jest `STABLE`, więc zajęcie musi być osobną funkcją `VOLATILE`.
  - Pole `NOTATKA` z designu (wolny tekst na poziomie okresu, treścią zachodzący na `is_sensitive`) — wymaganie czy artefakt designu? Przypisane do tego slice'a 2026-09-06. Owner: użytkownik. Block: no.
- **Risk:** Najbardziej ryzykowny slice i sedno produktu: równoczesne zajęcie tego samego slotu musi dać dokładnie jednego zwycięzcę, a wrażliwe instrukcje nie mogą wyciec przed zajęciem. Sekwencjonowany najwcześniej, jak pozwala łańcuch S-01→S-02 — zgodnie z gwiazdą przewodnią.
- **Status:** proposed

### S-04: Właściciel widzi pełną obsadę okresu

- **Outcome:** właściciel widzi w jednym miejscu obsadę całego okresu — które pory są wolne, które zajęte i przez kogo — aktualizowaną w miarę zapisów opiekunów.
- **Change ID:** owner-occupancy-view
- **PRD refs:** FR-006, US-01 (domknięcie)
- **Prerequisites:** S-03
- **Parallel with:** S-05
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Domyka pętlę wartości po stronie właściciela. Zależy od istnienia zapisów (S-03), bo „przez kogo" wymaga zajętych slotów. Aktualizacja niemal-natychmiastowa (NFR < 1 s) jest celem odczuwalnym, nie twardym SLA.
- **Status:** proposed

### S-05: Widoczność imion w obrębie kręgu

- **Outcome:** opiekun widzi imiona innych opiekunów, którzy zajęli sloty w tym samym okresie, co wspiera wzajemną koordynację (Secondary success).
- **Change ID:** caretaker-names-visibility
- **PRD refs:** FR-011 (nice-to-have)
- **Prerequisites:** S-03
- **Parallel with:** S-04, S-06
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Nice-to-have wspierający kryterium Secondary; nie blokuje launchu. Sekwencjonowany po gwieździe przewodniej zgodnie z celem `szybkość` (najpierw ścieżka must-have).
- **Status:** proposed

### S-06: Właściciel zamyka / odwołuje okres

- **Outcome:** właściciel może zamknąć lub odwołać okres opieki, unieważniając link zapraszający (np. odwołany wyjazd, wrażliwy link).
- **Change ID:** close-care-period
- **PRD refs:** FR-012 (nice-to-have)
- **Prerequisites:** S-02
- **Parallel with:** S-03, S-04, S-05
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Nice-to-have; zależy tylko od istnienia okresu z linkiem (S-02), więc może iść równolegle do całej gałęzi opiekuna. Parkowany na koniec zgodnie z celem `szybkość`.
- **Status:** proposed

### S-07: Implementacja UI wg dostarczonego designu (system wizualny + reskin auth)

- **Outcome:** aplikacja wygląda zgodnie z hi-fi designem — ustanowiony system wizualny (tokeny kolorów, fonty Quicksand/Nunito, zaokrąglenia, cienie, tryb jasny/ciemny) oraz zestaw bazowych komponentów (przycisk, input z „Pokaż" hasła, karta, chip, badge pory, callout wrażliwych danych, nagłówek sekcji, panel-hero, baner sukcesu). Istniejące ekrany logowania/rejestracji (`src/pages/auth/signin.astro`, `signup.astro`) są przeskórowane do designu. Ekrany domenowe (pupile, okresy, kalendarz opiekuna, panel właściciela) **nie** powstają tutaj — są realizowane w swoich slice'ach (S-01…S-04) przy użyciu tego systemu (zob. Design reference).
- **Change ID:** ui-design-system
- **PRD refs:** przekrojowo dla UI wszystkich FR (bez własnej reguły biznesowej); design: `context/design/Pupilownik Hi-fi.html`
- **Prerequisites:** — (nie zależy od warstwy danych; dotyka istniejących ekranów auth)
- **Parallel with:** S-01, S-02 (niezależny od danych; powinien wylądować wcześnie, by slice'y domenowe konsumowały komponenty)
- **Blockers:** —
- **Unknowns:**
  - Wybór warstwy komponentów: rozbudować istniejące shadcn/ui (obecne w starterze) czy własne komponenty na Tailwind 4 tokenach? — Owner: team. Block: no (rozstrzygane w `/10x-plan`).
  - Mechanizm trybu ciemnego (klasa `dark` Tailwind vs `prefers-color-scheme`) i czy jest w zakresie v1. — Owner: użytkownik. Block: no.
- **Risk:** Poziomy, przekrojowy slice — ryzyko przeinwestowania w system komponentów zanim istnieją ekrany domenowe, oraz driftu między systemem a późniejszymi slice'ami. Trzymany minimalnie: tokeny + komponenty faktycznie użyte przez auth teraz, reszta dokładana przez slice'y domenowe wg designu. Nie blokuje ścieżki must-have (S-01→S-03), więc może iść równolegle, ale wcześnie daje spójny wygląd wszystkim kolejnym slice'om.
- **Status:** done

## Backlog Handoff

| Roadmap ID | Change ID                   | Suggested issue title                                           | Ready for `/10x-plan` | Notes                                   |
| ---------- | --------------------------- | --------------------------------------------------------------- | --------------------- | --------------------------------------- |
| F-01       | owner-data-rls-baseline     | Wzorzec dostępu do danych: migracje + RLS izolujące właściciela | yes                   | Run `/10x-plan owner-data-rls-baseline` |
| S-01       | pet-and-instructions        | Definicja zwierzęcia + instrukcje (public/sensitive)            | no                    | Po F-01                                 |
| S-02       | care-period-and-invite-link | Okres opieki ze slotami + link zapraszający                     | no                    | Po S-01                                 |
| S-08       | period-pets-relation        | Relacja okres ↔ zwierzęta (odblokowuje instrukcje opiekuna)     | yes                   | Plan gotowy → `/10x-implement`          |
| S-03       | caretaker-claims-slot       | Opiekun zajmuje slot przez link (atomowo)                       | no                    | Gwiazda przewodnia; po S-08             |
| S-04       | owner-occupancy-view        | Widok obsady okresu dla właściciela                             | no                    | Po S-03                                 |
| S-05       | caretaker-names-visibility  | Widoczność imion opiekunów w okresie                            | no                    | Nice-to-have; po S-03                   |
| S-06       | close-care-period           | Zamknięcie/odwołanie okresu + unieważnienie linku               | no                    | Nice-to-have; po S-02                   |
| S-07       | ui-design-system            | System wizualny wg hi-fi designu + reskin ekranów auth          | yes                   | Bez prerekwizytów; wcześnie, równolegle z S-01. `/10x-plan ui-design-system` |

## Open Roadmap Questions

1. **Strukturalny harmonogram karmienia (obrotowa miska)** — czy/jak modelować godziny otwierania komór i gramaturę na komorę jako dane strukturalne zamiast wolnego tekstu. Odłożone z FR-003 do v2. Owner: użytkownik. Block: roadmap-wide (poza MVP — nie blokuje żadnego slice'a v1).
2. **Skalowanie reguły przydziału** — przy ~100× skali zasada „kto pierwszy, ten lepszy" może nie wystarczyć; rozważyć kolejkowanie / listę rezerwową. Kierunek na przyszłość, poza MVP. Owner: użytkownik. Block: roadmap-wide (poza MVP).

## Parked

- **Konta i tożsamość opiekunów** — Why parked: PRD §Non-Goals — opiekun zostaje przy modelu „link + imię"; tarcie zabija adopcję.
- **Lista rezerwowa / kolejkowanie na zajęty slot** — Why parked: PRD §Non-Goals — obowiązuje wyłącznie „kto pierwszy, ten lepszy"; kierunek v2 (zob. Open Roadmap Questions #2).
- **Powiadomienia push/email** — Why parked: PRD §Non-Goals — widok obsady i samoobsługa wystarczają na v1 (nie dotyczy maila logowania właściciela).
- **Marketplace i płatności** — Why parked: PRD §Non-Goals — to zamknięty zaufany krąg, nie giełda opiekunów.
- **Opiekun zwalnia własny zapis (FR-010)** — Why parked: wycięte w rundzie Socratesa — bez tożsamości opiekuna trudne i ryzykowne; na v1 wypis robi właściciel ręcznie. Kandydat do v2.
- **Strukturalny harmonogram karmienia (obrotowa miska)** — Why parked: odłożone z FR-003 do v2 (zob. Open Roadmap Questions #1).

## Done

- **F-01: (foundation) ustalony bezpieczny wzorzec persystencji: działający przepływ migracji Supabase, polityki Row-Level Security izolujące dane do właściciela-właściciela oraz typowany helper zapytań. Nie tworzy jeszcze tabel domenowych — ustanawia kontrakt „jak bezpiecznie dotykamy danych".** — Archived 2026-06-27 → `context/archive/2026-06-27-owner-data-rls-baseline/`. Lesson: —.
- **S-01: zalogowany właściciel może dodać zwierzę (nazwa, gatunek / podstawowe dane) i zapisać instrukcje opieki jako wolny tekst z podziałem na część publiczną i część wrażliwą (odsłanianą później).** — Archived 2026-09-05 → `context/archive/2026-07-12-pet-and-instructions/`. Lesson: —.
- **S-07: aplikacja wygląda zgodnie z hi-fi designem — ustanowiony system wizualny (tokeny kolorów, fonty Quicksand/Nunito, zaokrąglenia, cienie, tryb jasny/ciemny) oraz zestaw bazowych komponentów (przycisk, input z „Pokaż" hasła, karta, chip, badge pory, callout wrażliwych danych, nagłówek sekcji, panel-hero, baner sukcesu). Istniejące ekrany logowania/rejestracji (`src/pages/auth/signin.astro`, `signup.astro`) są przeskórowane do designu. Ekrany domenowe (pupile, okresy, kalendarz opiekuna, panel właściciela) **nie** powstają tutaj — są realizowane w swoich slice'ach (S-01…S-04) przy użyciu tego systemu (zob. Design reference).** — Archived 2026-09-06 → `context/archive/2026-09-05-ui-design-system/`. Lesson: „Wylicz konsumentów, zanim zmienisz coś współdzielonego" (`context/foundation/lessons.md`).
- **S-02: właściciel może utworzyć okres opieki (zakres dat), który generuje sloty per pora dnia (rano / popołudnie / wieczór) dla każdego dnia, oraz wygenerować link zapraszający prowadzący wyłącznie do tego okresu.** — Archived 2026-09-06 → `context/archive/2026-09-06-care-period-and-invite-link/`. Lesson: —.
- **S-08: właściciel może wskazać, które ze swoich zwierząt obejmuje okres opieki, i widzi je na liście wyjazdów oraz w szczegółach okresu.** — Archived 2026-09-06 → `context/archive/2026-09-06-period-pets-relation/`. Lesson: „Ubij serwer dev, zanim uruchomisz `npm run build`” (`context/foundation/lessons.md`).
