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
