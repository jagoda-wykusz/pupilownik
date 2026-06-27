---
change_id: owner-data-rls-baseline
title: Wzorzec dostępu do danych właściciela (migracje + RLS)
roadmap_id: F-01
status: implementing
created: 2026-06-27
updated: 2026-06-27
---

# F-01: Owner-data RLS baseline

Foundation (z `context/foundation/roadmap.md`). Ustanawia kontrakt dostępu do danych:
działająca pętla migracji Supabase, wzorzec Row-Level Security izolujący dane do właściciela
(zademonstrowany na realnej tabeli `profiles`), typowany klient Supabase oraz minimalny seed.
NIE tworzy tabel domenowych (pets / okresy / sloty) — te należą do slice'ów S-01+.

Unlocks: S-01 (pet-and-instructions) i wszystkie kolejne slice'y danych.
