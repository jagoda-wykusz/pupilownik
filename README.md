# 10x Astro Starter

![](./public/template.png)

A modern, opinionated starter template for building fast, accessible web applications.

## Tech Stack

- [Astro](https://astro.build/) v6 - Modern web framework with server-first rendering
- [React](https://react.dev/) v19 - UI library for interactive components
- [TypeScript](https://www.typescriptlang.org/) v5 - Type-safe JavaScript
- [Tailwind CSS](https://tailwindcss.com/) v4 - Utility-first CSS framework
- [Supabase](https://supabase.com/) - Authentication and backend-as-a-service
- [Cloudflare Workers](https://workers.cloudflare.com/) - Edge deployment runtime

## Prerequisites

- Node.js v22.23.2 (as specified in `.nvmrc`)
- npm (comes with Node.js)

## Getting Started

1. Clone the repository:

```bash
git clone https://github.com/przeprogramowani/10x-astro-starter.git
cd 10x-astro-starter
```

2. Install dependencies:

```bash
npm install
```

3. Set up Supabase and configure environment variables — see [Supabase Configuration](#supabase-configuration) below.

4. Create a `.dev.vars` file for local Cloudflare dev secrets:

```bash
cp .env.example .dev.vars
```

5. Run the development server:

```bash
npm run dev
```

## Available Scripts

- `npm run dev` - Start development server (Cloudflare workerd runtime)
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint with type-checked rules
- `npm run lint:fix` - Auto-fix ESLint issues
- `npm run format` - Run Prettier
- `npm run check:secrets` - Scan `dist/client` for a secret that should never reach a browser (needs a build first)

## Project Structure

```md
.
├── src/
│ ├── layouts/ # Astro layouts
│ ├── pages/ # Astro pages
│ │ └── api/ # API endpoints
│ ├── components/ # UI components (Astro & React)
│ └── assets/ # Static assets
├── public/ # Public assets
├── wrangler.jsonc # Cloudflare Workers config
```

## Supabase Configuration

This project uses [Supabase](https://supabase.com/) for authentication. Environment variables are declared via Astro's `astro:env` schema and are treated as **server-only secrets** — they are never exposed to the client.

### First-time setup (local, no cloud project needed)

Requires [Docker](https://www.docker.com/) and ~7 GB RAM.

1. Create your `.env` file:

```bash
cp .env.example .env
```

2. Initialize the local Supabase project (creates a `supabase/` config folder):

```bash
npx supabase init
```

3. Start the local stack (downloads Docker images on first run):

```bash
npx supabase start
```

4. Copy the credentials printed by the CLI into your `.env` and `.dev.vars`:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<anon key from CLI output>
```

5. To stop the stack when done:

```bash
npx supabase stop
```

The local Studio UI is available at `http://localhost:54323`.

No database tables or migrations are required — this project uses Supabase Auth's built-in `auth.users` table only.

### Using a cloud Supabase project instead

If you prefer to use a hosted Supabase project, add these variables to your `.env` and `.dev.vars` files:

| Variable       | Description                                                |
| -------------- | ---------------------------------------------------------- |
| `SUPABASE_URL` | Project URL from Supabase dashboard → Settings → API       |
| `SUPABASE_KEY` | `anon` public key from Supabase dashboard → Settings → API |

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_KEY=<anon-key>
```

### Email confirmation in local development

By default Supabase requires email confirmation before a user can sign in. To skip this during local development:

1. Open the Supabase dashboard for your project
2. Go to **Authentication → Email → Confirm email**
3. Toggle it **off**

Users can then sign in immediately after sign-up without clicking a confirmation link.

### Auth routes

| Route                 | Description                                                             |
| --------------------- | ----------------------------------------------------------------------- |
| `/auth/signin`        | Email/password sign-in form                                             |
| `/auth/signup`        | Email/password sign-up form                                             |
| `/auth/confirm-email` | Post-signup "check your inbox" page                                     |
| `/dashboard`          | Example protected page (redirects to `/auth/signin` if unauthenticated) |

Route protection is handled in `src/middleware.ts`. Add paths to the `PROTECTED_ROUTES` array there to require authentication.

## Deployment

This project deploys to [Cloudflare Workers](https://workers.cloudflare.com/).

1. Build the project:

```bash
npm run build
```

2. Deploy with Wrangler:

```bash
npx wrangler deploy
```

Set `SUPABASE_URL` and `SUPABASE_KEY` as secrets in your Cloudflare dashboard or via `npx wrangler secret put`.

## CI / CD

**Two gates, in two places, for two different failures.**

|               | GitHub Actions                                                                                                                  | Workers Builds build command                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| What runs     | typecheck, lint, build, **all three vitest projects**, secret scan                                                              | typecheck, lint, build, **unit + component**, secret scan                                                             |
| Needs         | a real Supabase stack (Docker)                                                                                                  | nothing but the repo                                                                                                  |
| Can it block? | **No.** Private repo on GitHub Free — branch protection is unavailable, so a red run is a red X next to an enabled merge button | **Yes.** A non-zero exit produces no version, and no version means no deploy — including on a direct push to `master` |

The split is forced by the platforms, not chosen. The Cloudflare build container has no Docker, so `supabase start` cannot run there and the 22 integration files are permanently unrunnable in the publish gate. GitHub Actions is the only place they execute at all — and on this plan it can only report.

The publish gate is `npm run ci:gate`, defined in `package.json` rather than typed into the Cloudflare dashboard, so its contents live in git history where review can see them. The dashboard holds one line: `npm run ci:gate`. Order inside the chain is load-bearing — `astro check` regenerates `.astro/` that type-aware ESLint needs, and the build must precede the tests because `tests/unit/client-bundle.test.ts` scans `dist/client` and fails rather than skips without it.

Run the same gate locally before pushing:

```bash
npm run ci:gate       # exactly what Cloudflare runs; ~1-2 min
npm test              # adds the integration project (needs `npm run db:start`)
```

`tests/unit/ci-gate-source.test.ts` pins both gates, so removing a step from either breaks a test. It cannot see the Cloudflare dashboard field: if the build command is ever set back to `npm run build`, that test still passes and nothing blocks publication any more.

A pre-commit hook runs `lint-staged` (eslint on staged code, prettier on staged json/css/md) and `npm run check` — the same script the gate uses, so the two cannot drift apart. It is bypassable with `--no-verify` and does not run for anyone who has not installed hooks; the publish gate is not bypassable.

`SUPABASE_URL` and `SUPABASE_KEY` must be set in **two places**: as build-environment variables in the Workers Builds config, and as runtime secrets (`npx wrangler secret put`). Both are `optional: true` in `astro.config.mjs`, so a build succeeds without them — but `npm run check:secrets` exits 2 when they are missing, so since the gate was wired their absence blocks publication rather than surfacing at runtime.

See `context/foundation/test-plan.md` §5 for the full, verified gate inventory.

## License

MIT
