---
starter_id: 10x-astro-starter
package_manager: npm
project_name: pupilownik
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-workers
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
---

## Why this stack

Pupilownik to web-app dla pojedynczego dewelopera (solo) z 3-tygodniowym oknem MVP, gdzie kluczowe wymagania to konto właściciela (auth), współdzielony kalendarz z realtime oraz PostgreSQL (po świadomym odrzuceniu SQL Server). 10x-astro-starter pokrywa wszystkie trzy z pudełka przez Supabase (PostgreSQL + auth + realtime + storage), więc nie trzeba dokładać osobnych usług — co bezpośrednio skraca drogę do działającej ścieżki MVP. TypeScript w całym projekcie trzyma jawne kontrakty na granicach (Zod), co jest agent-friendly, a Astro + React pozwala lekko zbudować zarówno panel właściciela, jak i mobilny widok opiekuna z linku. Deployment i CI/CD idą natywną drogą Cloudflare: cel to **Cloudflare Workers** (nie Pages — `@astrojs/cloudflare` v13+ wycofał wsparcie dla Pages; `wrangler.jsonc` w starterze jest już konfiguracją Workers z `nodejs_compat`). Repozytorium żyje na **GitHubie**, więc **Cloudflare Workers Builds** podłącza się do repo natywnie — auto-deploy na merge do gałęzi produkcyjnej, podglądowe URL-e per PR, bez GitHub Actions. Sekrety `SUPABASE_URL`/`SUPABASE_KEY` ustawia się jako build-environment variables w konfiguracji Workers Builds oraz jako runtime secrets przez `npx wrangler secret put`. Pewność scaffoldingu: first-class.
