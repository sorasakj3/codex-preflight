# Codex Preflight

Turn a rough coding request into a Codex-ready `TASK.md`.

Codex works better when the task has boundaries, acceptance criteria, and a verification plan. This tiny CLI creates that preflight from one sentence and a quick scan of the repo.

## Usage

```sh
npm start -- "fix mobile nav overlap"
```

Or after linking/installing:

```sh
codex-preflight "add password reset flow"
codex-preflight "add tests for billing webhooks" --repo ./my-app --out TASK.md
codex-preflight "polish the settings page UI" --stdout
codex-preflight "add a --json flag to the CLI" --json --stdout
```

Markdown writes to `TASK.md` by default. JSON writes to `preflight.json` by default.

## What It Generates

- Objective
- Repo context and detected stack
- Likely files or areas to inspect first
- Assumptions Codex should validate
- Clarifying questions Codex should answer from the repo
- Boundaries to avoid unrelated churn
- Suggested implementation plan
- Acceptance criteria
- Verification plan
- Paste-ready Codex prompt

Use `--json` when you want to pipe the preflight into another script or automation.

## Example

```sh
codex-preflight "add a --json flag to the CLI"
```

Creates `TASK.md`:

```md
# Codex Preflight

## Objective
add a --json flag to the CLI.

## Likely Files Or Areas To Inspect First
- `bin`
- `cli`
- `README.md`

...
```

## Why This Exists

The fastest way to waste Codex usage is to start with a fuzzy task and let the agent discover the shape of the work the expensive way. Preflight makes the first prompt smaller, clearer, and easier to verify.

## Development

```sh
npm test
```
