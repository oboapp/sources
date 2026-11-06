import assert from "node:assert/strict";
import { test } from "node:test";
import { FacebookApiError, FacebookGraphClient } from "../dist/esm/graph.js";
import type { FacebookGraphDependencies, FacebookGraphOptions } from "../dist/esm/graph.js";

const token = "synthetic-graph-token-never-log";
const options: FacebookGraphOptions = {
  pageId: "101",
  apiVersion: "v25.0",
  getAccessToken: () => token,
  pageSize: 25,
  lookbackDays: 7,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function client(dependencies: FacebookGraphDependencies, overrides: Partial<FacebookGraphOptions> = {}) {
  return new FacebookGraphClient({ ...options, ...overrides }, dependencies);
}

function queued(responses: Response[]) {
  let requests = 0;
  const sleeps: number[] = [];
  const fetch: typeof globalThis.fetch = async () => {
    requests++;
    const response = responses.shift();
    assert.ok(response, "Unexpected HTTP request");
    return response;
  };
  return {
    fetch,
    sleep: async (milliseconds: number) => {
      sleeps.push(milliseconds);
    },
    count: () => requests,
    sleeps,
  };
}

function failsWith(code: string) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof FacebookApiError);
    assert.equal(error.code, code);
    assert.equal(String(error).includes(token), false);
    assert.equal(error.stack?.includes(token), false);
    assert.equal(JSON.stringify(error).includes(token), false);
    assert.equal(error.cause, undefined);
    return true;
  };
}

test("rejects malformed JSON instead of reporting an empty listing", async () => {
  const runtime = queued([new Response("{broken", { status: 200 })]);
  await assert.rejects(client(runtime).listPosts(), failsWith("invalid_json"));
  assert.equal(runtime.count(), 1);
});

test("recognizes Graph errors inside HTTP 200 without exposing provider messages", async () => {
  const runtime = queued([json({ error: { code: 10, message: token } })]);
  await assert.rejects(client(runtime).listPosts(), (error: unknown) => {
    failsWith("api_error")(error);
    assert.ok(error instanceof FacebookApiError);
    assert.equal(error.httpStatus, 200);
    assert.equal(error.graphCode, 10);
    return true;
  });
  assert.equal(runtime.count(), 1);
});

test("recovers from server failures using two bounded retries", async () => {
  const runtime = queued([json({}, 500), json({}, 503), json({ data: [] })]);
  assert.deepEqual(await client(runtime).listPosts(), { posts: [] });
  assert.equal(runtime.count(), 3);
  assert.deepEqual(runtime.sleeps, [1000, 2000]);
});

test("stops after two retries when server failures continue", async () => {
  const runtime = queued([json({}, 500), json({}, 500), json({}, 500)]);
  await assert.rejects(client(runtime).listPosts(), failsWith("server_error"));
  assert.equal(runtime.count(), 3);
  assert.deepEqual(runtime.sleeps, [1000, 2000]);
});

test("replaces network errors containing credentials with a safe error", async () => {
  const fetch: typeof globalThis.fetch = async () => {
    throw new Error(`Request failed at https://example.invalid/?access_token=${token}`);
  };
  await assert.rejects(client({ fetch }).listPosts(), failsWith("request_failed"));
});

test("rejects a next page without an after cursor", async () => {
  const runtime = queued([json({ data: [], paging: { next: `https://example.invalid/${token}` } })]);
  await assert.rejects(client(runtime).listPosts(), failsWith("invalid_cursor"));
  assert.equal(runtime.count(), 1);
});

test("rejects oversized returned cursors before exposing them to a caller", async () => {
  const runtime = queued([json({ data: [], paging: {
    next: "present",
    cursors: { after: "x".repeat(8193) },
  } })]);
  await assert.rejects(client(runtime).listPosts(), failsWith("invalid_cursor"));
  assert.equal(runtime.count(), 1);
});

test("rejects credentials embedded in returned cursors", async () => {
  const runtime = queued([json({ data: [], paging: {
    next: "present",
    cursors: { after: `prefix-${token}-suffix` },
  } })]);
  await assert.rejects(client(runtime).listPosts(), failsWith("invalid_cursor"));
  assert.equal(runtime.count(), 1);
});

test("never puts a supplied token-bearing cursor into a request URL", async () => {
  const runtime = queued([]);
  await assert.rejects(client(runtime).listPosts(token), failsWith("invalid_cursor"));
  assert.equal(runtime.count(), 0);
});

test("rejects an immediately repeated cursor", async () => {
  const runtime = queued([json({ data: [], paging: {
    next: "present",
    cursors: { after: "same-page" },
  } })]);
  await assert.rejects(client(runtime).listPosts("same-page"), failsWith("cursor_loop"));
  assert.equal(runtime.count(), 1);
});

test("cleans cancellation errors after a request has started", async () => {
  const controller = new AbortController();
  const fetch: typeof globalThis.fetch = async (_input, init) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      assert.ok(signal);
      signal.addEventListener("abort", () => {
        reject(new Error(token));
      }, { once: true });
      controller.abort(new Error(token));
    });
  };
  await assert.rejects(client({ fetch }, { signal: controller.signal }).listPosts(), failsWith("cancelled"));
});

test("cleans token getter failures before making any request", async () => {
  const runtime = queued([]);
  const graph = client(runtime, { getAccessToken: async () => {
    throw new Error(token);
  } });
  await assert.rejects(graph.listPosts(), failsWith("authorization"));
  assert.equal(runtime.count(), 0);
});

test("rejects oversized listing pages instead of silently truncating posts", async () => {
  const runtime = queued([json({ data: Array.from({ length: 101 }, () => ({ id: "101_1" })) })]);
  await assert.rejects(client(runtime).listPosts(), failsWith("invalid_response"));
});

test("rejects detail requests for another Page without making a request", async () => {
  const runtime = queued([]);
  await assert.rejects(client(runtime).getPost("202_1"), failsWith("invalid_post_id"));
  assert.equal(runtime.count(), 0);
});
