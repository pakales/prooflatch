import { createHash } from "node:crypto";
import { getReleasePolicy } from "./release-policies";
import type {
  DeterministicAssessment,
  EvidencePacket,
  ModelAnalysis,
  Verdict,
} from "./prooflatch-schema";

export const EVALUATOR_VERSION = "1.1.0";
export const PROMPT_VERSION = "1.1.0";

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

export function assessEvidence(packet: EvidencePacket): DeterministicAssessment {
  const policy = getReleasePolicy(packet.policy.id);
  const checks = packet.checks.map((check) => ({
    ...check,
    required: policy.checks[check.id]?.required ?? true,
  }));
  const required = checks.filter((check) => check.required);
  const requiredPassed = required.filter((check) => check.status === "pass").length;
  const blockers = checks.filter(
    (check) => check.required && check.status !== "pass",
  );
  const warnings = checks.filter(
    (check) => !check.required && check.status !== "pass",
  );
  const sourceDirty = packet.repository.dirtyFiles > 0;

  const verdict: Verdict =
    blockers.length > 0 || sourceDirty ? "BLOCKED" : "READY";

  const passRatio = required.length === 0 ? 1 : requiredPassed / required.length;
  const warningPenalty = Math.min(warnings.length * 3, 12);
  const dirtyPenalty = sourceDirty ? 15 : 0;
  const score = Math.max(
    0,
    Math.min(100, Math.round(passRatio * 100 - warningPenalty - dirtyPenalty)),
  );

  const proofHash = createHash("sha256")
    .update(
      canonicalize({
        evaluatorVersion: EVALUATOR_VERSION,
        effectivePolicy: policy,
        packet,
        evaluation: {
          verdict,
          score,
          requiredPassed,
          requiredTotal: required.length,
          blockerIds: blockers.map((check) => check.id),
          warningIds: warnings.map((check) => check.id),
        },
      }),
    )
    .digest("hex");

  return {
    verdict,
    score,
    requiredPassed,
    requiredTotal: required.length,
    blockers,
    warnings,
    proofHash,
  };
}

export function createFallbackAnalysis(
  packet: EvidencePacket,
  assessment: DeterministicAssessment,
): ModelAnalysis {
  const blockingChecks = [...assessment.blockers];
  if (
    packet.repository.dirtyFiles > 0 &&
    !blockingChecks.some((check) => check.id === "clean-tree")
  ) {
    blockingChecks.unshift({
      id: "clean-tree",
      label: "Working tree",
      category: "source",
      status: "fail",
      summary: `${packet.repository.dirtyFiles} uncommitted file(s) remain.`,
      required: true,
    });
  }

  const ready = assessment.verdict === "READY";
  const attentionChecks = ready
    ? []
    : blockingChecks.length > 0
      ? blockingChecks
      : assessment.warnings;

  return {
    headline: ready
      ? "Evidence chain complete"
      : `${attentionChecks.length} release gate${attentionChecks.length === 1 ? "" : "s"} must be cleared`,
    explanation: ready
      ? `Every required check passed for ${packet.repository.name} at commit ${packet.repository.commit.slice(0, 8)}. The receipt is tied to the supplied evidence packet and can be independently re-run.`
      : `The deterministic gate found ${assessment.blockers.length} required failure${assessment.blockers.length === 1 ? "" : "s"} and ${assessment.warnings.length} warning${assessment.warnings.length === 1 ? "" : "s"}. ProofLatch will not upgrade this verdict without new evidence.`,
    topRisks: attentionChecks.slice(0, 5).map((check) => ({
      checkId: check.id,
      title: check.label,
      evidence: check.summary,
      impact:
        check.status === "fail"
          ? "This required gate prevents a defensible release."
          : "Record or resolve this caution before broad rollout.",
    })),
    repairObjective: ready
      ? "Preserve the verified state until release."
      : "Clear only the failed release gates, then regenerate the evidence packet.",
    repairSteps: attentionChecks.slice(0, 6).map((check) => ({
      checkId: check.id,
      action: `Resolve the condition reported by “${check.label}” without weakening the gate.`,
      verify: `Regenerate check ${check.id} under ${packet.policy.id}@${packet.policy.version} and require a passing result.`,
    })),
    stopCondition: ready
      ? "Stop if the commit or evidence packet changes; a new receipt is required."
      : "Stop when every required check passes on the same clean commit, then re-run ProofLatch.",
    confidence: "high",
  };
}
