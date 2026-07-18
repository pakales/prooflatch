import type {
  DeterministicAssessment,
  EvidencePacket,
  ModelAnalysis,
} from "./prooflatch-schema";

export type ProofLatchArtifactResult = {
  mode:
    | "gpt-5.6-live"
    | "deterministic-fallback"
    | "deterministic-action";
  model: string | null;
  assessment: DeterministicAssessment;
  analysis: ModelAnalysis;
  evaluatorVersion: string;
  promptVersion: string | null;
};

export type ProofLatchProducerMetadata = {
  kind: string;
  version: string;
  scannerState: string;
};

export function createCodexRepairBrief(
  packet: EvidencePacket,
  result: ProofLatchArtifactResult,
): string {
  const lines = [
    "# ProofLatch Codex repair brief",
    "",
    `Repository: ${packet.repository.name}`,
    `Branch: ${packet.repository.branch}`,
    `Commit: ${packet.repository.commit}`,
    `Policy: ${packet.policy.id}@${packet.policy.version}`,
    `Authoritative verdict: ${result.assessment.verdict}`,
    `Evidence digest: ${result.assessment.proofHash}`,
    "",
    `Objective: ${result.analysis.repairObjective}`,
    "",
  ];

  for (const [index, step] of result.analysis.repairSteps.entries()) {
    lines.push(
      `${index + 1}. [${step.checkId}] ${step.action}`,
      `   Verify: ${step.verify}`,
    );
  }

  lines.push(
    "",
    `Stop condition: ${result.analysis.stopCondition}`,
    "",
    "Do not weaken, skip, or relabel a release gate to make the verdict pass.",
    "After the evidence changes, regenerate the packet and run ProofLatch again.",
  );

  return lines.join("\n");
}

export function createProofLatchReceipt(
  packet: EvidencePacket,
  result: ProofLatchArtifactResult,
  options: { producer?: ProofLatchProducerMetadata } = {},
): string {
  return JSON.stringify(
    {
      product: "ProofLatch",
      schemaVersion: packet.schemaVersion,
      policy: packet.policy,
      evaluatorVersion: result.evaluatorVersion,
      promptVersion: result.promptVersion,
      verdict: result.assessment.verdict,
      score: result.assessment.score,
      evidenceDigest: result.assessment.proofHash,
      repository: packet.repository,
      release: packet.release,
      checks: packet.checks.map((check) => ({
        id: check.id,
        status: check.status,
        required: check.required,
      })),
      explanationMode: result.mode,
      model: result.model,
      ...(options.producer ? { producer: options.producer } : {}),
    },
    null,
    2,
  );
}
