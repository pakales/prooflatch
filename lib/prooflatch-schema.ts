import { z } from "zod";
import {
  getReleasePolicy,
  POLICY_VERSION,
  releasePolicyIds,
} from "./release-policies";

export const checkStatusSchema = z.enum(["pass", "warn", "fail"]);
export const checkCategorySchema = z.enum([
  "source",
  "tests",
  "security",
  "release",
  "runtime",
  "coordination",
]);

export const evidenceCheckSchema = z
  .object({
    id: z
      .string()
      .min(2)
      .max(48)
      .regex(/^[a-z0-9][a-z0-9-]*$/),
    label: z.string().min(2).max(90),
    category: checkCategorySchema,
    status: checkStatusSchema,
    summary: z.string().min(2).max(240),
    command: z.string().min(1).max(220).optional(),
    required: z.boolean(),
    durationMs: z.number().int().min(0).max(3_600_000).optional(),
  })
  .strict();

export const evidencePacketSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    policy: z
      .object({
        id: z.enum(releasePolicyIds),
        version: z.literal(POLICY_VERSION),
      })
      .strict(),
    repository: z
      .object({
        name: z.string().min(2).max(80),
        branch: z.string().min(1).max(120),
        commit: z
          .string()
          .min(7)
          .max(64)
          .regex(/^[a-f0-9]+$/i),
        dirtyFiles: z.number().int().min(0).max(10_000),
      })
      .strict(),
    release: z
      .object({
        version: z.string().min(1).max(40),
        target: z.string().min(2).max(80),
        generatedAt: z.string().datetime(),
      })
      .strict(),
    checks: z.array(evidenceCheckSchema).min(1).max(32),
  })
  .strict()
  .superRefine((packet, context) => {
    const ids = new Set<string>();
    const policy = getReleasePolicy(packet.policy.id);

    for (const [index, check] of packet.checks.entries()) {
      if (ids.has(check.id)) {
        context.addIssue({
          code: "custom",
          path: ["checks", index, "id"],
          message: "Check IDs must be unique.",
        });
      }
      ids.add(check.id);

      const expected = policy.checks[check.id];
      if (!expected) {
        context.addIssue({
          code: "custom",
          path: ["checks", index, "id"],
          message: `Check ${check.id} is not part of ${policy.id}@${policy.version}.`,
        });
        continue;
      }

      if (check.required !== expected.required) {
        context.addIssue({
          code: "custom",
          path: ["checks", index, "required"],
          message: "Check requirement is controlled by the selected policy.",
        });
      }
      if (check.category !== expected.category) {
        context.addIssue({
          code: "custom",
          path: ["checks", index, "category"],
          message: "Check category does not match the selected policy.",
        });
      }
      if (check.label !== expected.label) {
        context.addIssue({
          code: "custom",
          path: ["checks", index, "label"],
          message: "Check label does not match the selected policy.",
        });
      }
      if (!expected.required && check.status === "fail") {
        context.addIssue({
          code: "custom",
          path: ["checks", index, "status"],
          message: "Advisory checks use warn rather than fail.",
        });
      }
    }

    for (const checkId of Object.keys(policy.checks)) {
      if (!ids.has(checkId)) {
        context.addIssue({
          code: "custom",
          path: ["checks"],
          message: `Required policy check ${checkId} is missing.`,
        });
      }
    }

    const cleanTree = packet.checks.find(
      (check) => check.id === "clean-tree",
    );
    if (
      packet.repository.dirtyFiles > 0 &&
      cleanTree?.status === "pass"
    ) {
      context.addIssue({
        code: "custom",
        path: ["repository", "dirtyFiles"],
        message:
          "A dirty repository cannot contain a passing clean-tree check.",
      });
    }
  });

export const riskSchema = z
  .object({
    checkId: z.string().min(2).max(48),
    title: z.string().min(2).max(90),
    evidence: z.string().min(2).max(220),
    impact: z.string().min(2).max(220),
  })
  .strict();

export const repairStepSchema = z
  .object({
    checkId: z.string().min(2).max(48),
    action: z.string().min(2).max(260),
    verify: z.string().min(2).max(220),
  })
  .strict();

export const modelAnalysisSchema = z
  .object({
    headline: z.string().min(2).max(100),
    explanation: z.string().min(2).max(700),
    topRisks: z.array(riskSchema).max(5),
    repairObjective: z.string().min(2).max(220),
    repairSteps: z.array(repairStepSchema).max(6),
    stopCondition: z.string().min(2).max(220),
    confidence: z.enum(["high", "medium", "low"]),
  })
  .strict();

export type EvidencePacket = z.infer<typeof evidencePacketSchema>;
export type EvidenceCheck = z.infer<typeof evidenceCheckSchema>;
export type ModelAnalysis = z.infer<typeof modelAnalysisSchema>;
export type Verdict = "READY" | "BLOCKED";

export type DeterministicAssessment = {
  verdict: Verdict;
  score: number;
  requiredPassed: number;
  requiredTotal: number;
  blockers: EvidenceCheck[];
  warnings: EvidenceCheck[];
  proofHash: string;
};
