# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Wylicz konsumentów, zanim zmienisz coś współdzielonego

- **Context**: Każdy poziomy slice (system wizualny, refaktor, upgrade zależności) oraz każda
  zmiana w tokenach designu, komponencie `ui/` lub innym module importowanym w więcej niż
  jednym miejscu.
- **Problem**: W S-07 pięć razy plan założył, że zakres jest właścicielem czegoś
  współdzielonego: `bg-cosmic`, `Topbar`, `FormField`, skład komponentów i wreszcie
  `--radius`/`Button`/`ServerError`. Cztery wysypały się w trakcie implementacji; piąte
  przeszło do review, bo nie złamało builda — tylko po cichu zmieniło wygląd ekranów spoza
  zakresu.
- **Rule**: Przed zmianą współdzielonego komponentu, tokenu lub utility wylicz WSZYSTKICH
  konsumentów (grep po nazwie), nie tylko tych w zakresie. Każdy konsument spoza zakresu albo
  migruje świadomie, albo zostaje jawnie odnotowany w §What We're NOT Doing — nie może zostać
  pominięty milczeniem.
- **Applies to**: plan, implement, impl-review

## Weryfikuj posturę systemu z katalogu, nie z komentarza

- **Context**: Każde twierdzenie o stanie systemu, którego nie widać w kodzie aplikacji —
  granty i uprawnienia w bazie, polityki RLS, nagłówki odpowiedzi, volatility funkcji,
  domyślne privileges. Dotyczy też każdego testu, który ma pilnować takiej warstwy.
  **Oraz — i to jest szerszy zasięg niż sugeruje pierwotne brzmienie — każdego dokumentu,
  który zapisuje stan:** pól `Outcome` i `## Done` w roadmapie, rejestru kontraktów
  (`docs/reference/*`), sekcji planu, wpisów w `change.md`. Tam nie istnieje test, który
  mógłby upaść, więc jedyną obroną jest przeczytanie artefaktu przeciw kodowi **w momencie
  pisania**.
- **Problem**: W S-02 zdarzyło się to cztery razy. Trzy razy komentarz migracji opisywał
  posturę grantów, której baza nie miała: `revoke ... from public` nie odbiera uprawnień rolom
  `anon`/`authenticated`/`service_role`, bo Supabase nadaje je osobno przez ALTER DEFAULT
  PRIVILEGES — a S-01 zamknął finding F3 jako naprawiony, opisując stan, którego nie osiągnął.
  Ten sam błąd powtórzył się na poziomie tabel: komentarz twierdził „deliberately NO grant to
  anon", a katalog pokazał pełny zestaw uprawnień. Czwarty raz był w teście: „anon nie może
  czytać tabeli" przechodził, bo `expect(data ?? []).toEqual([])` nie odróżnia odmowy 42501 od
  pustego wyniku po RLS — przeszedłby po usunięciu całej warstwy grantów, którą miał pilnować.
- **Problem (2026-09-07, rozszerzenie na dokumenty)**: ta sama klasa wystąpiła trzy razy
  w jeden dzień, ani razu w SQL-u. (1) Wpis `## Done` dla S-07 w roadmapie twierdził, że
  wylądowały: karta, chip, badge pory, callout wrażliwych danych i baner sukcesu — a plan
  S-07 wykluczył je **wprost** we własnym §What We're NOT Doing. (2) To samo zdanie stało
  w polu `Outcome` slice'u, bo `/10x-archive` kopiuje `Outcome` żywcem do `## Done`:
  **aspiracyjne zdanie z etapu planowania zamienia się w rekord historyczny bez żadnego kroku,
  który skonfrontowałby je z kodem.** To pułapka strukturalna, nie niedbalstwo. (3) Kilka
  godzin po przeczytaniu tej lekcji dopisałem do `contract-surfaces.md`, że `caretaker_note`
  jest „served only by `get_claimed_details`" — funkcję, która miała powstać dopiero dwie fazy
  później. Wniosek o samej lekcji: w pierwotnym brzmieniu czyta się ona jak reguła o SQL-u
  i grantach, więc **nie odpala się, gdy pisze się prozę** — a to teraz jej częstszy przypadek.
- **Rule**: Nigdy nie przyjmuj twierdzenia o posturze systemu na podstawie komentarza, planu
  ani intencji migracji. Odczytaj je z katalogu (`has_function_privilege`,
  `information_schema.role_table_grants`, `pg_policies`, `pg_proc`) albo przypnij testem, który
  UPADA, gdy postura znika. Asercja przechodząca również przy braku tej warstwy nie jest jej
  testem, tylko jej opisem.
- **Rule (dokumenty)**: Zdanie o tym, co istnieje, pisz w czasie teraźniejszym **tylko wtedy,
  gdy właśnie sprawdziłeś to w `src/` albo w katalogu**. Cokolwiek zamierzonego oznacz jawnie
  („planned — faza N; nic tego jeszcze nie czyta ani nie zapisuje"). Rozdzielaj „co projekt
  rysuje / zamierza" od „co istnieje" — zlanie tych dwóch w jedno zdanie jest tym, co pozwala
  czytać opis jako inwentarz. Zanim zamkniesz slice, przeczytaj jego `Outcome` przeciw kodowi:
  to pole zostanie skopiowane do `## Done` i przestanie być prognozą, a stanie się historią.
- **Applies to**: plan, plan-review, implement, impl-review, roadmap, archive

## Ubij serwer dev, zanim cokolwiek ruszy `node_modules/.vite` (build, astro check, commit)

- **Context**: Każda weryfikacja fazy w tym repo wykonywana przy działającym `npm run dev` —
  a `npm run build` jest kryterium sukcesu w KAŻDYM planie, więc trafia się to za każdym
  razem. Dotyczy też `rm -rf node_modules/.vite` i każdej innej operacji na tym katalogu.
  **Od `45432b6` dotyczy też KAŻDEGO commita**: hook pre-commit uruchamia `npx astro check`,
  które również przebudowuje `node_modules/.vite`. Czyli nie tylko jawny build — samo
  zacommitowanie czegokolwiek wywraca działający serwer dev.
- **Problem**: W S-02 i S-08 zdarzyło się to trzy razy i za każdym razem diagnoza szła w złą
  stronę. `astro dev` i `astro build` dzielą `node_modules/.vite`; build przebudowuje cache
  zoptymalizowanych zależności, a działający serwer dev zostaje z URL-ami, których już nie ma
  („The file does not exist at .../deps/lucide-react.js?v=6391e524"). Objawy są mylące, bo
  **build kończy się sukcesem** — psuje się dev: `TypeError: Cannot read properties of null
(reading 'useHostTransitionStatus')`, `jsxDEV is not a function`, albo SSR zwraca 200 z
  pustym ciałem i znikają wszystkie formularze. Dwa razy odesłałem użytkownika na twardy
  reload, zanim zrozumiałem przyczynę; raz szukałem błędu w kodzie, którego tam nie było.
- **Problem (2026-09-07, S-03 faza 4 — reguła znana i mimo to złamana)**: przeczytałem tę
  lekcję na starcie fazy, po czym uruchomiłem `npm run build` i `astro check` przy serwerze dev
  działającym od dwóch godzin, a następnie **odesłałem użytkownika do `npm run dev` ze zdaniem
  „build właśnie przebiegł, więc cache Vite jest świeży"** — czyli znałem regułę i wyciągnąłem
  z niej wniosek odwrotny do jej treści. Objaw był nowy i mylący: `Invalid hook call … more
than one copy of React`, co czyta się jak zdublowana zależność, a nie jak cache (w
  `node_modules` była jedna kopia Reacta — sprawdzone). Diagnozę uratowało tylko zdanie
  „nie diagnozuj kodu, dopóki tego nie wykluczysz": dowodem były znaczniki czasu — proces node
  z 20:00, `node_modules/.vite/deps` przepisany o 22:05.
- **Rule**: Zanim uruchomisz `npm run build`, `npx astro check`, `git commit` — albo cokolwiek
  innego, co rusza `node_modules/.vite` — ubij serwer dev. Gdy dev zaczyna się psuć (null-owy
  hook Reacta, `Invalid hook call`, `more than one copy of React`, `jsxDEV is not a function`,
  puste SSR), najpierw zrestartuj serwer i poszukaj w logu „does not exist … optimize deps
  directory"; nie diagnozuj kodu, dopóki tego nie wykluczysz. Twardy reload w przeglądarce NIE
  wystarcza — stare ścieżki trzyma serwer, nie klient.
- **Rule (kierunek wnioskowania)**: „Cache jest świeży" to stan NIEBEZPIECZNY dla procesu,
  który już działa, a nie zaleta. Świeżość liczy się względem procesu, który wystartował PO
  przebudowie. Nigdy nie odsyłaj nikogo do `npm run dev` argumentem „build właśnie przebiegł" —
  to jest dokładnie ta sytuacja, w której trzeba najpierw wyczyścić katalog i wystartować od
  nowa.
- **Applies to**: implement, impl-review

## Nie czytaj kodu wyjścia z potoku

- **Context**: Każda weryfikacja kryterium sukcesu uruchamiana przez potok — `npm run lint | tail`,
  `npm test | grep`, `npm run build | tail`. W tym repo `lint` i `build` są kryterium w KAŻDYM
  planie, a ich wyjście jest długie, więc odruch „utnę ogon" trafia się za każdym razem.
- **Problem**: W S-03 fazie 2 uruchomiłem `npm run lint 2>&1 | tail -20`. Kod wyjścia potoku to
  kod ostatniego elementu, czyli `tail` — zawsze 0. Eslint zwracał 1 z trzema błędami w plikach,
  które ta faza właśnie dodała. Zaraportowałem „lint 0 errors" na bramce fazy i w treści commita,
  wiersz Progress 2.3 dostał `[x]` i SHA, a faza została zamknięta na nieprawdziwym odczycie.
  Utwierdził mnie w tym drugi artefakt: uruchomienie w tle zgłosiło „exit code 0", bo raportowało
  status potoku, a plik wyjściowy odczytałem, zanim cokolwiek do niego trafiło — dwa niezależnie
  wyglądające sygnały, oba mierzące to samo złe miejsce. Błąd wyszedł dopiero przy review, gdy
  ta sama komenda poszła bez potoku.
- **Rule**: Kryterium sukcesu uruchamiaj tak, żeby jego kod wyjścia był kodem NARZĘDZIA, nie
  potoku: `npm run lint > out.txt 2>&1; echo $?`, a dopiero potem czytaj plik. Nigdy nie
  raportuj „przeszło" na podstawie `cmd | tail`, `cmd | grep` ani powiadomienia o zadaniu w tle,
  które opakowuje potok. Jeśli musisz filtrować na żywo, użyj `set -o pipefail`.
- **Applies to**: implement, impl-review

## Zdanie o tym, co się stanie po usunięciu bramki, jest prognozą — zmierz je, zanim je zapiszesz

- **Context**: Każde zdanie w planie, researchu, nagłówku testu albo komentarzu migracji, które
  mówi, co system ZROBI w sytuacji, której nikt nie wywołał: „bez tej bramki żądanie przejdzie",
  „ten predykat jest jedyną obroną", „ta gałąź jest osiągalna tylko tak", „tego nie pilnuje żaden
  test". Dotyczy też pola `Current State Analysis` w planie, bo stamtąd te zdania wędrują do
  treści commitów i do nagłówków plików, gdzie czyta się je jak ustalony fakt.
- **Problem**: W `testing-domain-guardrails` zdarzyło się to cztery razy na pięć faz i ANI RAZU
  nie wyłapało tego planowanie ani review planu — za każdym razem dopiero pomiar. (1) Plan
  twierdził, że strona opiekuna wycieka wrażliwe instrukcje; `get_period_by_token` zwraca tylko
  wiersze publiczne, więc nie było czego wyciekać. (2) Plan twierdził, że błąd w handlerze omija
  warstwę grantów; bez ciasteczka sesji granty łapią (42501), ale z ciasteczkiem i bez
  `locals.user` przepuszczają i bramka handlera jest jedynym płotem — 201 i realny wiersz.
  (3) Dwa testy twierdziły, że nakładające się selekcje sięgają gałęzi deadlocka; guarded UPDATE
  nie ma `ORDER BY`, więc obie sesje blokują wiersze w tym samym porządku i deadlock jest
  niemożliwy, nie „rzadki". (4) Najgorszy: research zgłosił „triple CHECK nie ma negatywnego
  testu", plan to przepisał bez weryfikacji, powstał cały plik duplikujący ścisły podzbiór
  `care-slots.isolation.test.ts:123`. **Mutacja tego nie złapała** — usunięcie constraintu wywala
  także test istniejący, więc „pięć przypadków padło" było prawdą, która nie dowodziła niczego
  o nowości.
- **Rule**: Zanim wpiszesz do planu lub do nagłówka testu zdanie o zachowaniu przy usuniętej
  ochronie — URUCHOM mutację i przeczytaj, co naprawdę się stało, łącznie z kodem statusu
  i treścią błędu. Nie wystarczy, że test padł: sprawdź, **dlaczego** padł i **czy nie padłby
  również bez Twojej zmiany**. Zanim napiszesz „nic tego nie pilnuje", zgrepuj `tests/` za nazwą
  constraintu, funkcji albo kolumny; twierdzenie o braku pokrycia jest twierdzeniem o całym
  katalogu i nie wolno go przyjąć z raportu researchu na słowo.
- **Rule (granica metody)**: Mutacja obala tylko te hipotezy, które już masz — więc potwierdzi
  błędną analizę luki, jeśli Twoja mutacja wywala zarówno Twój test, jak i ten, o którym nie
  wiesz. Projektuj mutację tak, żeby odróżniała Twoją prognozę od sąsiednich (np. mutacja
  „kasuje całą zdolność" obok „nie kasuje wcale"), i sprawdzaj, że mutacja w ogóle się
  zaaplikowała — raz był to no-op przez nieosiągalny warunek, raz przez przeformatowanie
  prettierem.
- **Applies to**: plan, plan-review, research, implement, impl-review
