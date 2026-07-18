import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import {
  parseArguments,
  scanRepository,
} from "../bin/prooflatch-scan.mjs";
import { evidencePacketSchema } from "../lib/prooflatch-schema.ts";

const execFileAsync = promisify(execFile);
const scannerPath = new URL("../bin/prooflatch-scan.mjs", import.meta.url);
const fixedNow = new Date("2026-07-18T12:00:00.000Z");

async function git(root, ...args) {
  return execFileAsync("git", ["-C", root, ...args], {
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
}

async function makeTempDirectory(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "prooflatch-scan-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

async function initializeGit(root) {
  await git(root, "init", "-q");
  await git(root, "config", "user.name", "ProofLatch Test");
  await git(root, "config", "user.email", "prooflatch@example.invalid");
}

async function writeReadyProject(root, { ci = true, readme = true } = {}) {
  const scriptCanary = "PROJECT_SCRIPT_CANARY_92f0";
  await writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify(
      {
        name: "fixture-project",
        version: "1.2.3",
        type: "module",
        scripts: {
          test: `node -e "require('node:fs').writeFileSync('project-code-ran', '${scriptCanary}')"`,
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(path.join(root, "package-lock.json"), "{}\n");
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(
    path.join(root, "src", "index.js"),
    'export const value = "SOURCE_SECRET_CANARY_a13d";\n',
  );
  await mkdir(path.join(root, "tests"), { recursive: true });
  await writeFile(
    path.join(root, "tests", "unit.test.mjs"),
    "export const fixture = true;\n",
  );
  if (ci) {
    await mkdir(path.join(root, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(root, ".github", "workflows", "ci.yml"),
      "name: CI\non: push\njobs: {}\n",
    );
  }
  if (readme) {
    await writeFile(path.join(root, "README.md"), "# Fixture\n");
  }
}

async function commitAll(root, message = "fixture commit") {
  await git(root, "add", "--all");
  await git(root, "commit", "-q", "-m", message);
}

async function makeReadyRepository(t, options) {
  const root = await makeTempDirectory(t);
  await initializeGit(root);
  await writeReadyProject(root, options);
  await commitAll(root, "COMMIT_SECRET_CANARY_d8c4");
  return root;
}

function checkById(packet, id) {
  const check = packet.checks.find((candidate) => candidate.id === id);
  assert.ok(check, `missing check: ${id}`);
  return check;
}

async function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scannerPath.pathname, ...args], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
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
      resolve({ code, stdout, stderr });
    });
  });
}

test("emits a schema-valid ready packet without running project code", async (t) => {
  const root = await makeReadyRepository(t);
  const fsmonitorMarker = path.join(root, "fsmonitor-was-run");
  const fsmonitor = path.join(root, "fsmonitor.sh");
  await writeFile(
    fsmonitor,
    `#!/bin/sh\nprintf unsafe > "${fsmonitorMarker}"\n`,
  );
  await chmod(fsmonitor, 0o755);
  await git(root, "add", "fsmonitor.sh");
  await git(root, "commit", "-q", "-m", "add scanner trap");
  await git(root, "config", "core.fsmonitor", fsmonitor);
  await git(
    root,
    "remote",
    "add",
    "origin",
    "https://scanner-user:REMOTE_SECRET_CANARY_73b1@example.invalid/repo.git",
  );

  const result = await scanRepository({
    root,
    target: "Production",
    now: fixedNow,
  });
  const packet = evidencePacketSchema.parse(result.packet);
  const serialized = JSON.stringify(packet);

  assert.equal(result.exitCode, 0);
  assert.equal(result.state, "ready");
  assert.equal(packet.release.version, "1.2.3");
  assert.equal(packet.release.target, "Production");
  assert.equal(packet.release.generatedAt, fixedNow.toISOString());
  assert.match(packet.repository.commit, /^[a-f0-9]{40}$/);
  assert.equal(packet.repository.dirtyFiles, 0);
  assert.equal(checkById(packet, "git-head").status, "pass");
  assert.equal(checkById(packet, "clean-tree").status, "pass");
  assert.equal(checkById(packet, "project-manifest").status, "pass");
  assert.equal(checkById(packet, "dependency-lock").status, "pass");
  assert.equal(checkById(packet, "test-signal").status, "pass");
  assert.equal(checkById(packet, "ci-signal").status, "pass");
  assert.equal(checkById(packet, "readme").status, "pass");
  assert.doesNotMatch(serialized, /SOURCE_SECRET_CANARY_a13d/);
  assert.doesNotMatch(serialized, /PROJECT_SCRIPT_CANARY_92f0/);
  assert.doesNotMatch(serialized, /COMMIT_SECRET_CANARY_d8c4/);
  assert.doesNotMatch(serialized, /REMOTE_SECRET_CANARY_73b1/);
  await assert.rejects(readFile(fsmonitorMarker));
  await assert.rejects(readFile(path.join(root, "project-code-ran")));
});

test("CLI prints only the packet and preserves ready exit semantics", async (t) => {
  const root = await makeReadyRepository(t);
  const result = await runCli([
    "--root",
    root,
    "--target",
    "Production",
    "--release-version",
    "9.4.1",
  ]);

  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  const packet = evidencePacketSchema.parse(JSON.parse(result.stdout));
  assert.equal(packet.release.version, "9.4.1");
  assert.equal(packet.release.target, "Production");
});

test("uses review exit code for optional CI and README warnings", async (t) => {
  const root = await makeReadyRepository(t, { ci: false, readme: false });
  const result = await scanRepository({ root, now: fixedNow });

  evidencePacketSchema.parse(result.packet);
  assert.equal(result.exitCode, 1);
  assert.equal(result.state, "review");
  assert.equal(checkById(result.packet, "ci-signal").status, "warn");
  assert.equal(checkById(result.packet, "readme").status, "warn");
});

test("blocks a dirty repository without copying changed source contents", async (t) => {
  const root = await makeReadyRepository(t);
  await writeFile(
    path.join(root, "src", "index.js"),
    'export const value = "DIRTY_SOURCE_SECRET_CANARY_682a";\n',
  );

  const result = await scanRepository({ root, now: fixedNow });
  const serialized = JSON.stringify(result.packet);

  evidencePacketSchema.parse(result.packet);
  assert.equal(result.exitCode, 2);
  assert.equal(result.state, "blocked");
  assert.equal(checkById(result.packet, "clean-tree").status, "fail");
  assert.equal(result.packet.repository.dirtyFiles, 1);
  assert.doesNotMatch(serialized, /DIRTY_SOURCE_SECRET_CANARY_682a/);
});

test("blocks unresolved merge conflicts and counts paths once", async (t) => {
  const root = await makeReadyRepository(t);
  const { stdout: branchOutput } = await git(
    root,
    "symbolic-ref",
    "--short",
    "HEAD",
  );
  const primaryBranch = branchOutput.trim();
  await git(root, "checkout", "-q", "-b", "conflict-side");
  await writeFile(
    path.join(root, "src", "index.js"),
    'export const value = "SIDE_CONFLICT_CANARY_1aa3";\n',
  );
  await commitAll(root, "side conflict");
  await git(root, "checkout", "-q", primaryBranch);
  await writeFile(
    path.join(root, "src", "index.js"),
    'export const value = "PRIMARY_CONFLICT_CANARY_19f7";\n',
  );
  await commitAll(root, "primary conflict");
  await assert.rejects(git(root, "merge", "conflict-side"));

  const result = await scanRepository({ root, now: fixedNow });
  const conflictCheck = checkById(result.packet, "merge-conflicts");
  const serialized = JSON.stringify(result.packet);

  evidencePacketSchema.parse(result.packet);
  assert.equal(result.exitCode, 2);
  assert.equal(conflictCheck.status, "fail");
  assert.match(conflictCheck.summary, /^1 unresolved conflict path remains\.$/);
  assert.doesNotMatch(serialized, /SIDE_CONFLICT_CANARY_1aa3/);
  assert.doesNotMatch(serialized, /PRIMARY_CONFLICT_CANARY_19f7/);
});

test("returns a schema-valid indeterminate packet for a non-Git directory", async (t) => {
  const root = await makeTempDirectory(t);
  await writeFile(
    path.join(root, "private.txt"),
    "NON_GIT_SECRET_CANARY_885d\n",
  );

  const result = await scanRepository({ root, now: fixedNow });

  evidencePacketSchema.parse(result.packet);
  assert.equal(result.exitCode, 3);
  assert.equal(result.state, "indeterminate");
  assert.equal(result.packet.repository.commit, "0000000");
  assert.equal(checkById(result.packet, "scan-complete").status, "fail");
  assert.equal(checkById(result.packet, "git-head").status, "fail");
  assert.doesNotMatch(JSON.stringify(result.packet), /NON_GIT_SECRET_CANARY_885d/);
});

test("returns indeterminate evidence for an unborn Git repository", async (t) => {
  const root = await makeTempDirectory(t);
  await initializeGit(root);
  await writeReadyProject(root);

  const result = await scanRepository({ root, now: fixedNow });

  evidencePacketSchema.parse(result.packet);
  assert.equal(result.exitCode, 3);
  assert.equal(result.state, "indeterminate");
  assert.equal(result.packet.repository.commit, "0000000");
  assert.equal(checkById(result.packet, "git-head").status, "fail");
  assert.ok(result.packet.repository.dirtyFiles > 0);
});

test("rejects an external manifest symlink and never reads its target", async (t) => {
  const base = await makeTempDirectory(t);
  const root = path.join(base, "repo");
  await mkdir(root);
  await initializeGit(root);
  const target = path.join(base, "outside-package.json");
  await writeFile(
    target,
    '{"version":"SYMLINK_TARGET_SECRET_CANARY_f43b","scripts":{"test":"secret"}}\n',
  );
  await symlink(target, path.join(root, "package.json"));
  await writeFile(path.join(root, "package-lock.json"), "{}\n");
  await mkdir(path.join(root, "tests"));
  await writeFile(path.join(root, "tests", "unit.test.mjs"), "export {};\n");
  await mkdir(path.join(root, ".github", "workflows"), { recursive: true });
  await writeFile(
    path.join(root, ".github", "workflows", "ci.yml"),
    "name: CI\non: push\njobs: {}\n",
  );
  await writeFile(path.join(root, "README.md"), "# Symlink fixture\n");
  await commitAll(root);

  const result = await scanRepository({ root, now: fixedNow });
  const serialized = JSON.stringify(result.packet);

  evidencePacketSchema.parse(result.packet);
  assert.equal(result.exitCode, 2);
  assert.equal(checkById(result.packet, "unsafe-symlinks").status, "fail");
  assert.equal(checkById(result.packet, "project-manifest").status, "fail");
  assert.equal(result.packet.release.version, "unversioned");
  assert.doesNotMatch(serialized, /SYMLINK_TARGET_SECRET_CANARY_f43b/);
});

test("blocks sensitive-looking filenames without disclosing names or values", async (t) => {
  const root = await makeReadyRepository(t);
  await writeFile(
    path.join(root, ".env.production"),
    "API_TOKEN=SENSITIVE_VALUE_CANARY_2e7c\n",
  );
  await git(root, "add", "-f", ".env.production");
  await git(root, "commit", "-q", "-m", "add unsafe fixture");

  const result = await scanRepository({ root, now: fixedNow });
  const serialized = JSON.stringify(result.packet);

  evidencePacketSchema.parse(result.packet);
  assert.equal(result.exitCode, 2);
  assert.equal(checkById(result.packet, "sensitive-files").status, "fail");
  assert.doesNotMatch(serialized, /\.env\.production/);
  assert.doesNotMatch(serialized, /SENSITIVE_VALUE_CANARY_2e7c/);
});

test("rejects malformed CLI options with usage exit code", async () => {
  assert.throws(
    () => parseArguments(["--target", "x"]),
    /must be 2-80 printable characters/,
  );
  const result = await runCli(["--unknown"]);
  assert.equal(result.code, 64);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^ProofLatch scanner:/);
});
