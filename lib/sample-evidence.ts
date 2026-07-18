import type { EvidencePacket } from "./prooflatch-schema";

const generatedAt = "2026-07-18T10:30:00.000Z";

export const blockedSample: EvidencePacket = {
  schemaVersion: "1.0",
  policy: {
    id: "web-release",
    version: "1.0.0",
  },
  repository: {
    name: "Atlas Checkout",
    branch: "release/2.4.0",
    commit: "87a9e01d51c6e9f5",
    dirtyFiles: 0,
  },
  release: {
    version: "2.4.0",
    target: "Production",
    generatedAt,
  },
  checks: [
    {
      id: "clean-tree",
      label: "Clean source state",
      category: "source",
      status: "pass",
      summary: "No uncommitted files; release commit is pinned.",
      command: "git status --short",
      required: true,
      durationMs: 42,
    },
    {
      id: "unit-suite",
      label: "Unit and integration tests",
      category: "tests",
      status: "fail",
      summary: "1 checkout idempotency test failed out of 214.",
      command: "npm test",
      required: true,
      durationMs: 18_440,
    },
    {
      id: "security-audit",
      label: "Production dependency audit",
      category: "security",
      status: "fail",
      summary: "One high-severity production dependency advisory remains.",
      command: "npm audit --omit=dev",
      required: true,
      durationMs: 2_140,
    },
    {
      id: "build",
      label: "Production build",
      category: "release",
      status: "pass",
      summary: "Production bundle completed without compilation errors.",
      command: "npm run build",
      required: true,
      durationMs: 9_870,
    },
    {
      id: "browser-smoke",
      label: "Critical browser flow",
      category: "runtime",
      status: "warn",
      summary: "Desktop checkout passed; mobile viewport evidence is missing.",
      command: "npm run test:e2e",
      required: false,
      durationMs: 6_510,
    },
    {
      id: "session-collision",
      label: "Codex session collision guard",
      category: "coordination",
      status: "pass",
      summary: "No other active agent owns the release workstream.",
      required: true,
      durationMs: 180,
    },
    {
      id: "rollback",
      label: "Rollback path",
      category: "release",
      status: "pass",
      summary: "Previous production artifact and rollback command are recorded.",
      required: true,
    },
  ],
};

export const fixedSample: EvidencePacket = {
  ...blockedSample,
  repository: {
    ...blockedSample.repository,
    commit: "d4b340a71c78f8a2",
  },
  release: {
    ...blockedSample.release,
    generatedAt: "2026-07-18T10:42:00.000Z",
  },
  checks: blockedSample.checks.map((check) => {
    if (check.id === "unit-suite") {
      return {
        ...check,
        status: "pass" as const,
        summary: "214 of 214 tests passed, including checkout idempotency.",
        durationMs: 18_620,
      };
    }
    if (check.id === "security-audit") {
      return {
        ...check,
        status: "pass" as const,
        summary: "No known production dependency vulnerabilities.",
        durationMs: 2_020,
      };
    }
    if (check.id === "browser-smoke") {
      return {
        ...check,
        status: "pass" as const,
        summary: "Desktop and mobile checkout flows passed.",
        durationMs: 7_330,
      };
    }
    return check;
  }),
};
