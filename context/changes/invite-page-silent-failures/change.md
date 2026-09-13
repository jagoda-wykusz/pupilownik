---
change_id: invite-page-silent-failures
title: The caretaker page swallows both of its RPC errors without logging either
status: implemented
created: 2026-09-13
updated: 2026-09-13
archived_at: null
---

## Notes

Dwa połknięte błędy w src/pages/invite/[token].astro, oba bez żadnego logowania: :92 loadError=true (użytkownik widzi kartę błędu, serwer nie dowiaduje się nic) oraz :144 claimed = error ? null — opiekun, który się zapisał, cicho traci wskazówki i widzi stronę sprzed claimu przy statusie 200. Zero console.\* w jakimkolwiek pliku .astro, a konwencja obserwowalności z test-plan.md:825 jest zakresowana na src/pages/\*\*/\*.ts, więc ma dziurę dokładnie tam. Warstwa API jest czysta — wszystkie 6 routów loguje i propaguje. Do rozstrzygnięcia w planie: czy awaria reveal ma zostać cichą degradacją (+ logowanie), czy stać się widoczna — przy zachowaniu właściwości uniform-failure, która jest przypięta testami.

> **Zdanie „Warstwa API jest czysta — wszystkie 6 routów" powyżej jest nieprawdziwe** i zostaje
> jako ślad tego, w co wierzyłem otwierając zmianę. Patrz §Korekta audytu niżej: `auth/signout.ts`
> nigdy nie został otwarty.

### Audyt przeprowadzony przed otwarciem zmiany (2026-09-13)

Pełny przemiat kodu pod kątem wzorca z M3L5 (try/catch albo `if (error)`, który loguje lub połyka
i mimo to oddaje sukces):

| Warstwa                                                                                    | Wynik                                                                                                                  |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| 6 routów API (`periods`, `pets`, `revoke`, `release`, `token`, `invite/claim`)             | czyste — `console.error("… failed:", error.code, error.message)` + `500` lub zmapowany `4xx`                           |
| `src/lib/`, middleware                                                                     | czyste — brak połknięć                                                                                                 |
| wyspy klienckie (`ClaimSlots`, `AddPetForm`, `NewPeriodForm`, `Regenerate/Release/Revoke`) | czyste — każdy `catch` ustawia komunikat widoczny dla użytkownika                                                      |
| `InviteLinkPanel.tsx:33`                                                                   | benign, udokumentowane — schowek może odmówić w niezabezpieczonym kontekście, link i tak jest na ekranie i zaznaczalny |
| `res.json().catch(() => null)` ×2                                                          | benign — parsowanie ciała, które może nie być JSON-em; status jest obsługiwany osobno                                  |
| `auth/signin`, `auth/signup`                                                               | czyste — logują `code`/`message`, potem jednolite przekierowanie (świadoma uniform-failure)                            |
| **`auth/signout`**                                                                         | **NIEZBADANE w tym audycie — patrz korekta niżej**                                                                     |
| **`src/pages/invite/[token].astro` ×2**                                                    | **znalezisko**                                                                                                         |

### Korekta audytu (2026-09-13, w trakcie fazy 2)

Audyt powyżej zbadał sześć wymienionych routów plus `signin`/`signup` i **nigdy nie otworzył
`src/pages/api/auth/signout.ts`**. Zdanie „warstwa API jest czysta" było więc szersze niż to, co
faktycznie sprawdziłem. Policzone dopiero przy weryfikacji fazy 2: dziewięć plików route'ów, osiem
loguje, `signout` nie.

`signout.ts` nie inspekcjonuje wyniku w ogóle — `await supabase.auth.signOut()` bez
destrukturyzacji `{ error }`, a potem `context.redirect("/")` niezależnie od wyniku. To ten sam
wzorzec z M3L5 w czystszej postaci niż w `[token].astro`, gdzie błąd był przynajmniej przypisywany
do zmiennej.

**Waga: NIEZMIERZONA.** Nie sprawdziłem, czy nieudany `signOut()` zostawia żywą sesję.
`tests/api/signout.test.ts` przypina, że ciasteczko przestaje uwierzytelniać — ale na ścieżce
sukcesu. Napisanie tu „to jest groźne" albo „to jest niegroźne" byłoby prognozą, nie pomiarem.

**Świadomie NIE naprawione w tej zmianie**: inny plik, inna warstwa, nieznana waga, brak czerwonego
testu. Należy do osobnej zmiany, która zacznie od zmierzenia skutku.

Pomiar, na którym stoi ta zmiana: **`grep -rn "console\." src/pages/**/\*.astro` → 0 trafień.\*\*
