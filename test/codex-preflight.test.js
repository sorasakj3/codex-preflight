import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildPreflight,
  inferAcceptance,
  inferLikelyFiles,
  inferQuestions,
  renderPreflight,
} from "../bin/codex-preflight.js";

describe("Codex Preflight", () => {
  it("renders a paste-ready task document", () => {
    const preflight = buildPreflight({
      task: "fix mobile nav overlap",
      repoRoot: "/tmp/example-app",
      snapshot: {
        files: ["package.json", "src/App.tsx", "src/styles.css"],
        packageInfo: { name: "example-app", scripts: { test: "vitest" } },
        stacks: ["Node.js / JavaScript or TypeScript", "TypeScript"],
        testCommands: ["npm test"],
      },
    });
    const markdown = renderPreflight(preflight);

    assert.match(markdown, /# Codex Preflight/);
    assert.match(markdown, /fix mobile nav overlap/);
    assert.match(markdown, /Paste-Ready Codex Prompt/);
    assert.match(markdown, /npm test/);
  });

  it("builds structured output for JSON mode", () => {
    const preflight = buildPreflight({
      task: "add a --json flag to the CLI",
      repoRoot: "/tmp/codex-preflight",
      snapshot: {
        files: ["package.json", "bin/codex-preflight.js", "test/codex-preflight.test.js"],
        packageInfo: { name: "codex-preflight", scripts: { test: "node --test" } },
        stacks: ["Node.js / JavaScript or TypeScript"],
        testCommands: ["npm test"],
      },
    });

    assert.equal(preflight.repo.name, "codex-preflight");
    assert.ok(preflight.suggestedFiles.includes("bin"));
    assert.ok(preflight.pasteReadyPrompt.includes("Goal: add a --json flag to the CLI"));
  });

  it("infers UI questions for frontend tasks", () => {
    const questions = inferQuestions("polish the settings page UI");
    assert.ok(questions.some((question) => question.includes("design tokens")));
  });

  it("points CLI tasks toward bin or cli areas", () => {
    const likelyFiles = inferLikelyFiles("add a CLI flag for stdout", [
      "bin/tool.js",
      "src/index.ts",
      "README.md",
    ]);

    assert.ok(likelyFiles.includes("`bin`"));
    assert.ok(likelyFiles.includes("`README.md`"));
  });

  it("adds CLI acceptance criteria for command tasks", () => {
    const acceptance = inferAcceptance("add a terminal command");
    assert.ok(acceptance.some((criterion) => criterion.includes("help output")));
  });
});
