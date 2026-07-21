import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the ProofLatch release desk", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>ProofLatch — Evidence before release<\/title>/i);
  assert.match(html, /ProofLatch/);
  assert.match(html, /Run deterministic proof/);
  assert.match(html, /Guest judge mode/);
  assert.match(html, /Guest mode · deterministic only · no paid model call/);
  assert.match(html, /Sign in for GPT‑5\.6/);
  assert.match(html, /\/signin-with-chatgpt\?return_to=%2F/);
  assert.doesNotMatch(html, /Sign in to run live analysis/);
  assert.match(html, /Rules decide/);
  assert.match(html, /GPT‑5\.6 explains/);
  assert.match(html, /Required evidence/);
  assert.match(html, /aria-label="EV1 Labs project links"/);
  assert.match(
    html,
    /aria-label="An EV1 Labs build — Build Week 2026 collection"/,
  );
  assert.equal((html.match(/AN EV1 LABS BUILD/g) ?? []).length, 1);
  assert.match(html, /href="https:\/\/ev1labs\.com\/"/);
  assert.match(
    html,
    /href="https:\/\/ev1labs\.com\/labs\/build-week-2026\/"/,
  );
  assert.doesNotMatch(html, /OPENAI_API_KEY|PROOFLATCH_QUOTA_SALT/);
});

test("uses the canonical EV1 Labs publisher mark", async () => {
  const mark = await readFile(
    new URL("../public/ev1-mark.svg", import.meta.url),
  );
  assert.equal(
    createHash("sha256").update(mark).digest("hex"),
    "d1074b27463fb95e6ccfe07e1e7cba65528a08fe6e1af79919427bdd81b41032",
  );
});

test("unknown routes do not render the release desk", async () => {
  const response = await render("/not-a-prooflatch-route");
  assert.equal(response.status, 404);
});
