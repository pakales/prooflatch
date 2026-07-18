import assert from "node:assert/strict";
import test from "node:test";

import { blockedSample, fixedSample } from "../lib/sample-evidence.ts";
import { evidencePacketSchema } from "../lib/prooflatch-schema.ts";
import { assessEvidence } from "../lib/prooflatch.ts";

function clone(value) {
  return structuredClone(value);
}

test("blocked and ready fixtures produce immutable binary verdicts", () => {
  const blocked = assessEvidence(evidencePacketSchema.parse(blockedSample));
  const ready = assessEvidence(evidencePacketSchema.parse(fixedSample));

  assert.equal(blocked.verdict, "BLOCKED");
  assert.deepEqual(
    blocked.blockers.map((check) => check.id),
    ["unit-suite", "security-audit"],
  );
  assert.equal(ready.verdict, "READY");
  assert.equal(ready.requiredPassed, 6);
  assert.equal(ready.requiredTotal, 6);
  assert.match(ready.proofHash, /^[a-f0-9]{64}$/);
});

test("advisory warnings remain visible without changing READY", () => {
  const packet = clone(fixedSample);
  const browserCheck = packet.checks.find(
    (check) => check.id === "browser-smoke",
  );
  browserCheck.status = "warn";
  browserCheck.summary = "Mobile viewport evidence is pending.";

  const assessment = assessEvidence(evidencePacketSchema.parse(packet));
  assert.equal(assessment.verdict, "READY");
  assert.deepEqual(
    assessment.warnings.map((check) => check.id),
    ["browser-smoke"],
  );
});

test("a required warning blocks the release", () => {
  const packet = clone(fixedSample);
  const unitCheck = packet.checks.find((check) => check.id === "unit-suite");
  unitCheck.status = "warn";
  unitCheck.summary = "Test evidence is incomplete.";

  const assessment = assessEvidence(evidencePacketSchema.parse(packet));
  assert.equal(assessment.verdict, "BLOCKED");
  assert.deepEqual(
    assessment.blockers.map((check) => check.id),
    ["unit-suite"],
  );
});

test("the server policy rejects weakened, missing, and unknown checks", () => {
  const weakened = clone(fixedSample);
  weakened.checks.find(
    (check) => check.id === "security-audit",
  ).required = false;
  assert.equal(evidencePacketSchema.safeParse(weakened).success, false);

  const missing = clone(fixedSample);
  missing.checks = missing.checks.filter(
    (check) => check.id !== "security-audit",
  );
  assert.equal(evidencePacketSchema.safeParse(missing).success, false);

  const unknown = clone(fixedSample);
  unknown.checks.push({
    id: "looks-good",
    label: "Looks good",
    category: "release",
    status: "pass",
    summary: "An unrecognized check tried to enter the policy.",
    required: false,
  });
  assert.equal(evidencePacketSchema.safeParse(unknown).success, false);
});

test("advisory failures and contradictory clean-tree evidence are rejected", () => {
  const failedAdvisory = clone(fixedSample);
  failedAdvisory.checks.find(
    (check) => check.id === "browser-smoke",
  ).status = "fail";
  assert.equal(evidencePacketSchema.safeParse(failedAdvisory).success, false);

  const contradictory = clone(fixedSample);
  contradictory.repository.dirtyFiles = 1;
  assert.equal(evidencePacketSchema.safeParse(contradictory).success, false);
});

test("receipt hashes are deterministic and bind evidence changes", () => {
  const first = assessEvidence(evidencePacketSchema.parse(clone(fixedSample)));
  const second = assessEvidence(evidencePacketSchema.parse(clone(fixedSample)));
  assert.equal(first.proofHash, second.proofHash);

  const changed = clone(fixedSample);
  changed.repository.commit = "a4b340a71c78f8a2";
  const third = assessEvidence(evidencePacketSchema.parse(changed));
  assert.notEqual(first.proofHash, third.proofHash);
});
