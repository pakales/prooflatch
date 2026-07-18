import * as core from "@actions/core";
import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import {
  chmod,
  lstat,
  mkdtemp,
  open,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createCodexRepairBrief,
  createProofLatchReceipt,
  type ProofLatchArtifactResult,
} from "../../lib/prooflatch-artifacts";
import {
  type DeterministicAssessment,
  type EvidencePacket,
  evidencePacketSchema,
} from "../../lib/prooflatch-schema";
import {
  assessEvidence,
  createFallbackAnalysis,
  EVALUATOR_VERSION,
} from "../../lib/prooflatch";
import { buildSafeProcessEnv } from "../../lib/safe-process-env.mjs";

export const ACTION_VERSION = "1.0.0";

const MAX_SCANNER_STDOUT_BYTES = 1024 * 1024;
const MAX_SCANNER_STDERR_BYTES = 128 * 1024;
const SCANNER_TIMEOUT_MS = 25_000;
const FULL_COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const ACTION_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

type ScannerState = "ready" | "review" | "blocked" | "indeterminate";

type ScannerResult = {
  exitCode: number;
  stderr: string;
  stdout: string;
};

function isInsidePath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function requireEnvironmentPath(
  environment: NodeJS.ProcessEnv,
  name: "GITHUB_WORKSPACE" | "RUNNER_TEMP",
): string {
  const value = environment[name];
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\0") ||
    !path.isAbsolute(value)
  ) {
    throw new Error(`Missing or invalid ${name}.`);
  }
  return path.resolve(value);
}

/**
 * Resolves a repository directory without permitting a lexical escape or any
 * symlink/junction component below the workspace root.
 */
export async function resolveRepositoryPath(
  workspaceValue: string,
  requestedPath: string,
): Promise<string> {
  if (
    requestedPath.length === 0 ||
    requestedPath.includes("\0") ||
    path.isAbsolute(requestedPath)
  ) {
    throw new Error("The repository path is invalid.");
  }

  const workspace = path.resolve(workspaceValue);
  const workspaceMetadata = await lstat(workspace);
  if (!workspaceMetadata.isDirectory()) {
    throw new Error("GITHUB_WORKSPACE is not a directory.");
  }

  const candidate = path.resolve(workspace, requestedPath);
  if (!isInsidePath(workspace, candidate)) {
    throw new Error("The repository path escapes GITHUB_WORKSPACE.");
  }

  const relative = path.relative(workspace, candidate);
  let cursor = workspace;
  if (relative !== "") {
    for (const segment of relative.split(path.sep)) {
      cursor = path.join(cursor, segment);
      const metadata = await lstat(cursor);
      if (metadata.isSymbolicLink()) {
        throw new Error("Repository path symlinks are not allowed.");
      }
    }
  }

  const candidateMetadata = await lstat(candidate);
  if (!candidateMetadata.isDirectory()) {
    throw new Error("The repository path is not a directory.");
  }

  const [resolvedWorkspace, resolvedCandidate] = await Promise.all([
    realpath(workspace),
    realpath(candidate),
  ]);
  if (!isInsidePath(resolvedWorkspace, resolvedCandidate)) {
    throw new Error("The repository path resolves outside GITHUB_WORKSPACE.");
  }

  return resolvedCandidate;
}

async function resolveScannerPath(actionPathValue: string): Promise<string> {
  const actionPath = await realpath(path.resolve(actionPathValue));
  const scannerCandidate = path.join(
    actionPath,
    "bin",
    "prooflatch-scan.mjs",
  );
  const scannerMetadata = await lstat(scannerCandidate);
  if (
    !scannerMetadata.isFile() ||
    scannerMetadata.isSymbolicLink()
  ) {
    throw new Error("The trusted ProofLatch scanner is unavailable.");
  }
  const scannerPath = await realpath(scannerCandidate);
  if (!isInsidePath(actionPath, scannerPath)) {
    throw new Error("The trusted ProofLatch scanner escaped its action.");
  }
  return scannerPath;
}

function appendBoundedChunk(
  chunks: Buffer[],
  chunk: Buffer,
  state: { exceeded: boolean; size: number },
  limit: number,
  terminate: () => void,
): void {
  if (state.exceeded) {
    return;
  }
  state.size += chunk.length;
  if (state.size > limit) {
    state.exceeded = true;
    terminate();
    return;
  }
  chunks.push(chunk);
}

async function runScanner(
  scannerPath: string,
  repositoryPath: string,
  target: string,
  releaseVersion: string,
  environment: NodeJS.ProcessEnv,
): Promise<ScannerResult> {
  const args = [
    scannerPath,
    "--root",
    repositoryPath,
    "--require-root",
    "--target",
    target,
  ];
  if (releaseVersion !== "") {
    args.push("--release-version", releaseVersion);
  }

  return new Promise((resolve, reject) => {
    const child: ChildProcessWithoutNullStreams = spawn(
      process.execPath,
      args,
      {
        cwd: repositoryPath,
        env: buildSafeProcessEnv(
          environment,
        ) as unknown as NodeJS.ProcessEnv,
        shell: false,
        stdio: "pipe",
        windowsHide: true,
      },
    );
    child.stdin.end();
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const stdoutState = { exceeded: false, size: 0 };
    const stderrState = { exceeded: false, size: 0 };
    let settled = false;
    let timedOut = false;

    const terminate = () => {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, SCANNER_TIMEOUT_MS);
    timeout.unref();

    child.stdout.on("data", (chunk: Buffer) => {
      appendBoundedChunk(
        stdoutChunks,
        chunk,
        stdoutState,
        MAX_SCANNER_STDOUT_BYTES,
        terminate,
      );
    });
    child.stderr.on("data", (chunk: Buffer) => {
      appendBoundedChunk(
        stderrChunks,
        chunk,
        stderrState,
        MAX_SCANNER_STDERR_BYTES,
        terminate,
      );
    });
    child.once("error", () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error("The trusted scanner could not start."));
      }
    });
    child.once("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (
        timedOut ||
        stdoutState.exceeded ||
        stderrState.exceeded ||
        code === null
      ) {
        reject(new Error("The trusted scanner exceeded its execution bounds."));
        return;
      }
      resolve({
        exitCode: code,
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
      });
    });
  });
}

function scannerStateForExitCode(exitCode: number): ScannerState {
  switch (exitCode) {
    case 0:
      return "ready";
    case 1:
      return "review";
    case 2:
      return "blocked";
    case 3:
      return "indeterminate";
    default:
      throw new Error("The trusted scanner did not emit a usable packet.");
  }
}

function checkStatus(
  packet: EvidencePacket,
  checkId: string,
): "pass" | "warn" | "fail" {
  const check = packet.checks.find((candidate) => candidate.id === checkId);
  if (!check) {
    throw new Error("The scanner packet omitted a policy check.");
  }
  return check.status;
}

function deriveScannerState(
  packet: EvidencePacket,
  assessment: DeterministicAssessment,
): ScannerState {
  if (
    checkStatus(packet, "scan-complete") !== "pass" ||
    checkStatus(packet, "git-head") !== "pass"
  ) {
    return "indeterminate";
  }
  if (assessment.verdict === "BLOCKED") {
    return "blocked";
  }
  if (assessment.warnings.length > 0) {
    return "review";
  }
  return "ready";
}

function verifyCommit(
  packet: EvidencePacket,
  githubShaValue: string | undefined,
): void {
  if (githubShaValue === undefined || githubShaValue.trim() === "") {
    return;
  }
  const githubSha = githubShaValue.trim().toLowerCase();
  const packetCommit = packet.repository.commit.toLowerCase();
  if (
    !FULL_COMMIT_PATTERN.test(githubSha) ||
    !FULL_COMMIT_PATTERN.test(packetCommit) ||
    packetCommit !== githubSha
  ) {
    throw new Error(
      "The scanned full commit does not match GITHUB_SHA.",
    );
  }
}

async function makeArtifactDirectory(
  runnerTempValue: string,
): Promise<string> {
  const runnerTemp = await realpath(path.resolve(runnerTempValue));
  const metadata = await lstat(runnerTemp);
  if (!metadata.isDirectory()) {
    throw new Error("RUNNER_TEMP is not a directory.");
  }
  const artifactDirectory = await mkdtemp(
    path.join(runnerTemp, "prooflatch-"),
  );
  await chmod(artifactDirectory, 0o700);
  return artifactDirectory;
}

async function writePrivateFile(
  directory: string,
  filename: string,
  contents: string,
): Promise<string> {
  const filePath = path.join(directory, filename);
  const handle = await open(filePath, "wx", 0o600);
  try {
    await handle.writeFile(contents, { encoding: "utf8" });
    await handle.chmod(0o600);
  } finally {
    await handle.close();
  }
  return filePath;
}

async function persistArtifacts(
  runnerTemp: string,
  packet: EvidencePacket,
  scannerState: ScannerState,
  result: ProofLatchArtifactResult,
): Promise<{
  evidencePath: string;
  receiptPath: string;
  repairBriefPath: string;
}> {
  const artifactDirectory = await makeArtifactDirectory(runnerTemp);
  const evidencePath = await writePrivateFile(
    artifactDirectory,
    "evidence.json",
    `${JSON.stringify(packet, null, 2)}\n`,
  );
  const receiptPath = await writePrivateFile(
    artifactDirectory,
    "receipt.json",
    `${createProofLatchReceipt(packet, result, {
      producer: {
        kind: "github-action",
        version: ACTION_VERSION,
        scannerState,
      },
    })}\n`,
  );
  const repairBriefPath =
    result.assessment.verdict === "BLOCKED"
      ? await writePrivateFile(
          artifactDirectory,
          "codex-repair-brief.md",
          `${createCodexRepairBrief(packet, result)}\n`,
        )
      : "";

  return {
    evidencePath,
    receiptPath,
    repairBriefPath,
  };
}

function setActionOutputs(
  packet: EvidencePacket,
  scannerState: ScannerState,
  assessment: DeterministicAssessment,
  artifacts: {
    evidencePath: string;
    receiptPath: string;
    repairBriefPath: string;
  },
): void {
  core.setOutput("verdict", assessment.verdict);
  core.setOutput("scanner-state", scannerState);
  core.setOutput("evidence-digest", assessment.proofHash);
  core.setOutput(
    "policy",
    `${packet.policy.id}@${packet.policy.version}`,
  );
  core.setOutput("commit", packet.repository.commit);
  core.setOutput(
    "blocking-check-ids",
    JSON.stringify(assessment.blockers.map((check) => check.id)),
  );
  core.setOutput(
    "warning-check-ids",
    JSON.stringify(assessment.warnings.map((check) => check.id)),
  );
  core.setOutput("evidence-path", artifacts.evidencePath);
  core.setOutput("receipt-path", artifacts.receiptPath);
  core.setOutput("repair-brief-path", artifacts.repairBriefPath);
}

function emitPolicyAnnotations(
  assessment: DeterministicAssessment,
): void {
  for (const check of assessment.blockers) {
    core.error(`Status: ${check.status}`, {
      title: `${check.id}: ${check.label}`,
    });
  }
  for (const check of assessment.warnings) {
    core.warning(`Status: ${check.status}`, {
      title: `${check.id}: ${check.label}`,
    });
  }
}

async function writeSummary(
  packet: EvidencePacket,
  scannerState: ScannerState,
  assessment: DeterministicAssessment,
): Promise<void> {
  const rows = [
    [
      { data: "Field", header: true },
      { data: "Repository baseline result", header: true },
    ],
    ["Verdict", assessment.verdict],
    ["Scanner state", scannerState],
    ["Policy", `${packet.policy.id}@${packet.policy.version}`],
    ["Pinned commit", packet.repository.commit],
    [
      "Required checks",
      `${assessment.requiredPassed}/${assessment.requiredTotal} passed`,
    ],
    ["Advisory warnings", String(assessment.warnings.length)],
  ];

  core.summary
    .addHeading("ProofLatch repository baseline", 2)
    .addTable(rows)
    .addRaw(
      "This is a read-only repository baseline. It reports source-state and repository signals only.",
      true,
    )
    .addRaw(
      "It does not prove that project tests or builds ran successfully.",
      true,
    )
    .addRaw(
      "Stable job, branch-protection, and required-check enforcement remain the caller’s responsibility.",
      true,
    );
  await core.summary.write();
}

export async function runAction(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const workspace = requireEnvironmentPath(
    environment,
    "GITHUB_WORKSPACE",
  );
  const runnerTemp = requireEnvironmentPath(environment, "RUNNER_TEMP");
  const requestedPath = core.getInput("path") || ".";
  const target =
    core.getInput("target") || "Pull request repository baseline";
  const releaseVersion = core.getInput("release-version");

  const [repositoryPath, scannerPath] = await Promise.all([
    resolveRepositoryPath(workspace, requestedPath),
    resolveScannerPath(ACTION_ROOT),
  ]);
  const scannerResult = await runScanner(
    scannerPath,
    repositoryPath,
    target,
    releaseVersion,
    environment,
  );
  const scannerState = scannerStateForExitCode(
    scannerResult.exitCode,
  );
  if (scannerResult.stderr !== "") {
    throw new Error("The trusted scanner emitted unexpected diagnostics.");
  }

  let untrustedPacket: unknown;
  try {
    untrustedPacket = JSON.parse(scannerResult.stdout);
  } catch {
    throw new Error("The trusted scanner emitted invalid JSON.");
  }
  const packet = evidencePacketSchema.parse(untrustedPacket);
  if (packet.policy.id !== "repository-baseline") {
    throw new Error("The scanner emitted the wrong policy.");
  }

  const assessment = assessEvidence(packet);
  const derivedState = deriveScannerState(packet, assessment);
  if (derivedState !== scannerState) {
    throw new Error(
      "The scanner state contradicts the deterministic verdict.",
    );
  }
  verifyCommit(packet, environment.GITHUB_SHA);

  const result: ProofLatchArtifactResult = {
    mode: "deterministic-action",
    model: null,
    evaluatorVersion: EVALUATOR_VERSION,
    promptVersion: null,
    assessment,
    analysis: createFallbackAnalysis(packet, assessment),
  };
  const artifacts = await persistArtifacts(
    runnerTemp,
    packet,
    scannerState,
    result,
  );

  setActionOutputs(packet, scannerState, assessment, artifacts);
  emitPolicyAnnotations(assessment);
  await writeSummary(packet, scannerState, assessment);

  core.info(
    `ProofLatch repository baseline: ${assessment.verdict} (${scannerState}).`,
  );
  if (assessment.verdict === "BLOCKED") {
    process.exitCode = core.ExitCode.Failure;
  }
}
