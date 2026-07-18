export const POLICY_VERSION = "1.0.0" as const;

export const releasePolicyIds = [
  "web-release",
  "repository-baseline",
] as const;

export type ReleasePolicyId = (typeof releasePolicyIds)[number];

type PolicyCheck = {
  label: string;
  category:
    | "source"
    | "tests"
    | "security"
    | "release"
    | "runtime"
    | "coordination";
  required: boolean;
};

type ReleasePolicy = {
  id: ReleasePolicyId;
  version: typeof POLICY_VERSION;
  label: string;
  scope: string;
  checks: Record<string, PolicyCheck>;
};

export const releasePolicies = {
  "web-release": {
    id: "web-release",
    version: POLICY_VERSION,
    label: "Web release v1.0",
    scope: "Executed release evidence for a web production candidate.",
    checks: {
      "clean-tree": {
        label: "Clean source state",
        category: "source",
        required: true,
      },
      "unit-suite": {
        label: "Unit and integration tests",
        category: "tests",
        required: true,
      },
      "security-audit": {
        label: "Production dependency audit",
        category: "security",
        required: true,
      },
      build: {
        label: "Production build",
        category: "release",
        required: true,
      },
      "browser-smoke": {
        label: "Critical browser flow",
        category: "runtime",
        required: false,
      },
      "session-collision": {
        label: "Codex session collision guard",
        category: "coordination",
        required: true,
      },
      rollback: {
        label: "Rollback path",
        category: "release",
        required: true,
      },
    },
  },
  "repository-baseline": {
    id: "repository-baseline",
    version: POLICY_VERSION,
    label: "Repository baseline v1.0",
    scope:
      "Read-only repository structure and source-state evidence; it does not prove tests ran.",
    checks: {
      "scan-complete": {
        label: "Repository inspection",
        category: "source",
        required: true,
      },
      "git-head": {
        label: "Pinned source commit",
        category: "source",
        required: true,
      },
      "merge-conflicts": {
        label: "Merge conflict state",
        category: "source",
        required: true,
      },
      "clean-tree": {
        label: "Clean source state",
        category: "source",
        required: true,
      },
      "unsafe-symlinks": {
        label: "Repository-bound metadata",
        category: "security",
        required: true,
      },
      "sensitive-files": {
        label: "Sensitive filename guard",
        category: "security",
        required: true,
      },
      "project-manifest": {
        label: "Project manifest",
        category: "release",
        required: true,
      },
      "dependency-lock": {
        label: "Dependency lockfile",
        category: "release",
        required: true,
      },
      "test-signal": {
        label: "Automated test signal",
        category: "tests",
        required: true,
      },
      "ci-signal": {
        label: "Continuous integration signal",
        category: "coordination",
        required: false,
      },
      readme: {
        label: "Operator documentation",
        category: "coordination",
        required: false,
      },
    },
  },
} as const satisfies Record<ReleasePolicyId, ReleasePolicy>;

export function getReleasePolicy(id: ReleasePolicyId): ReleasePolicy {
  return releasePolicies[id];
}
