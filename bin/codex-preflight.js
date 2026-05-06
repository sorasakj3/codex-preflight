#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "0.1.0";

const DEFAULT_IGNORES = new Set([
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  ".venv",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
]);

const STACK_MARKERS = [
  { file: "package.json", label: "Node.js / JavaScript or TypeScript" },
  { file: "tsconfig.json", label: "TypeScript" },
  { file: "vite.config.js", label: "Vite" },
  { file: "vite.config.ts", label: "Vite" },
  { file: "next.config.js", label: "Next.js" },
  { file: "next.config.mjs", label: "Next.js" },
  { file: "next.config.ts", label: "Next.js" },
  { file: "pyproject.toml", label: "Python" },
  { file: "requirements.txt", label: "Python" },
  { file: "Cargo.toml", label: "Rust" },
  { file: "go.mod", label: "Go" },
  { file: "Gemfile", label: "Ruby" },
  { file: "pom.xml", label: "Java / Maven" },
  { file: "build.gradle", label: "Java / Gradle" },
  { file: "docker-compose.yml", label: "Docker Compose" },
  { file: "Dockerfile", label: "Docker" },
];

const AREA_HINTS = [
  { pattern: /\b(api|endpoint|route|server|backend|controller)\b/i, paths: ["api", "server", "routes", "controllers", "src/server", "app/api"] },
  { pattern: /\b(ui|frontend|screen|page|component|button|modal|form|css|style)\b/i, paths: ["src", "app", "pages", "components", "styles"] },
  { pattern: /\b(test|spec|coverage|regression)\b/i, paths: ["test", "tests", "__tests__", "spec", "src"] },
  { pattern: /\b(auth|login|session|oauth|permission)\b/i, paths: ["auth", "middleware", "src/auth", "app/api/auth"] },
  { pattern: /\b(database|db|schema|migration|sql|model)\b/i, paths: ["db", "database", "migrations", "prisma", "models"] },
  { pattern: /\b(cli|command|terminal|argument|flag)\b/i, paths: ["bin", "cli", "cmd", "src/cli"] },
  { pattern: /\b(docs|readme|documentation)\b/i, paths: ["README.md", "docs"] },
];

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    process.stdout.write(helpText());
    return;
  }

  if (args.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  if (!args.task) {
    fail("Missing task. Try: codex-preflight \"add password reset flow\"");
  }

  const repoRoot = resolve(args.repo ?? process.cwd());
  if (!existsSync(repoRoot)) {
    fail(`Repo path does not exist: ${repoRoot}`);
  }

  const snapshot = inspectRepo(repoRoot, args.depth);
  const preflight = buildPreflight({
    task: args.task,
    repoRoot,
    snapshot,
  });
  const output = args.json ? JSON.stringify(preflight, null, 2) : renderPreflight(preflight);

  if (args.stdout) {
    process.stdout.write(`${output}\n`);
    return;
  }

  const outPath = resolve(repoRoot, args.out ?? (args.json ? "preflight.json" : "TASK.md"));
  writeFileSync(outPath, `${output}\n`, "utf8");
  process.stdout.write(`Wrote ${relative(process.cwd(), outPath) || basename(outPath)}\n`);
}

function parseArgs(argv) {
  const parsed = {
    depth: 3,
    help: false,
    json: false,
    out: null,
    repo: process.cwd(),
    stdout: false,
    task: "",
    version: false,
  };

  const taskParts = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--version" || arg === "-v") {
      parsed.version = true;
    } else if (arg === "--stdout") {
      parsed.stdout = true;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--repo") {
      parsed.repo = nextValue(argv, (i += 1), "--repo");
    } else if (arg === "--out") {
      parsed.out = nextValue(argv, (i += 1), "--out");
    } else if (arg === "--depth") {
      parsed.depth = Number.parseInt(nextValue(argv, (i += 1), "--depth"), 10);
      if (!Number.isInteger(parsed.depth) || parsed.depth < 1 || parsed.depth > 8) {
        fail("--depth must be an integer from 1 to 8.");
      }
    } else if (arg.startsWith("-")) {
      fail(`Unknown option: ${arg}`);
    } else {
      taskParts.push(arg);
    }
  }

  parsed.task = taskParts.join(" ").trim();
  return parsed;
}

function nextValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("-")) {
    fail(`Missing value for ${flag}.`);
  }
  return value;
}

function inspectRepo(root, maxDepth) {
  const files = walk(root, root, maxDepth);
  const fileSet = new Set(files);
  const stacks = detectStacks(root, fileSet);
  const packageInfo = readPackageInfo(root);
  const testCommands = detectTestCommands(root, fileSet, packageInfo);

  return {
    files,
    packageInfo,
    stacks,
    testCommands,
  };
}

function walk(root, current, maxDepth, depth = 0) {
  if (depth > maxDepth) return [];

  let entries = [];
  try {
    entries = readdirSync(current, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => !DEFAULT_IGNORES.has(entry.name))
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .flatMap((entry) => {
      const fullPath = join(current, entry.name);
      const relPath = relative(root, fullPath);
      if (entry.isDirectory()) {
        return [slash(relPath), ...walk(root, fullPath, maxDepth, depth + 1)];
      }
      if (isUsefulFile(entry.name)) {
        return [slash(relPath)];
      }
      return [];
    });
}

function isUsefulFile(name) {
  const ext = extname(name).toLowerCase();
  return (
    !name.startsWith(".DS_Store") &&
    (ext === "" ||
      [
        ".css",
        ".go",
        ".html",
        ".js",
        ".json",
        ".jsx",
        ".md",
        ".mjs",
        ".py",
        ".rs",
        ".sh",
        ".sql",
        ".toml",
        ".ts",
        ".tsx",
        ".yml",
        ".yaml",
      ].includes(ext))
  );
}

function detectStacks(root, fileSet) {
  const labels = new Set();
  for (const marker of STACK_MARKERS) {
    if (fileSet.has(marker.file) || existsSync(join(root, marker.file))) {
      labels.add(marker.label);
    }
  }
  return [...labels];
}

function readPackageInfo(root) {
  const packagePath = join(root, "package.json");
  if (!existsSync(packagePath)) return null;

  try {
    const parsed = JSON.parse(readFileSync(packagePath, "utf8"));
    return {
      name: parsed.name,
      scripts: parsed.scripts ?? {},
    };
  } catch {
    return null;
  }
}

function detectTestCommands(root, fileSet, packageInfo) {
  const commands = [];

  if (packageInfo?.scripts?.test) commands.push("npm test");
  if (packageInfo?.scripts?.lint) commands.push("npm run lint");
  if (packageInfo?.scripts?.typecheck) commands.push("npm run typecheck");
  if (fileSet.has("pyproject.toml")) commands.push("pytest");
  if (fileSet.has("Cargo.toml")) commands.push("cargo test");
  if (fileSet.has("go.mod")) commands.push("go test ./...");

  const seen = new Set();
  return commands.filter((command) => {
    if (seen.has(command)) return false;
    seen.add(command);
    return true;
  });
}

function buildPreflight({ task, repoRoot, snapshot }) {
  const cleanTask = sentence(task);
  const repoName = basename(repoRoot);
  const likelyFiles = inferLikelyFiles(task, snapshot.files);
  const questions = inferQuestions(task);
  const boundaries = inferBoundaries(task);
  const plan = inferPlan(task);
  const acceptance = inferAcceptance(task);
  const verification = snapshot.testCommands.length
    ? snapshot.testCommands
    : ["Run the smallest relevant manual or project-specific verification available."];

  return {
    acceptance,
    assumptions: [
      "The existing project conventions should drive naming, structure, and styling.",
      "The change should be scoped to the smallest surface that satisfies the objective.",
      "Existing behavior should be preserved unless the task explicitly asks to change it.",
    ],
    boundaries,
    objective: cleanTask,
    pasteReadyPrompt: renderPasteReadyPrompt(task),
    plan,
    questions,
    repo: {
      name: repoName,
      packageName: snapshot.packageInfo?.name ?? null,
      root: repoRoot,
      stack: snapshot.stacks,
    },
    suggestedFiles: likelyFiles.map(stripTicks),
    verification,
  };
}

function renderPreflight(preflight) {
  return `# Codex Preflight

## Objective
${preflight.objective}

## Repo Context
- Repository: \`${preflight.repo.name}\`
- Detected stack: ${preflight.repo.stack.length ? preflight.repo.stack.map((item) => `\`${item}\``).join(", ") : "Unknown from current files"}
- Package: ${preflight.repo.packageName ? `\`${preflight.repo.packageName}\`` : "Not detected"}

## Likely Files Or Areas To Inspect First
${renderList(preflight.suggestedFiles.map((path) => `\`${path}\``))}

## Assumptions To Validate
${renderList(preflight.assumptions)}

## Clarifying Questions Codex Should Answer Before Editing
${renderList(preflight.questions)}

## Boundaries
${renderList(preflight.boundaries)}

## Suggested Implementation Plan
${renderList(preflight.plan)}

## Acceptance Criteria
${renderList(preflight.acceptance)}

## Verification Plan
${renderList(preflight.verification)}

## Paste-Ready Codex Prompt
\`\`\`text
${preflight.pasteReadyPrompt}
\`\`\`
`;
}

function renderPasteReadyPrompt(task) {
  return `Use this TASK.md as the source of truth.

Goal: ${task}

Before editing:
- Inspect the likely files or areas listed above.
- Validate the assumptions and answer the clarifying questions from repository context when possible.
- If a question cannot be answered from the repo, make the most conservative reasonable assumption and state it.

While editing:
- Keep the change scoped.
- Follow existing project conventions.
- Do not rewrite unrelated code.
- Add or update focused tests when the behavior risk justifies it.

Before finishing:
- Run the verification plan where possible.
- Summarize changed files, verification results, and any remaining risk.`;
}

function stripTicks(value) {
  return value.replace(/^`|`$/g, "");
}

function inferLikelyFiles(task, files) {
  const hints = new Set();

  for (const area of AREA_HINTS) {
    if (area.pattern.test(task)) {
      for (const path of area.paths) hints.add(path);
    }
  }

  const lowerTask = task.toLowerCase();
  for (const file of files) {
    const base = basename(file).toLowerCase();
    const stem = base.replace(extname(base), "");
    if (stem.length > 2 && lowerTask.includes(stem)) hints.add(file);
  }

  const alwaysUseful = [
    "README.md",
    "package.json",
    "pyproject.toml",
    "Cargo.toml",
    "go.mod",
    "src",
    "app",
    "lib",
    "test",
    "tests",
  ];

  for (const useful of alwaysUseful) {
    if (files.includes(useful) || files.some((file) => file.startsWith(`${useful}/`))) {
      hints.add(useful);
    }
  }

  return [...hints].slice(0, 12).map((path) => `\`${path}\``);
}

function inferQuestions(task) {
  const questions = [
    "What existing pattern in the repo is closest to this change?",
    "What is the smallest user-visible behavior that proves the task is complete?",
    "Which files should be left untouched because they are unrelated?",
  ];

  if (/\b(ui|frontend|page|component|style|css)\b/i.test(task)) {
    questions.push("Are there existing design tokens, components, or layout conventions to reuse?");
  }

  if (/\b(api|backend|database|auth|permission)\b/i.test(task)) {
    questions.push("Are there security, auth, validation, or migration concerns in this code path?");
  }

  if (/\b(fix|bug|error|broken|regression)\b/i.test(task)) {
    questions.push("Can the bug be reproduced with an existing test, script, or minimal command?");
  }

  return questions;
}

function inferBoundaries(task) {
  const boundaries = [
    "Do not make broad refactors unless they are required for the objective.",
    "Do not change formatting, dependencies, or generated files unless necessary.",
    "Do not remove existing tests or safety checks to make verification pass.",
  ];

  if (/\b(database|migration|schema)\b/i.test(task)) {
    boundaries.push("Do not modify persisted data or destructive migrations without an explicit migration plan.");
  }

  if (/\b(auth|payment|billing|security|permission)\b/i.test(task)) {
    boundaries.push("Treat this as a high-risk path and prefer explicit validation plus tests.");
  }

  return boundaries;
}

function inferPlan(task) {
  const plan = [
    "Read the closest existing implementation and tests before editing.",
    "Identify the minimal set of files needed for the change.",
    "Make the implementation change in small, reviewable steps.",
    "Add or adjust focused tests, fixtures, or examples if behavior changes.",
    "Run verification and inspect the diff for unrelated churn.",
  ];

  if (/\b(docs|readme|documentation)\b/i.test(task)) {
    plan.splice(3, 0, "Keep docs examples runnable and aligned with current commands.");
  }

  return plan;
}

function inferAcceptance(task) {
  const criteria = [
    `The requested task is implemented: ${sentence(task)}`,
    "The change follows existing repo conventions.",
    "Unrelated files and behaviors are unchanged.",
    "Verification commands complete, or any inability to run them is clearly explained.",
  ];

  if (/\b(ui|frontend|page|component|style|css)\b/i.test(task)) {
    criteria.push("The UI works at relevant desktop and mobile sizes without text overlap.");
  }

  if (/\b(cli|command|terminal|flag)\b/i.test(task)) {
    criteria.push("The CLI handles help output, invalid inputs, and the main success path.");
  }

  return criteria;
}

function renderList(items) {
  if (!items.length) return "- No obvious candidates found. Start from the repo entry points.";
  return items.map((item) => `- ${item}`).join("\n");
}

function sentence(value) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function slash(path) {
  return path.replaceAll("\\", "/");
}

function helpText() {
  return `Codex Preflight ${VERSION}

Turn a rough coding request into a Codex-ready TASK.md.

Usage:
  codex-preflight "add password reset flow"
  codex-preflight "fix mobile nav overlap" --repo ./my-app --out TASK.md
  codex-preflight "add tests for billing webhooks" --stdout
  codex-preflight "add a --json flag" --json --stdout

Options:
  --repo <path>     Repository to inspect. Defaults to the current directory.
  --out <path>      Output path. Defaults to TASK.md or preflight.json in JSON mode.
  --depth <n>       File tree depth to inspect, 1-8. Defaults to 3.
  --json            Write or print structured JSON instead of markdown.
  --stdout          Print markdown instead of writing a file.
  -h, --help        Show this help.
  -v, --version     Show the version.
`;
}

function fail(message) {
  process.stderr.write(`codex-preflight: ${message}\n`);
  process.exit(1);
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main();
}

export {
  buildPreflight,
  inspectRepo,
  inferAcceptance,
  inferBoundaries,
  inferLikelyFiles,
  inferPlan,
  inferQuestions,
  renderPreflight,
};
