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

## Asercja podciągiem trafia we własne uzasadnienie

- **Context**: Każdy test źródłowy — czytający `package.json`, plik konfiguracyjny, workflow,
  hook albo `.astro` — który sprawdza obecność czegoś przez `toContain("...")` albo goły `grep`.
  W tym repo to przypadek CZĘSTY, nie skrajny, bo obowiązuje tu zasada gęstego komentowania
  „dlaczego": `.husky/pre-commit` poświęca 24 linie jednej komendzie, `check-client-bundle.mjs`
  otwiera się 36-liniowym nagłówkiem. **Im lepiej opiszesz linię, tym pewniej Twój strażnik
  przeżyje jej usunięcie** — bo zostaje proza, która tę linię nazywa.
- **Problem**: W `ci-quality-gates` zdarzyło się to trzy razy jednego dnia, w trzech plikach,
  za każdym razem w innym przebraniu. (1) `expect(gate).toContain("npm run check")` przechodziło
  przy łańcuchu BEZ typechecku, bo trafiało w podciąg `npm run check:secrets`; towarzyszący test
  kolejności liczył `indexOf("npm run check ")` → `-1`, a `-1 < indexOf(lint)` jest prawdą, więc
  asercja porządku również przechodziła pusto. Usunięcie najdroższego kroku bramki nie ruszało
  siedmiu asercji. (2) Poprawka do (1) przypięła trzy linie `vitest.config.ts` przez
  `toContain("groupOrder")` i `toContain("globalSetup")` — oba słowa stoją w komentarzach, które
  te linie tłumaczą, więc skasowanie konfiguracji i zostawienie prozy nadal dawało zielone.
  **Ta sama dziura powstała wewnątrz naprawy tej dziury.** (3) Wcześniej tego samego dnia
  `toContain("--project component")` przechodziło przy literówce w nazwie projektu, bo
  `vitest run --project nieistniejący` kończy się kodem 0 i po prostu nic nie uruchamia.
  Żadnego z trzech nie wyłapało czytanie kodu ani review planu — wyłapała macierz mutacji,
  puszczona mimo zielonego wyniku.
- **Rule**: W teście źródłowym nie sprawdzaj obecności podciągiem. Kotwicz do KSZTAŁTU, którego
  proza nie ma: `/globalSetup:\s*\[/` zamiast `"globalSetup"`, `/npm run check(?![:\w])/`
  zamiast `"npm run check"`. Jeśli sprawdzasz kolejność przez `indexOf`, najpierw podłoguj każdy
  indeks asercją `> -1` — brakujący element daje `-1`, a `-1` jest mniejsze od wszystkiego, więc
  test kolejności nieobecnego kroku jest pieczątką, nie sprawdzeniem.
- **Rule (co uznać za dowód)**: Zielony strażnik nie jest dowodem, że strażnik gryzie. Dowodem
  jest mutacja NA KAŻDĄ asercję z osobna — nie na jedną reprezentatywną. W (2) pierwsze dwie
  mutacje z pięciu wróciły zielone; gdybym puścił tylko trzecią, zamknąłbym fazę z dwiema
  martwymi asercjami i raportem, że wszystko gryzie. Gdy mutacja wraca zielona, najpierw sprawdź,
  czy się w ogóle zaaplikowała, a zaraz potem — czy Twoja asercja nie trafia w komentarz.
- **Rule (nazwa też jest podciągiem)**: Przed asercją na nazwę przekazywaną narzędziu (`--project X`,
  `--filter`, nazwa skryptu npm) sprawdź, co narzędzie robi z nazwą nieistniejącą. Jeśli kończy
  się zerem, sama obecność flagi nie dowodzi niczego — przypnij powiązanie z definicją.
- **Applies to**: implement, impl-review, plan

## Tryb awarii należy do ścieżki wywołania, nie do zależności

- **Context**: Każde badanie albo review, które nazywa ryzyko przez dostawcę — „zależymy od Google
  Fonts", „build ciągnie coś z GitHuba", „to woła zewnętrzne API". Nazwa dostawcy brzmi jak
  wystarczająco precyzyjna jednostka ryzyka i nią nie jest.
- **Problem**: W `vendor-build-fonts` follow-up F9 stwierdzał, że fetcher fontów „rzuca `AstroError`
  bez gałęzi zapasowej, więc jeden 429 to nieudany deploy". Zdanie było poprawne — dla JEDNEJ z dwóch
  ścieżek. Ten sam podsystem, ten sam dostawca, dwa hosty: binarki (`fonts.gstatic.com`) idą przez
  `CachedFontFetcher`, który rzuca przy pierwszej porażce bez ponowień → exit 1, brak deployu.
  Metadane CSS (`fonts.googleapis.com`) idą przez unifont, który Astro konstruuje z
  `throwOnError: false` → ostrzeżenie, pusta lista rodzin, **exit 0 i strona opublikowana w fontach
  systemowych**. Pierwszy pomiar zablokował oba hosty naraz, więc metadane padły pierwsze i binarna
  ścieżka nigdy się nie wykonała — wyszedł zielony build i wniosek, że premisa follow-upu jest
  obalona. Dopiero rozdzielenie hostów pokazało, że obie tezy są prawdziwe, o różnych rzeczach.
  Cichsza z nich była groźniejsza i nie miała rzecznika.
- **Rule**: Zanim zapiszesz ryzyko, policz ścieżki wywołania do dostawcy i zmierz KAŻDĄ osobno.
  Blokuj hosty pojedynczo, nie zbiorczo — blokada zbiorcza mierzy tę ścieżkę, która zawodzi
  najwcześniej, i ukrywa wszystkie pozostałe. Jeżeli którakolwiek ścieżka zawodzi cicho (kod 0,
  degradacja zamiast błędu), to ONA jest tematem zmiany, nie ta głośna: głośna sama się zgłasza,
  cicha publikuje.
- **Rule (osobno, bo dotyczy bramek)**: Bramka, która sprawdza typy, lint, testy i sekrety, nadal
  nie sprawdza, czy build wyprodukował to, co miał wyprodukować. Build kończący się zerem z zerową
  liczbą fontów przeszedł w tym repo wszystkie sześć kroków `ci:gate`. Przy każdej zależności
  produkującej artefakt dopisz asercję NA ARTEFAKT — reszta bramki mierzy proces, nie wynik.
- **Applies to**: research, frame, plan, implement, impl-review

## Bramka nie jest najbardziej zewnętrzną rzeczą, która może paść

- **Context**: Każda zależność z hookiem `preinstall` / `install` / `postinstall`. W tym repo są
  cztery: `supabase`, `esbuild`, `sharp`, `workerd`. Hook wykonuje się podczas `npm ci`, a na
  Cloudflare Workers Builds `npm ci` dzieje się PRZED komendą builda.
- **Problem**: W `supabase-cli-build-cost` okazało się, że `postinstall` Supabase CLI ściąga 98 MB
  z GitHub Releases i kończy się gołym `await main()` bez `catch`. Zmierzone: przy nieosiągalnym
  hoście `POSTINSTALL_EXIT=1`, co wywala `npm ci`, co zabija deploy. Wszystkie strażniki, jakie ten
  projekt kiedykolwiek dodał — typy, lint, testy, render sweep, skan sekretów, asercja na artefakcie
  — żyją WEWNĄTRZ `npm run ci:gate`. Żaden z nich nie ma prawa głosu w tym momencie. Follow-up
  opisywał tę zależność jako marnotrawstwo („ściąga binarkę, której kontener nie uruchomi") i to
  sformułowanie przetrwało trzy tygodnie, bo nikt nie zapytał, co się dzieje, gdy pobranie zawiedzie.
- **Rule**: Dodając zależność z hookiem instalacyjnym, sprawdź JAK ZAWODZI, zanim sprawdzisz, co
  robi. Otwórz skrypt i poszukaj `catch`. Jeśli go nie ma, porażka jest fatalna dla `npm ci` — a to
  znaczy fatalna dla deployu, w miejscu, którego żadna bramka nie widzi. `optionalDependencies` jest
  tu właściwym narzędziem: npm traktuje porażkę opcjonalnej zależności jako NIEFATALNĄ (zmierzone
  dla `npm ci`, nie tylko `npm install`).
- **Rule (co za to płacisz)**: Przy porażce npm USUWA opcjonalną paczkę w całości, zamiast zostawić
  zepsutą — i robi to CAŁKOWICIE CICHO. Zmierzone: pełne wyjście `npm ci` w takim przypadku to
  `up to date in 675ms`, bez ostrzeżenia i bez wzmianki o usuniętej paczce. Zawsze zapytaj, kto jej
  używa i czy zauważy brak. Actions by nie zauważył — `npx` po cichu dociągnąłby CLI z rejestru —
  więc trzeba było dołożyć `npx --no-install`. **Lokalna maszyna deweloperska nie dostała
  odpowiednika i nie ma gdzie go dołożyć**: sześć skryptów `db:*` woła gołe `supabase`, więc awaria
  przenosi się z czasu instalacji na czas użycia i objawia jako `supabase: not found` godziny
  później. Odpowiedz na to pytanie dla KAŻDEGO konsumenta, nie tylko dla tego, który ma bramkę.
- **Rule (nie sięgaj po `--omit=optional`)**: Kusi, żeby przy okazji oszczędzić transfer. Zmierz
  najpierw, ile wpisów w `package-lock.json` ma `"optional": true`. W tym repo 131, w tym binarki
  platformowe `workerd`, `esbuild` i `sharp`, bez których build nie ruszy.
- **Applies to**: plan, implement, impl-review, research

## Degradacja bez logu to nie degradacja, tylko martwe pole

- **Context**: Każda gałąź, która łapie błąd zewnętrznego wywołania (RPC, fetch, klient bazy)
  i **degraduje** zamiast paść — w szczególności we frontmatterze `.astro`, gdzie kusi, żeby
  po prostu ustawić flagę albo przypisać `null` i renderować dalej. Dotyczy też każdej decyzji
  „to nie jest awaria strony, pokażmy uboższy widok".
- **Problem**: W `invite-page-silent-failures` okazało się, że `src/pages/invite/[token].astro`
  połykał **oba** swoje błędy RPC, a grep `console.` po wszystkich plikach `.astro` w repo zwracał
  **zero**. Gorsza z gałęzi odrzucała `error` w ternary: opiekun, który JUŻ zajął termin, przy
  awarii `get_claimed_details` dostawał stronę sprzed claimu ze statusem 200 (`claimed = null` →
  `hasClaims: false`, a `tests/unit/invite-view.test.ts:34-40` przypina, że to daje
  `kind: "period", status: 200`), jego wskazówki
  znikały — i nie dowiadywał się o tym ani on, ani serwer. Osiem z dziewięciu routów obok robiło
  to poprawnie, więc nie był to brak wiedzy, tylko **dziura w konwencji**: zarówno zapis
  obserwowalności w §7 test-planu, jak i poluzowanie `no-console` w `eslint.config.js` były
  zakresowane na `src/pages/**/*.ts`. Pliki `.astro` nie miały ani precedensu, ani **pozwolenia**,
  żeby logować — `console.error` na stronie wywracał `--max-warnings 0`, czyli bramkę publikacji.
  Cicha degradacja była więc ścieżką najmniejszego oporu, wymuszoną przez narzędzia.
- **Problem (jak poznaliśmy tę liczbę)**: audyt otwierający tę zmianę zapisał „warstwa API jest
  czysta", zbadawszy sześć wymienionych routów plus `signin`/`signup` — i **nie otworzył
  `auth/signout.ts`**, który nie inspekcjonuje wyniku `signOut()` w ogóle. Wyszło to dopiero przy
  weryfikacji ostatniej fazy, z policzenia plików. Zdanie o CZYSTOŚCI całej warstwy jest
  twierdzeniem o każdym pliku w niej; wolno je napisać dopiero po wyliczeniu tych plików, a nie po
  sprawdzeniu tych, które przyszły do głowy.
- **Rule**: Degradacja jest decyzją i wymaga zapisania DWÓCH rzeczy, nie jednej: co zobaczy
  użytkownik ORAZ co zapamięta serwer. Gałąź, która połyka błąd i nic nie loguje, nie jest
  degradacją — jest martwym polem, bo nie zostawia po sobie żadnego śladu, po którym dałoby się
  ją kiedykolwiek zdiagnozować. Zanim wybierzesz „degradujemy po cichu", sprawdź, czy w tym typie
  pliku wolno Ci w ogóle sięgnąć po sink logów.
- **Rule (co znaczy opór narzędzia)**: Jeśli oczywista poprawka odbija się od reguły lintu
  zakresowanej na **sąsiedni typ pliku**, to sygnał, że dziurę ma konwencja, a nie poprawka.
  Rozszerz zakres na tym samym uzasadnieniu, które już w nim stoi, albo zapisz wprost, dlaczego
  ten typ pliku ma być wyjątkiem. Nie obchodź reguły punktowym `eslint-disable` — następny plik
  powtórzy obejście zamiast odziedziczyć regułę.
- **Applies to**: plan, implement, impl-review, frame

## Czerwony, którego nie spowodowałeś, nadal jest twój do zapisania

- **Context**: Każdy przebieg pełnego suite'u, w którym pada test spoza zakresu zmiany — inny
  moduł, inna tabela, inna warstwa. Dotyczy też sytuacji odwrotnej: testu, który pada w suite, a
  w izolacji przechodzi.
- **Problem**: W trakcie `signout-swallows-failure` `tests/rls/release-reveal.test.ts` padł raz
  na trzy pełne przebiegi, a potem był zielony. Nic w tej zmianie nie dotykało release'u,
  reveala ani ich tabel, więc rozpoznanie „nie moje, pre-existing" było poprawne — i na tym
  stanęło. Nie zapisałem tego nigdzie. Wyszło dopiero w impl-review jako F10, czyli po
  zamknięciu implementacji, z jedynym śladem w postaci zdania w rozmowie, która zaraz potem
  została skompaktowana.
- **Problem (co dał dopiero pomiar)**: dopiero na etapie triage zmierzyłem to porządnie —
  `vitest run tests/rls/release-reveal.test.ts`, pięć przebiegów z rzędu, 4/4 za każdym razem.
  To zmieniło opis z „test bywa czerwony" na „coś w interakcji z resztą suite'u: stan w
  Supabase, kolejność albo timing", czyli z obserwacji w hipotezę, którą da się sprawdzić.
  Jeden przebieg w izolacji tego nie daje; pięć daje. **Zielony w izolacji nie jest
  zaprzeczeniem czerwonego w suite — jest drugą połową opisu.**
- **Rule**: „Nie moje" i „nie do zapisania" to dwie różne rzeczy. Test, który padł raz i
  przeszedł przy powtórce, zapisz w miejscu, które przeżyje sesję — z liczbą przebiegów w suite
  i liczbą w izolacji — nawet jeśli ustaliłeś, że jest starszy niż twoja zmiana. Bez tego
  następna osoba zobaczy ten sam czerwony jako pierwszy raz i też go przepuści, bo „przeszło za
  drugim razem".
- **Rule (dlaczego to nie jest porządkowanie)**: flake uczy czytać wynik przez powtórzenie
  zamiast przez lekturę. Dokładnie tym kanałem prawdziwa regresja przechodzi niezauważona —
  ktoś odpala ponownie, robi się zielono, i nikt nie pyta, czy to był ten sam powód. Zapis nie
  naprawia testu; odbiera „przeszło przy powtórce" status odpowiedzi.
- **Rule (czego zapis NIE ma udawać)**: notatka o flaku to nie diagnoza. Napisz wprost, że
  przyczyna jest **nieznana**, i nie zamykaj sprawy zdaniem, które brzmi jak wyjaśnienie.
  Diagnoza interakcji na poziomie suite'u to własna zmiana, nie przypis do cudzej.
- **Applies to**: implement, tdd, impl-review, archive
