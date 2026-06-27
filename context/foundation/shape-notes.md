---
project: "Pupilownik"
context_type: greenfield
created: 2026-06-26
updated: 2026-06-26
product_type: web-app
target_scale:
  users: medium
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: 2026-07-18
  after_hours_only: true
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "rodzaj bólu"
      decision: "wszystkie cztery: koszt koordynacji, wiedza uwięziona w instrukcjach, nierówny rozkład obciążenia, brak widoczności obsady"
    - topic: "insight / przewaga"
      decision: "zaufany krąg zapraszany linkiem, nie publiczne ogłoszenie / marketplace"
    - topic: "zakres persony"
      decision: "szersza nisza prywatnych właścicieli zwierząt; każda instancja to zamknięty zaufany krąg"
    - topic: "logowanie właściciela"
      decision: "email + hasło"
    - topic: "dostęp opiekuna"
      decision: "link bez konta; przy zapisie na slot podaje tylko imię"
    - topic: "granularność slotów"
      decision: "sloty per pora dnia (np. rano/wieczór), nie całodniowe"
    - topic: "format instrukcji"
      decision: "wolny tekst na v1; podział na część publiczną i odsłanianą po zajęciu slotu"
    - topic: "typ produktu i skala"
      decision: "aplikacja webowa; skala medium (dziesiątki–setki właścicieli)"
    - topic: "ramy czasowe"
      decision: "MVP ~3 tyg., deadline 2026-07-18, praca po godzinach"
  frs_drafted: 11
  quality_check_status: accepted
---

# Shape Notes

_Seed idea (verbatim, PL):_

> Pomysłem jest utworzenie serwisu webowego za pomocą którego zaufani dla mnie ludzie będą mogli wpisać się w kalendarz opieki nad moimi zwierzakami. Widzę to tak, że użytkownik definiuje swoje zwierzęta, opisuje ich zwyczaje i inne instrukcje dla opiekunów (np. mam obrotową miskę, która otwiera się o konkretnych godzinach, więc warto było by rozpisać te godziny i ile gramów karmy powinno być w przegródce — miski są różne, niektóre mają 3, 5 albo nawet 6 komór), następnie generuje link i wysyła go zaufanym osobom, te osoby wchodzą pod link i wyświetla im się informacja o okresie kiedy potrzebna jest opieka — za pomocą slotów kalendarza mogą wpisać się na opiekę na dany dzień.

## Vision & Problem Statement

Serwis webowy, w którym właściciel zwierząt definiuje swoich podopiecznych wraz ze szczegółowymi instrukcjami opieki (zwyczaje, karmienie — w tym obrotowe miski z gramaturą i godzinami otwierania komór), a następnie zaprasza linkiem zaufane osoby. Zaproszeni widzą okres, w którym potrzebna jest opieka, i samodzielnie zapisują się na sloty kalendarza w dogodnych dla siebie dniach.

Problem: dziś opieka organizowana jest seryjnie przez social media — pyta się ludzi po kolei. Osoby zwlekające z odpowiedzią blokują pytanie kolejnych, ciężar całego okresu spada na jedną osobę, brakuje widoczności która część okresu jest już obsadzona, a skomplikowane instrukcje karmienia trudno wiarygodnie przekazać każdemu opiekunowi z osobna.

Insight: równoległy, samoobsługowy zapis na sloty wewnątrz zamkniętego, zaufanego kręgu (zapraszanego linkiem) usuwa wąskie gardło seryjnego pytania i rozkłada obciążenie. To nie marketplace opiekunów ani publiczne ogłoszenie — krąg jest wąski i zaufany.

## User & Persona

Główna persona: prywatny właściciel zwierząt domowych, planujący okres nieobecności (wyjazd/urlop), który chce rozłożyć opiekę między kilka zaufanych osób zamiast obciążać jedną. Należy do szerszej niszy podobnych właścicieli — produkt celuje w wielu takich użytkowników, ale każda instancja użycia to zamknięty, prywatny krąg zaufanych opiekunów zapraszanych linkiem.

Druga (pomocnicza) rola w przepływie: **opiekun** — zaufana osoba wchodząca pod link, która przegląda instrukcje i zapisuje się na sloty. Nie jest personą zakładającą konto, ale jest kluczowym aktorem w głównym przepływie.

## Access Control

Płaski, dwurolowy model dostępu:

- **Właściciel** — uwierzytelniany przez email + hasło. Zakłada konto, definiuje zwierzęta i instrukcje opieki, tworzy okresy opieki, generuje linki zapraszające. Ma pełny dostęp wyłącznie do własnych danych.
- **Opiekun** — wchodzi przez link zapraszający, bez zakładania konta. Przy zapisie na slot podaje tylko imię. Widzi instrukcje opieki oraz kalendarz danego okresu; może zająć wolny slot i zwolnić własny zapis. Nie ma wglądu w panel właściciela ani w inne okresy/zwierzęta poza tymi, których dotyczy link.

Brak ról administracyjnych i warstw uprawnień w MVP. Nieuwierzytelniony użytkownik trafiający na trasę panelu właściciela jest kierowany do logowania; dostęp opiekuna jest ograniczony zakresem linku.

## MVP — przepływ pierwszej sesji

1. Właściciel zakłada konto (email + hasło).
2. Dodaje zwierzę + instrukcje opieki (zwyczaje, karmienie — miska, godziny otwierania komór, gramatura).
3. Tworzy okres opieki (zakres dat) ze slotami per pora dnia (np. rano/wieczór).
4. Generuje link zapraszający i wysyła go zaufanym osobom.
5. Opiekun wchodzi z linku → widzi publiczną część instrukcji + kalendarz okresu.
6. Opiekun podaje imię i zapisuje się na wybrany slot; odsłaniają mu się pełne instrukcje.
7. Właściciel widzi obsadę okresu — które pory zajęte, które wolne.

## Success Criteria

### Primary

- Pełna ścieżka MVP działa end-to-end: właściciel definiuje zwierzę z instrukcjami, tworzy okres opieki i wysyła link, a co najmniej jeden opiekun samodzielnie zapisuje się na slot — bez seryjnego dopytywania przez właściciela.

### Secondary

- Opiekunowie widzą imiona — kto zajął który dzień — co ułatwia wzajemną koordynację w obrębie okresu. (Mile widziane; nie przesądza o sukcesie v1.)

### Guardrails

- **Brak podwójnej obsady slotu** — dwóch opiekunów nie może zająć tego samego dnia; widoczność zajęty/wolny jest zawsze prawdziwa.
- **Dostęp tylko dla osób z linku** — instrukcje i kalendarz nie wyciekają poza zaproszony krąg (instrukcje bywają wrażliwe: adres, kody dostępu).
- **Instrukcje zawsze aktualne** — opiekun widzi najnowszą wersję instrukcji karmienia; rozjazd tu oznacza głodne lub przekarmione zwierzę.
- **Brak utraty zapisów** — raz zajęty slot nie znika; właściciel może na nim polegać.

## Functional Requirements

### Konto właściciela

- FR-001: Właściciel może założyć konto i zalogować się (email + hasło). Priority: must-have
  > Socrates: Kontrargument: dla zaufanego kręgu można by zrezygnować z kont na rzecz jednego linku zarządzającego. Rozstrzygnięcie: konto zostaje — właściciel wraca między okresami, może mieć wiele zwierząt, a dane wymagają trwałej, prywatnej tożsamości.

### Definicja zwierząt i instrukcji

- FR-002: Właściciel może zdefiniować zwierzę (nazwa, gatunek / podstawowe dane). Priority: must-have
  > Socrates: Kontrargument: wystarczyłby jeden blok instrukcji na okres bez encji „zwierzę". Rozstrzygnięcie: encja zostaje — jeden okres może obejmować kilka zwierząt o różnych instrukcjach.
- FR-003: Właściciel może zapisać instrukcje opieki dla zwierzęcia jako wolny tekst (zwyczaje, karmienie). Instrukcje dzielą się na część widoczną publicznie i część odsłanianą dopiero po zajęciu slotu. Priority: must-have
  > Socrates: Kontrargument: strukturalny harmonogram miski (godziny + gramy + komory) to przerost na v1. Rozstrzygnięcie: na v1 instrukcje jako wolny tekst; strukturalny harmonogram karmienia przeniesiony do Open Questions / v2.

### Okresy opieki i zaproszenia

- FR-004: Właściciel może utworzyć okres opieki (zakres dat) generujący sloty per pora dnia (np. rano / wieczór), nie całodniowe. Priority: must-have
  > Socrates: Kontrargument: jeden slot na dzień wystarczy. Rozstrzygnięcie: opieka bywa per pora dnia (rano/wieczór), więc slot musi być drobniejszy niż dzień.
- FR-005: Właściciel może wygenerować link zapraszający do okresu opieki. Priority: must-have
  > Socrates: Kontrargument: imienne zaproszenia mailowe zamiast linku. Rozstrzygnięcie: link zostaje — opiekun nie ma konta ani znanego maila; jeden link do wysłania dowolnym kanałem to najniższe tarcie.
- FR-006: Właściciel może zobaczyć obsadę okresu — które pory są zajęte/wolne i przez kogo. Priority: must-have
  > Socrates: Kontrargument: powiadomienia zastępują widok obsady. Rozstrzygnięcie: widok zostaje — to sedno wartości; jeden rzut oka na całość okresu, czego powiadomienia nie dają.
- FR-012: Właściciel może zamknąć / odwołać okres opieki, unieważniając link zapraszający. Priority: nice-to-have
  > Socrates: Kontrargument: okres mija sam, ręczne zamykanie zbędne. Rozstrzygnięcie: przydatne (odwołany wyjazd, wrażliwy link), ale nie blokuje MVP — demote do nice-to-have.

### Dostęp i zapis opiekuna

- FR-007: Opiekun może otworzyć okres opieki przez link, bez logowania. Priority: must-have
  > Socrates: Kontrargument: brak logowania = ryzyko nadużycia linku. Rozstrzygnięcie: bez logowania zostaje — krąg jest zaufany, a tarcie zabija adopcję; sekretny link to wystarczająca bariera na v1.
- FR-008: Opiekun może zobaczyć publiczną część instrukcji od razu po wejściu z linku, a pełne (wrażliwe) instrukcje — adres, kody dostępu — dopiero po zajęciu slotu. Priority: must-have
  > Socrates: Kontrargument: czy instrukcje mają być widoczne od razu, czy dopiero po zapisie? Rozstrzygnięcie: podział — część publiczna (na co się piszę) widoczna przed zapisem; wrażliwe szczegóły odsłaniają się dopiero osobie, która wzięła slot.
- FR-009: Opiekun może zapisać się na wolny slot, podając imię. Priority: must-have
  > Socrates: Kontrargument: imię bez weryfikacji — ktoś może zająć złośliwie lub podać cudze imię. Rozstrzygnięcie: imię wystarczy na v1 — bariera linku + zaufanie kręgu; właściciel widzi obsadę i może reagować.
- FR-011: Opiekun może zobaczyć imiona innych opiekunów, którzy zajęli sloty. Priority: nice-to-have
  > Socrates: Kontrargument: prywatność — czy opiekunowie powinni widzieć siebie nawzajem? Rozstrzygnięcie: imiona zostają widoczne — krąg jest zaufany, a widoczność „kto wziął co" wspiera koordynację (zgodnie z Secondary).

_Wycięte z MVP w rundzie Socratesa:_

- ~~FR-010: Opiekun może zwolnić własny zapis~~ — bez tożsamości opiekuna trudne i ryzykowne; na v1 wypis załatwia właściciel ręcznie. Kandydat do v2 (po dodaniu lekkiej tożsamości opiekuna).

## User Stories

### US-01: Właściciel przygotowuje okres opieki i zaprasza opiekunów

- **Given** zalogowany właściciel z co najmniej jednym zdefiniowanym zwierzęciem i instrukcjami opieki
- **When** tworzy okres opieki (zakres dat) i generuje link zapraszający
- **Then** otrzymuje link do wysłania zaufanym osobom, a okres pojawia się w jego panelu z widokiem obsady (na start wszystkie sloty wolne)

#### Acceptance Criteria

- Utworzenie okresu generuje sloty per pora dnia dla każdego dnia zakresu.
- Link prowadzi wyłącznie do tego okresu i powiązanych instrukcji — nie do panelu właściciela ani innych okresów.
- Właściciel widzi w każdej chwili, które pory są wolne, a które zajęte (i przez kogo).

### US-02: Opiekun zapisuje się na porę opieki

- **Given** zaufana osoba, która otrzymała link do okresu opieki
- **When** otwiera link, czyta publiczną część instrukcji i wybiera wolny slot (pora dnia), podając swoje imię
- **Then** slot zostaje przypisany do niej, znika z puli wolnych dla pozostałych opiekunów, a wrażliwa część instrukcji staje się dla niej widoczna; właściciel widzi slot jako obsadzony

#### Acceptance Criteria

- Próba zajęcia slotu, który właśnie zajął ktoś inny, jest odrzucana z czytelnym komunikatem — nigdy nie powstaje podwójna obsada.
- Opiekun zawsze widzi najnowszą wersję instrukcji opieki.
- Publiczna część instrukcji jest widoczna przed zapisem; wrażliwe szczegóły (adres, kody) dopiero po zajęciu slotu.
- Dostęp do okresu wymaga ważnego linku; po zamknięciu/odwołaniu okresu link przestaje działać.

## Non-Functional Requirements

- Zajęcie slotu jest atomowe: przy równoczesnej próbie dwóch opiekunów slot otrzymuje dokładnie jeden, a drugi dostaje czytelną odmowę — podwójna obsada nie powstaje nigdy.
- Wrażliwa część instrukcji (adres, kody dostępu) nie jest dostępna bez ważnego linku ani przed zajęciem slotu; nie wycieka poza zaproszony krąg.
- Użytkownik widzi potwierdzenie zajęcia/zwolnienia slotu i zaktualizowaną dostępność niemal natychmiast (cel: < 1 s w odczuciu użytkownika).
- Produkt jest wygodny w obsłudze na mobilnych przeglądarkach — opiekun otwiera link głównie na telefonie.

## Business Logic

Aplikacja zarządza współdzieloną pulą slotów opieki (per pora dnia): przydziela każdy slot dokładnie jednemu opiekunowi na zasadzie „kto pierwszy, ten lepszy", utrzymuje aktualną dostępność widoczną dla całego kręgu i udostępnia opiekunom instrukcje opieki w odpowiednim zakresie.

Wejścia reguły (jako dane od użytkownika, nie komponenty systemu): definicja zwierząt i instrukcji opieki, zakres dat okresu i jego pory dnia, oraz zgłoszenia opiekunów zajmujące konkretny slot (wraz z imieniem). Wyjście: jednoznaczny przydział „slot → opiekun", aktualny obraz dostępności okresu oraz odpowiedni zakres instrukcji odsłonięty danej osobie.

Użytkownik napotyka regułę w głównym przepływie tak: właściciel widzi obsadę całego okresu w jednym miejscu; opiekun widzi tylko wolne sloty i może zająć któryś, po czym znika on z puli dla pozostałych, a jemu odsłaniają się pełne instrukcje. Domena nie jest pustym CRUD-em, bo aplikacja podejmuje decyzję o wyłącznym przydziale slotu i o zakresie widoczności instrukcji — to nie jest samo przechowywanie wpisów.

## Non-Goals

- **Brak kont i tożsamości opiekunów** — opiekun zostaje przy modelu „link + imię"; żadnych logowań, profili ani historii. Rationale: tarcie zabija adopcję w zaufanym kręgu.
- **Brak listy rezerwowej / kolejkowania** — obowiązuje wyłącznie „kto pierwszy, ten lepszy"; rezerwa na zajęty slot to kierunek na przyszłość (zob. Open Questions), nie v1.
- **Brak powiadomień push/email** — w v1 nie ma automatycznych przypomnień ani maili; widok obsady i samoobsługa wystarczają. (Nie dotyczy maila używanego do logowania właściciela.)
- **Brak marketplace i płatności** — to nie giełda opiekunów ani system płatności; produkt obsługuje wyłącznie zamknięty, zaufany krąg zapraszany linkiem.

## Open Questions

1. **Strukturalny harmonogram karmienia (obrotowa miska)** — czy/jak modelować godziny otwierania komór i gramaturę na komorę jako dane strukturalne zamiast wolnego tekstu. Odłożone z FR-003 do v2. Owner: użytkownik.
2. **Skalowanie reguły przydziału** — przy ~100× skali zasada „kto pierwszy, ten lepszy" może nie wystarczyć; rozważyć kolejkowanie / listę rezerwową (opiekun „w rezerwie" na zajęty slot). Kierunek na przyszłość, poza MVP. Owner: użytkownik.
