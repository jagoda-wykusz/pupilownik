---
project: "Pupilownik"
version: 1
status: draft
created: 2026-06-26
context_type: greenfield
product_type: web-app
target_scale:
  users: medium
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: 2026-07-18
  after_hours_only: true
---

# Pupilownik — PRD

## Vision & Problem Statement

Prywatny właściciel zwierząt domowych, planujący okres nieobecności (wyjazd, urlop), dziś organizuje opiekę seryjnie przez social media — pyta zaufane osoby po kolei. Osoby zwlekające z odpowiedzią blokują pytanie kolejnych, ciężar całego okresu spada na jedną osobę, brakuje widoczności która część okresu jest już obsadzona, a skomplikowane instrukcje karmienia trudno wiarygodnie przekazać każdemu opiekunowi z osobna.

Insight: równoległy, samoobsługowy zapis na sloty wewnątrz zamkniętego, zaufanego kręgu (zapraszanego linkiem) usuwa wąskie gardło seryjnego pytania i rozkłada obciążenie na wiele osób. To nie marketplace opiekunów ani publiczne ogłoszenie — krąg jest wąski i zaufany, a właściciel definiuje podopiecznych wraz z instrukcjami opieki w jednym miejscu, do którego trafia każdy opiekun.

## User & Persona

Główna persona: prywatny właściciel zwierząt domowych, planujący okres nieobecności, który chce rozłożyć opiekę między kilka zaufanych osób zamiast obciążać jedną. Należy do szerszej niszy podobnych właścicieli — produkt celuje w wielu takich użytkowników, ale każda instancja użycia to zamknięty, prywatny krąg zaufanych opiekunów zapraszanych linkiem.

### Secondary persona

Opiekun — zaufana osoba wchodząca pod link, która przegląda instrukcje i zapisuje się na sloty. Nie zakłada konta, ale jest kluczowym aktorem w głównym przepływie produktu.

## Success Criteria

### Primary

- Pełna ścieżka MVP działa end-to-end: właściciel definiuje zwierzę z instrukcjami, tworzy okres opieki i wysyła link, a co najmniej jeden opiekun samodzielnie zapisuje się na slot — bez seryjnego dopytywania przez właściciela.

### Secondary

- Opiekunowie widzą imiona — kto zajął który slot — co ułatwia wzajemną koordynację w obrębie okresu. (Mile widziane; nie przesądza o sukcesie v1.)

### Guardrails

- **Brak podwójnej obsady slotu** — dwóch opiekunów nie może zająć tego samego slotu; widoczność zajęty/wolny jest zawsze prawdziwa.
- **Dostęp tylko dla osób z linku** — instrukcje i kalendarz nie wyciekają poza zaproszony krąg (instrukcje bywają wrażliwe: adres, kody dostępu).
- **Instrukcje zawsze aktualne** — opiekun widzi najnowszą wersję instrukcji karmienia; rozjazd tu oznacza głodne lub przekarmione zwierzę.
- **Brak utraty zapisów** — raz zajęty slot nie znika; właściciel może na nim polegać.

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
  >
  > **Wdrożone 2026-09-11 jako JEDNA akcja („odwołaj"), nie dwie.** Słowo „zamknąć" zostaje w brzmieniu FR, ale nie stało się osobnym działaniem, i to jest rozstrzygnięcie, nie przeoczenie: §Access Control poniżej opisuje zamknięcie i odwołanie jako jeden identyczny efekt („po zamknięciu/odwołaniu okresu link przestaje działać"), kontrargument „okres mija sam" został wyżej **przyjęty** jako trafny, a schemat ma dokładnie jedną oś lifecycle (`care_periods.revoked_at`) — osobne „zamknięte" byłoby pierwszą w tym projekcie kolumną stanu, przy priorytecie nice-to-have. Odwołanie jest **nieodwracalne** (brak un-revoke; `regenerate_period_token` odmawia odwołanemu okresowi). Doszła rzecz, której FR nie zapowiadał: opiekun, który zajął już termin, dostaje przy wejściu na link odrębną odpowiedź „wyjazd został odwołany" zamiast tej samej martwej strony co obcy — jedno bit informacji za bramką `claim_digest`, opisane jako drugie poszerzenie reguły 4 w `docs/reference/data-access.md`.

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

## Non-Functional Requirements

- Zajęcie slotu jest atomowe: przy równoczesnej próbie dwóch opiekunów slot otrzymuje dokładnie jeden, a drugi dostaje czytelną odmowę — podwójna obsada nie powstaje nigdy.
- Wrażliwa część instrukcji (adres, kody dostępu) nie jest dostępna bez ważnego linku ani przed zajęciem slotu; nie wycieka poza zaproszony krąg.
- Użytkownik widzi potwierdzenie zajęcia/zwolnienia slotu i zaktualizowaną dostępność niemal natychmiast (cel: < 1 s w odczuciu użytkownika).
- Produkt pozostaje wygodny w obsłudze na mobilnych przeglądarkach — opiekun otwiera link głównie na telefonie.

## Business Logic

Aplikacja zarządza współdzieloną pulą slotów opieki (per pora dnia): przydziela każdy slot dokładnie jednemu opiekunowi na zasadzie „kto pierwszy, ten lepszy", utrzymuje aktualną dostępność widoczną dla całego kręgu i udostępnia opiekunom instrukcje opieki w odpowiednim zakresie.

Wejścia reguły (jako dane od użytkownika, nie komponenty systemu): definicja zwierząt i instrukcji opieki, zakres dat okresu i jego pory dnia, oraz zgłoszenia opiekunów zajmujące konkretny slot (wraz z imieniem). Wyjście: jednoznaczny przydział „slot → opiekun", aktualny obraz dostępności okresu oraz odpowiedni zakres instrukcji odsłonięty danej osobie.

Użytkownik napotyka regułę w głównym przepływie tak: właściciel widzi obsadę całego okresu w jednym miejscu; opiekun widzi tylko wolne sloty i może zająć któryś, po czym znika on z puli dla pozostałych, a jemu odsłaniają się pełne instrukcje. Domena nie jest pustym CRUD-em, bo aplikacja podejmuje decyzję o wyłącznym przydziale slotu i o zakresie widoczności instrukcji — to nie jest samo przechowywanie wpisów.

## Access Control

Płaski, dwurolowy model dostępu:

- **Właściciel** — uwierzytelniany przez email + hasło. Zakłada konto, definiuje zwierzęta i instrukcje opieki, tworzy okresy opieki, generuje linki zapraszające. Ma pełny dostęp wyłącznie do własnych danych.
- **Opiekun** — wchodzi przez link zapraszający, bez zakładania konta. Przy zapisie na slot podaje tylko imię. Widzi publiczną część instrukcji oraz kalendarz danego okresu; po zajęciu slotu odsłania mu się wrażliwa część instrukcji. Nie ma wglądu w panel właściciela ani w inne okresy/zwierzęta poza tymi, których dotyczy link.

Brak ról administracyjnych i warstw uprawnień w MVP. Nieuwierzytelniony użytkownik trafiający na trasę panelu właściciela jest kierowany do logowania; dostęp opiekuna jest ograniczony zakresem linku, a po zamknięciu/odwołaniu okresu link przestaje działać.

## Non-Goals

- **Brak kont i tożsamości opiekunów** — opiekun zostaje przy modelu „link + imię"; żadnych logowań, profili ani historii. Rationale: tarcie zabija adopcję w zaufanym kręgu.
- **Brak listy rezerwowej / kolejkowania** — obowiązuje wyłącznie „kto pierwszy, ten lepszy"; rezerwa na zajęty slot to kierunek na przyszłość (zob. Open Questions), nie v1.
- **Brak powiadomień push/email** — w v1 nie ma automatycznych przypomnień ani maili; widok obsady i samoobsługa wystarczają. (Nie dotyczy maila używanego do logowania właściciela.)
- **Brak marketplace i płatności** — to nie giełda opiekunów ani system płatności; produkt obsługuje wyłącznie zamknięty, zaufany krąg zapraszany linkiem.

## Open Questions

1. **Strukturalny harmonogram karmienia (obrotowa miska)** — czy/jak modelować godziny otwierania komór i gramaturę na komorę jako dane strukturalne zamiast wolnego tekstu. Odłożone z FR-003 do v2. Owner: użytkownik.
2. **Skalowanie reguły przydziału** — przy ~100× skali zasada „kto pierwszy, ten lepszy" może nie wystarczyć; rozważyć kolejkowanie / listę rezerwową (opiekun „w rezerwie" na zajęty slot). Kierunek na przyszłość, poza MVP. Owner: użytkownik.
3. **Wyścig przy zwalnianiu terminu** — `release_slot` nie ma optymistycznej blokady: zwolniony termin wraca do stanu `claimed_by_name is null`, czyli dokładnie tego, w który wpisuje się `claim_slots`. Sekwencja „karta właściciela pokazuje Anię → druga karta zwalnia → Basia zajmuje przez wciąż żywy link → pierwsza karta zwalnia na nieaktualnym widoku" po cichu kasuje świeży zapis Basi. Przyjęte na MVP (potrzebne dwie równoczesne sesje właściciela, a slot i tak kończy jako wolny); do rozstrzygnięcia, gdyby doszli współwłaściciele albo realtime — wtedy argument `p_claimed_at` wpięty w WHERE zamyka okno. Owner: użytkownik.
4. **Czy „wyjazd się skończył" ma być w ogóle pojęciem w produkcie** — dziś nie jest: żadne z trzech anonimowych drzwi nie ma predykatu daty, więc link wyjazdu, który minął pół roku temu, nadal się rozwiązuje, nadal odsłania klucze i nadal przyjmuje zapisy. To żywa konsekwencja świadomej decyzji S-02 o braku auto-wygaszania („opiekun potrzebuje wskazówek jeszcze ostatniego wieczoru; auto-wygaszanie zawodzi dokładnie wtedy"), a nie luka. S-06 tego nie zmienił i wprost wykluczył ze zakresu — wprowadzenie stanu wyprowadzonego z daty byłoby pierwszym takim w produkcie. Do rozstrzygnięcia, gdyby liczba archiwalnych wyjazdów zaczęła przeszkadzać. Owner: użytkownik.
5. **Czy odwołanie wyjazdu ma zwalniać już zajęte terminy** — dziś nie zwalnia: odwołanie zapisuje jedną kolumnę i nie rusza danych zapisów, więc opiekunowie zostają „przypisani" do wyjazdu, którego nie ma. Rozstrzygnięte w S-06 na „nie". **Sprostowanie 2026-09-11:** pierwotnie zapisany powód pochodził ze stanu przed fazą 2 i był odwrócony — twierdził, że 404 powstaje, zanim `claim_digest` zostanie przeczytany, więc masowe zwolnienie nic by opiekunowi nie zmieniło. Faza 2 obróciła oba te twierdzenia: digest jest czytany **pierwszy**, a `release_slot` zeruje `claim_digest`, więc zwolnienie terminów posiadacza wywala go z bramki claimu i **odbiera mu** kartę „wyjazd został odwołany", zwracając martwy link obcego (zmierzone: `{"revoked": true}` przed zwolnieniem, `NULL` po). Masowe zwolnienie zmienia więc dokładnie to, co opiekun widzi, i zmienia na gorsze — co czyni tę decyzję lepiej uzasadnioną, niż mówiła pierwotna notka. Osobna decyzja produktowa, wymagałaby własnej funkcji masowej (`release_slot` nie nadaje się: skalarne arity i skalarny zwrot nie wyrażą „zwolniono 7 z 12"). Owner: użytkownik.
