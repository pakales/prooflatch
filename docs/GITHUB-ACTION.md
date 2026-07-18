# ProofLatch GitHub Action

`pakales/prooflatch@v1` is the public compatibility alias for the bundled
JavaScript Action in this repository. For production, pin the immutable commit
SHA listed in the
[v1.0.0 release](https://github.com/pakales/prooflatch/releases/tag/v1.0.0).

## What v1 proves

The Action runs the existing read-only scanner and evaluates its output with
the same strict schema, versioned server-owned policy, and deterministic
evaluator used by the web product:

```text
checked-out repository
  -> repository-baseline@1.0.0 packet
  -> strict policy validation
  -> deterministic READY or BLOCKED
  -> evidence packet + receipt (+ Codex brief when BLOCKED)
```

`READY` means the structural repository baseline passed for the exact checked
out commit. It confirms source-state and repository signals such as a pinned
HEAD, clean worktree, no unresolved conflicts, safe metadata boundaries,
manifest, lockfile, test signal, CI signal, and README status.

It does **not** prove that tests, a production build, a dependency audit, or a
browser flow ran. It is not a source attestation, signature, deployment
authorization, or complete `web-release` proof. Git submodule/gitlink entries
are unsupported in v1 and produce `BLOCKED` rather than an incomplete clean-tree
claim.

## Consumer workflow

Use one non-matrix job with the exact stable name `ProofLatch`. GitHub Actions
creates the job check automatically; the Action does not create a second Check
Run or Commit Status.

```yaml
name: ProofLatch

on:
  pull_request:
  merge_group:
    types: [checks_requested]

permissions:
  contents: read

jobs:
  prooflatch:
    name: ProofLatch
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    steps:
      - name: Check out the evaluated commit
        uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6
        with:
          persist-credentials: false

      - name: Evaluate the repository baseline
        id: prooflatch
        uses: pakales/prooflatch@v1
        with:
          path: .
          target: Pull request repository baseline
```

The complete copyable example lives at
[`examples/github/prooflatch.yml`](../examples/github/prooflatch.yml).

For production use, pin both Actions to full immutable commit SHAs. A moving
`@v1` tag is a convenient compatibility alias, not an immutable supply-chain
reference.

Do not use:

- `pull_request_target` to evaluate untrusted pull request code;
- secrets or a write-capable token;
- `continue-on-error`;
- job-level conditions or path filters that can skip the required job;
- a matrix that creates multiple checks with the same intended ruleset name.

If a repository uses GitHub merge queue, keep the `merge_group` trigger so the
required check is produced for the merge group.

## Inputs

| Input | Required | Default | Meaning |
| --- | --- | --- | --- |
| `path` | no | `.` | Relative Git worktree root inside `GITHUB_WORKSPACE`; symlink escapes and parent-worktree discovery are rejected |
| `target` | no | `Pull request repository baseline` | Printable receipt label, 2–80 characters |
| `release-version` | no | scanner-detected | Optional printable release label, 1–40 characters |

The Action intentionally has no token, policy, shell-command,
`fail-on-blocked`, network, or arbitrary receipt-path input.

## Outputs

| Output | Meaning |
| --- | --- |
| `verdict` | Authoritative `READY` or `BLOCKED` |
| `scanner-state` | `ready`, `review`, `blocked`, or `indeterminate` |
| `evidence-digest` | Full 64-character SHA-256 evidence digest |
| `policy` | Effective policy ID and version |
| `commit` | Full checked-out Git commit evaluated by the scanner |
| `blocking-check-ids` | JSON array of authoritative blocking check IDs |
| `warning-check-ids` | JSON array of advisory warning check IDs |
| `evidence-path` | Fresh private packet file under `RUNNER_TEMP` |
| `receipt-path` | Fresh private receipt file under `RUNNER_TEMP` |
| `repair-brief-path` | BLOCKED-only Codex brief path, otherwise empty |

Outputs and artifact files are written before a `BLOCKED` result fails the job,
so diagnostics remain available to later `if: failure()` steps in the same job.
The Action does not upload or persist them automatically.

## Ruleset setup

1. Land the workflow on the default branch.
2. Run the `ProofLatch` job successfully at least once.
3. Create or update the branch ruleset.
4. Enable **Require status checks to pass before merging**.
5. Add the exact check name `ProofLatch`.
6. Prefer strict/up-to-date checking for a release branch.

The check name comes from `jobs.<job>.name`, not from `action.yml`, the workflow
name, or the step name. Do not reuse `ProofLatch` for an unrelated job.

## Security boundary

- The Action performs no OpenAI call and does not use `/api/analyze`.
- It does not read `OPENAI_API_KEY`, `GITHUB_TOKEN`, or other job secrets.
- It locates its trusted scanner relative to the executing bundle, without
  relying on the composite-only `GITHUB_ACTION_PATH` context.
- Git child processes receive an allowlisted environment only.
- The selected path must equal the discovered Git top-level after realpath
  resolution; a nested parent worktree is indeterminate.
- It runs fixed Git metadata commands through a validated absolute system Git
  executable with shell execution disabled; nonstandard Git locations fail
  closed.
- Git hooks, fsmonitor, pagers, prompts, remote transports, and configured
  content filters are blocked or rejected before worktree status is inspected.
- Gitlink entries are detected from bounded index metadata and block v1 without
  entering the nested repository.
- It never runs project scripts, package installation, tests, build commands,
  or packet-provided commands.
- Output files are created exclusively in a new private directory under
  `RUNNER_TEMP`, never in the evaluated worktree.

Residual limitations remain: a pull request may try to modify its caller
workflow, repository-baseline evidence is structural rather than executed CI
attestation, and the receipt digest authenticates no producer. Protect workflow
changes with repository review rules or centrally managed required workflows
when available.

## Maintainer validation

```bash
npm run build:action
npm run check:action-bundle
npm run test:action
npm run verify
```

The committed bundle is generated from `action/src/`; do not edit
`action/dist/` by hand. The repository release and branch protection are
maintainer-controlled. A Marketplace listing is separate and is not required
to use the Action.
