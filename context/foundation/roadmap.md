---
project: "Pupilownik"
version: 1
status: draft
created: 2026-06-27
updated: 2026-06-27
prd_version: 1
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
| F-01 | owner-data-rls-baseline     | (foundation) bezpieczny wzorzec dostępu do danych właściciela    | —             | NFR (privacy), Access Control | ready    |
| S-01 | pet-and-instructions        | właściciel definiuje zwierzę z instrukcjami (publiczna+wrażliwa) | F-01          | FR-001, FR-002, FR-003, US-01 | proposed |
| S-02 | care-period-and-invite-link | właściciel tworzy okres ze slotami i generuje link zapraszający  | S-01          | FR-004, FR-005, US-01         | proposed |
| S-03 | caretaker-claims-slot       | opiekun otwiera link i zajmuje wolny slot (bez podwójnej obsady) | S-02          | FR-007, FR-008, FR-009, US-02 | proposed |
| S-04 | owner-occupancy-view        | właściciel widzi pełną obsadę okresu — kto zajął którą porę      | S-03          | FR-006, US-01                 | proposed |
| S-05 | caretaker-names-visibility  | opiekun widzi imiona innych opiekunów w obrębie okresu           | S-03          | FR-011                        | proposed |
| S-06 | close-care-period           | właściciel zamyka/odwołuje okres i unieważnia link               | S-02          | FR-012                        | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                          | Chain                                      | Note                                                                                    |
| ------ | ------------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------- |
| A      | Rdzeń: od zwierzęcia do zapisu | `F-01` → `S-01` → `S-02` → `S-03` → `S-04` | Ścieżka must-have; zawiera gwiazdę przewodnią `S-03`. Zgodna z celem `szybkość`.        |
| B      | Dodatki (nice-to-have)         | `S-05` / `S-06`                            | `S-06` dołącza do Stream A przy `S-02`, `S-05` przy `S-03`; równoległe względem siebie. |

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
- **Status:** ready

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
- **Status:** proposed

### S-02: Właściciel tworzy okres opieki ze slotami i generuje link

- **Outcome:** właściciel może utworzyć okres opieki (zakres dat), który generuje sloty per pora dnia (np. rano/wieczór) dla każdego dnia, oraz wygenerować link zapraszający prowadzący wyłącznie do tego okresu.
- **Change ID:** care-period-and-invite-link
- **PRD refs:** FR-004, FR-005, US-01 (część)
- **Prerequisites:** S-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Granularność/zakres pór dnia — stały zestaw (rano/wieczór) czy konfigurowalny przez właściciela na v1? — Owner: użytkownik. Block: no.
- **Risk:** Wprowadza model dostępu przez nieodgadywalny token linku (bez konta opiekuna) — kontrakt, na którym opiera się guardrail „dostęp tylko dla osób z linku". Sloty generowane z zakresu dat × pory dnia muszą być deterministyczne, by S-03 mógł je bezpiecznie zajmować.
- **Status:** proposed

### S-03: Opiekun otwiera link i zajmuje wolny slot

- **Outcome:** opiekun może wejść przez link bez logowania, zobaczyć publiczną część instrukcji i kalendarz okresu, a następnie podać imię i zająć wolny slot; przydział jest atomowy (nigdy podwójna obsada), a po zajęciu odsłaniają się wrażliwe instrukcje. (Gwiazda przewodnia.)
- **Change ID:** caretaker-claims-slot
- **PRD refs:** FR-007, FR-008, FR-009, US-02, NFR (atomowość zajęcia slotu)
- **Prerequisites:** S-02
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Mechanizm gwarancji atomowości przy równoległym zajęciu (transakcja / unikalny constraint / `update ... where free`) — Owner: team. Block: no (rozstrzygane w `/10x-plan`, nie blokuje sekwencjonowania).
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

## Backlog Handoff

| Roadmap ID | Change ID                   | Suggested issue title                                           | Ready for `/10x-plan` | Notes                                   |
| ---------- | --------------------------- | --------------------------------------------------------------- | --------------------- | --------------------------------------- |
| F-01       | owner-data-rls-baseline     | Wzorzec dostępu do danych: migracje + RLS izolujące właściciela | yes                   | Run `/10x-plan owner-data-rls-baseline` |
| S-01       | pet-and-instructions        | Definicja zwierzęcia + instrukcje (public/sensitive)            | no                    | Po F-01                                 |
| S-02       | care-period-and-invite-link | Okres opieki ze slotami + link zapraszający                     | no                    | Po S-01                                 |
| S-03       | caretaker-claims-slot       | Opiekun zajmuje slot przez link (atomowo)                       | no                    | Gwiazda przewodnia; po S-02             |
| S-04       | owner-occupancy-view        | Widok obsady okresu dla właściciela                             | no                    | Po S-03                                 |
| S-05       | caretaker-names-visibility  | Widoczność imion opiekunów w okresie                            | no                    | Nice-to-have; po S-03                   |
| S-06       | close-care-period           | Zamknięcie/odwołanie okresu + unieważnienie linku               | no                    | Nice-to-have; po S-02                   |

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

(Empty on first generation. `/10x-archive` appends entries here when a matching change is archived.)
