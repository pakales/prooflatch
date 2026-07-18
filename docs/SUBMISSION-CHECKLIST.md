# ProofLatch Final Submission Checklist

This is a hard gate. Do not submit while any required item is unchecked or any
placeholder remains.

## 1. Product

- [ ] Public product name is **ProofLatch** everywhere user-visible.
- [ ] The first viewport explains the product without narration.
- [ ] Bundled blocked fixture returns `BLOCKED`.
- [ ] Blocking checks and advisory warnings remain inspectable.
- [ ] Live GPT-5.6 explanation is evidence-bound.
- [ ] Deterministic fallback is visibly labeled and usable.
- [ ] Copied Codex brief contains only authoritative blocking check IDs.
- [ ] Demo fix disclosure is visible before and after the fixture change.
- [ ] Ready fixture returns `READY` with no risks or repair steps.
- [ ] Receipt policy, commit, and full digest are present; commit and digest
      differ between fixture states.
- [ ] Missing, unknown, relabeled, recategorized, or weakened policy checks are
      rejected.
- [ ] Required warnings block; advisory warnings remain visible without
      blocking.
- [ ] Repository scanner output imports successfully and does not imply tests
      ran.
- [ ] Copy does not claim bug-free, tamper-proof, authenticated provenance,
      first, or only.

## 2. Security and operations

- [ ] `OPENAI_API_KEY` is configured as a production secret, not committed.
- [ ] `PROOFLATCH_QUOTA_SALT` is configured as a production secret, not
      committed.
- [ ] D1 binding `DB` is active.
- [ ] Anonymous production users cannot trigger paid model use.
- [ ] Authenticated usage is persistently quota-limited by HMAC pseudonym.
- [ ] Three-per-minute and twenty-per-day quota boundaries are verified.
- [ ] D1 contains no raw email, evidence packet, or model response.
- [ ] Missing identity, salt, quota store, or API key fails closed for paid use.
- [ ] Request type, encoding, stream size, JSON, and strict schema boundaries
      are tested.
- [ ] Model timeout, malformed output, unknown check ID, and READY-invariant
      failures use deterministic fallback.
- [ ] Responses, logs, and browser console contain no secrets, raw identity, or
      internal exception text.
- [ ] OpenAI usage/spend monitoring is configured.

## 3. Validation on the submitted commit

Record the exact commit: `TODO_SUBMITTED_COMMIT`

- [ ] `npm run verify`
- [ ] Type check and lint stages pass.
- [ ] Unit and rendered-worker test stages pass.
- [ ] Production build stage passes.
- [ ] Production dependency audit stage passes.
- [ ] Desktop browser blocked-to-ready flow
- [ ] Mobile browser blocked-to-ready flow
- [ ] Keyboard and visible-focus pass
- [ ] Reduced-motion pass
- [ ] Browser console error/warning inspection
- [ ] Live production GPT-5.6 smoke
- [ ] Anonymous production paid-call denial
- [ ] Signed-out access check for every judge-facing URL

Attach final evidence to the table in [`TESTING.md`](TESTING.md).

## 4. Repository

- [ ] Repository URL: `TODO_PUBLIC_REPOSITORY_URL`
- [ ] Submitted source state is pushed and matches `TODO_SUBMITTED_COMMIT`.
- [ ] Default branch builds from a clean clone.
- [ ] Repository is public with the MIT `LICENSE`.
- [ ] If kept private instead, both required judging accounts have access:
      `testing@devpost.com` and `build-week-event@openai.com`.
- [ ] README includes setup, sample data, test commands, architecture, honest
      boundaries, and Codex collaboration.
- [ ] Importable blocked and ready JSON fixtures work.
- [ ] No `.env*`, key, token, private URL, identity, or generated secret is
      present in git history.
- [ ] No stale starter name, preview, placeholder, or broken link remains.
- [ ] `git status --short` is empty after the submitted commit.

## 5. Deployment and judge access

- [ ] Live app URL: `TODO_DEPLOYED_APP_URL`
- [ ] Deployment uses the same submitted commit.
- [ ] Deployment status is healthy and stable.
- [ ] Judge sign-in path completes in a signed-out browser.
- [ ] Test access will remain available throughout judging.
- [ ] Quota is sufficient for judge testing without enabling unlimited use.
- [ ] Open Graph image, title, description, favicon, and HTTPS are correct.
- [ ] Mobile and desktop production screenshots are archived.
- [ ] Rollback path or previous known-good version is recorded.

## 6. Demo video

- [ ] Public YouTube URL: `TODO_PUBLIC_YOUTUBE_URL`
- [ ] Runtime is 2:50 or shorter.
- [ ] Audio is clear and continuous.
- [ ] Both Codex and GPT-5.6 usage are explained.
- [ ] The blocked-to-ready loop is completed on the public deployment.
- [ ] Simulated demo fix and digest limitations are spoken aloud.
- [ ] Test proof, public repository, MIT license, and Codex session ID are
      visible.
- [ ] No secret, email, private tab, notification, or account data appears.
- [ ] Video and description links work signed out.

Use [`DEMO-SCRIPT.md`](DEMO-SCRIPT.md) as the recording source of truth.

## 7. Devpost entry

- [ ] Track selected: **Developer Tools**.
- [ ] Project name and tagline match [`SUBMISSION.md`](SUBMISSION.md).
- [ ] Final description contains only verified behavior.
- [ ] Live app, repository, video, and license links are correct.
- [ ] Codex session ID is real and entered in the `/feedback` field:
      `019f7221-2421-78e3-b12e-f6082da1ed87`
- [ ] The same session ID appears in the README/submission copy.
- [ ] Existing-project question is answered truthfully; this entry's submitted
      work and event-period implementation are evident in commit history.
- [ ] Required team, eligibility, terms, and event fields are complete.
- [ ] Final preview has no Markdown formatting damage or `TODO_*` placeholders.
- [ ] Submission confirmation is captured.

## 8. Placeholder sweep

Run:

```bash
rg -n 'TODO_[A-Z0-9_]+' README.md docs
```

Expected result before submission: no matches.

## Final go/no-go

**GO only when:**

- the exact deployed commit passed the technical gate;
- the public app, repository, and video work signed out;
- production model spend is bounded;
- every claim in submission copy is demonstrated;
- every placeholder is replaced;
- the user explicitly approves the final public submission.

Otherwise: **NO-GO**, record the blocker, and preserve the last verified build.
