# ProofLatch Test Plan

## Objective

Testing must prove the product's central claim: the same validated evidence and
evaluator version produce the same authoritative verdict and digest, while the
model can explain but cannot change that result.

Do not treat a successful model response, polished UI, or passing build as
substitute evidence for the deterministic contract.

## Automated release gate

Run from a clean checkout with Node.js `>=22.13.0`:

```bash
npm ci
npm run verify
```

`verify` checks that the committed Action bundle matches its source, then runs
the type check, lint, unit suites, production build, rendered-worker tests, and
production dependency audit. A submission build is not ready if any stage is
skipped or fails. Record any intentionally deferred development-only audit
finding separately; never hide a production dependency advisory.

## Deterministic evaluator matrix

At minimum, automated tests should cover:

| Case | Expected verdict | Expected boundary |
| --- | --- | --- |
| All required checks pass; clean tree | `READY` | No blockers |
| One required check fails | `BLOCKED` | Failed check appears once |
| Multiple required checks fail | `BLOCKED` | All failures preserved |
| Required check warns | `BLOCKED` | Incomplete required evidence cannot pass |
| Advisory check warns | `READY` | Warning remains visible |
| Advisory check fails | Schema rejection | Advisory failure cannot bypass policy |
| Dirty tree with passing `clean-tree` | Schema rejection | Contradictory evidence rejected |
| Dirty tree with non-passing `clean-tree` | `BLOCKED` | Source state remains authoritative |
| Required flag is weakened | Schema rejection | Server policy owns requirements |
| Policy check is missing or unknown | Schema rejection | Exact check set enforced |
| Identical packet evaluated twice | Same verdict and digest | Stable canonicalization |
| Object keys reordered | Same digest | Canonical key ordering |
| Commit changes | Different digest | Receipt is commit-bound |
| Check status changes | Different digest | Receipt is evidence-bound |
| Policy or evaluator version changes | Different digest | Receipt is version-bound |
| Ready fallback | No risks or repair steps | READY invariant |
| Blocked fallback | Only authoritative blocking IDs | Evidence boundary |
| Hostile packet `command` text | Absent from Codex instructions | Evidence remains data |

The receipt preserves a full 64-character SHA-256 digest; the UI may show a
16-character abbreviation. Neither is a signature or evidence-origin check.

The current deterministic suite is
[`tests/prooflatch-engine.test.mjs`](../tests/prooflatch-engine.test.mjs) and can
be run independently with `npm run test:engine`.

## Schema rejection matrix

Requests must fail before a model call for:

- malformed JSON;
- unknown top-level or nested keys;
- missing required fields;
- unsupported `schemaVersion`;
- unknown policy ID or unsupported policy version;
- duplicate check IDs;
- missing, unknown, relabeled, recategorized, or reclassified policy checks;
- an advisory `fail`;
- contradictory dirty-tree evidence;
- invalid commit characters or length;
- invalid category or status;
- too many checks;
- oversized strings or body;
- unsupported content type;
- compressed request body;
- a cross-origin browser request.

Tests should assert both the HTTP status and that no model client was invoked.

## Model-boundary matrix

Use a mocked model client for deterministic automated tests:

| Model result | Expected server behavior |
| --- | --- |
| Valid blocked analysis using authoritative blocker IDs | Return `gpt-5.6-live` |
| Risk references a passing or unknown ID | Discard and use deterministic fallback |
| Repair step references an unknown ID | Discard and use deterministic fallback |
| `BLOCKED` has no risk or repair step | Discard and use deterministic fallback |
| `READY` contains risks or repair steps | Discard and use deterministic fallback |
| Output fails Zod parsing | Deterministic fallback |
| Empty parsed output | Deterministic fallback |
| Timeout or network error | Deterministic fallback |
| Missing `OPENAI_API_KEY` | Deterministic fallback |

Also assert the outbound request:

- uses explicit model `gpt-5.6-sol`;
- sets `store: false`;
- uses structured output;
- has zero automatic retries;
- includes the authoritative verdict;
- labels packet values as untrusted data;
- does not offer tools or repository command execution.

The live model smoke test is useful but non-deterministic. It must supplement,
not replace, mocked contract tests.

## Identity and quota matrix

Production tests should verify:

1. an anonymous visitor can run both bundled fixtures and receive a complete
   deterministic assessment, digest, brief, and receipt without a D1 or paid
   model call;
2. a valid hosting-injected ChatGPT identity can use the model within quota;
3. quota records contain only an HMAC pseudonym, never raw email;
4. repeated calls eventually receive the configured quota response;
5. quota remains enforced across worker restarts;
6. missing `PROOFLATCH_QUOTA_SALT` fails closed for paid model use;
7. unavailable D1 does not silently create unlimited model access;
8. anonymous localhost requests follow the same deterministic-only spend
   boundary; the live contract is exercised only with controlled authenticated
   test identity.

The current policy permits three calls per minute and twenty per day per
pseudonymous user, with thirty-day record expiry. Tests should still read
server constants instead of duplicating those values in unrelated code.

## Scanner contract

Run `npm run test:scanner`. The scanner suite verifies:

- ready, warning, blocked, and indeterminate exit semantics;
- schema-valid `repository-baseline@1.0.0` output;
- unborn and non-Git repositories;
- dirty worktrees and unresolved merge conflicts;
- sensitive-looking filename redaction;
- external or ambiguous metadata symlink rejection;
- project scripts, hooks, and fsmonitor traps are not executed;
- repository content filters are detected before `git status` can invoke them;
- inherited process secrets and Git/Node injection variables are excluded;
- a fake `git` prepended to `PATH` is never executed;
- Git submodule/gitlink entries are blocked without entering the nested repo;
- source, commit-message, and remote-credential canaries do not enter output;
- malformed CLI options return usage exit code `64`.

The scanner proves repository structure and source state only. A discovered test
or CI signal is not test-execution evidence.

## GitHub Action contract

Run the Action checks independently with:

```bash
npm run build:action
npm run check:action-bundle
npm run test:action
```

The Action suite must cover:

| Case | Expected GitHub step result |
| --- | --- |
| Clean baseline with all required checks passing | Success and `READY` output |
| Advisory CI or README warning | Success and `READY` output with warning IDs |
| Dirty checkout or another required failure | Failure after `BLOCKED` outputs are written |
| Scanner indeterminate or malformed output | Failure with no readiness claim |
| Packet commit differs from `GITHUB_SHA` | Failure |
| Input path escapes `GITHUB_WORKSPACE` | Failure before scanning |
| Input path traverses a symlink | Failure before scanning |
| Selected path resolves to a parent Git worktree | Indeterminate without inspecting the parent |
| Action receives secret or Git/Node injection environment variables | Scanner subprocess does not inherit them |
| Repository config defines an executable content filter | Scanner stops before filter execution |
| READY run | Evidence and receipt paths exist; repair-brief path is empty |
| BLOCKED run | Evidence, receipt, and bounded repair-brief paths exist |
| Rebuilt bundle differs from committed `action/dist` | Bundle check fails |

Also assert that public outputs are limited to verdict, scanner state, digest,
policy, commit, blocker/warning IDs, and artifact paths; the Action must not
accept or require an OpenAI token. The workflow job named `ProofLatch` is the
GitHub Check. The Action must not call the Checks API or Commit Status API.

## Local API smoke

With the development server running:

```bash
curl --fail-with-body \
  --request POST \
  --header 'Content-Type: application/json' \
  --data-binary @examples/evidence/blocked.json \
  http://localhost:3000/api/analyze
```

Confirm:

- `assessment.verdict` is `BLOCKED`;
- blocker IDs include `unit-suite` and `security-audit`;
- `analysis` exists in either `gpt-5.6-live` or
  `deterministic-fallback` mode;
- `evaluatorVersion`, `promptVersion`, and `proofHash` are present;
- `proofHash` is 64 lowercase hexadecimal characters;
- no secret, raw identity, internal error, or OpenAI response ID is returned.

Repeat with `examples/evidence/ready.json` and confirm:

- `assessment.verdict` is `READY`;
- `topRisks` and `repairSteps` are empty;
- the digest differs from the blocked fixture.

## Browser acceptance flow

Test at a desktop width and a narrow mobile width.

### Blocked state

1. Load `/` with the bundled blocked fixture.
2. Confirm the first viewport states the product purpose and exposes one primary
   signed-out action: **Run deterministic proof**.
3. Confirm the mode label states that guest mode is deterministic-only and
   creates no paid model call.
4. Run the deterministic proof.
5. Confirm `BLOCKED`, two required blockers, one warning, and a non-pending
   digest.
6. Select each failed check and confirm the inspector explanation stays tied to
   that check.
7. Copy the decision receipt and confirm it records deterministic explanation
   mode with no model identifier.
8. Copy the Codex brief and verify that every step has a known check ID,
   verification instruction, and stop condition.
9. Confirm there is no language claiming a repository was modified.

### Simulated evidence update

1. Click **Apply demo fix set**.
2. Confirm the disclosure states that only sample evidence changes.
3. Confirm the commit changes before re-analysis.
4. Run the deterministic proof again.

### Ready state

1. Confirm `READY`, zero blockers, zero warnings, and a changed digest.
2. Confirm no risk or repair callouts appear.
3. Copy the receipt.
4. Verify it includes the policy and evaluator versions, exact commit, verdict,
   full digest, checks, explanation mode, and returned model identifier.
5. Confirm the UI warns that any commit or evidence change requires a new
   evaluation.

### Import and accessibility

- Import both JSON fixtures.
- Try invalid JSON and schema-invalid JSON; errors must be specific and safe.
- Navigate all controls by keyboard.
- Confirm focus is visible and status is not communicated by color alone.
- Enable reduced motion and confirm no required information depends on
  animation.
- Check layout at approximately 390 px, 768 px, and 1440 px.
- Inspect browser console `error` and `warn` entries.

## Video evidence pass

Before recording the contest video:

- use the exact deployed build intended for judges;
- clear unrelated tabs, notifications, identity details, and secrets;
- preload the blocked fixture;
- verify the live model path and deterministic fallback label;
- verify the signed-out deterministic Judge Mode and no-paid-call label;
- rehearse the 2:50 script with a visible timer;
- record audible narration and confirm final runtime under three minutes;
- verify the uploaded public YouTube video from a signed-out window.

See [`DEMO-SCRIPT.md`](DEMO-SCRIPT.md).

## Candidate evidence record

Recorded on 2026-07-19 from the Judge Mode candidate source state. Public-only
rows remain pending until the exact candidate commit is approved, pushed, and
deployed.

| Gate | Result | Evidence |
| --- | --- | --- |
| Action bundle parity | PASS | `npm run verify`; generated bundle is current |
| Lint | PASS | `npm run verify` |
| Type check | PASS | `npm run verify` |
| Production build | PASS | `npm run verify`; `/` and `/api/analyze` built |
| Automated tests | PASS | 52 unit tests and 2 rendered-worker tests |
| Production dependency audit | PASS | `npm audit --omit=dev`; 0 vulnerabilities |
| Anonymous spend boundary | PASS | Localhost and production-shaped API tests call neither D1 quota nor OpenAI |
| Hostile command isolation | PASS | Packet `command` text is absent from generated Codex instructions |
| Desktop browser flow | PASS | Local production build at 1440×1000; BLOCKED → receipt → fixture swap → READY; digest changed |
| Mobile browser flow | PASS | Local production build at 390×844; no horizontal overflow and core actions fit the flow |
| Browser console | PASS | No `error` or `warn` entries during Judge Mode QA |
| Live GPT-5.6 candidate smoke | PENDING | Run after the exact candidate deployment |
| Production deployment | PENDING | Requires explicit `push + deploy` approval |
