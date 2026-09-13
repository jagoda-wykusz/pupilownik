---
change_id: invite-page-silent-failures
title: The caretaker page swallows both of its RPC errors without logging either
status: implementing
created: 2026-09-13
updated: 2026-09-13
archived_at: null
---

## Notes

Dwa połknięte błędy w src/pages/invite/[token].astro, oba bez żadnego logowania: :92 loadError=true (użytkownik widzi kartę błędu, serwer nie dowiaduje się nic) oraz :144 claimed = error ? null — opiekun, który się zapisał, cicho traci wskazówki i widzi stronę sprzed claimu przy statusie 200. Zero console.\* w jakimkolwiek pliku .astro, a konwencja obserwowalności z test-plan.md:825 jest zakresowana na src/pages/\*\*/\*.ts, więc ma dziurę dokładnie tam. Warstwa API jest czysta — wszystkie 6 routów loguje i propaguje. Do rozstrzygnięcia w planie: czy awaria reveal ma zostać cichą degradacją (+ logowanie), czy stać się widoczna — przy zachowaniu właściwości uniform-failure, która jest przypięta testami.

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
| **`src/pages/invite/[token].astro` ×2**                                                    | **znalezisko**                                                                                                         |

Pomiar, na którym stoi ta zmiana: **`grep -rn "console\." src/pages/**/\*.astro` → 0 trafień.\*\*
