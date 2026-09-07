#!/usr/bin/env node
// PostToolUse hook: format the single file the agent just wrote/edited.
//
// Why prettier and not eslint here: this project's eslint config is type-aware
// (`projectService: true`), so linting one file costs 12-22s on Windows — too slow
// to sit in the agent loop. Prettier on one file is ~0.3s. ESLint and typecheck run
// at the pre-commit gate instead (.husky/pre-commit). See CLAUDE-m3l3 layering.
//
// Exit codes: 0 = formatted or skipped, 2 = prettier could not parse the file
// (usually a syntax error worth showing the agent).

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const FORMATTABLE = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".astro", ".json", ".jsonc", ".css", ".md"]);

function readEvent() {
  let raw = "";
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const event = readEvent();
const filePath = event?.tool_input?.file_path;
if (!filePath) {
  process.exit(0);
}

const cwd = process.cwd();
const absolute = path.resolve(cwd, filePath);
const relative = path.relative(cwd, absolute);

// Ignore anything outside the project and anything prettier has no business touching.
if (relative.startsWith("..") || path.isAbsolute(relative)) {
  process.exit(0);
}
if (!FORMATTABLE.has(path.extname(absolute).toLowerCase())) {
  process.exit(0);
}
if (!existsSync(absolute)) {
  process.exit(0);
}

const prettierBin = path.join(cwd, "node_modules", "prettier", "bin", "prettier.cjs");
if (!existsSync(prettierBin)) {
  process.exit(0);
}

// Calling the bin through node skips the ~5s `npx` resolution penalty on Windows.
// `--ignore-unknown` keeps unsupported files quiet; .prettierignore is honoured.
const result = spawnSync(process.execPath, [prettierBin, "--write", "--ignore-unknown", relative], {
  cwd,
  encoding: "utf8",
});

if (result.status !== 0) {
  const detail = `${result.stderr ?? ""}${result.stdout ?? ""}`.trim();
  process.stderr.write(`prettier could not format ${relative}:\n${detail}\n`);
  process.exit(2);
}

process.exit(0);
