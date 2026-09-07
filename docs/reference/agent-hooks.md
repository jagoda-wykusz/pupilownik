# Agent hooks

Local quality gates that fire while an AI agent works, plus the git-hook layer
underneath them. Gate placement and its measured cost live in
`context/foundation/test-plan.md` §5 — this file documents the wiring.

## Layers

| Layer      | Where                                                               | What runs                                                                                 |
| ---------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| per-edit   | `.claude/settings.json` → `PostToolUse` on `Write\|Edit\|MultiEdit` | prettier on the edited file; `vitest related` for risk-area files                         |
| pre-commit | `.husky/pre-commit`                                                 | `lint-staged` (eslint --fix on staged files, prettier on json/css/md) then `tsc --noEmit` |
| CI         | Cloudflare Workers Builds                                           | full lint + build                                                                         |

## Per-edit hooks

Both hooks read the PostToolUse event JSON from stdin and take
`tool_input.file_path`. They are plain Node scripts rather than shell
one-liners for two reasons: `jq` is not installed on the dev machines here, and
the exec form (`"command": "node", "args": [...]`) never touches a shell, so it
behaves the same on Windows and POSIX.

| Script                                 | Trigger                                                                        | Exit codes                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `.claude/hooks/format-edited-file.mjs` | any formattable extension inside the project                                   | `0` formatted or skipped, `2` prettier could not parse the file |
| `.claude/hooks/related-tests.mjs`      | `src/middleware.ts`, `src/db/**`, `src/pages/api/**`, `src/lib/**`, `tests/**` | `0` passed / skipped, `2` related tests failed                  |

Exit code `2` is the blocking signal: Claude Code feeds the hook's stderr back
into the agent's context, so the agent sees the actual failure and can fix it
on the next turn. Any other non-zero code is logged but does not block.

The test hook exits `0` (with a note on stdout) when the local Supabase stack is
unreachable or `.env.test` is missing, and when the edited file is a migration —
see the reasoning in test-plan §5.

Both hooks call `node_modules/.../{prettier,vitest}` directly instead of via
`npx`, which costs ~5s of resolution per invocation on Windows.

## The same hook in other tools

The pattern is trigger → matcher → handler → signal everywhere; only the config
format changes. The format hook, translated:

**Cursor** — `.cursor/hooks.json`

```json
{
  "version": 1,
  "hooks": {
    "afterFileEdit": [{ "command": "node .claude/hooks/format-edited-file.mjs" }]
  }
}
```

**Codex** — `.codex/hooks.json` (or `[hooks]` in `~/.codex/config.toml`).
Repo-level hooks are hash-gated: they do not run until reviewed and approved
with `/hooks`, and every edit needs re-approval.

```json
{
  "hooks": {
    "PostToolUse": [{ "matcher": "Write|Edit", "command": ["node", ".claude/hooks/format-edited-file.mjs"] }]
  }
}
```

**Copilot (VS Code)** — reads `.claude/settings.json`, but the compatibility is
partial and this hook needs adapting: matchers are ignored (the hook fires on
every event of that type), tool names differ (`create_file`, not `Write`), and
payload fields are camelCase (`tool_input.filePath`, not
`tool_input.file_path`).

**Windsurf** — can block on exit code 2 but cannot pass the hook's output back
to the agent, so automatic self-correction does not work there.
