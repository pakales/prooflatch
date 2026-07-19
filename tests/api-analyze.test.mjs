import assert from "node:assert/strict";
import { after, beforeEach, mock, test } from "node:test";

import {
  blockedSample,
  fixedSample,
} from "../lib/sample-evidence.ts";

const originalApiKey = process.env.OPENAI_API_KEY;
const originalQuotaSalt = process.env.PROOFLATCH_QUOTA_SALT;
const safetyIdentifier = "a".repeat(64);

const state = {
  openaiCalls: [],
  openaiError: null,
  quotaCalls: [],
  quotaError: null,
  quotaResult: {
    allowed: true,
    safetyIdentifier,
    remainingMinute: 2,
    remainingDay: 19,
  },
  analysis: null,
};

function validBlockedAnalysis() {
  return {
    headline: "Two blocking gates require repair",
    explanation:
      "The required test and security evidence do not support release.",
    topRisks: [
      {
        checkId: "unit-suite",
        title: "Model supplied title",
        evidence: "Model supplied evidence",
        impact: "Checkout behavior remains unverified.",
      },
      {
        checkId: "security-audit",
        title: "Another model title",
        evidence: "Another model evidence",
        impact: "A production dependency risk remains.",
      },
    ],
    repairObjective: "Clear the two blocking gates.",
    repairSteps: [
      {
        checkId: "unit-suite",
        action: "Repair the failing idempotency behavior.",
        verify: "Model supplied verification",
      },
      {
        checkId: "security-audit",
        action: "Resolve the production dependency advisory.",
        verify: "Another model verification",
      },
    ],
    stopCondition: "Model supplied stop condition",
    confidence: "high",
  };
}

function resetState() {
  state.openaiCalls.length = 0;
  state.openaiError = null;
  state.quotaCalls.length = 0;
  state.quotaError = null;
  state.quotaResult = {
    allowed: true,
    safetyIdentifier,
    remainingMinute: 2,
    remainingDay: 19,
  };
  state.analysis = validBlockedAnalysis();
  process.env.OPENAI_API_KEY = "test-key-not-a-secret";
  process.env.PROOFLATCH_QUOTA_SALT = "s".repeat(32);
}

class FakeOpenAI {
  constructor(options) {
    this.options = options;
    this.responses = {
      parse: async (params, requestOptions) => {
        state.openaiCalls.push({ params, requestOptions, options });
        if (state.openaiError) throw state.openaiError;
        return {
          model: "gpt-5.6-sol",
          output_parsed: structuredClone(state.analysis),
        };
      },
    };
  }
}

const openaiModuleMock = mock.module("openai", {
  defaultExport: FakeOpenAI,
});

const quotaModuleMock = mock.module(
  new URL("../lib/quota.ts", import.meta.url).href,
  {
    namedExports: {
      consumeAiQuota: async (input) => {
        state.quotaCalls.push(input);
        if (state.quotaError) throw state.quotaError;
        return structuredClone(state.quotaResult);
      },
    },
  },
);

const { POST } = await import("../app/api/analyze/route.ts");

beforeEach(() => {
  resetState();
});

after(() => {
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalApiKey;

  if (originalQuotaSalt === undefined) {
    delete process.env.PROOFLATCH_QUOTA_SALT;
  } else {
    process.env.PROOFLATCH_QUOTA_SALT = originalQuotaSalt;
  }

  openaiModuleMock.restore();
  quotaModuleMock.restore();
});

function clone(value) {
  return structuredClone(value);
}

function request({
  url = "http://localhost/api/analyze",
  body = JSON.stringify(blockedSample),
  headers = {},
} = {}) {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body,
    duplex: body instanceof ReadableStream ? "half" : undefined,
  });
}

async function responseJson(response) {
  return {
    response,
    body: await response.json(),
  };
}

test("rejects malformed JSON before quota or model execution", async () => {
  const { response, body } = await responseJson(
    await POST(request({ body: "{" })),
  );

  assert.equal(response.status, 400);
  assert.equal(body.error, "Evidence packet is not valid JSON.");
  assert.equal(state.quotaCalls.length, 0);
  assert.equal(state.openaiCalls.length, 0);
});

test("accepts only application/json and rejects compressed input", async (t) => {
  await t.test("wrong media type", async () => {
    const { response, body } = await responseJson(
      await POST(
        request({
          headers: { "content-type": "text/plain" },
        }),
      ),
    );

    assert.equal(response.status, 415);
    assert.equal(body.error, "Expected application/json.");
  });

  await t.test("compressed body", async () => {
    const { response, body } = await responseJson(
      await POST(
        request({
          headers: { "content-encoding": "gzip" },
        }),
      ),
    );

    assert.equal(response.status, 415);
    assert.equal(body.error, "Compressed request bodies are not accepted.");
  });

  assert.equal(state.quotaCalls.length, 0);
  assert.equal(state.openaiCalls.length, 0);
});

test("enforces the streamed body cap without trusting Content-Length", async () => {
  const encoder = new TextEncoder();
  const oversized = encoder.encode(
    JSON.stringify({ payload: "x".repeat(50_000) }),
  );
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(oversized.subarray(0, 12_000));
      controller.enqueue(oversized.subarray(12_000));
      controller.close();
    },
  });

  const { response, body } = await responseJson(
    await POST(request({ body: stream })),
  );

  assert.equal(response.status, 413);
  assert.equal(body.error, "Evidence packet is too large.");
  assert.equal(state.quotaCalls.length, 0);
  assert.equal(state.openaiCalls.length, 0);
});

test("rejects cross-origin requests before reading trust-bearing input", async () => {
  const { response, body } = await responseJson(
    await POST(
      request({
        headers: { origin: "https://attacker.example" },
      }),
    ),
  );

  assert.equal(response.status, 403);
  assert.equal(body.error, "Cross-origin requests are not allowed.");
  assert.equal(state.quotaCalls.length, 0);
  assert.equal(state.openaiCalls.length, 0);
});

test("anonymous requests get deterministic proof without paid services", async () => {
  const local = await responseJson(await POST(request()));

  assert.equal(local.response.status, 200);
  assert.equal(local.body.mode, "deterministic-fallback");
  assert.equal(local.body.assessment.verdict, "BLOCKED");
  assert.equal(state.quotaCalls.length, 0);
  assert.equal(state.openaiCalls.length, 0);

  const blocked = await responseJson(
    await POST(
      request({
        url: "https://prooflatch.example/api/analyze",
        headers: { origin: "https://prooflatch.example" },
      }),
    ),
  );

  assert.equal(blocked.response.status, 200);
  assert.equal(blocked.body.mode, "deterministic-fallback");
  assert.equal(blocked.body.model, null);
  assert.equal(blocked.body.assessment.verdict, "BLOCKED");
  assert.match(blocked.body.assessment.proofHash, /^[a-f0-9]{64}$/);
  assert.ok(blocked.body.analysis.topRisks.length > 0);
  assert.ok(blocked.body.analysis.repairSteps.length > 0);
  assert.equal(state.quotaCalls.length, 0);
  assert.equal(state.openaiCalls.length, 0);

  const ready = await responseJson(
    await POST(
      request({
        url: "https://prooflatch.example/api/analyze",
        body: JSON.stringify(fixedSample),
        headers: { origin: "https://prooflatch.example" },
      }),
    ),
  );

  assert.equal(ready.response.status, 200);
  assert.equal(ready.body.mode, "deterministic-fallback");
  assert.equal(ready.body.model, null);
  assert.equal(ready.body.assessment.verdict, "READY");
  assert.match(ready.body.assessment.proofHash, /^[a-f0-9]{64}$/);
  assert.notEqual(
    ready.body.assessment.proofHash,
    blocked.body.assessment.proofHash,
  );
  assert.deepEqual(ready.body.analysis.topRisks, []);
  assert.deepEqual(ready.body.analysis.repairSteps, []);
  assert.equal(state.quotaCalls.length, 0);
  assert.equal(state.openaiCalls.length, 0);
});

test("rejects a client attempt to weaken the server policy", async () => {
  const weakened = clone(blockedSample);
  weakened.checks.find(
    (check) => check.id === "security-audit",
  ).required = false;

  const { response, body } = await responseJson(
    await POST(request({ body: JSON.stringify(weakened) })),
  );

  assert.equal(response.status, 422);
  assert.equal(body.error, "Evidence packet failed validation.");
  assert.ok(
    body.issues.some(
      (issue) =>
        issue.path.endsWith(".required") &&
        /controlled by the selected policy/i.test(issue.message),
    ),
  );
  assert.equal(state.quotaCalls.length, 0);
  assert.equal(state.openaiCalls.length, 0);
});

test("quota denial blocks the model and returns Retry-After", async () => {
  state.quotaResult = {
    allowed: false,
    retryAfterSeconds: 37,
  };

  const { response, body } = await responseJson(
    await POST(
      request({
        url: "https://prooflatch.example/api/analyze",
        headers: {
          origin: "https://prooflatch.example",
          "oai-authenticated-user-email": "judge@example.invalid",
        },
      }),
    ),
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "37");
  assert.equal(body.error, "Live analysis limit reached. Try again later.");
  assert.deepEqual(state.quotaCalls, [
    {
      email: "judge@example.invalid",
      secretSalt: "s".repeat(32),
    },
  ]);
  assert.equal(state.openaiCalls.length, 0);
});

test("quota infrastructure failure fails closed without model spend", async () => {
  state.quotaError = new Error("D1 unavailable");

  const { response, body } = await responseJson(
    await POST(
      request({
        url: "https://prooflatch.example/api/analyze",
        headers: {
          origin: "https://prooflatch.example",
          "oai-authenticated-user-email": "judge@example.invalid",
        },
      }),
    ),
  );

  assert.equal(response.status, 200);
  assert.equal(body.mode, "deterministic-fallback");
  assert.equal(body.assessment.verdict, "BLOCKED");
  assert.equal(state.quotaCalls.length, 1);
  assert.equal(state.openaiCalls.length, 0);
});

test("quota success binds the pseudonymous safety identifier to GPT", async () => {
  const { response, body } = await responseJson(
    await POST(
      request({
        url: "https://prooflatch.example/api/analyze",
        headers: {
          origin: "https://prooflatch.example",
          "oai-authenticated-user-email": "judge@example.invalid",
        },
      }),
    ),
  );

  assert.equal(response.status, 200);
  assert.equal(body.mode, "gpt-5.6-live");
  assert.equal(body.assessment.verdict, "BLOCKED");
  assert.equal(state.quotaCalls.length, 1);
  assert.equal(state.openaiCalls.length, 1);
  assert.equal(
    state.openaiCalls[0].params.safety_identifier,
    safetyIdentifier,
  );
  assert.equal(state.openaiCalls[0].params.store, false);
  assert.equal(state.openaiCalls[0].options.maxRetries, 0);
  assert.equal(
    body.analysis.topRisks[0].title,
    blockedSample.checks.find((check) => check.id === "unit-suite").label,
  );
  assert.equal(
    body.analysis.topRisks[0].evidence,
    blockedSample.checks.find((check) => check.id === "unit-suite").summary,
  );
  assert.match(
    body.analysis.repairSteps[0].verify,
    /^Regenerate check unit-suite under web-release@1\.0\.0/,
  );
  assert.notEqual(
    body.analysis.stopCondition,
    "Model supplied stop condition",
  );
});

test("a semantic model mismatch fails soft without changing BLOCKED", async () => {
  state.analysis = {
    headline: "Ready to ship",
    explanation: "The model tried to ignore the deterministic blockers.",
    topRisks: [],
    repairObjective: "Ship immediately.",
    repairSteps: [],
    stopCondition: "No further evidence needed.",
    confidence: "high",
  };

  const { response, body } = await responseJson(
    await POST(
      request({
        headers: {
          "oai-authenticated-user-email": "developer@example.invalid",
        },
      }),
    ),
  );

  assert.equal(response.status, 200);
  assert.equal(state.openaiCalls.length, 1);
  assert.equal(body.mode, "deterministic-fallback");
  assert.equal(body.model, null);
  assert.equal(body.assessment.verdict, "BLOCKED");
  assert.notEqual(body.analysis.headline, "Ready to ship");
  assert.ok(body.analysis.topRisks.length > 0);
});

test("GPT cannot add blockers or repair steps to a READY verdict", async () => {
  state.analysis = validBlockedAnalysis();

  const { response, body } = await responseJson(
    await POST(
      request({
        body: JSON.stringify(fixedSample),
        headers: {
          "oai-authenticated-user-email": "developer@example.invalid",
        },
      }),
    ),
  );

  assert.equal(response.status, 200);
  assert.equal(state.openaiCalls.length, 1);
  assert.equal(body.mode, "deterministic-fallback");
  assert.equal(body.assessment.verdict, "READY");
  assert.deepEqual(body.analysis.topRisks, []);
  assert.deepEqual(body.analysis.repairSteps, []);
});
