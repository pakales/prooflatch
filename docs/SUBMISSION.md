# ProofLatch — Devpost Submission Copy

> The Devpost entry, repository, live app, and public demo video are live. The
> signed-out Judge Mode instructions below are the next candidate update and
> must only replace the public copy after this exact source state is deployed.

## Core fields

**Project name**

ProofLatch

**Track**

Developer Tools

**Tagline**

The release latch for agent-written code.

**One-line description**

Deterministic evidence decides `BLOCKED` or `READY`; GPT-5.6 explains why and
hands Codex the smallest safe repair brief.

**Short description**

ProofLatch turns bounded release evidence into a defensible decision.
Deterministic rules own the verdict, GPT-5.6 Sol explains it, and Codex receives
a repair brief tied only to blocking policy gates. New evidence produces a new
reproducible receipt.

## Full description

### Inspiration

Agentic coding can create a working feature in minutes, but a confident agent
message is not release evidence. The last mile still depends on a human
reconstructing which tests ran, what failed, whether the source state was
clean, and what should happen next.

We wanted a release tool that benefits from model reasoning without asking a
model to invent the truth.

### What it does

ProofLatch accepts a strict, bounded evidence packet for one release commit.
Deterministic policy evaluates required checks and source cleanliness, then
returns one authoritative verdict:

- `BLOCKED` when a policy-required check is not `pass` or the supplied working
  tree is dirty;
- `READY` when every policy-required gate passed on a clean supplied source
  state.

Only after that decision does GPT-5.6 Sol enter the loop. It explains the
evidence in plain language and, for a blocked release, creates a bounded Codex
repair brief. Every risk and repair step must reference an authoritative
blocking check ID. GPT-5.6 has no verdict field and cannot upgrade the release.

After repair, the operator supplies a new commit and new evidence, reruns the
gate, and receives a new receipt containing the evaluator version, decision,
check statuses, and evidence digest.

If the model path fails or is unavailable, ProofLatch keeps the deterministic
decision and returns a visibly labeled deterministic fallback.

### How we built it

ProofLatch is a full-stack TypeScript application built with React, Next-style
routing through vinext, Zod, the OpenAI Responses API, Sign in with ChatGPT,
Cloudflare D1, and OpenAI Sites.

The core evaluator is a pure function. Server-owned, versioned policies define
the exact allowed checks and prevent a client from omitting or weakening a
release gate. The evaluator canonicalizes the effective policy, validated
packet, evaluator version, and assessment summary, then derives a full
SHA-256 evidence digest. The model call uses explicit `gpt-5.6-sol`, structured
output, medium reasoning, `store: false`, zero automatic retries, and a bounded
timeout. The server performs a second semantic check on the parsed model output
before returning it.

Production model calls require server-side ChatGPT identity and pass through a
persistent pseudonymous per-user quota. The included local scanner can emit a
read-only repository baseline packet without running project code or tests.
Evidence is not stored.

### How Codex and GPT-5.6 were used

Codex was the build partner. We used it to frame the product, challenge the
novelty, design the deterministic/model boundary, implement the evaluator and
API, audit abuse paths, build the responsive interface, write tests and
documentation, and validate the release.

GPT-5.6 Sol has a separate runtime job: explain an already-determined release
decision and generate a repair brief bounded by the supplied evidence. This is
not a generic chat wrapper. The model's authority is deliberately narrower than
the deterministic evaluator's authority.

**Codex session ID:** `019f7221-2421-78e3-b12e-f6082da1ed87`

Use the same value in the event `/feedback` field.

### Challenges

The hardest design problem was preventing useful model reasoning from becoming
unverifiable model authority. We solved it structurally:

- the verdict is computed before the model call;
- the model schema contains no verdict;
- every risk and repair step must reference an authoritative blocking gate;
- `READY` forbids risks and repair steps;
- any model contract violation falls back to deterministic output.

The second challenge was honest proof language. The receipt digest detects
changes to captured evidence; it does not authenticate the source or prove a
command ran. We expose that limitation in the interface, README, threat model,
and demo.

The third challenge was offering a public judgeable demo without exposing an
unbounded paid API. Signed-out visitors now receive the full deterministic
decision, digest, brief, and receipt before any D1 or model code can run.
Optional GPT-5.6 explanations still require server-side identity and a
persistent per-user quota.

### Accomplishments

- A working blocked-to-ready release decision loop.
- Two server-owned policy profiles that reject missing, unknown, or weakened
  checks.
- A read-only repository baseline scanner with bounded Git metadata inspection.
- A deterministic verdict that remains authoritative when GPT is unavailable.
- A signed-out 60-second judge path with no paid model call.
- Strict evidence and structured-output contracts.
- Bounded Codex repair briefs linked to exact check IDs.
- Reproducible evidence receipts tied to commit, policy version, and packet.
- A responsive operational UI that makes the decision visible in the first
  viewport.
- Explicit security, privacy, provenance, testing, and fallback documentation.

### What we learned

The most useful place for a reasoning model is not always the decision itself.
Separating truth from narration made both layers stronger: rules became easier
to test, while the model could focus on turning evidence into the next safe
action.

We also learned that proof products must state what they do **not** prove.
Honest boundaries make the receipt more useful, not less.

### What's next

- an opt-in collector for executed test, build, and browser evidence;
- signed CI provenance and receipt verification;
- versioned release policies for web, iOS, APIs, and infrastructure;
- organization-managed evidence requirements;
- policy and receipt diffs across release attempts.

## Judge instructions

No repository access or source upload is required.

1. Open `https://prooflatch-buildweek.e-vigelis.chatgpt.site`.
2. Stay signed out and confirm **Guest mode · deterministic only · no paid
   model call**.
3. Click **Run deterministic proof** on the bundled Atlas Checkout fixture.
4. Inspect the `BLOCKED` verdict, failed checks, digest, and decision receipt.
5. Copy the bounded Codex repair brief.
6. Click **Apply demo fix set**. This simulates updated sample evidence only; it
   does not modify a repository.
7. Click **Re-run deterministic proof** and confirm `READY`.
8. Copy the new receipt and compare its commit and digest with the blocked run.
9. Optionally choose **Sign in for GPT-5.6** for an evidence-bound model
   explanation, or import the JSON fixtures from the public repository.

The complete signed-out loop takes about 60 seconds. If the authenticated model
quota or API is unavailable, the deterministic verdict still works and the UI
explicitly labels fallback mode.

## Links

- **Live app:** `https://prooflatch-buildweek.e-vigelis.chatgpt.site`
- **Public repository:** `https://github.com/pakales/prooflatch`
- **Public YouTube demo:** `https://youtu.be/zGwFgef_Cbg`
- **Devpost entry:** `https://devpost.com/software/prooflatch`
- **Codex session ID:** `019f7221-2421-78e3-b12e-f6082da1ed87`
- **License:** `https://github.com/pakales/prooflatch/blob/main/LICENSE`

## Evaluation criteria mapping

### Technological implementation

- pure deterministic evaluator and two server-owned versioned policies;
- read-only, non-executing repository baseline scanner;
- strict input and model-output schemas;
- explicit GPT-5.6 Sol Responses API integration;
- server semantic validation and fail-soft fallback;
- server-side identity, persistent pseudonymous quota, request bounds, and
  production secret isolation;
- full receipt digest tied to effective policy, packet, assessment, and
  evaluator version.

### Design

- one calm operational decision desk, not a generic chat interface;
- first viewport answers whether the release is blocked or ready and what to do;
- evidence list and sticky inspector keep explanation connected to proof;
- accessible status labels, keyboard controls, mobile layout, and reduced-motion
  support;
- model mode and simulated demo behavior are disclosed.

### Impact

- turns opaque agent confidence into an inspectable release decision;
- gives solo builders and teams one bounded next action;
- keeps release gates from being weakened by an open-ended repair request;
- preserves a portable record of what evidence was supplied for an exact
  commit.

### Quality of the idea

- separates deterministic truth, model narration, Codex action, and rerun proof;
- uses GPT-5.6 where reasoning adds value without giving it release authority;
- connects the agent coding loop to an evidence-backed release latch.

## Final claim audit

Before pasting this copy into Devpost, verify each statement against the exact
public build:

- [ ] Live responses return the intended GPT-5.6 model identifier.
- [ ] Exact server-owned policy validation and scanner tests pass.
- [ ] Structured and semantic boundary tests pass.
- [ ] Production identity and D1 quota are active.
- [ ] Evidence is not persisted.
- [ ] Fallback is visible and works.
- [ ] Desktop and mobile flows pass.
- [ ] Repository, license, README, session ID, app, and video links resolve
      signed out.
- [ ] No copy says bug-free, tamper-proof, source-authenticated, first, or only.
