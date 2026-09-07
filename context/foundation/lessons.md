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

## Ubij serwer dev, zanim uruchomisz `npm run build`

- **Context**: Każda weryfikacja fazy w tym repo wykonywana przy działającym `npm run dev` —
  a `npm run build` jest kryterium sukcesu w KAŻDYM planie, więc trafia się to za każdym
  razem. Dotyczy też `rm -rf node_modules/.vite` i każdej innej operacji na tym katalogu.
- **Problem**: W S-02 i S-08 zdarzyło się to trzy razy i za każdym razem diagnoza szła w złą
  stronę. `astro dev` i `astro build` dzielą `node_modules/.vite`; build przebudowuje cache
  zoptymalizowanych zależności, a działający serwer dev zostaje z URL-ami, których już nie ma
  („The file does not exist at .../deps/lucide-react.js?v=6391e524"). Objawy są mylące, bo
  **build kończy się sukcesem** — psuje się dev: `TypeError: Cannot read properties of null
  (reading 'useHostTransitionStatus')`, `jsxDEV is not a function`, albo SSR zwraca 200 z
  pustym ciałem i znikają wszystkie formularze. Dwa razy odesłałem użytkownika na twardy
  reload, zanim zrozumiałem przyczynę; raz szukałem błędu w kodzie, którego tam nie było.
- **Rule**: Zanim uruchomisz `npm run build` — albo cokolwiek ruszy `node_modules/.vite` —
  ubij serwer dev. Gdy dev zaczyna się psuć (null-owy hook Reacta, `jsxDEV is not a function`,
  puste SSR), najpierw zrestartuj serwer i poszukaj w logu „does not exist … optimize deps
  directory"; nie diagnozuj kodu, dopóki tego nie wykluczysz.
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
