---
bootstrapped_at: 2026-06-26T22:16:36Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: pupilownik
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

Verbatim z `context/foundation/tech-stack.md`:

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: pupilownik
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: cloudflare-builds
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: true
  has_ai: false
  has_background_jobs: false
```

**Why this stack** (z hand-offu): Pupilownik to web-app dla pojedynczego dewelopera (solo) z 3-tygodniowym oknem MVP, gdzie kluczowe wymagania to konto właściciela (auth), współdzielony kalendarz z realtime oraz PostgreSQL (po świadomym odrzuceniu SQL Server). 10x-astro-starter pokrywa wszystkie trzy z pudełka przez Supabase (PostgreSQL + auth + realtime + storage). TypeScript w całym projekcie trzyma jawne kontrakty na granicach (Zod), co jest agent-friendly. Deployment i CI/CD idą natywną drogą Cloudflare (Cloudflare Builds, auto-deploy na merge). Uwaga: jeśli repozytorium żyje na Bitbukecie, „Bitbucket Pipelines" nie mieści się w enumie hand-offu — zapisano `cloudflare-builds` jako natywny CI dla tego deploymentu. Pewność scaffoldingu: first-class.

## Pre-scaffold verification

| Signal      | Value   | Severity | Notes                                                             |
| ----------- | ------- | -------- | ----------------------------------------------------------------- |
| npm package | not run | —        | cmd_template to `git clone` — brak pakietu npm CLI do sprawdzenia |
| GitHub repo | not run | —        | `gh` CLI niedostępny w środowisku (command not found)             |

Brak sygnału świeżości — WARN-AND-CONTINUE, scaffolding kontynuowany.

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone
**Exit code**: 0
**Files moved**: 19 (top-level: `.env.example`, `.github`, `.gitignore`, `.husky`, `.nvmrc`, `.prettierrc.json`, `.vscode`, `README.md`, `astro.config.mjs`, `components.json`, `eslint.config.js`, `node_modules`, `package-lock.json`, `package.json`, `public`, `src`, `supabase`, `tsconfig.json`, `wrangler.jsonc`)
**Conflicts (.scaffold siblings)**: `CLAUDE.md.scaffold` (cwd `CLAUDE.md` zachowany; kopia startera odłożona jako sibling)
**.gitignore handling**: moved silently (cwd nie miał własnego `.gitignore`)
**.bootstrap-scaffold cleanup**: deleted (`.git/` startera usunięty przed move-up; katalog tymczasowy usunięty)

Instalacja zależności: 773 pakiety dodane, audytowano 774.

## Post-scaffold audit

**Tool**: `npm audit`
**Summary**: 0 CRITICAL, 6 HIGH, 10 MODERATE, 2 LOW (łącznie 18)
**Direct vs transitive**: tylko `astro` jest bezpośrednią zależnością projektu; pozostałe podatne pakiety przychodzą tranzytywnie przez `astro`, `supabase` oraz łańcuch narzędzi Cloudflare (`wrangler`/`miniflare`/`@cloudflare/vite-plugin`) i `@astrojs/check`. Wszystkie z dostępnym `npm audit fix` (jedynie `yaml` wymaga `npm audit fix --force` z breaking change).

#### CRITICAL findings

Brak.

#### HIGH findings

- **astro** `<=7.0.0-beta.6` (bezpośredni) — Reflected XSS via unescaped slot name (GHSA-8hv8-536x-4wqp), XSS via unescaped attribute names in spread props (GHSA-jrpj-wcv7-9fh9), Host header SSRF w prerendered error page fetch (GHSA-2pvr-wf23-7pc7). Fix: `npm audit fix`.
- **esbuild** `0.27.3 - 0.28.0` (tranzytywny, dev-server) — arbitrary file read w dev serverze na Windows (GHSA-g7r4-m6w7-qqqr). Dotyczy lokalnego dev, nie produkcji. Fix: `npm audit fix`.
- **undici** `7.0.0 - 7.27.2` (tranzytywny przez miniflare) — TLS cert validation bypass, HTTP header injection, WebSocket DoS, cache poisoning i in. (GHSA-vmh5-mc38-953g i 6 powiązanych). Fix: `npm audit fix`.
- **vite** `7.0.0 - 7.3.3` (tranzytywny, dev) — NTLMv2 hash disclosure via UNC path na Windows (GHSA-v6wh-96g9-6wx3), `server.fs.deny` bypass na Windows (GHSA-fx2h-pf6j-xcff). Fix: `npm audit fix`.
- **ws** `8.0.0 - 8.20.1` (tranzytywny przez @supabase/realtime-js) — uninitialized memory disclosure (GHSA-58qx-3vcg-4xpx), memory-exhaustion DoS (GHSA-96hv-2xvq-fx4p). Fix: `npm audit fix`.
- **devalue** `5.6.3 - 5.8.0` (tranzytywny) — DoS via sparse array deserialization (GHSA-77vg-94rm-hx3p). Fix: `npm audit fix`.

#### MODERATE findings

10 podatności moderate, m.in.: **@babel/core** `<=7.29.0` (arbitrary file read via sourceMappingURL, GHSA-4x5r-pxfx-6jf8), **js-yaml** `<=4.1.1` (quadratic-complexity DoS, GHSA-h67p-54hq-rp68), **tar** `<=7.5.15` (file smuggling via PAX size override, GHSA-vmf3-w455-68vh; pociąga `supabase`), **yaml** `2.0.0 - 2.8.2` (stack overflow via deeply nested collections, GHSA-48c2-rrv3-qjmp; pociąga łańcuch `yaml-language-server` → `volar-service-yaml` → `@astrojs/language-server` → `@astrojs/check`), oraz tranzytywne `wrangler`/`miniflare`/`@cloudflare/vite-plugin`. Większość to narzędzia build/dev. Fix: `npm audit fix` (dla `yaml` — `--force`, breaking).

#### LOW / INFO findings

2 podatności low — nie wyróżnione indywidualnie w widoku podsumowania `npm audit`; pełny rozkład dostępny przez `npm audit` w katalogu projektu.

## Hints recorded but not acted on

| Hint                    | Value                |
| ----------------------- | -------------------- |
| bootstrapper_confidence | first-class          |
| quality_override        | false                |
| path_taken              | standard             |
| self_check_answers      | null                 |
| team_size               | solo                 |
| deployment_target       | cloudflare-pages     |
| ci_provider             | cloudflare-builds    |
| ci_default_flow         | auto-deploy-on-merge |
| has_auth                | true                 |
| has_payments            | false                |
| has_realtime            | true                 |
| has_ai                  | false                |
| has_background_jobs     | false                |

v1 odnotowuje te hinty, ale ich nie realizuje — `AGENTS.md`/`CLAUDE.md`, pliki CI i konfiguracja deploymentu należą do przyszłego kroku (M1L4).

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:

- `git init` jeśli jeszcze nie masz własnego repo (historia startera została usunięta celowo).
- Przejrzyj `CLAUDE.md.scaffold` — porównaj z własnym `CLAUDE.md` i zdecyduj, co zachować (`diff CLAUDE.md CLAUDE.md.scaffold`).
- Rozważ `npm audit fix` dla podatności nie wymagających breaking changes; `yaml` wymaga `--force`. 0 critical, większość high to narzędzia build/dev (część luk file-read tylko na Windows w dev serverze).
- Skonfiguruj `.env` na bazie `.env.example` (Supabase + Cloudflare) — NIE commituj `.env`.
