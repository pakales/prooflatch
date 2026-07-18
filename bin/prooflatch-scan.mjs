#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  lstat,
  readFile,
  readlink,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SCHEMA_VERSION = "1.0";
const ZERO_COMMIT = "0000000";
const MAX_GIT_STDOUT_BYTES = 8 * 1024 * 1024;
const MAX_GIT_STDERR_BYTES = 128 * 1024;
const MAX_PACKAGE_JSON_BYTES = 256 * 1024;
const MAX_SCANNED_FILES = 50_000;
const GIT_TIMEOUT_MS = 8_000;

const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null";
const safeGitConfig = [
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.pager=cat",
  "-c",
  "color.ui=false",
  "-c",
  "diff.external=",
];

const manifestNames = new Set([
  "package.json",
  "pyproject.toml",
  "cargo.toml",
  "go.mod",
  "composer.json",
  "gemfile",
]);

const lockfileNames = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "uv.lock",
  "poetry.lock",
  "pdm.lock",
  "pipfile.lock",
  "cargo.lock",
  "go.sum",
  "composer.lock",
  "gemfile.lock",
]);

const ciFileNames = new Set([
  ".gitlab-ci.yml",
  ".gitlab-ci.yaml",
  "azure-pipelines.yml",
  "azure-pipelines.yaml",
  "bitbucket-pipelines.yml",
  "bitbucket-pipelines.yaml",
  "jenkinsfile",
]);

const safeEnvironment = {
  ...process.env,
  GIT_ASKPASS: nullDevice,
  GIT_CONFIG_GLOBAL: nullDevice,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_SYSTEM: nullDevice,
  GIT_OPTIONAL_LOCKS: "0",
  GIT_PAGER: "cat",
  GIT_SSH_COMMAND: "false",
  GIT_TERMINAL_PROMPT: "0",
  LC_ALL: "C",
  PAGER: "cat",
};

class UsageError extends Error {}

function appendBounded(chunks, chunk, state, limit, child) {
  state.size += chunk.length;
  if (state.size > limit) {
    state.truncated = true;
    child.kill("SIGKILL");
    return;
  }
  chunks.push(chunk);
}

/**
 * Executes only a fixed Git binary and fixed scanner-owned arguments.
 * User input is confined to the literal value following `-C`; shell expansion,
 * hooks, fsmonitor commands, pagers, prompts, and network transports are disabled.
 */
async function runGit(root, args) {
  return new Promise((resolve) => {
    const child = spawn(
      "git",
      [...safeGitConfig, "-C", root, ...args],
      {
        cwd: root,
        env: safeEnvironment,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const stdoutChunks = [];
    const stderrChunks = [];
    const stdoutState = { size: 0, truncated: false };
    const stderrState = { size: 0, truncated: false };
    let timedOut = false;
    let spawnError = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, GIT_TIMEOUT_MS);
    timeout.unref();

    child.stdout.on("data", (chunk) => {
      appendBounded(
        stdoutChunks,
        chunk,
        stdoutState,
        MAX_GIT_STDOUT_BYTES,
        child,
      );
    });
    child.stderr.on("data", (chunk) => {
      appendBounded(
        stderrChunks,
        chunk,
        stderrState,
        MAX_GIT_STDERR_BYTES,
        child,
      );
    });
    child.once("error", () => {
      spawnError = true;
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolve({
        ok:
          !spawnError &&
          !timedOut &&
          !stdoutState.truncated &&
          !stderrState.truncated &&
          code === 0,
        code,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        timedOut,
        truncated: stdoutState.truncated || stderrState.truncated,
      });
    });
  });
}

function sanitizeRepositoryName(value) {
  const sanitized = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 80);
  if (sanitized.length >= 2) {
    return sanitized;
  }
  return sanitized ? `repo-${sanitized}` : "repository";
}

function sanitizeBranch(value) {
  const sanitized = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 120);
  return sanitized || "detached";
}

function normalizeRepositoryPath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function splitNullRecords(value) {
  if (!value) {
    return [];
  }
  const records = value.split("\0");
  if (records.at(-1) === "") {
    records.pop();
  }
  return records;
}

function parsePorcelainStatus(value) {
  const records = splitNullRecords(value);
  let dirtyFiles = 0;

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length < 3 || record[2] !== " ") {
      continue;
    }
    dirtyFiles += 1;
    const x = record[0];
    const y = record[1];
    if (x === "R" || x === "C" || y === "R" || y === "C") {
      index += 1;
    }
  }

  return Math.min(dirtyFiles, 10_000);
}

function countUnmergedPaths(value) {
  const paths = new Set();
  for (const record of splitNullRecords(value)) {
    const separator = record.indexOf("\t");
    if (separator >= 0) {
      paths.add(record.slice(separator + 1));
    }
  }
  return paths.size;
}

function isSensitivePath(relativePath) {
  const normalized = normalizeRepositoryPath(relativePath).toLowerCase();
  const segments = normalized.split("/");
  const basename = segments.at(-1) ?? normalized;

  if (
    basename === ".env" ||
    (basename.startsWith(".env.") &&
      !/\.env\.(example|sample|template|defaults?)$/.test(basename))
  ) {
    return true;
  }

  if (
    basename === ".npmrc" ||
    basename === ".pypirc" ||
    basename === "credentials.json" ||
    basename === "auth.json" ||
    basename === "id_rsa" ||
    basename === "id_ed25519" ||
    basename === "keystore" ||
    /^client[_-]secret.*\.json$/.test(basename) ||
    /^service[_-]account.*\.json$/.test(basename) ||
    /^secrets?\.(json|ya?ml|toml)$/.test(basename) ||
    /\.(pem|key|p12|pfx|jks|tfstate)$/.test(basename)
  ) {
    return true;
  }

  return (
    normalized === ".aws/credentials" ||
    normalized.startsWith(".ssh/") ||
    normalized.includes("/.ssh/")
  );
}

function isCiPath(relativePath) {
  const normalized = normalizeRepositoryPath(relativePath).toLowerCase();
  const basename = normalized.split("/").at(-1) ?? normalized;
  return (
    (/^\.github\/workflows\/[^/]+\.ya?ml$/).test(normalized) ||
    normalized === ".circleci/config.yml" ||
    normalized === ".circleci/config.yaml" ||
    ciFileNames.has(basename)
  );
}

function isReadmePath(relativePath) {
  const basename = normalizeRepositoryPath(relativePath)
    .split("/")
    .at(-1)
    ?.toLowerCase();
  return /^readme(?:\.(?:md|mdx|rst|txt))?$/.test(basename ?? "");
}

function isTestPath(relativePath) {
  const normalized = normalizeRepositoryPath(relativePath).toLowerCase();
  const basename = normalized.split("/").at(-1) ?? normalized;
  return (
    /(^|\/)(?:tests?|__tests__)\//.test(normalized) ||
    /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(basename) ||
    /^(?:vitest|jest|playwright|cypress)\.config\.[cm]?[jt]s$/.test(basename) ||
    basename === "pytest.ini" ||
    basename === "tox.ini"
  );
}

function isInsideRoot(root, absolutePath) {
  const relative = path.relative(root, absolutePath);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

async function inspectFiles(root, relativePaths) {
  const signals = {
    ci: false,
    lockfile: false,
    manifest: false,
    manifestUsable: false,
    packageHasTestScript: false,
    readme: false,
    releaseVersion: "unversioned",
    sensitiveCount: 0,
    test: false,
    unsafeSymlinkCount: 0,
  };

  for (const rawRelativePath of relativePaths) {
    const relativePath = normalizeRepositoryPath(rawRelativePath);
    const absolutePath = path.resolve(root, relativePath);
    if (!isInsideRoot(root, absolutePath)) {
      signals.unsafeSymlinkCount += 1;
      continue;
    }

    const basename = relativePath.split("/").at(-1)?.toLowerCase() ?? "";
    const isManifest = manifestNames.has(basename);
    const isLockfile = lockfileNames.has(basename);
    const isSignalFile =
      isManifest ||
      isLockfile ||
      isSensitivePath(relativePath) ||
      isCiPath(relativePath) ||
      isReadmePath(relativePath) ||
      isTestPath(relativePath);

    const sensitivePath = isSensitivePath(relativePath);
    const ciPath = isCiPath(relativePath);
    const readmePath = isReadmePath(relativePath);
    const testPath = isTestPath(relativePath);

    if (sensitivePath) {
      signals.sensitiveCount += 1;
    }

    let metadata;
    try {
      metadata = await lstat(absolutePath);
    } catch {
      if (isSignalFile) {
        signals.unsafeSymlinkCount += 1;
      }
      continue;
    }

    if (metadata.isSymbolicLink()) {
      let targetOutsideRoot = true;
      try {
        const target = await readlink(absolutePath);
        const resolvedTarget = path.isAbsolute(target)
          ? path.resolve(target)
          : path.resolve(path.dirname(absolutePath), target);
        targetOutsideRoot = !isInsideRoot(root, resolvedTarget);
      } catch {
        targetOutsideRoot = true;
      }
      if (targetOutsideRoot || isSignalFile) {
        signals.unsafeSymlinkCount += 1;
      }
      continue;
    }

    if (!metadata.isFile()) {
      continue;
    }

    signals.ci ||= ciPath;
    signals.lockfile ||= isLockfile;
    signals.manifest ||= isManifest;
    signals.readme ||= readmePath;
    signals.test ||= testPath;

    if (isManifest && basename !== "package.json") {
      signals.manifestUsable = true;
    }

    if (basename === "package.json") {
      if (metadata.size > MAX_PACKAGE_JSON_BYTES) {
        continue;
      }
      try {
        const parsed = JSON.parse(await readFile(absolutePath, "utf8"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          continue;
        }
        signals.manifestUsable = true;
        signals.packageHasTestScript =
          typeof parsed.scripts === "object" &&
          parsed.scripts !== null &&
          typeof parsed.scripts.test === "string" &&
          parsed.scripts.test.trim().length > 0;
        if (
          typeof parsed.version === "string" &&
          /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,39}$/.test(parsed.version)
        ) {
          signals.releaseVersion = parsed.version;
        }
      } catch {
        // Invalid JSON is represented by a failed manifest check. Its contents
        // are deliberately never copied into the evidence packet.
      }
    }
  }

  signals.test ||= signals.packageHasTestScript;
  return signals;
}

function makeCheck({
  id,
  label,
  category,
  status,
  summary,
  required = true,
  command,
}) {
  return {
    id,
    label,
    category,
    status,
    summary,
    ...(command ? { command } : {}),
    required,
  };
}

function unavailablePacket(root, options, generatedAt) {
  const repositoryName = sanitizeRepositoryName(path.basename(root));
  const checks = [
    makeCheck({
      id: "scan-complete",
      label: "Repository inspection",
      category: "source",
      status: "fail",
      summary: "The target is not an inspectable Git worktree.",
      required: true,
      command: "git rev-parse --show-toplevel",
    }),
    makeCheck({
      id: "git-head",
      label: "Pinned source commit",
      category: "source",
      status: "fail",
      summary: "No Git commit could be pinned for this evidence packet.",
      required: true,
      command: "git rev-parse --verify HEAD",
    }),
    makeCheck({
      id: "merge-conflicts",
      label: "Merge conflict state",
      category: "source",
      status: "fail",
      summary: "Merge conflict state could not be verified.",
      required: true,
      command: "git ls-files --unmerged",
    }),
    makeCheck({
      id: "clean-tree",
      label: "Clean source state",
      category: "source",
      status: "fail",
      summary: "Working tree state could not be verified.",
      required: true,
      command: "git status --porcelain",
    }),
    makeCheck({
      id: "unsafe-symlinks",
      label: "Repository-bound metadata",
      category: "security",
      status: "fail",
      summary: "Repository file boundaries could not be verified.",
      required: true,
    }),
    makeCheck({
      id: "sensitive-files",
      label: "Sensitive filename guard",
      category: "security",
      status: "fail",
      summary: "Tracked and untracked filenames could not be inspected.",
      required: true,
    }),
    makeCheck({
      id: "project-manifest",
      label: "Project manifest",
      category: "release",
      status: "fail",
      summary: "A readable project manifest could not be verified.",
      required: true,
    }),
    makeCheck({
      id: "dependency-lock",
      label: "Dependency lockfile",
      category: "release",
      status: "fail",
      summary: "A dependency lockfile could not be verified.",
      required: true,
    }),
    makeCheck({
      id: "test-signal",
      label: "Automated test signal",
      category: "tests",
      status: "fail",
      summary: "An automated test suite could not be verified.",
      required: true,
    }),
    makeCheck({
      id: "ci-signal",
      label: "Continuous integration signal",
      category: "coordination",
      status: "warn",
      summary: "A CI configuration could not be verified.",
      required: false,
    }),
    makeCheck({
      id: "readme",
      label: "Operator documentation",
      category: "coordination",
      status: "warn",
      summary: "Repository documentation could not be verified.",
      required: false,
    }),
  ];

  return {
    packet: {
      schemaVersion: SCHEMA_VERSION,
      policy: {
        id: "repository-baseline",
        version: "1.0.0",
      },
      repository: {
        name: repositoryName,
        branch: "unavailable",
        commit: ZERO_COMMIT,
        dirtyFiles: 0,
      },
      release: {
        version: options.releaseVersion ?? "unversioned",
        target: options.target,
        generatedAt,
      },
      checks,
    },
    exitCode: 3,
    state: "indeterminate",
  };
}

/**
 * Scans repository metadata without executing project code, hooks, package
 * scripts, tests, network operations, or reading arbitrary source contents.
 */
export async function scanRepository({
  root = process.cwd(),
  releaseVersion,
  target = "Local release candidate",
  now = new Date(),
} = {}) {
  const resolvedRoot = path.resolve(root);
  const generatedAt = now.toISOString();
  const topLevelResult = await runGit(resolvedRoot, [
    "rev-parse",
    "--show-toplevel",
  ]);

  if (!topLevelResult.ok) {
    return unavailablePacket(
      resolvedRoot,
      { releaseVersion, target },
      generatedAt,
    );
  }

  const topLevel = topLevelResult.stdout.trim();
  if (!topLevel) {
    return unavailablePacket(
      resolvedRoot,
      { releaseVersion, target },
      generatedAt,
    );
  }
  const repositoryRoot = path.resolve(topLevel);

  const [headResult, branchResult, statusResult, conflictResult, filesResult] =
    await Promise.all([
      runGit(repositoryRoot, ["rev-parse", "--verify", "HEAD"]),
      runGit(repositoryRoot, ["symbolic-ref", "--short", "-q", "HEAD"]),
      runGit(repositoryRoot, [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--ignore-submodules=all",
      ]),
      runGit(repositoryRoot, ["ls-files", "--unmerged", "-z"]),
      runGit(repositoryRoot, [
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
      ]),
    ]);

  const fileRecords = filesResult.ok
    ? splitNullRecords(filesResult.stdout)
    : [];
  const tooManyFiles = fileRecords.length > MAX_SCANNED_FILES;
  const filesForInspection = tooManyFiles
    ? fileRecords.slice(0, MAX_SCANNED_FILES)
    : fileRecords;
  const signals = await inspectFiles(repositoryRoot, filesForInspection);
  const head = headResult.ok
    ? headResult.stdout.trim().toLowerCase()
    : ZERO_COMMIT;
  const branch = branchResult.ok
    ? sanitizeBranch(branchResult.stdout)
    : "detached";
  const dirtyFiles = statusResult.ok
    ? parsePorcelainStatus(statusResult.stdout)
    : 0;
  const conflictCount = conflictResult.ok
    ? countUnmergedPaths(conflictResult.stdout)
    : 0;
  const scanComplete =
    statusResult.ok &&
    conflictResult.ok &&
    filesResult.ok &&
    !tooManyFiles;

  const checks = [
    makeCheck({
      id: "scan-complete",
      label: "Repository inspection",
      category: "source",
      status: scanComplete ? "pass" : "fail",
      summary: scanComplete
        ? `Inspected ${fileRecords.length} repository paths without executing project code.`
        : "Repository metadata inspection was incomplete or exceeded the safe file limit.",
      required: true,
    }),
    makeCheck({
      id: "git-head",
      label: "Pinned source commit",
      category: "source",
      status: headResult.ok ? "pass" : "fail",
      summary: headResult.ok
        ? "Evidence is anchored to an immutable Git commit."
        : "The repository has no committed HEAD to anchor this evidence.",
      required: true,
      command: "git rev-parse --verify HEAD",
    }),
    makeCheck({
      id: "merge-conflicts",
      label: "Merge conflict state",
      category: "source",
      status: conflictResult.ok && conflictCount === 0 ? "pass" : "fail",
      summary: !conflictResult.ok
        ? "Merge conflict state could not be verified."
        : conflictCount === 0
          ? "No unresolved index conflicts were found."
          : `${conflictCount} unresolved conflict ${conflictCount === 1 ? "path remains" : "paths remain"}.`,
      required: true,
      command: "git ls-files --unmerged",
    }),
    makeCheck({
      id: "clean-tree",
      label: "Clean source state",
      category: "source",
      status: statusResult.ok && dirtyFiles === 0 ? "pass" : "fail",
      summary: !statusResult.ok
        ? "Working tree state could not be verified."
        : dirtyFiles === 0
          ? "No tracked or untracked release changes are pending."
          : `${dirtyFiles} working tree path${dirtyFiles === 1 ? "" : "s"} differ from the pinned commit.`,
      required: true,
      command: "git status --porcelain",
    }),
    makeCheck({
      id: "unsafe-symlinks",
      label: "Repository-bound metadata",
      category: "security",
      status: signals.unsafeSymlinkCount === 0 ? "pass" : "fail",
      summary:
        signals.unsafeSymlinkCount === 0
          ? "Release metadata was read only from regular files inside the worktree."
          : `${signals.unsafeSymlinkCount} unsafe or ambiguous metadata link${signals.unsafeSymlinkCount === 1 ? "" : "s"} were rejected.`,
      required: true,
    }),
    makeCheck({
      id: "sensitive-files",
      label: "Sensitive filename guard",
      category: "security",
      status: signals.sensitiveCount === 0 ? "pass" : "fail",
      summary:
        signals.sensitiveCount === 0
          ? "No tracked or non-ignored sensitive-looking filenames were found."
          : `${signals.sensitiveCount} sensitive-looking path${signals.sensitiveCount === 1 ? "" : "s"} require removal or an explicit safe exception.`,
      required: true,
      command: "git ls-files --cached --others --exclude-standard",
    }),
    makeCheck({
      id: "project-manifest",
      label: "Project manifest",
      category: "release",
      status: signals.manifest && signals.manifestUsable ? "pass" : "fail",
      summary:
        signals.manifest && signals.manifestUsable
          ? "A supported, regular project manifest was found."
          : signals.manifest
            ? "The project manifest is unreadable, invalid, oversized, or linked."
            : "No supported project manifest was found.",
      required: true,
    }),
    makeCheck({
      id: "dependency-lock",
      label: "Dependency lockfile",
      category: "release",
      status: signals.lockfile ? "pass" : "fail",
      summary: signals.lockfile
        ? "A dependency lockfile is present for reproducible installation."
        : "No supported dependency lockfile was found.",
      required: true,
    }),
    makeCheck({
      id: "test-signal",
      label: "Automated test signal",
      category: "tests",
      status: signals.test ? "pass" : "fail",
      summary: signals.test
        ? "A test script, test file, or supported test configuration is present."
        : "No automated test signal was found; tests were not executed by this scanner.",
      required: true,
    }),
    makeCheck({
      id: "ci-signal",
      label: "Continuous integration signal",
      category: "coordination",
      status: signals.ci ? "pass" : "warn",
      summary: signals.ci
        ? "A supported continuous integration configuration is present."
        : "No supported continuous integration configuration was found.",
      required: false,
    }),
    makeCheck({
      id: "readme",
      label: "Operator documentation",
      category: "coordination",
      status: signals.readme ? "pass" : "warn",
      summary: signals.readme
        ? "Repository-level operator documentation is present."
        : "No repository-level README was found.",
      required: false,
    }),
  ];

  const packet = {
    schemaVersion: SCHEMA_VERSION,
    policy: {
      id: "repository-baseline",
      version: "1.0.0",
    },
    repository: {
      name: sanitizeRepositoryName(path.basename(repositoryRoot)),
      branch,
      commit: /^[a-f0-9]{7,64}$/.test(head) ? head : ZERO_COMMIT,
      dirtyFiles,
    },
    release: {
      version: releaseVersion ?? signals.releaseVersion,
      target,
      generatedAt,
    },
    checks,
  };

  const indeterminate = !headResult.ok || !scanComplete;
  const blocked = checks.some(
    (check) => check.required && check.status === "fail",
  );
  const warnings = checks.some((check) => check.status === "warn");

  return {
    packet,
    exitCode: indeterminate ? 3 : blocked ? 2 : warnings ? 1 : 0,
    state: indeterminate
      ? "indeterminate"
      : blocked
        ? "blocked"
        : warnings
          ? "review"
          : "ready",
  };
}

function validateTextOption(name, value, minimum, maximum) {
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new UsageError(
      `${name} must be ${minimum}-${maximum} printable characters.`,
    );
  }
  return value;
}

export function parseArguments(argv) {
  const options = {
    pretty: false,
    root: process.cwd(),
    target: "Local release candidate",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      return { ...options, help: true };
    }
    if (argument === "--pretty") {
      options.pretty = true;
      continue;
    }
    if (argument === "--root") {
      const value = argv[index + 1];
      if (!value) {
        throw new UsageError("--root requires a path.");
      }
      options.root = value;
      index += 1;
      continue;
    }
    if (argument === "--release-version") {
      const value = argv[index + 1];
      if (!value) {
        throw new UsageError("--release-version requires a value.");
      }
      options.releaseVersion = validateTextOption(
        "--release-version",
        value,
        1,
        40,
      );
      index += 1;
      continue;
    }
    if (argument === "--target") {
      const value = argv[index + 1];
      if (!value) {
        throw new UsageError("--target requires a value.");
      }
      options.target = validateTextOption("--target", value, 2, 80);
      index += 1;
      continue;
    }
    throw new UsageError(`Unknown option: ${argument}`);
  }

  return options;
}

function usage() {
  return [
    "Usage: prooflatch-scan [options]",
    "",
    "Options:",
    "  --root <path>             Git worktree to inspect (default: current directory)",
    "  --release-version <value> Override the release version",
    "  --target <value>          Release target label",
    "  --pretty                  Pretty-print the JSON packet",
    "  -h, --help                Show this help",
    "",
    "Exit codes: 0 ready, 1 review warnings, 2 blocked, 3 indeterminate,",
    "64 invalid usage, 70 internal scanner error.",
  ].join("\n");
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArguments(argv);
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      return 0;
    }
    const result = await scanRepository(options);
    process.stdout.write(
      `${JSON.stringify(result.packet, null, options.pretty ? 2 : 0)}\n`,
    );
    return result.exitCode;
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`ProofLatch scanner: ${error.message}\n`);
      return 64;
    }
    process.stderr.write(
      "ProofLatch scanner: internal error; no evidence packet was emitted.\n",
    );
    return 70;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  process.exitCode = await main();
}
