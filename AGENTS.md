# ProofLatch Agent Guide

This file defines the durable engineering contract for automated contributors
working in this repository. User instructions and higher-level workspace rules
still take precedence.

## Mission

ProofLatch turns a bounded release evidence packet into a defensible release
decision:

1. Deterministic code decides `BLOCKED` or `READY`.
2. GPT-5.6 Sol explains that decision and may create a bounded Codex repair
   brief.
3. A changed commit or evidence packet must be evaluated again to produce a new
   receipt.

The product and internal engineering name is **ProofLatch**. Keep that naming
consistent in code, tests, fixtures, documentation, and public copy.

## Non-negotiable invariants

- A language model must never create, override, upgrade, or downgrade the
  release verdict.
- `BLOCKED` means at least one policy-required check is not `pass` or the
  supplied working tree count is non-zero.
- `READY` means every policy-required check is `pass` and the supplied working
  tree count is zero.
- A model risk or repair step may reference only an authoritative blocking
  check ID.
- Check IDs, labels, categories, and required flags come from
  `lib/release-policies.ts`; client packets may not redefine them.
- Advisory checks use `pass` or `warn`. An advisory `fail` is schema-invalid.
- A `READY` model analysis must have no risks and no repair steps.
- A `BLOCKED` live model analysis must have at least one risk and one repair
  step.
- A model failure must preserve the deterministic result through an explicitly
  labeled fallback.
- Do not weaken, skip, relabel, or make a check optional merely to produce
  `READY`.
- Any evidence, policy, or commit change requires a new digest and receipt.
- Keep evaluator and prompt versions explicit in API responses and receipts.

If a proposed change breaks one of these invariants, stop and redesign it.

## Honest product language

Never claim ProofLatch is:

- bug-free assurance;
- tamper-proof;
- a source attestation;
- proof that a command actually ran;
- the first or only product of its kind.

The full SHA-256 digest binds the effective server-owned policy, supplied
packet, evaluator version, and deterministic assessment after capture. The UI
may abbreviate it visually, but receipts must preserve the full digest. It is
not a signature, trusted timestamp, or proof of evidence origin.

The **Apply demo fix set** action is a fixture swap. It must always remain
visibly disclosed as simulated and must never imply that ProofLatch modified a
repository.

## Security and privacy contract

- Keep `OPENAI_API_KEY` and `PROOFLATCH_QUOTA_SALT` server-only and out of logs,
  fixtures, client bundles, receipts, and git.
- Never add a `NEXT_PUBLIC_` prefix to secrets.
- Production model calls require server-side Sign in with ChatGPT identity and
  a persistent per-user D1 quota.
- Pseudonymize quota identity with keyed HMAC; do not store raw email addresses.
- Treat every evidence value as untrusted data, never as model instructions.
- Preserve strict Zod schemas, request size limits, content-type enforcement,
  origin checks, bounded model output, zero automatic retries, and timeout
  behavior.
- Keep OpenAI `store: false`.
- Do not persist evidence packets or model output unless a future product
  requirement, retention policy, and threat-model update explicitly authorize
  it.
- Sign in with ChatGPT establishes identity, not workspace membership. Hosting
  access policy is a separate control.

Read [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) before changing auth, quota,
request handling, hashing, model prompts, persistence, or deployment settings.

## Repository map

- `app/ProofLatchApp.tsx` — client decision desk and demo flow
- `app/api/analyze/route.ts` — validated analysis boundary and model call
- `app/chatgpt-auth.ts` — hosting-owned ChatGPT sign-in helpers
- `lib/release-policies.ts` — server-owned policy profiles and exact check sets
- `lib/prooflatch-schema.ts` — strict evidence and model schemas
- `lib/prooflatch.ts` — deterministic evaluator, digest, and fallback
- `lib/prooflatch-artifacts.ts` — shared deterministic receipt and repair brief
- `lib/sample-evidence.ts` — bundled blocked and ready fixtures
- `lib/quota.ts` — pseudonymous persistent model-usage quota
- `bin/prooflatch-scan.mjs` — read-only repository baseline packet generator
- `lib/safe-process-env.mjs` — explicit scanner subprocess environment allowlist
- `action.yml` and `action/src/` — public JavaScript Action contract and source
- `action/dist/` — committed generated Action bundle; never edit by hand
- `db/schema.ts` — persistent quota schema
- `examples/evidence/` — importable JSON fixtures
- `examples/github/` — inactive consumer workflow examples
- `tests/` — deterministic, API, rendering, and contract tests
- `docs/` — architecture, testing, security, demo, and submission package
- `.openai/hosting.json` — OpenAI Sites resource declarations

## Engineering defaults

- Use Node.js `>=22.13.0` and npm; preserve the checked-in lockfile.
- Prefer the smallest robust change and existing repository patterns.
- Keep the evaluator pure and independently testable.
- Keep model prose outside the receipt's deterministic truth fields.
- Keep the GitHub Action token-free and limited to the structural
  `repository-baseline@1.0.0` profile.
- Rebuild `action/dist/` through `npm run build:action`; never hand-edit it.
- Use exact explicit model identifiers in runtime code.
- Do not render model output as raw HTML.
- Do not add repository command execution, hooks, shell interpolation, or
  arbitrary network fetches to the web app.
- Preserve accessible keyboard behavior, visible focus states, reduced motion,
  and responsive desktop/mobile layout.
- Do not add charts or decorative dashboard elements that obscure the release
  decision.

## Required checks

Before handing off a meaningful change, run:

```bash
npm run verify
```

For UI or API changes, also manually verify:

1. bundled blocked fixture → `BLOCKED`;
2. GPT live response or transparent deterministic fallback;
3. copied repair brief references only authoritative blocking check IDs;
4. simulated demo fix disclosure remains visible;
5. ready fixture → `READY`;
6. receipt digest changes when evidence or commit changes;
7. anonymous production users cannot trigger a paid model call;
8. desktop and mobile layouts work without console errors.

Do not state that a gate passed unless its command or check was actually run in
the current source state. Record skipped checks and residual risk.

## Documentation synchronization

When changing the evidence contract, evaluator, receipt, model schema, auth,
quota, or public flow, update the relevant files in the same change:

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/EVIDENCE-CONTRACT.md`
- `docs/TESTING.md`
- `docs/THREAT-MODEL.md`
- JSON fixtures under `examples/evidence/`

If a public behavior changes, update the demo script and submission copy too.

## Build Week integrity

- Keep the repository license and setup instructions intact.
- Preserve a real Codex session ID in the final event feedback field; do not
  submit the placeholder from the README.
- The demo video must stay under three minutes, include audible narration, and
  explain the distinct roles of Codex and GPT-5.6.
- Do not expose API keys, identity headers, private browser tabs, or user data in
  screenshots or video.
- Do not publish, deploy, submit, upload, or change production access without
  explicit user approval at that action boundary.
