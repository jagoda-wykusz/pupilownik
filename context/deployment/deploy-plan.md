# Pierwsze wdrożenie Pupilownik → Cloudflare Workers (Workers Builds)

## Context

Pupilownik (Astro 6 SSR + React 19, Supabase) ma za sobą decyzję infrastrukturalną (`context/foundation/infrastructure.md`): hosting na **Cloudflare Workers**, CI/CD natywnie przez **Cloudflare Workers Builds** podpięte do repo na GitHubie. Repo i stack są już gotowe do deployu — brakuje tylko uruchomienia łańcucha „push → build → deploy". Celem jest pierwsze działające wdrożenie produkcyjne pod `*.workers.dev`, z poprawnie wpiętym auto-deployem na każdy merge do `master`.

Na życzenie użytkownika idziemy ścieżką **tylko Workers Builds** (bez wstępnego ręcznego `wrangler deploy`): pierwszy deploy nastąpi po pushu na `master`, po wcześniejszym skonfigurowaniu projektu w dashboardzie Cloudflare. Użytkownik ma już produkcyjny projekt Supabase (URL + anon key).

## Stan wyjściowy (zweryfikowany)

- **Adapter/SSR:** `astro.config.mjs` → `adapter: cloudflare()`, `output: "server"`. ✓
- **`wrangler.jsonc`:** `name: "pupilownik"`, `main: "@astrojs/cloudflare/entrypoints/server"` (ścieżka rozwiązuje się w adapterze → `dist/entrypoints/server.js`), `compatibility_flags: ["nodejs_compat"]`, `compatibility_date: "2026-05-08"`, `assets.directory: "./dist"`, observability ON. ✓
- **Build:** `package.json` → `"build": "astro build"`; `@astrojs/cloudflare ^13.5.0`, `wrangler ^4.90.0`. ✓
- **Node:** `.nvmrc` → `22.14.0` (zgodny z domyślnym obrazem build Workers Builds). ✓
- **Sekrety:** `SUPABASE_URL`, `SUPABASE_KEY` czytane przez `astro:env/server` w `src/lib/supabase.ts` (deklaracja w `astro.config.mjs`, `context:"server"`, `access:"secret"`, `optional:true`). Brak innych zmiennych. ✓
- **DB:** brak migracji (`supabase/migrations/` nie istnieje); aplikacja używa wyłącznie Supabase Auth (`auth.users`) — **migracje niepotrzebne do deployu**. ✓
- **`.gitignore`:** `.env` i `.dev.vars` ignorowane. ✓
- **Git:** working tree czysty; `master` śledzi `origin/master`; **1 commit niewypchnięty** (`74b00ee` — rename Workera na `pupilownik`). Remote `origin → https://github.com/jagoda-wykusz/pupilownik.git` osiągalny. ✓
- **CI:** brak GitHub Actions / Bitbucket (usunięte) — Workers Builds nie jest jeszcze podpięte (krok dashboardowy). ⚠️

## Podejście

CI-only przez Workers Builds. Zaletą tej drogi jest brak potrzeby `CLOUDFLARE_API_TOKEN` (Workers Builds używa konta z dashboardu) i brak ręcznych komend deployu. Kluczowe ryzyko do świadomego ogrania: **gdzie żyją sekrety**.

> **Krytyczny niuans sekretów (z „two-place env binding" w infrastructure.md):** aplikacja czyta `SUPABASE_URL`/`SUPABASE_KEY` w **runtime** Workera przez `astro:env/server`. Dlatego muszą być ustawione jako **runtime Variables & Secrets danego Workera** (zaszyfrowane), a nie tylko jako build-time env vars Workers Builds. Build-time vars są tu opcjonalne (schema `optional:true` → build nie padnie bez nich). Ustawienie wartości wyłącznie jako build var = aplikacja wstanie, ale `createSupabaseServer` zwróci `null` i auth nie zadziała.
>
> **Sekwencja (chicken-and-egg):** Worker `pupilownik` powstaje dopiero przy pierwszym buildzie Workers Builds. Runtime-sekrety w dashboardzie można dodać dopiero, gdy Worker istnieje. Dlatego pierwszy push może zdeployować Workera bez sekretów (strona wstanie, auth nie). Po dodaniu sekretów i ponownym deployu (re-run / kolejny push) auth ruszy. Jeśli kreator „Connect Git" pozwala dodać zmienne od razu — ustaw je tam i unikniesz drugiego przebiegu.

Sekrety trafiają **wyłącznie do dashboardu Cloudflare** — nigdy do repo (zgodnie z regułą: nie commitować `.env`/sekretów).

## Kroki

Oznaczenia: **[Ty]** = krok w dashboardzie/interaktywny (agent nie kliknie); **[Agent]** = wykonalne przeze mnie po zatwierdzeniu.

1. **[Agent]** Zapisać ten plan jako `context/deployment/deploy-plan.md` (utworzyć `context/deployment/`). ✓ (ten plik)
2. **[Agent, opcjonalnie]** Lokalna weryfikacja builda przed pushem: `npm run build` — potwierdza, że artefakt `./dist` powstaje (to dokładnie krok, który wykona Workers Builds). Pominąć, jeśli wolisz polegać na buildzie w CI.
3. **[Ty] Podpięcie repo w dashboardzie Cloudflare** — Workers & Pages → Create → Connect to Git → wybierz `jagoda-wykusz/pupilownik`. Ustaw:
   - **Production branch:** `master` (uwaga: nie `main`).
   - **Build command:** `npm run build`
   - **Deploy command:** `npx wrangler deploy`
   - (Node 22 z `.nvmrc` zostanie wykryty automatycznie.)
4. **[Ty] Sekrety runtime Workera** — w ustawieniach Workera `pupilownik` → Settings → Variables and Secrets dodaj jako **Secret (encrypted)**:
   - `SUPABASE_URL` = URL projektu cloud Supabase
   - `SUPABASE_KEY` = anon key projektu
     (Jeśli kreator z kroku 3 pozwala dodać je od razu — zrób to tam.)
5. **[Ty, jednorazowo] Supabase Auth na czas MVP** — w dashboardzie Supabase wyłącz „Confirm email" (Authentication → Email), żeby właściciel mógł się logować od razu po rejestracji (zgodnie z README).
6. **[Agent] Push wyzwalający pierwszy deploy:** `git push origin master` (wypycha `74b00ee` z nazwą `pupilownik`). To uruchamia pierwszy build + `wrangler deploy` w Workers Builds.
7. **[Ty/Agent] Jeśli pierwszy deploy poszedł bez sekretów** (kolejność z niuansu wyżej): po dodaniu sekretów (krok 4) uruchom ponowny deploy — „Retry build" w Workers Builds albo pusty commit/kolejny push.

## Pliki

- **Tworzony:** `context/deployment/deploy-plan.md` (ten plik).
- **Bez zmian w kodzie** — repo jest gotowe. Cała konfiguracja deployu i sekretów żyje po stronie Cloudflare/Supabase (dashboard), nie w plikach repo.
- **Nie dotykać:** `wrangler.jsonc` (już poprawny), `astro.config.mjs`, `src/lib/supabase.ts`, `src/middleware.ts`.

## Weryfikacja (end-to-end)

1. **Build w CI:** log Workers Builds pokazuje sukces `npm run build` i `npx wrangler deploy` (zwraca URL Workera).
2. **Strona żyje:** otwórz `https://pupilownik.<konto>.workers.dev` — ładuje się strona główna (Astro SSR działa na workerd).
3. **Sekrety/runtime:** podgląd logów `npx wrangler tail` (lub dashboard → Logs). Brak błędów `Dynamic require of 'stream'` (potwierdza, że `nodejs_compat` działa z `@supabase/ssr`).
4. **Auth flow:** wejdź na `/dashboard` niezalogowany → przekierowanie na `/auth/signin` (middleware działa). Zarejestruj/zaloguj właściciela na `/auth/signup` → `/auth/signin` → dostęp do `/dashboard` (potwierdza, że runtime-sekrety Supabase są obecne).
5. **Brak wycieku sekretów:** w buildzie/kliencie nie ma `SUPABASE_KEY` (zmienne `astro:env/server` są server-only) — sanity check w devtools (brak klucza w bundlu JS).
6. **Auto-deploy:** drobny commit na `master` → push → potwierdź, że Workers Builds sam odpala build i aktualizuje Workera.

## Rollback

- **Kod:** `npx wrangler rollback` (lub dashboard → Deployments → wybierz poprzednią wersję) — przywraca poprzedni deploy w sekundy.
- **Uwaga:** rollback cofa tylko kod Workera; nie dotyka Supabase (brak migracji w MVP, więc bezpieczne).

## Poza zakresem (świadomie)

- Custom domain (na razie `*.workers.dev`).
- Środowisko preview/staging i ochrona preview (Cloudflare Access) — do dołożenia w kolejnym kroku (mityguje ryzyko cache'owania sesji z infrastructure.md).
- Migracje DB / schema (aplikacja MVP używa tylko Supabase Auth).
- `GitHub Actions` jako gate lintu/buildu (usunięte; ewentualnie do rozważenia później).
