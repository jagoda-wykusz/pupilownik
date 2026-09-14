---
change_id: pet-edit-and-delete
title: Owner edits a pet with its care instructions, and deletes one no live trip covers
status: implemented
created: 2026-09-13
updated: 2026-09-14
archived_at: null
---

## Notes

Właściciel edytuje zwierzę wraz z instrukcjami opieki i usuwa zwierzę, którego nie obejmuje
żaden aktywny wyjazd. Slice S-09, dwie fazy: (1) edycja, (2) usunięcie z blokadą przy
aktywnym wyjeździe.

Ustalenia z rozmowy przed planem (2026-09-13):

- **Powód, dla którego to nie jest kosmetyka CRUD.** PRD §Guardrails: „Instrukcje zawsze
  aktualne — opiekun widzi najnowszą wersję instrukcji karmienia; rozjazd tu oznacza głodne
  lub przekarmione zwierzę". `get_period_by_token` (20260907180022) czyta instrukcje na żywo
  przy każdym wejściu opiekuna, więc strona odczytu jest gotowa — brakuje wyłącznie zapisu.
  Bez edycji ten guardrail jest niespełnialny.
- **Semantyka usunięcia — rozstrzygnięta: blokada.** Zwierzę przypięte do nieodwołanego
  wyjazdu nie daje się usunąć; odpowiedź mówi, że trzeba najpierw odwołać wyjazd. Predykat
  należy do SQL, nie do handlera. **Zaktualizowane po pomiarze 2026-09-13 (research.md §2):**
  pierwotna notka mówiła, że zwierzę „znika po cichu z trwającego wyjazdu" — to prawda, ale
  za słabo. Zmierzone: zapis opiekuna PRZEŻYWA usunięcie, wyjazd zostaje aktywny, link dalej
  działa, a instrukcje znikają wraz ze zwierzęciem. Opiekunowi zostaje więc dyżur przy
  zwierzęciu, którego nie ma w wyjeździe, bez instrukcji i bez jakiegokolwiek sygnału.
  **Druga rzecz z pomiaru, ważniejsza dla planu:** `authenticated` ma w katalogu granty
  UPDATE/DELETE na `pets`, a polityki `pets_update_own`/`pets_delete_own` przepuszczają
  właściciela — czyli blokada napisana w handlerze jest do obejścia gołym wywołaniem
  PostgREST z przeglądarki. Musi być predykatem SQL.
  Spójne z Open Question #5, gdzie produkt rozstrzygnął tak samo: odwołanie wyjazdu NIE
  rusza danych zapisów, żeby nie niszczyć cicho tego, co widzi opiekun.
- **Odrzucone warianty usunięcia:** kaskada za świadomą zgodą właściciela (zgoda jest po
  stronie właściciela, a ofiarą jest opiekun) oraz soft-delete `archived_at` (dokłada stan
  wyprowadzony do każdego zapytania o `pets` i najdroższy w testach RLS).
- **Zakres:** jeden slice, dwie fazy — edycja i usunięcie dzielą schemat zod, formularz
  i RPC, więc rozdzielenie oznaczałoby ten sam research dwa razy.

Rozstrzygnięte 2026-09-13 po researchu (research.md Open Question #1):

- **Tekst instrukcji (`title`, `body`) jest edytowalny zawsze**, także w trakcie trwającego
  wyjazdu i po zajęciu terminów. To jest wprost guardrail PRD „Instrukcje zawsze aktualne"
  (prd.md:48, US-02 prd.md:74): obie bramki opiekuna czytają tabele na żywo, więc poprawka
  gramatury karmy jest widoczna natychmiast i taki jest zamiar.
- **`is_sensitive` na ISTNIEJĄCYM wierszu jest zamrożony po claimie.** Nie wolno przełączyć
  flagi na instrukcji zwierzęcia objętego aktywnym wyjazdem, w którym ktokolwiek zajął już
  termin. Powód asymetrii wobec punktu wyżej: `true→false` publikuje adres i kod do bramy
  każdemu, kto trzyma link, łącznie z osobami sprzed claimu — a podział na tiery jest filtrem
  WIERSZY, nie maską pól (data-access.md:283-295), więc wiersz przeskakuje między dwiema
  publicznościami bez stanu pośredniego.

Doprecyzowania przyjęte jako rozsądne domyślne (moje, nie użytkownika — do potwierdzenia
przy planie, jeśli któreś wygląda źle):

- Blokada dotyczy **zmiany flagi na istniejącym wierszu**, nie dodania nowego. Nowa
  instrukcja nie była nikomu pokazana, więc wolno ją dodać z dowolną flagą.
- „Po claimie" = istnieje wyjazd z `revoked_at is null` obejmujący to zwierzę, w którym
  **jakikolwiek** slot ma `claimed_by_name is not null`. Uwaga: to INNY predykat niż blokada
  usunięcia zwierzęcia (tam sam `revoked_at is null`, bez warunku o zajętym terminie) — łatwo
  je pomylić, więc plan ma je nazwać osobno.
- Usuwanie instrukcji pozostaje dozwolone (patrz niżej — z tego wynika znane obejście).

**Blokada flagi jest MIĘKKA — zaakceptowane 2026-09-13 przez użytkownika, świadomie.**
Skoro usuwanie instrukcji jest dozwolone, właściciel może skasować wiersz wrażliwy i dodać
go ponownie jako publiczny — to samo ujawnienie w dwóch krokach. Broni to przed
PRZYPADKOWYM kliknięciem i przed cichą zmianą kontraktu, nie przed intencją właściciela,
który jest autorem tych danych.

Rozważone i ODRZUCONE warianty domknięcia (żeby impl-review nie zgłosił tego jako dziury,
a kolejny slice nie „naprawiał" tego bez kontekstu):

- zablokowanie usuwania wierszy wrażliwych po claimie — odbiera właścicielowi skasowanie
  nieaktualnej wrażliwej instrukcji w trakcie wyjazdu, zostawiając mu tylko edycję treści;
- zablokowanie dodawania wierszy publicznych po claimie — blokuje też całkiem niewinne
  dopisanie wskazówki w trakcie wyjazdu.

Plan ma to zapisać jako własność projektu, nie jako niedopatrzenie.

Rozstrzygnięte w planie 2026-09-13 (pełna tabela decyzji w plan-brief.md):

- **Synchronizacja instrukcji: match po `id`** (update / insert / delete). Jedyny kształt,
  w którym zamrożenie `is_sensitive` da się w ogóle wyrazić — delete-all kasuje tożsamość
  wierszy, więc nie ma czego chronić.
- **Blokada usunięcia: sam `revoked_at is null`**, bez predykatu daty. Koszt przyjęty:
  zwierzę z nieodwołanego wyjazdu sprzed roku jest nieusuwalne, dopóki właściciel go nie
  odwoła — komunikat 409 musi wprost wskazać to wyjście.
- **Granty tabelaryczne zostają** — RPC jest pisarzem zamierzonym, nie egzekwowanym; ta sama
  postura, którą `contract-surfaces.md:36` opisuje dla `release_slot`.
- **Formularz: nowy `EditPetForm` na design systemie**, nowa strona `/pets/[id]` na
  `bg-background`. `AddPetForm`, `FormField` i `bg-cosmic` nietknięte.
- **Ekran: `/pets/[id]` to ekran edycji**, usuwanie w strefie pod formularzem; `/pets`
  zostaje przy zero islandach.
- **Czasownik: `PUT`** — ciało niesie pełny stan docelowy, a wiersz nieobecny w payloadzie
  oznacza usunięcie.
