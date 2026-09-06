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
- **Problem**: W S-02 zdarzyło się to cztery razy. Trzy razy komentarz migracji opisywał
  posturę grantów, której baza nie miała: `revoke ... from public` nie odbiera uprawnień rolom
  `anon`/`authenticated`/`service_role`, bo Supabase nadaje je osobno przez ALTER DEFAULT
  PRIVILEGES — a S-01 zamknął finding F3 jako naprawiony, opisując stan, którego nie osiągnął.
  Ten sam błąd powtórzył się na poziomie tabel: komentarz twierdził „deliberately NO grant to
  anon", a katalog pokazał pełny zestaw uprawnień. Czwarty raz był w teście: „anon nie może
  czytać tabeli" przechodził, bo `expect(data ?? []).toEqual([])` nie odróżnia odmowy 42501 od
  pustego wyniku po RLS — przeszedłby po usunięciu całej warstwy grantów, którą miał pilnować.
- **Rule**: Nigdy nie przyjmuj twierdzenia o posturze systemu na podstawie komentarza, planu
  ani intencji migracji. Odczytaj je z katalogu (`has_function_privilege`,
  `information_schema.role_table_grants`, `pg_policies`, `pg_proc`) albo przypnij testem, który
  UPADA, gdy postura znika. Asercja przechodząca również przy braku tej warstwy nie jest jej
  testem, tylko jej opisem.
- **Applies to**: plan, plan-review, implement, impl-review

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
