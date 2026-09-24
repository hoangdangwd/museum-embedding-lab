import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index.js";

const origin = "https://example.test";
const env = {
    ALLOW_ADMIN_LOCAL: "true",
    OPENROUTER_API_KEY: "test-key",
    OPENROUTER_MODEL: "google/gemini-embedding-2",
    EMBEDDING_DIMENSIONS: "1536",
    EMBEDDING_VERSION: "2",
    PREPROCESS_VERSION: "test",
    RECOGNITION_THRESHOLD: "0.8",
    RECOGNITION_MARGIN: "0.05",
};

function jpeg() {
    return new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" });
}

test("invalid guest upload is rejected before storage access", async () => {
    const form = new FormData();
    form.set("file", new Blob(["not jpeg"], { type: "image/png" }), "bad.png");
    const result = await worker.fetch(
        new Request(origin + "/api/query", { method: "POST", body: form }),
        env
    );
    assert.equal(result.status, 400);
    assert.match((await result.json()).detail, /JPEG/);
});

test("admin API is not public without Cloudflare Access", async () => {
    const result = await worker.fetch(new Request(origin + "/api/admin/artifacts"), {
        ...env,
        ALLOW_ADMIN_LOCAL: "false",
    });
    assert.equal(result.status, 403);
});

test("embedding request includes 1536 dimensions and rejects wrong output size", async () => {
    const originalFetch = globalThis.fetch;
    let requestBody;
    globalThis.fetch = async (url, options) => {
        if (String(url).endsWith("/embeddings/models"))
            return Response.json({
                data: [
                    {
                        id: "google/gemini-embedding-2",
                        architecture: { input_modalities: ["image"] },
                    },
                ],
            });
        requestBody = JSON.parse(options.body);
        return Response.json({ model: "google/gemini-embedding-2", data: [{ embedding: [1, 2] }] });
    };
    try {
        const form = new FormData();
        form.set("file", jpeg(), "capture.jpg");
        const result = await worker.fetch(
            new Request(origin + "/api/query", { method: "POST", body: form }),
            {
                ...env,
                DB: { prepare: () => ({ bind: () => ({ first: async () => ({ count: 1 }) }) }) },
                VECTORIZE: { query: async () => ({ matches: [] }) },
            }
        );
        assert.equal(result.status, 502);
        assert.equal(requestBody.dimensions, 1536);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("query groups reference matches by artifact and ignores stale vectors", async () => {
    const originalFetch = globalThis.fetch;
    const vector = [1, ...Array(1535).fill(0)];
    globalThis.fetch = async (url) => String(url).endsWith("/models")
        ? Response.json({ data: [{ id: "google/gemini-embedding-2", architecture: { input_modalities: ["image"] } }] })
        : Response.json({ model: "google/gemini-embedding-2", data: [{ embedding: vector }] });
    const db = {
        prepare(sql) {
            return {
                bind(...params) {
                    return {
                        first: async () => ({ count: 3 }),
                        all: async () => {
                            assert.equal(params.at(-1), "openrouter|google/gemini-embedding-2|2|1536|test");
                            assert.match(sql, /status='ready'/);
                            return { results: [
                                { id: "red", name: "Đỏ", vector_id: "red-1" },
                                { id: "red", name: "Đỏ", vector_id: "red-2" },
                                { id: "blue", name: "Xanh", vector_id: "blue-1" },
                            ] };
                        },
                    };
                },
            };
        },
    };
    const vectorize = { query: async () => ({ matches: [
        { id: "red-1", score: .91, metadata: { artifact_id: "red" } },
        { id: "red-2", score: .90, metadata: { artifact_id: "red" } },
        { id: "blue-1", score: .80, metadata: { artifact_id: "blue" } },
        { id: "deleted", score: .99, metadata: { artifact_id: "deleted" } },
    ] }) };
    try {
        const form = new FormData();
        form.set("file", jpeg(), "capture.jpg");
        const result = await worker.fetch(new Request(origin + "/api/query", { method: "POST", body: form }), { ...env, DB: db, VECTORIZE: vectorize });
        assert.equal(result.status, 200);
        const data1 = await result.json();
          assert.equal(data1.recognized, true);
          assert.equal(data1.artifact, "Đỏ");
          assert.ok(data1.candidates.length > 0);
          assert.equal(data1.candidates[0].name, "Đỏ");
    } finally { globalThis.fetch = originalFetch; }
});

test("query retries while a freshly upserted vector becomes searchable", async () => {
    const originalFetch = globalThis.fetch;
    const vector = [1, ...Array(1535).fill(0)];
    let queryCount = 0;
    globalThis.fetch = async (url) => String(url).endsWith("/models")
        ? Response.json({ data: [{ id: "google/gemini-embedding-2", architecture: { input_modalities: ["image"] } }] })
        : Response.json({ model: "google/gemini-embedding-2", data: [{ embedding: vector }] });
    try {
        const form = new FormData();
        form.set("file", jpeg(), "capture.jpg");
        const result = await worker.fetch(new Request(origin + "/api/query", { method: "POST", body: form }), {
            ...env,
            DB: {
                prepare(sql) {
                    return {
                        bind() {
                            return {
                                first: async () => ({ count: 1 }),
                                all: async () => ({ results: [{ id: "artifact-1", name: "Tượng", vector_id: "vector-1" }] }),
                            };
                        },
                    };
                },
            },
            VECTORIZE: {
                query: async () => {
                    queryCount++;
                    return queryCount === 1
                        ? { matches: [] }
                        : { matches: [{ id: "vector-1", score: 0.95, metadata: { artifact_id: "artifact-1" } }] };
                },
            },
        });
        assert.equal(result.status, 200);
        const data2 = await result.json();
          assert.equal(data2.recognized, true);
          assert.equal(data2.artifact, "Tượng");
          assert.ok(data2.candidates.length > 0);
          assert.equal(data2.candidates[0].name, "Tượng");
        assert.equal(queryCount, 2);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("query retries transient Vectorize failures", async () => {
    const originalFetch = globalThis.fetch;
    const vector = [1, ...Array(1535).fill(0)];
    let queryCount = 0;
    globalThis.fetch = async (url) => String(url).endsWith("/models")
        ? Response.json({ data: [{ id: "google/gemini-embedding-2", architecture: { input_modalities: ["image"] } }] })
        : Response.json({ model: "google/gemini-embedding-2", data: [{ embedding: vector }] });
    try {
        const form = new FormData();
        form.set("file", jpeg(), "capture.jpg");
        const result = await worker.fetch(new Request(origin + "/api/query", { method: "POST", body: form }), {
            ...env,
            DB: { prepare: () => ({ bind: () => ({ first: async () => ({ count: 1 }), all: async () => ({ results: [{ id: "vector-1", name: "Tượng", vector_id: "vector-1" }] }) }) }) },
            VECTORIZE: { query: async () => {
                queryCount++;
                if (queryCount < 3) throw new Error("VECTOR_QUERY_ERROR: Status + 500");
                return { matches: [{ id: "vector-1", score: .95, metadata: { artifact_id: "artifact-1" } }] };
            } },
        });
        assert.equal(result.status, 200);
        assert.equal((await result.json()).artifact, "Tượng");
        assert.equal(queryCount, 3);
    } finally { globalThis.fetch = originalFetch; }
});

test("persistent Vectorize failures return retryable 503", async () => {
    const originalFetch = globalThis.fetch;
    const vector = [1, ...Array(1535).fill(0)];
    globalThis.fetch = async (url) => String(url).endsWith("/models")
        ? Response.json({ data: [{ id: "google/gemini-embedding-2", architecture: { input_modalities: ["image"] } }] })
        : Response.json({ model: "google/gemini-embedding-2", data: [{ embedding: vector }] });
    try {
        const form = new FormData();
        form.set("file", jpeg(), "capture.jpg");
        const result = await worker.fetch(new Request(origin + "/api/query", { method: "POST", body: form }), {
            ...env,
            DB: { prepare: () => ({ bind: () => ({ first: async () => ({ count: 1 }) }) }) },
            VECTORIZE: { query: async () => { throw new Error("VECTOR_QUERY_ERROR: Status + 500"); } },
        });
        assert.equal(result.status, 503);
        assert.match((await result.json()).detail, /thử lại/);
    } finally { globalThis.fetch = originalFetch; }
});

test("admin thumbnail endpoints stay behind Access", async () => {
    const result = await worker.fetch(new Request(origin + "/api/admin/images/image-1"), {
        ...env,
        ALLOW_ADMIN_LOCAL: "false",
    });
    assert.equal(result.status, 403);
});

test("guest cannot override server recognition or thresholds", async () => {
    const originalFetch = globalThis.fetch;
    const vector = [1, ...Array(1535).fill(0)];
    globalThis.fetch = async url => String(url).endsWith('/models')
        ? Response.json({ data: [{ id: 'google/gemini-embedding-2', architecture: { input_modalities: ['image'] } }] })
        : Response.json({ model: 'google/gemini-embedding-2', data: [{ embedding: vector }] });
    try {
        const form = new FormData();
        form.set('file', jpeg(), 'capture.jpg');
        form.set('recognized', 'true');
        form.set('artifact', 'forged');
        form.set('threshold', '0');
        form.set('margin', '0');
        const response = await worker.fetch(new Request(origin + '/api/query', { method: 'POST', body: form }), {
            ...env,
            DB: { prepare: () => ({ bind: () => ({ first: async () => ({ count: 2 }),
                all: async () => ({ results: [
                    { id: 'real', name: 'Real', vector_id: 'real-vector' },
                    { id: 'other', name: 'Other', vector_id: 'other-vector' },
                ] }) }) }) },
            VECTORIZE: { query: async () => ({ matches: [
                { id: 'real-vector', score: .79, metadata: { artifact_id: 'real' } },
                { id: 'other-vector', score: .50, metadata: { artifact_id: 'other' } },
            ] }) },
        });
        assert.equal(response.status, 200);
        const result = await response.json();
        assert.equal(result.recognized, false);
        assert.equal(result.artifact, null);
        assert.equal(result.threshold, .8);
        assert.equal(result.margin, .05);
        assert.equal(result.candidates[0].name, 'Real');
    } finally { globalThis.fetch = originalFetch; }
});
