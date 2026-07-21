"use client";

import { useMemo, useState } from "react";
import {
  createCodexRepairBrief,
  createProofLatchReceipt,
  type ProofLatchArtifactResult,
} from "@/lib/prooflatch-artifacts";
import { releasePolicies } from "@/lib/release-policies";
import { blockedSample, fixedSample } from "@/lib/sample-evidence";
import {
  evidencePacketSchema,
  type EvidenceCheck,
  type EvidencePacket,
} from "@/lib/prooflatch-schema";

type AnalysisResponse = Omit<ProofLatchArtifactResult, "mode"> & {
  mode: "gpt-5.6-live" | "deterministic-fallback";
  promptVersion: string;
};

type ProofLatchAppProps = {
  user: { displayName: string } | null;
  signInPath: string;
};

const categoryLabels: Record<EvidenceCheck["category"], string> = {
  source: "Source",
  tests: "Tests",
  security: "Security",
  release: "Release",
  runtime: "Runtime",
  coordination: "Coordination",
};

const statusLabels: Record<EvidenceCheck["status"], string> = {
  pass: "Passed",
  warn: "Warning",
  fail: "Failed",
};

function formatDuration(durationMs?: number) {
  if (durationMs === undefined) return "Recorded";
  if (durationMs < 1_000) return `${durationMs} ms`;
  return `${(durationMs / 1_000).toFixed(durationMs >= 10_000 ? 1 : 2)} s`;
}

function copyText(value: string) {
  return navigator.clipboard.writeText(value);
}

function StatusMark({ status }: { status: EvidenceCheck["status"] }) {
  return (
    <span className={`status-mark status-${status}`} aria-hidden="true">
      {status === "pass" ? "✓" : status === "warn" ? "!" : "×"}
    </span>
  );
}

export function ProofLatchApp({
  user,
  signInPath,
}: ProofLatchAppProps) {
  const [packet, setPacket] = useState<EvidencePacket>(blockedSample);
  const [response, setResponse] = useState<AnalysisResponse | null>(null);
  const [selectedCheckId, setSelectedCheckId] = useState("unit-suite");
  const [phase, setPhase] = useState<"idle" | "analyzing">("idle");
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importValue, setImportValue] = useState("");
  const [copyState, setCopyState] = useState<string | null>(null);
  const [demoFixLoaded, setDemoFixLoaded] = useState(false);
  const [previousProofHash, setPreviousProofHash] = useState<string | null>(
    null,
  );

  const selectedCheck =
    packet.checks.find((check) => check.id === selectedCheckId) ??
    packet.checks[0];
  const policy = releasePolicies[packet.policy.id];
  const failedCount = packet.checks.filter(
    (check) => check.required && check.status === "fail",
  ).length;
  const warningCount = packet.checks.filter(
    (check) => check.status === "warn",
  ).length;
  const passedCount = packet.checks.filter(
    (check) => check.required && check.status === "pass",
  ).length;
  const selectedRisk = response?.analysis.topRisks.find(
    (risk) => risk.checkId === selectedCheck.id,
  );
  const selectedRepair = response?.analysis.repairSteps.find(
    (step) => step.checkId === selectedCheck.id,
  );
  const sortedChecks = useMemo(
    () =>
      [...packet.checks].sort((a, b) => {
        const rank = { fail: 0, warn: 1, pass: 2 };
        return rank[a.status] - rank[b.status];
      }),
    [packet],
  );

  async function analyze() {
    setError(null);
    setCopyState(null);
    setPhase("analyzing");

    try {
      const result = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(packet),
      });
      const data = (await result.json()) as
        | AnalysisResponse
        | { error?: string };

      if (!result.ok || !("assessment" in data)) {
        throw new Error(
          "error" in data && data.error
            ? data.error
            : "ProofLatch could not analyze this packet.",
        );
      }

      setResponse(data);
      const firstAttention =
        data.assessment.blockers[0]?.id ??
        data.assessment.warnings[0]?.id ??
        packet.checks[0]?.id;
      if (firstAttention) setSelectedCheckId(firstAttention);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "ProofLatch could not analyze this packet.",
      );
    } finally {
      setPhase("idle");
    }
  }

  function applyDemoFixSet() {
    setPreviousProofHash(response?.assessment.proofHash ?? null);
    setPacket(fixedSample);
    setResponse(null);
    setError(null);
    setDemoFixLoaded(true);
    setSelectedCheckId("unit-suite");
  }

  function resetDemo() {
    setPacket(blockedSample);
    setResponse(null);
    setError(null);
    setDemoFixLoaded(false);
    setPreviousProofHash(null);
    setSelectedCheckId("unit-suite");
  }

  function importPacket() {
    setError(null);
    let candidate: unknown;
    try {
      candidate = JSON.parse(importValue);
    } catch {
      setError("Imported evidence is not valid JSON.");
      return;
    }

    const parsed = evidencePacketSchema.safeParse(candidate);
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ??
          "Imported evidence does not match the ProofLatch schema.",
      );
      return;
    }

    setPacket(parsed.data);
    setResponse(null);
    setDemoFixLoaded(false);
    setPreviousProofHash(null);
    setSelectedCheckId(parsed.data.checks[0].id);
    setImportValue("");
    setImportOpen(false);
  }

  async function handleCopy(kind: "brief" | "receipt") {
    if (!response) return;
    const value =
      kind === "brief"
        ? createCodexRepairBrief(packet, response)
        : createProofLatchReceipt(packet, response);
    await copyText(value);
    setCopyState(kind);
    window.setTimeout(() => setCopyState(null), 1_800);
  }

  const verdict = response?.assessment.verdict ?? null;
  const isBlocked = verdict === "BLOCKED";
  const isReady = verdict === "READY";
  const isGuestMode = !user;
  const proofHashChanged =
    previousProofHash !== null &&
    response !== null &&
    previousProofHash !== response.assessment.proofHash;
  const modelLabel =
    response?.mode === "gpt-5.6-live"
      ? `${response.model ?? "gpt-5.6-sol"} · live`
      : response
        ? isGuestMode
          ? "Guest mode · deterministic only · no paid model call"
          : "Deterministic fallback"
        : isGuestMode
          ? "Guest mode · deterministic only · no paid model call"
          : "GPT-5.6 Sol ready";
  const impactLabel =
    response?.mode === "gpt-5.6-live"
      ? "GPT‑5.6 impact"
      : isGuestMode
        ? "Deterministic impact"
        : "Deterministic fallback";

  return (
    <main className="app-shell">
      <header className="app-bar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            PL
          </span>
          <span className="brand-name">ProofLatch</span>
        </div>

        <div className="repo-context" aria-label="Current sample repository">
          <strong>{packet.repository.name}</strong>
          <span>{packet.repository.branch}</span>
          <code>{packet.repository.commit.slice(0, 8)}</code>
        </div>

        <div className="header-actions">
          <span className="user-label">
            {user?.displayName ?? "Guest judge mode"}
          </span>
          <button
            className="button button-quiet"
            type="button"
            onClick={() => setImportOpen((open) => !open)}
          >
            Import evidence
          </button>
        </div>
      </header>

      <div className="workspace">
        {importOpen ? (
          <section className="import-panel" aria-labelledby="import-title">
            <div>
              <p className="eyebrow">Evidence contract v1.0</p>
              <h2 id="import-title">Use a bounded repository packet</h2>
              <p>
                Paste ProofLatch JSON. Source files, secrets, and raw logs are
                neither required nor accepted.
              </p>
            </div>
            <textarea
              aria-label="Evidence packet JSON"
              placeholder='{"schemaVersion":"1.0", ...}'
              value={importValue}
              onChange={(event) => setImportValue(event.target.value)}
            />
            <div className="import-actions">
              <button
                className="button button-primary"
                type="button"
                onClick={importPacket}
                disabled={!importValue.trim()}
              >
                Validate and load
              </button>
              <button
                className="button button-quiet"
                type="button"
                onClick={() => setImportOpen(false)}
              >
                Close
              </button>
            </div>
          </section>
        ) : null}

        <section
          className={`decision-surface ${
            isBlocked ? "decision-blocked" : isReady ? "decision-ready" : ""
          }`}
          aria-live="polite"
        >
          <div className="decision-copy">
            <p className="eyebrow">
              {phase === "analyzing"
                ? "Verifying evidence"
                : verdict
                  ? `Release ${verdict.toLowerCase()}`
                  : demoFixLoaded
                    ? "Updated evidence loaded"
                    : "Release decision desk"}
            </p>
            <h1>
              {phase === "analyzing"
                ? "Checking the latch…"
                : response?.analysis.headline ??
                  "From “it works” to “here’s the evidence.”"}
            </h1>
            <p className="decision-summary">
              {response?.analysis.explanation ??
                "Deterministic rules decide whether this release can ship. GPT‑5.6 explains the evidence and prepares a bounded Codex repair brief—it cannot change the verdict."}
            </p>
            <div className="trust-line">
              <span>Rules decide</span>
              <span>GPT‑5.6 explains</span>
              <span>Codex repairs</span>
              <span>New evidence reopens the latch</span>
            </div>
          </div>

          <div className="decision-actions">
            <button
              className="button button-primary button-large"
              type="button"
              onClick={analyze}
              disabled={phase === "analyzing"}
            >
              {phase === "analyzing"
                ? "Verifying…"
                : demoFixLoaded && isGuestMode
                  ? "Re-run deterministic proof"
                  : response
                    ? "Run proof again"
                    : isGuestMode
                      ? "Run deterministic proof"
                      : "Run release proof"}
            </button>

            {isBlocked ? (
              <button
                className="button button-secondary"
                type="button"
                onClick={applyDemoFixSet}
              >
                Apply demo fix set
              </button>
            ) : isReady ? (
              <button
                className="button button-secondary"
                type="button"
                onClick={() => handleCopy("receipt")}
              >
                {copyState === "receipt" ? "Receipt copied" : "Copy receipt"}
              </button>
            ) : demoFixLoaded ? (
              <button
                className="button button-quiet"
                type="button"
                onClick={resetDemo}
              >
                Reset blocked demo
              </button>
            ) : null}

            {!user ? (
              <a className="button button-quiet guest-sign-in" href={signInPath}>
                Sign in for GPT‑5.6
              </a>
            ) : null}

            <p className="model-state">{modelLabel}</p>
            {isGuestMode ? (
              <p className="guest-support">
                Optional AI explanation. Verdict and receipt stay
                deterministic.
              </p>
            ) : null}
            {isBlocked || demoFixLoaded ? (
              <p className="demo-disclosure">
                Demo fix only updates the sample evidence packet. It does not
                modify a repository.
              </p>
            ) : null}
          </div>

          <dl className="metric-strip">
            <div>
              <dt>Required proofs</dt>
              <dd>
                {response
                  ? `${response.assessment.requiredPassed}/${response.assessment.requiredTotal}`
                  : `${passedCount}/${packet.checks.filter((check) => check.required).length}`}
              </dd>
            </div>
            <div>
              <dt>Blocking</dt>
              <dd>{response?.assessment.blockers.length ?? failedCount}</dd>
            </div>
            <div>
              <dt>Warnings</dt>
              <dd>{response?.assessment.warnings.length ?? warningCount}</dd>
            </div>
            <div>
              <dt>Evidence digest</dt>
              <dd className="metric-hash">
                <span>
                  {response?.assessment.proofHash.slice(0, 16) ?? "pending"}
                </span>
                {proofHashChanged ? (
                  <small className="digest-change">
                    Changed from {previousProofHash.slice(0, 8)}
                  </small>
                ) : null}
              </dd>
            </div>
          </dl>
        </section>

        {error ? (
          <div className="error-banner" role="alert">
            <strong>Analysis stopped.</strong>
            <span>{error}</span>
          </div>
        ) : null}

        <div className="evidence-desk">
          <section className="evidence-list" aria-labelledby="evidence-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Policy: {policy.label}</p>
                <h2 id="evidence-title">Required evidence</h2>
              </div>
              <span>{packet.checks.length} checks</span>
            </div>

            <div className="check-list">
              {sortedChecks.map((check) => (
                <button
                  className={`check-row ${
                    selectedCheck.id === check.id ? "check-row-selected" : ""
                  }`}
                  type="button"
                  key={check.id}
                  onClick={() => setSelectedCheckId(check.id)}
                  aria-pressed={selectedCheck.id === check.id}
                >
                  <StatusMark status={check.status} />
                  <span className="check-main">
                    <span className="check-title-line">
                      <strong>{check.label}</strong>
                      <span className={`status-text text-${check.status}`}>
                        {statusLabels[check.status]}
                      </span>
                    </span>
                    <span className="check-summary">{check.summary}</span>
                  </span>
                  <span className="check-meta">
                    <span>{categoryLabels[check.category]}</span>
                    <span>{formatDuration(check.durationMs)}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <aside className="evidence-inspector" aria-labelledby="inspector-title">
            <div className="inspector-heading">
              <div>
                <p className="eyebrow">Evidence details</p>
                <h2 id="inspector-title">{selectedCheck.label}</h2>
              </div>
              <span className={`status-badge badge-${selectedCheck.status}`}>
                {statusLabels[selectedCheck.status]}
              </span>
            </div>

            <p className="inspector-summary">{selectedCheck.summary}</p>

            <dl className="proof-metadata">
              <div>
                <dt>Check ID</dt>
                <dd>
                  <code>{selectedCheck.id}</code>
                </dd>
              </div>
              <div>
                <dt>Requirement</dt>
                <dd>{selectedCheck.required ? "Release gate" : "Advisory"}</dd>
              </div>
              <div>
                <dt>Commit</dt>
                <dd>
                  <code>{packet.repository.commit.slice(0, 12)}</code>
                </dd>
              </div>
              <div>
                <dt>Proof source</dt>
                <dd>
                  <code>{selectedCheck.command ?? "Recorded evidence"}</code>
                </dd>
              </div>
            </dl>

            {selectedRisk ? (
              <div className="inspector-callout callout-risk">
                <p className="eyebrow">{impactLabel}</p>
                <strong>{selectedRisk.title}</strong>
                <p>{selectedRisk.impact}</p>
              </div>
            ) : null}

            {selectedRepair ? (
              <div className="inspector-callout callout-action">
                <p className="eyebrow">Bounded repair</p>
                <p>{selectedRepair.action}</p>
                <span>Done when: {selectedRepair.verify}</span>
              </div>
            ) : null}

            {isBlocked && response ? (
              <div className="inspector-actions">
                <button
                  className="button button-secondary button-full"
                  type="button"
                  onClick={() => handleCopy("brief")}
                >
                  {copyState === "brief"
                    ? "Codex brief copied"
                    : "Copy Codex repair brief"}
                </button>
                <button
                  className="button button-quiet button-full"
                  type="button"
                  onClick={() => handleCopy("receipt")}
                >
                  {copyState === "receipt"
                    ? "Decision receipt copied"
                    : "Copy decision receipt"}
                </button>
              </div>
            ) : null}

            {isReady && response ? (
              <div className="receipt-panel">
                <div className="receipt-seal" aria-hidden="true">
                  ✓
                </div>
                <div>
                  <p className="eyebrow">Reproducible evidence receipt</p>
                  <strong>Latch open for this commit</strong>
                  <p>
                    Any commit or evidence change requires a new evaluation.
                  </p>
                </div>
              </div>
            ) : null}
          </aside>
        </div>

        <footer className="product-footer">
          <p>
            ProofLatch does not claim software is bug-free. It records what was
            checked, under which policy, and why the current evidence passed or
            failed.
          </p>
          <div className="product-footer-meta">
            <span>Built with Codex + GPT‑5.6 Sol</span>
            <nav
              className="product-attribution"
              aria-label="EV1 Labs project links"
            >
              <a
                href="https://ev1labs.com/"
                target="_blank"
                rel="noreferrer"
              >
                EV1 Labs
              </a>
              <span aria-hidden="true">·</span>
              <a
                href="https://ev1labs.com/labs/build-week-2026/"
                target="_blank"
                rel="noreferrer"
              >
                Build Week 2026
              </a>
            </nav>
          </div>
        </footer>
      </div>
    </main>
  );
}
