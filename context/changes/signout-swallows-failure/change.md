---
change_id: signout-swallows-failure
title: A failed sign-out leaves the session alive and redirects as if it succeeded
status: implemented
created: 2026-09-13
updated: 2026-09-13
archived_at: null
---

## Notes

src/pages/api/auth/signout.ts robi `await supabase.auth.signOut()` bez destrukturyzacji `{ error }` i przekierowuje na `/` niezależnie od wyniku. ZMIERZONE w @supabase/auth-js@2.105.3 GoTrueClient.\_signOut(): przy błędzie innym niż 404/401/403 funkcja wychodzi PRZED `_removeSession()`, a to jedyna droga czyszczenia ciasteczek przez adapter @supabase/ssr. Czyli nieudane wylogowanie zostawia żywą sesję, a użytkownik dostaje przekierowanie jak przy sukcesie. Drugi, mniejszy przypadek w tym samym pliku: gdy `createClient` zwraca null (brak konfiguracji), sign-out jest pomijany w całości i też następuje przekierowanie. tests/api/signout.test.ts ma trzy przypadki, wszystkie na ścieżce sukcesu. Znalezione przy audycie w invite-page-silent-failures, świadomie odłożone tam jako osobna zmiana.

### Pomiar, który zmienił kwalifikację (2026-09-13)

`context/archive/2026-09-13-invite-page-silent-failures/change.md` zostawił to znalezisko z jawną
adnotacją **„Waga: NIEZMIERZONA"** i warunkiem, że osobna zmiana ma zacząć się od pomiaru. Pomiar
wykonany przed otwarciem tej zmiany, przez odczyt zainstalowanego źródła — nie z dokumentacji i nie
z pamięci o bibliotece.

`node_modules/@supabase/auth-js/dist/main/GoTrueClient.js`, `_signOut()`:

```js
if (accessToken) {
  const { error } = await this.admin.signOut(accessToken, scope);
  if (error) {
    if (
      !(
        (isAuthApiError(error) && (error.status === 404 || error.status === 401 || error.status === 403)) ||
        isAuthSessionMissingError(error)
      )
    ) {
      return this._returnResult({ error }); // ← wyjście PRZED czyszczeniem
    }
  }
}
if (scope !== "others") {
  await this._removeSession(); // ← nieosiągnięte
  await removeItemAsync(this.storage, `${this.storageKey}-code-verifier`);
}
```

`_removeSession()` jest jedyną drogą, którą adapter `@supabase/ssr` czyści ciasteczka sesji. Zatem
przy błędzie spoza trójki 404/401/403 — 500 z GoTrue, timeout, awaria sieci — **ciasteczka
zostają, a route i tak przekierowuje na `/`**. Użytkownik jest przekonany, że się wylogował, i
pozostaje zalogowany.

**Kwalifikacja: to nie jest luka w obserwowalności, tylko cicha awaria wylogowania.** Adnotacja
„waga niezmierzona" z archiwum przestaje obowiązywać; archiwum jest niemutowalne, więc korekta żyje
tutaj.

### Czego pomiar jeszcze NIE rozstrzyga

- Czy ten błąd jest osiągalny na tym wdrożeniu w praktyce i jak często — nie ma monitoringu
  aplikacyjnego (`roadmap.md`: „brak warstwy aplikacyjnej"), więc częstotliwość jest nieznana.
- Czy poprawne zachowanie to 500, ponowna próba, czy wyczyszczenie ciasteczek po stronie route'a
  mimo błędu. To decyzja do planu, nie do notatki.
