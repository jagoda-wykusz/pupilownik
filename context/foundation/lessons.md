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
