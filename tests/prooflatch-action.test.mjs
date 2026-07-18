import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import yaml from "js-yaml";

import { evidencePacketSchema } from "../lib/prooflatch-schema.ts";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const metadataPath = path.join(repositoryRoot, "action.yml");
const bundlePath = path.join(
  repositoryRoot,
  "action",
  "dist",
  "index.mjs",
);
const scannerPath = path.join(
  repositoryRoot,
  "bin",
  "prooflatch-scan.mjs",
);
const safeEnvironmentPath = path.join(
  repositoryRoot,
  "lib",
  "safe-process-env.mjs",
);

async function git(root, ...args) {
  return execFileAsync("git", ["-C", root, ...args], {
    env: {
      PATH: process.env.PATH,
      GIT_CONFIG_GLOBAL:
        process.platform === "win32" ? "NUL" : "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
}

async function makeTempDirectory(t, prefix = "prooflatch-action-") {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

async function initializeGit(root) {
  await git(root, "init", "-q");
  await git(root, "config", "user.name", "ProofLatch Action Test");
  await git(
    root,
    "config",
    "user.email",
    "prooflatch-action@example.invalid",
  );
}

async function writeReadyProject(
  root,
  { ci = true, readme = true } = {},
) {
  await writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify(
      {
        name: "prooflatch-action-fixture",
        version: "4.2.0",
        type: "module",
        scripts: {
          test:
            "node -e \"require('node:fs').writeFileSync('project-code-ran', 'unsafe')\"",
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(path.join(root, "package-lock.json"), "{}\n");
  await mkdir(path.join(root, "src"));
  await writeFile(
    path.join(root, "src", "index.js"),
    "export const ready = true;\n",
  );
  await mkdir(path.join(root, "tests"));
  await writeFile(
    path.join(root, "tests", "unit.test.mjs"),
    "export const testSignal = true;\n",
  );
  if (ci) {
    await mkdir(path.join(root, ".github", "workflows"), {
      recursive: true,
    });
    await writeFile(
      path.join(root, ".github", "workflows", "ci.yml"),
      "name: CI\non: push\njobs: {}\n",
    );
  }
  if (readme) {
    await writeFile(path.join(root, "README.md"), "# Fixture\n");
  }
}

async function makeRepository(t, options) {
  const root = await makeTempDirectory(t, "prooflatch-repository-");
  await initializeGit(root);
  await writeReadyProject(root, options);
  await git(root, "add", "--all");
  await git(root, "commit", "-q", "-m", "fixture");
  const { stdout } = await git(root, "rev-parse", "HEAD");
  return { root, sha: stdout.trim().toLowerCase() };
}

async function makeIsolatedAction(t) {
  const actionRoot = await makeTempDirectory(
    t,
    "prooflatch-isolated-action-",
  );
  await mkdir(path.join(actionRoot, "action", "dist"), {
    recursive: true,
  });
  await mkdir(path.join(actionRoot, "bin"), { recursive: true });
  await mkdir(path.join(actionRoot, "lib"), { recursive: true });
  await copyFile(
    bundlePath,
    path.join(actionRoot, "action", "dist", "index.mjs"),
  );
  await copyFile(
    scannerPath,
    path.join(actionRoot, "bin", "prooflatch-scan.mjs"),
  );
  await copyFile(
    safeEnvironmentPath,
    path.join(actionRoot, "lib", "safe-process-env.mjs"),
  );
  await chmod(
    path.join(actionRoot, "bin", "prooflatch-scan.mjs"),
    0o755,
  );
  return actionRoot;
}

function parseOutputFile(value) {
  const outputs = {};
  const lines = value.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^([^<]+)<<(.+)$/.exec(lines[index]);
    if (!match) {
      continue;
    }
    const [, name, delimiter] = match;
    const valueLines = [];
    index += 1;
    while (index < lines.length && lines[index] !== delimiter) {
      valueLines.push(lines[index]);
      index += 1;
    }
    outputs[name] = valueLines.join("\n");
  }
  return outputs;
}

async function runAction(
  t,
  {
    githubSha = "",
    inputPath = ".",
    releaseVersion = "",
    workspace,
  },
) {
  const actionRoot = await makeIsolatedAction(t);
  const runnerTemp = await makeTempDirectory(
    t,
    "prooflatch-runner-temp-",
  );
  const githubOutput = path.join(runnerTemp, "github-output");
  const stepSummary = path.join(runnerTemp, "step-summary");
  await writeFile(githubOutput, "");
  await writeFile(stepSummary, "");

  const environment = {
    ...process.env,
    GITHUB_OUTPUT: githubOutput,
    GITHUB_SHA: githubSha,
    GITHUB_STEP_SUMMARY: stepSummary,
    GITHUB_WORKSPACE: workspace,
    INPUT_PATH: inputPath,
    INPUT_TARGET: "Production repository baseline",
    "INPUT_RELEASE-VERSION": releaseVersion,
    PROOFLATCH_TEST_SECRET: "MUST_NOT_REACH_SCANNER_OUTPUT_f23a",
    RUNNER_TEMP: runnerTemp,
  };
  delete environment.NODE_OPTIONS;
  delete environment.GITHUB_ACTION_PATH;

  const result = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(actionRoot, "action", "dist", "index.mjs")],
      {
        cwd: workspace,
        env: environment,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      resolve({ code, stderr, stdout });
    });
  });

  const outputText = await readFile(githubOutput, "utf8");
  return {
    ...result,
    actionRoot,
    githubOutput,
    outputs: parseOutputFile(outputText),
    outputText,
    runnerTemp,
    summary: await readFile(stepSummary, "utf8"),
  };
}

function sectionKeys(source, start, end) {
  const startIndex = source.indexOf(`${start}:\n`);
  const endIndex = source.indexOf(`\n${end}:\n`, startIndex);
  assert.notEqual(startIndex, -1, `missing ${start} section`);
  assert.notEqual(endIndex, -1, `missing ${end} section`);
  const block = source.slice(startIndex, endIndex);
  return [...block.matchAll(/^  ([a-z0-9-]+):\s*$/gm)].map(
    (match) => match[1],
  );
}

async function assertPrivateArtifacts(outputs) {
  const evidence = evidencePacketSchema.parse(
    JSON.parse(await readFile(outputs["evidence-path"], "utf8")),
  );
  const receipt = JSON.parse(
    await readFile(outputs["receipt-path"], "utf8"),
  );
  const artifactDirectory = path.dirname(outputs["evidence-path"]);
  assert.equal((await stat(artifactDirectory)).mode & 0o777, 0o700);
  assert.equal(
    (await stat(outputs["evidence-path"])).mode & 0o777,
    0o600,
  );
  assert.equal(
    (await stat(outputs["receipt-path"])).mode & 0o777,
    0o600,
  );
  if (outputs["repair-brief-path"]) {
    assert.equal(
      (await stat(outputs["repair-brief-path"])).mode & 0o777,
      0o600,
    );
  }
  return { evidence, receipt };
}

test("action metadata exposes only the token-free repository baseline contract", async () => {
  const metadata = await readFile(metadataPath, "utf8");
  const parsedMetadata = yaml.load(metadata);

  assert.deepEqual(sectionKeys(metadata, "inputs", "outputs"), [
    "path",
    "target",
    "release-version",
  ]);
  assert.deepEqual(sectionKeys(metadata, "outputs", "runs"), [
    "verdict",
    "scanner-state",
    "evidence-digest",
    "policy",
    "commit",
    "blocking-check-ids",
    "warning-check-ids",
    "evidence-path",
    "receipt-path",
    "repair-brief-path",
  ]);
  assert.equal(parsedMetadata.runs.using, "node24");
  assert.equal(parsedMetadata.runs.main, "action/dist/index.mjs");
  assert.match(metadata, /^\s+using: "node24"$/m);
  assert.match(metadata, /^\s+main: "action\/dist\/index\.mjs"$/m);
  assert.doesNotMatch(
    sectionKeys(metadata, "inputs", "outputs").join("\n"),
    /token|policy|commands|fail-on-blocked/,
  );
});

test("isolated bundle produces READY evidence without node_modules", async (t) => {
  const repository = await makeRepository(t);
  const result = await runAction(t, {
    githubSha: repository.sha,
    releaseVersion: "9.1.0",
    workspace: repository.root,
  });

  assert.equal(
    result.code,
    0,
    JSON.stringify({
      outputText: result.outputText,
      stderr: result.stderr,
      stdout: result.stdout,
      summary: result.summary,
    }),
  );
  assert.equal(result.stderr, "");
  assert.equal(result.outputs.verdict, "READY");
  assert.equal(result.outputs["scanner-state"], "ready");
  assert.equal(
    result.outputs.policy,
    "repository-baseline@1.0.0",
  );
  assert.equal(result.outputs.commit, repository.sha);
  assert.deepEqual(
    JSON.parse(result.outputs["blocking-check-ids"]),
    [],
  );
  assert.deepEqual(
    JSON.parse(result.outputs["warning-check-ids"]),
    [],
  );
  assert.equal(result.outputs["repair-brief-path"], "");
  assert.match(result.outputs["evidence-digest"], /^[a-f0-9]{64}$/);
  assert.match(result.summary, /ProofLatch repository baseline/);
  assert.match(
    result.summary,
    /does not prove that project tests or builds ran successfully/,
  );
  assert.match(result.summary, /caller.s responsibility/);
  assert.doesNotMatch(
    `${result.stdout}${result.outputText}${result.summary}`,
    /MUST_NOT_REACH_SCANNER_OUTPUT_f23a/,
  );

  const { evidence, receipt } = await assertPrivateArtifacts(
    result.outputs,
  );
  assert.equal(evidence.release.version, "9.1.0");
  assert.equal(receipt.verdict, "READY");
  assert.equal(receipt.explanationMode, "deterministic-action");
  assert.equal(receipt.model, null);
  assert.equal(receipt.promptVersion, null);
  assert.deepEqual(receipt.producer, {
    kind: "github-action",
    version: "1.0.0",
    scannerState: "ready",
  });
  await assert.rejects(
    readFile(path.join(repository.root, "project-code-ran")),
  );
  await assert.rejects(
    stat(path.join(result.actionRoot, "node_modules")),
  );
});

test("bundle resolves its own Action root without GITHUB_ACTION_PATH", async (t) => {
  const repository = await makeRepository(t);
  const result = await runAction(t, {
    githubSha: repository.sha,
    workspace: repository.root,
  });

  assert.equal(result.code, 0);
  assert.equal(result.outputs.verdict, "READY");
});

test("review warnings remain READY and never create a repair brief", async (t) => {
  const repository = await makeRepository(t, {
    ci: false,
    readme: false,
  });
  const result = await runAction(t, {
    githubSha: repository.sha,
    workspace: repository.root,
  });

  assert.equal(result.code, 0);
  assert.equal(result.outputs.verdict, "READY");
  assert.equal(result.outputs["scanner-state"], "review");
  assert.deepEqual(
    JSON.parse(result.outputs["warning-check-ids"]),
    ["ci-signal", "readme"],
  );
  assert.equal(result.outputs["repair-brief-path"], "");
  assert.match(result.stdout, /ci-signal/);
  assert.match(result.stdout, /Continuous integration signal/);
  assert.match(result.stdout, /Status: warn/);
  const { receipt } = await assertPrivateArtifacts(result.outputs);
  assert.equal(receipt.verdict, "READY");
  assert.equal(receipt.producer.scannerState, "review");
});

test("dirty BLOCKED run persists outputs, receipt, and brief before failing", async (t) => {
  const repository = await makeRepository(t);
  await writeFile(
    path.join(repository.root, "src", "index.js"),
    "export const dirty = 'PRIVATE_DIRTY_CONTENT_17a4';\n",
  );
  const result = await runAction(t, {
    githubSha: repository.sha,
    workspace: repository.root,
  });

  assert.equal(result.code, 1);
  assert.equal(result.outputs.verdict, "BLOCKED");
  assert.equal(result.outputs["scanner-state"], "blocked");
  assert.deepEqual(
    JSON.parse(result.outputs["blocking-check-ids"]),
    ["clean-tree"],
  );
  assert.ok(result.outputs["evidence-path"]);
  assert.ok(result.outputs["receipt-path"]);
  assert.ok(result.outputs["repair-brief-path"]);
  assert.match(result.stdout, /clean-tree/);
  assert.match(result.stdout, /Clean source state/);
  assert.match(result.stdout, /Status: fail/);
  assert.doesNotMatch(
    `${result.stdout}${result.outputText}${result.summary}`,
    /PRIVATE_DIRTY_CONTENT_17a4/,
  );

  const { evidence, receipt } = await assertPrivateArtifacts(
    result.outputs,
  );
  const brief = await readFile(
    result.outputs["repair-brief-path"],
    "utf8",
  );
  assert.equal(evidence.repository.dirtyFiles, 1);
  assert.equal(receipt.verdict, "BLOCKED");
  assert.equal(receipt.producer.scannerState, "blocked");
  assert.match(brief, /^# ProofLatch Codex repair brief/m);
  assert.match(brief, /\[clean-tree\]/);
});

test("Git gitlinks are BLOCKED without entering a nested repository", async (t) => {
  const repository = await makeRepository(t);
  await git(
    repository.root,
    "update-index",
    "--add",
    "--cacheinfo",
    `160000,${repository.sha},vendor/submodule`,
  );
  await git(
    repository.root,
    "commit",
    "-q",
    "-m",
    "add nested repository boundary",
  );
  const { stdout } = await git(repository.root, "rev-parse", "HEAD");

  const result = await runAction(t, {
    githubSha: stdout.trim().toLowerCase(),
    workspace: repository.root,
  });

  assert.equal(result.code, 1);
  assert.equal(result.outputs.verdict, "BLOCKED");
  assert.equal(result.outputs["scanner-state"], "blocked");
  assert.deepEqual(
    JSON.parse(result.outputs["blocking-check-ids"]),
    ["unsafe-symlinks"],
  );
  assert.match(result.stdout, /Repository-bound metadata/);
});

test("indeterminate repository emits a BLOCKED receipt before failing", async (t) => {
  const workspace = await makeTempDirectory(
    t,
    "prooflatch-non-git-",
  );
  await writeFile(
    path.join(workspace, "private.txt"),
    "NON_GIT_PRIVATE_CONTENT_51c8\n",
  );
  const result = await runAction(t, { workspace });

  assert.equal(result.code, 1);
  assert.equal(result.outputs.verdict, "BLOCKED");
  assert.equal(result.outputs["scanner-state"], "indeterminate");
  assert.ok(
    JSON.parse(result.outputs["blocking-check-ids"]).includes(
      "scan-complete",
    ),
  );
  assert.doesNotMatch(
    `${result.stdout}${result.outputText}${result.summary}`,
    /NON_GIT_PRIVATE_CONTENT_51c8/,
  );
  const { evidence, receipt } = await assertPrivateArtifacts(
    result.outputs,
  );
  assert.equal(evidence.repository.commit, "0000000");
  assert.equal(receipt.verdict, "BLOCKED");
  assert.equal(receipt.producer.scannerState, "indeterminate");
});

test("required scanner root blocks a workspace nested in a parent worktree", async (t) => {
  const repository = await makeRepository(t);
  const nestedWorkspace = path.join(repository.root, "nested-workspace");
  await mkdir(nestedWorkspace);
  await writeFile(
    path.join(nestedWorkspace, "private.txt"),
    "PARENT_WORKTREE_PRIVATE_CONTENT_a3d1\n",
  );

  const result = await runAction(t, { workspace: nestedWorkspace });

  assert.equal(result.code, 1);
  assert.equal(result.outputs.verdict, "BLOCKED");
  assert.equal(result.outputs["scanner-state"], "indeterminate");
  assert.doesNotMatch(
    `${result.stdout}${result.outputText}${result.summary}`,
    /PARENT_WORKTREE_PRIVATE_CONTENT_a3d1/,
  );
  const { evidence, receipt } = await assertPrivateArtifacts(
    result.outputs,
  );
  assert.equal(evidence.repository.commit, "0000000");
  assert.equal(receipt.producer.scannerState, "indeterminate");
});

test("rejects lexical workspace escapes and path symlinks", async (t) => {
  const base = await makeTempDirectory(t, "prooflatch-path-guard-");
  const workspace = path.join(base, "workspace");
  const outside = path.join(base, "outside");
  await mkdir(workspace);
  await mkdir(outside);

  await test("lexical escape", async () => {
    const result = await runAction(t, {
      inputPath: "../outside",
      workspace,
    });
    assert.equal(result.code, 1);
    assert.equal(result.outputText, "");
    assert.deepEqual(
      (await readdir(result.runnerTemp)).sort(),
      ["github-output", "step-summary"],
    );
  });

  await test("absolute path inside workspace", async () => {
    const result = await runAction(t, {
      inputPath: workspace,
      workspace,
    });
    assert.equal(result.code, 1);
    assert.equal(result.outputText, "");
    assert.deepEqual(
      (await readdir(result.runnerTemp)).sort(),
      ["github-output", "step-summary"],
    );
  });

  await symlink(outside, path.join(workspace, "linked-repository"));
  await test("symlink component", async () => {
    const result = await runAction(t, {
      inputPath: "linked-repository",
      workspace,
    });
    assert.equal(result.code, 1);
    assert.equal(result.outputText, "");
    assert.deepEqual(
      (await readdir(result.runnerTemp)).sort(),
      ["github-output", "step-summary"],
    );
  });
});

test("rejects a mismatched or abbreviated GITHUB_SHA", async (t) => {
  const repository = await makeRepository(t);
  const result = await runAction(t, {
    githubSha: repository.sha.slice(0, 12),
    workspace: repository.root,
  });

  assert.equal(result.code, 1);
  assert.equal(result.outputText, "");
  assert.deepEqual(
    (await readdir(result.runnerTemp)).sort(),
    ["github-output", "step-summary"],
  );
});
