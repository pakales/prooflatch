# ProofLatch 2:50 Demo Script

## Recording target

- **Maximum final runtime:** 2:50, leaving ten seconds below the three-minute
  limit.
- **Format:** 16:9, 1080p, audible narration, readable cursor and text.
- **Build:** exact public deployment submitted to judges.
- **Story:** evidence → `BLOCKED` → GPT-5.6 explanation → bounded Codex brief →
  clearly simulated new evidence → `READY` → receipt → implementation proof.

Keep the browser zoom and narration pace stable. Do not show secrets, private
tabs, email addresses, API dashboards, or raw identity headers.

## Shot list and narration

### 0:00–0:12 — The problem

**Screen:** ProofLatch title and decision desk.

**Narration:**

> Agent-written code arrives fast. Release confidence does not. ProofLatch is
> the release latch that turns bounded evidence into a decision you can inspect
> and repeat.

### 0:12–0:28 — The authority split

**Screen:** Point to the trust line, then the required evidence list.

**Narration:**

> The architecture is deliberate: deterministic rules decide blocked or ready.
> GPT-5.6 explains the evidence. Codex gets a bounded repair brief. Only new
> evidence can reopen the latch.

### 0:28–0:52 — Run the blocked proof

**Action:** Click **Run release proof**. Select `unit-suite`, then
`security-audit`.

**Narration:**

> This sample release has a clean pinned commit, but one test fails and a
> high-severity production advisory remains. The deterministic gate returns
> blocked. GPT-5.6 cannot change that verdict; it can only explain supplied
> gates that the server-owned policy marks as blocking.

Pause briefly on the model mode label and evidence digest.

### 0:52–1:18 — Generate the Codex repair brief

**Screen:** Show the inspector's GPT impact and bounded repair. Click
**Copy Codex repair brief** and briefly reveal the copied brief in a prepared,
non-sensitive text view.

**Narration:**

> The brief names the exact objective, the evidence-linked repair steps, how
> each step must be verified, and when Codex must stop. It explicitly forbids
> weakening or relabeling a gate just to get a passing result.

### 1:18–1:38 — Clearly disclose the simulation

**Action:** Return to the app and click **Apply demo fix set**. Point to the
disclosure and changed commit.

**Narration:**

> For this short demo, Apply demo fix set swaps in a prepared evidence fixture.
> It does not modify a repository. Notice that the commit changes and the
> evidence now records the repaired tests, audit, and mobile check.

### 1:38–1:58 — Re-run to ready

**Action:** Click **Run release proof** again.

**Narration:**

> We rerun the same deterministic policy. Every required proof now passes on a
> clean supplied state, so the result is ready. GPT-5.6 returns no risks and no
> repair steps because the server enforces that invariant.

### 1:58–2:18 — Show the receipt and its boundary

**Action:** Click **Copy receipt** and briefly show its JSON.

**Narration:**

> The receipt binds the server policy, commit, check statuses, evaluator
> version, and assessment into a full SHA-256 evidence digest. That digest
> detects changes after capture. It is not a signature, source attestation, or
> a claim that the software is bug-free.

### 2:18–2:38 — Prove the implementation

**Screen:** Prepared terminal or README section showing the completed lint,
type-check, build, test, and production-audit results. Briefly show the strict
schema and API contract, not source secrets.

**Narration:**

> ProofLatch uses server-owned policies, strict schemas, GPT-5.6 structured
> output, deterministic fallback, authenticated quotas, and a scanner that
> never runs project code. This commit passes lint, types, build, tests, and the
> production audit.

Only say the final sentence if every named gate passed on the recorded commit.
Otherwise state the precise verified set.

### 2:38–2:50 — Codex role and close

**Screen:** README section with public repository, MIT license, and real Codex
session ID.

**Narration:**

> Codex helped design, implement, audit, test, and document ProofLatch. GPT-5.6
> has one runtime job: explain evidence without owning the truth. ProofLatch:
> evidence before release.

End on the ProofLatch decision desk and live URL.

## Capture checklist

- [ ] The final cut is 2:50 or shorter.
- [ ] Narration is audible on phone and laptop speakers.
- [ ] Both Codex's build role and GPT-5.6's runtime role are explicit.
- [ ] `BLOCKED`, repair brief, simulated fix disclosure, `READY`, and receipt
      are all visible.
- [ ] The model mode label is visible during at least one run.
- [ ] The evidence digest changes between fixture states.
- [ ] The demo never implies the fixture button repaired real code.
- [ ] Digest and bug-free limitations are spoken aloud.
- [ ] No secret, personal email, private tab, notification, or account menu is
      visible.
- [ ] Test claims match the recorded commit.
- [ ] Public app and repository URLs appear in the description.
- [ ] The uploaded video is public, has audio, and works signed out.

## YouTube description

```text
ProofLatch — evidence before release.

Deterministic rules decide BLOCKED or READY. GPT-5.6 Sol explains the supplied
evidence and creates a bounded Codex repair brief. New evidence produces a new
receipt.

Live app: TODO_DEPLOYED_APP_URL
Source and setup: TODO_PUBLIC_REPOSITORY_URL

Built for OpenAI Build Week with Codex + GPT-5.6.

The demo fix is a sample evidence swap, not a repository modification. The
receipt digest binds supplied evidence after capture; it is not a source
attestation or bug-free guarantee.
```
