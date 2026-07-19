# Evidence Contract v1.0

ProofLatch accepts a small JSON document describing release evidence. It does
not accept source archives, raw logs, secrets, or arbitrary nested data.

Importable examples:

- [`examples/evidence/blocked.json`](../examples/evidence/blocked.json)
- [`examples/evidence/ready.json`](../examples/evidence/ready.json)

The TypeScript source of truth is
[`lib/prooflatch-schema.ts`](../lib/prooflatch-schema.ts).

## Top-level fields

| Field | Type | Rule |
| --- | --- | --- |
| `schemaVersion` | string | Exactly `"1.0"` |
| `policy` | object | Known server-owned ID and exact version |
| `repository` | object | Strict repository identity object |
| `release` | object | Strict release target object |
| `checks` | array | Exact selected-policy check set; no more than 32 |

Unknown fields are rejected. The policy object is one of:

```json
{ "id": "web-release", "version": "1.0.0" }
```

```json
{ "id": "repository-baseline", "version": "1.0.0" }
```

The server, not the packet author, defines each profile's check IDs, labels,
categories, and required flags.

## Repository

| Field | Type | Boundary |
| --- | --- | --- |
| `name` | string | 2–80 characters |
| `branch` | string | 1–120 characters |
| `commit` | hex string | 7–64 characters |
| `dirtyFiles` | integer | 0–10,000 |

`dirtyFiles > 0` blocks either current policy profile even if every supplied
check otherwise passes.

## Release

| Field | Type | Boundary |
| --- | --- | --- |
| `version` | string | 1–40 characters |
| `target` | string | 2–80 characters |
| `generatedAt` | ISO timestamp | Valid date-time string |

The timestamp is supplied evidence. ProofLatch does not provide a trusted
timestamp authority.

## Check

| Field | Type | Rule |
| --- | --- | --- |
| `id` | string | 2–48 lowercase letters, numbers, or hyphens; unique |
| `label` | string | 2–90 characters |
| `category` | enum | `source`, `tests`, `security`, `release`, `runtime`, or `coordination` |
| `status` | enum | `pass`, `warn`, or `fail` |
| `summary` | string | 2–240 characters |
| `command` | string, optional | 1–220 characters; descriptive evidence source only |
| `required` | boolean | Must exactly match the selected policy |
| `durationMs` | integer, optional | 0–3,600,000 |

The `command` field is displayed only as descriptive evidence provenance. It is
never executed and never repeated as an imperative in a Codex repair brief.
Deterministic repair verification uses a policy-owned instruction to regenerate
the named check. The separate baseline scanner runs only its own fixed Git
commands; it never executes a packet-provided command.

## GitHub Action producer

The bundled JavaScript Action produces only
`repository-baseline@1.0.0` evidence. It invokes the fixed ProofLatch scanner
from the checked-out Action package, validates the complete packet with the same
schema and server-owned policy used by the web product, and then runs the same
deterministic evaluator.

When GitHub provides `GITHUB_SHA`, the Action requires the packet's full commit
identifier to match it exactly. A mismatch is indeterminate and cannot produce
a successful check.

The Action writes three bounded artifacts:

- the exact repository-baseline evidence packet;
- a deterministic receipt;
- a Codex repair brief only when the verdict is `BLOCKED`.

These files are created under `RUNNER_TEMP`, not in the checked-out repository.
The Action exposes their paths as step outputs so the caller may explicitly
upload them. An artifact produced by a GitHub workflow still inherits that
workflow's trust boundary; it is not signed provenance or an independent
attestation.

## Policy profiles

### `web-release@1.0.0`

This profile represents executed evidence supplied for a web production
candidate.

| Check ID | Category | Required |
| --- | --- | --- |
| `clean-tree` | source | yes |
| `unit-suite` | tests | yes |
| `security-audit` | security | yes |
| `build` | release | yes |
| `browser-smoke` | runtime | no |
| `session-collision` | coordination | yes |
| `rollback` | release | yes |

### `repository-baseline@1.0.0`

This profile is emitted by the read-only scanner. Structural signals such as a
test file or CI configuration do not mean those systems ran successfully.

| Check ID | Category | Required |
| --- | --- | --- |
| `scan-complete` | source | yes |
| `git-head` | source | yes |
| `merge-conflicts` | source | yes |
| `clean-tree` | source | yes |
| `unsafe-symlinks` | security | yes |
| `sensitive-files` | security | yes |
| `project-manifest` | release | yes |
| `dependency-lock` | release | yes |
| `test-signal` | tests | yes |
| `ci-signal` | coordination | no |
| `readme` | coordination | no |

For v1, `unsafe-symlinks` also blocks Git mode `160000` gitlink entries. This
prevents an ignored or dirty submodule worktree from being represented as clean
parent-repository evidence.

Validation rejects:

- an unknown or missing check;
- a duplicate check ID;
- a changed policy-controlled label, category, or `required` flag;
- a `fail` status on an advisory check;
- `dirtyFiles > 0` paired with a passing `clean-tree` check.

## Policy semantics

| Condition | Effect |
| --- | --- |
| Required check is `warn` or `fail` | `BLOCKED` |
| `repository.dirtyFiles > 0` | `BLOCKED` |
| Advisory check is `warn` | Visible warning; not an independent blocker |
| Advisory check is `fail` | Packet rejected |
| Every required check passes and source is clean | `READY` |

Consumers must use `assessment.verdict`, not the secondary numeric score, for a
release decision.

## Data minimization

Evidence producers should:

- use stable check IDs;
- summarize results instead of embedding logs;
- omit file contents, diffs, environment dumps, tokens, user data, and secrets;
- use a pinned commit identifier;
- preserve exact command labels only when safe to disclose;
- produce a new packet after any source or evidence change.

## Provenance limitation

Schema validity means the packet is well-formed. It does not prove the packet is
truthful, that its commands ran, or that the named commit came from a trusted
repository. The receipt digest detects changes to the captured data; it does not
authenticate the producer.

The Action narrows this limitation by generating its own baseline packet and
binding it to the checked-out `GITHUB_SHA`. It does not prove that tests, builds,
audits, or deployments ran, and a compromised runner or Action dependency
remains inside the producer boundary.

Signed CI provenance is intentionally left outside v1.0 rather than implied by
the current receipt or Action artifact.
