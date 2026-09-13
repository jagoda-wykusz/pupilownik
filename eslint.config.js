/* eslint-disable @typescript-eslint/no-deprecated -- tseslint.config() is the only way to use extends; core defineConfig has incompatible API */
import { includeIgnoreFile } from "@eslint/config-helpers";
import eslint from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import eslintPluginAstro from "eslint-plugin-astro";
import pluginReact from "eslint-plugin-react";
import reactCompiler from "eslint-plugin-react-compiler";
import eslintPluginReactHooks from "eslint-plugin-react-hooks";
import path from "node:path";
import tseslint from "typescript-eslint";

const gitignorePath = path.resolve(import.meta.dirname, ".gitignore");

const baseConfig = tseslint.config({
  extends: [eslint.configs.recommended, tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
  languageOptions: {
    parserOptions: {
      projectService: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
  rules: {
    "no-console": "warn",
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
        ignoreRestSiblings: true,
      },
    ],
    "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
  },
});

const reactConfig = tseslint.config({
  files: ["**/*.{js,jsx,ts,tsx}"],
  extends: [pluginReact.configs.flat.recommended],
  languageOptions: {
    ...pluginReact.configs.flat.recommended.languageOptions,
    globals: {
      window: true,
      document: true,
    },
  },
  plugins: {
    "react-hooks": eslintPluginReactHooks,
    "react-compiler": reactCompiler,
  },
  settings: { react: { version: "detect" } },
  rules: {
    ...eslintPluginReactHooks.configs.recommended.rules,
    "react/react-in-jsx-scope": "off",
    "react-compiler/react-compiler": "error",
  },
});

// Standalone Node scripts. They are plain .mjs run by `node`, not part of any tsconfig, so the
// type-aware rules see every value as `any` and the browser-ish default globals hide `process`
// and `console`. Scoped narrowly and additively: this block changes nothing for src/ or tests/.
const scriptsConfig = tseslint.config({
  files: ["scripts/**/*.mjs"],
  extends: [tseslint.configs.disableTypeChecked],
  languageOptions: {
    globals: { process: "readonly", console: "readonly", URL: "readonly" },
  },
  rules: {
    // A CLI script's output IS its interface.
    "no-console": "off",
  },
});

// Server routes. Under `output: "server"` every `.ts` under src/pages/ is an Astro ENDPOINT — it
// runs on workerd and never reaches a browser. `wrangler.jsonc` has observability enabled and this
// project has no logging library, so `console.error` here is not debug residue: it IS the log sink,
// and the call sites know it (src/pages/api/periods.ts carries "Never log inviteToken" directly
// above one). Twelve such calls were reported as warnings by a rule that never applied to them.
//
// NARROWER THAN THE scripts/ BLOCK ABOVE, deliberately. That one turns the rule off outright,
// because a CLI script's output is its interface. An endpoint's output is its HTTP response, not
// its log — so `console.log` and `console.debug` stay forbidden, and a debugging line left behind
// still fails the build. Only the two levels that mean "something went wrong" are allowed.
//
// Also deliberately NOT extended to src/lib/: those modules are imported by client islands, where
// the rule protects something real.
//
// TWO ASSUMPTIONS THIS GLOB RESTS ON, both flagged in review and both true today rather than
// guaranteed:
//
//   1. Every `.ts` under src/pages/ is an endpoint. That holds for this repo (all nine are, and
//      nothing outside tests/ imports them) but not for Astro in general: an `_`-prefixed file is
//      excluded from routing and is a normal place for a helper — which WOULD match this glob,
//      inherit the allowance, and could legitimately be imported by a client island. If such a file
//      ever appears, narrow this to `src/pages/**/[!_]*.ts` rather than trusting the comment.
//   2. The rule pins the LEVEL, not the PAYLOAD. `console.error(error)` or
//      `console.error(await request.text())` passes it cleanly, and Workers retains logs. What
//      keeps the twelve existing sites safe is a discipline documented at the call sites — they log
//      `error.code, error.message` and never the whole error, because a `postgres`-owned SECURITY
//      DEFINER function does receive the failing row in `details` (see src/pages/api/periods.ts and
//      src/pages/invite/claim.ts). Nothing mechanical enforces that.
// Named for endpoints because that is all it covered until 2026-09-13, when `.astro` pages joined
// on the same argument rather than a new one. A page's frontmatter runs SERVER-side and its
// `console` output goes to the identical Workers sink an endpoint's does — `wrangler.jsonc` enables
// observability and this project has no logging library by decision, so `console.error` IS the log
// sink on both. What the block keeps out is unchanged: `console.log` still fails everywhere here,
// because a page's output is its HTTP response, not its log.
//
// The trigger was measurable: `src/pages/invite/[token].astro` swallowed BOTH of its RPC errors,
// and a grep for `console.` across every `.astro` file in the repo returned zero. The base rule
// plus `--max-warnings 0` meant the obvious fix could not be committed.
//
// STILL EXCLUDED, deliberately: `src/lib/**`, which client islands import. That exclusion is about
// which bundle the code can reach, and adding server-rendered pages does not weaken it.
//
// AND CLIENT `<script>` BLOCKS STAY OUT TOO — structurally, not by luck, which is worth recording
// because the mechanism is an upstream detail a reader would otherwise have to re-derive.
// `eslint-plugin-astro`'s flat/recommended applies `processor: "astro/client-side-ts"` to
// `**/*.astro`, which extracts each `<script>` body into a virtual file named `**/*.astro/*.js`.
// That path's basename no longer ends in `.astro`, so it does not match the glob below and a
// `console.*` inside a page's client script still falls under the base `no-console: "warn"` — and
// therefore still fails `--max-warnings 0`. Latent rather than live today: there are no `<script>`
// tags anywhere under `src/pages/`, `src/layouts/` or `src/components/`.
const serverRouteConfig = tseslint.config({
  files: ["src/pages/**/*.ts", "src/pages/**/*.astro"],
  rules: {
    // `error`, not `warn`: since `npm run lint` now runs with --max-warnings 0, a `warn` here
    // would fail the build identically while telling the reader it is advisory.
    //
    // Note the asymmetry this creates, measured rather than assumed: a `console.error` in a client
    // component reports as a WARNING (the base rule at `no-console: "warn"`) and fails only because
    // of --max-warnings 0, whereas a `console.log` in an endpoint reports as an ERROR and fails on
    // its own. Drop that flag and client code silently reverts to advisory while endpoints stay
    // strict — which is why tests/unit/ci-gate-source.test.ts pins it.
    "no-console": ["error", { allow: ["error", "warn"] }],
  },
});

const astroConfig = tseslint.config({
  files: ["**/*.astro"],
  rules: {
    "astro/no-set-html-directive": "error",
    "astro/no-unused-css-selector": "warn",
    "astro/prefer-class-list-directive": "warn",

    // A page that holds a secret is one keystroke from shipping it. MEASURED 2026-09-12: importing
    // SUPABASE_KEY in frontmatter and passing it to a `client:load` island BUILDS FINE, leaves
    // dist/client clean, passes `npm run check:secrets` — and puts the value verbatim into the HTTP
    // response inside `<astro-island props="...">`. Astro cannot stop it: the ServerOnlyModule guard
    // is keyed on which Vite environment resolves the module, and frontmatter resolves in `ssr`.
    //
    // So this bans the first step rather than the last. It is deliberately blunt — it forbids the
    // import even where the frontmatter would only read the value server-side — because no .astro
    // file in this repo imports it today, so the restriction costs nothing and removes the whole
    // class. The output-side guard is tests/render/island-props.test.ts, which catches what a source
    // rule cannot: the same value arriving through a helper, a re-export or a spread.
    //
    // NOT covered by the type system, which is worth saying because it nearly is: `astro check`
    // does reject an undeclared prop and a field missing from the source object (measured, two
    // errors). It cannot reject a secret handed to a prop already declared `string` — and a secret
    // is a string. Passing SUPABASE_KEY to SignInForm's `serverError` type-checks today.
    "no-restricted-imports": [
      "error",
      {
        paths: [
          {
            name: "astro:env/server",
            message:
              "Do not read server secrets in .astro frontmatter: Astro serializes island props into the HTML response, so one prop away is a disclosure the bundle scan cannot see. Read it in a .ts module and export a derived, non-secret value — src/lib/config-status.ts is the pattern.",
          },
        ],
      },
    ],
  },
});

export default tseslint.config(
  includeIgnoreFile(gitignorePath),
  // Generated by `npm run db:gen-types` — never hand-edited, so never linted/formatted.
  // `.claude/` holds harness state and agent git worktrees (checked-out project copies);
  // linting those would double-report and drag in stale generated files.
  { ignores: ["src/db/database.types.ts", ".claude/**"] },
  baseConfig,
  reactConfig,
  eslintPluginAstro.configs["flat/recommended"],
  ...eslintPluginAstro.configs["flat/jsx-a11y-recommended"],
  astroConfig,
  scriptsConfig,
  serverRouteConfig,
  eslintPluginPrettier,
);
