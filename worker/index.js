const MAX_REQUEST_BYTES = 32 * 1024 * 1024;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const EMBEDDING_DIMENSIONS = 1536;
const MODEL_API = "https://openrouter.ai/api/v1";
let modelCheck;
let accessJwks;

function json(data, status = 200, headers = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "content-type": "application/json; charset=utf-8", ...headers },
    });
}

function error(message, status = 400) {
    return json({ detail: message }, status);
}

function signature(env) {
    return `openrouter|${env.OPENROUTER_MODEL || "google/gemini-embedding-2"}|${env.EMBEDDING_VERSION || "2"}|${env.EMBEDDING_DIMENSIONS || EMBEDDING_DIMENSIONS}|${env.PREPROCESS_VERSION || "rgb-exif-white-jpeg95-max1600-v1"}`;
}

function configuredDimensions(env) {
    const dimensions = Number(env.EMBEDDING_DIMENSIONS || EMBEDDING_DIMENSIONS);
    if (dimensions !== EMBEDDING_DIMENSIONS)
        throw new Error(`EMBEDDING_DIMENSIONS phải là ${EMBEDDING_DIMENSIONS}.`);
    return dimensions;
}

async function prepare(env) {
    if (!env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY chưa được cấu hình.");
    configuredDimensions(env);
    if (modelCheck) return modelCheck;
    modelCheck = fetch(`${MODEL_API}/embeddings/models`, {
        headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}` },
    })
        .then(async (response) => {
            if (!response.ok)
                throw new Error(`OpenRouter HTTP ${response.status}: không kiểm tra được model.`);
            const catalog = await response.json();
            const model = (catalog.data || []).find(
                (item) => item.id === (env.OPENROUTER_MODEL || "google/gemini-embedding-2")
            );
            if (!model || !(model.architecture?.input_modalities || []).includes("image")) {
                throw new Error("Model đã chọn không có image embedding.");
            }
            return {
                aliases: new Set(
                    [model.id, model.canonical_slug, model.id?.split("/").pop()].filter(Boolean)
                ),
            };
        })
        .catch((error) => {
            modelCheck = null;
            throw error;
        });
    return modelCheck;
}

function base64(bytes) {
    let text = "";
    const values = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < values.length; i += 0x8000)
        text += String.fromCharCode(...values.subarray(i, i + 0x8000));
    return btoa(text);
}

function dataUrl(buffer) {
    return `data:image/jpeg;base64,${base64(buffer)}`;
}

function normalize(values) {
    if (
        !Array.isArray(values) ||
        values.length !== EMBEDDING_DIMENSIONS ||
        values.some((value) => !Number.isFinite(value))
    ) {
        throw new Error(`Model phải trả vector ${EMBEDDING_DIMENSIONS} chiều.`);
    }
    let norm = 0;
    for (const value of values) norm += value * value;
    norm = Math.sqrt(norm);
    if (!Number.isFinite(norm) || norm <= 1e-12) throw new Error("Model trả vector rỗng.");
    return values.map((value) => value / norm);
}

async function embed(buffer, env) {
    const check = await prepare(env);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    try {
        const response = await fetch(`${MODEL_API}/embeddings`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
                "Content-Type": "application/json",
                "X-Title": "Museum Embedding Lab",
            },
            body: JSON.stringify({
                model: env.OPENROUTER_MODEL || "google/gemini-embedding-2",
                dimensions: EMBEDDING_DIMENSIONS,
                encoding_format: "float",
                input: [{ content: [{ type: "image_url", image_url: { url: dataUrl(buffer) } }] }],
            }),
            signal: controller.signal,
        });
        if (!response.ok) {
            const descriptions = {
                400: "Model từ chối ảnh hoặc tham số.",
                401: "API key OpenRouter không hợp lệ.",
                402: "OpenRouter không đủ số dư.",
                403: "Tài khoản không có quyền dùng model.",
                429: "Vượt giới hạn lượt gọi.",
            };
            throw new Error(
                `OpenRouter HTTP ${response.status}: ${descriptions[response.status] || "Provider gặp lỗi."}`
            );
        }
        const result = await response.json();
        if (!check.aliases.has(result.model)) throw new Error("Provider trả model khác cấu hình.");
        const vector = normalize(result.data?.[0]?.embedding);
        return { vector, usage: result.usage || {} };
    } catch (error) {
        if (error.name === "AbortError") throw new Error("Model phản hồi quá chậm (90 giây).");
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

async function digest(buffer) {
    const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
    return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function validName(name) {
    return (
        typeof name === "string" &&
        name.trim().length > 0 &&
        name.trim().length <= 120 &&
        !/[\u0000-\u001f\u007f]/.test(name)
    );
}

function nameKey(name) {
    return name.trim().normalize("NFKC").toLocaleLowerCase("vi");
}

function validJpeg(buffer) {
    const bytes = new Uint8Array(buffer);
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function fileError(file) {
    if (!file || typeof file.arrayBuffer !== "function") return "Hãy chọn ảnh JPEG.";
    if (!file.size || file.size > MAX_IMAGE_BYTES) return "Ảnh phải là JPEG và không vượt 15 MB.";
    return null;
}

async function accessAllowed(request, env) {
    if (env.ALLOW_ADMIN_LOCAL === "true" && ["localhost", "127.0.0.1"].includes(new URL(request.url).hostname)) return true;
    const token = request.headers.get("Cf-Access-Jwt-Assertion");
    const domain = String(env.ACCESS_TEAM_DOMAIN || "")
        .replace(/^https?:\/\//, "")
        .replace(/\/$/, "");
    const audience = env.ACCESS_AUD;
    if (!token || !domain || !audience) return false;
    try {
        const { jwtVerify, createRemoteJWKSet } = await import("jose");
        accessJwks ||= createRemoteJWKSet(new URL(`https://${domain}/cdn-cgi/access/certs`));
        await jwtVerify(token, accessJwks, { issuer: `https://${domain}`, audience });
        return true;
    } catch {
        return false;
    }
}

async function requireAdmin(request, env) {
    return (await accessAllowed(request, env))
        ? null
        : error("Khu vực quản trị yêu cầu Cloudflare Access.", 403);
}

async function listArtifacts(env) {
    const result = await env.DB.prepare(
        `
    SELECT a.id, a.name, a.created_at, COUNT(i.id) AS image_count,
      SUM(CASE WHEN i.status = 'ready' THEN 1 ELSE 0 END) AS ready_count,
      SUM(CASE WHEN i.status = 'failed' THEN 1 ELSE 0 END) AS failed_count
    FROM artifacts a LEFT JOIN reference_images i ON i.artifact_id = a.id
    GROUP BY a.id ORDER BY a.created_at DESC, a.id DESC
  `
    ).all();
    const failed = await env.DB.prepare("SELECT id,artifact_id FROM reference_images WHERE status='failed'").all();
    const failedByArtifact = new Map();
    for (const row of failed.results || []) {
        const ids = failedByArtifact.get(row.artifact_id) || [];
        ids.push(row.id);
        failedByArtifact.set(row.artifact_id, ids);
    }
    return (result.results || []).map(row => ({ ...row, failed_image_ids: failedByArtifact.get(row.id) || [] }));
}

async function queryImage(request, env) {
    const form = await request.formData();
    const file = form.get("file");
    const invalid = fileError(file);
    if (invalid) return error(invalid);
    const buffer = await file.arrayBuffer();
    if (!validJpeg(buffer)) return error("Ảnh không hợp lệ. Hãy dùng ảnh JPEG.");
    const ready = await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM reference_images WHERE status='ready' AND signature=?"
    ).bind(signature(env)).first();
    if (!Number(ready?.count)) return error("Chưa có vật thể sẵn sàng nhận diện.", 503);
    const embedded = await embed(buffer, env);
    let matches = { matches: [] };
    for (let attempt = 0; attempt < 4; attempt++) {
        try {
            matches = await env.VECTORIZE.query(embedded.vector, { topK: 50, returnMetadata: "all" });
            if (matches.matches?.length || attempt === 3) break;
        } catch (caughtError) {
            if (attempt === 3 || !String(caughtError?.message).includes("VECTOR_QUERY_ERROR: Status + 500")) throw caughtError;
        }
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
    const scores = new Map();
    for (const match of matches.matches || []) {
        if (typeof match.metadata?.artifact_id !== "string" || !Number.isFinite(match.score)) continue;
        scores.set(match.id, match.score);
    }
    const ids = [...scores.keys()];
    if (!ids.length) return json({ recognized: false, artifact: null });
    const placeholders = ids.map(() => "?").join(",");
    const rows = await env.DB.prepare(
        `SELECT a.id,a.name,i.vector_id FROM reference_images i JOIN artifacts a ON a.id=i.artifact_id WHERE i.vector_id IN (${placeholders}) AND i.status='ready' AND i.signature=?`
    )
        .bind(...ids, signature(env))
        .all();
    const best = new Map();
    for (const row of rows.results || []) best.set(row.id, { name: row.name, score: Math.max(scores.get(row.vector_id), best.get(row.id)?.score ?? -1) });
    const ranked = [...best.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    if (!ranked.length) return json({ recognized: false, artifact: null });
    const threshold = Number(env.RECOGNITION_THRESHOLD || "0.8");
    const margin = Number(env.RECOGNITION_MARGIN || "0.05");
    if (!Number.isFinite(threshold) || threshold < -1 || threshold > 1 || !Number.isFinite(margin) || margin < 0 || margin > 2) throw new Error("Invalid recognition configuration");
    const recognized =
        ranked[0].score >= threshold &&
        (ranked.length < 2 || ranked[0].score - ranked[1].score >= margin);
    const candidates = ranked.slice(0, 5).map((item, index) => ({
        rank: index + 1,
        name: item.name,
        score: Number(item.score.toFixed(4)),
        match_percentage: Math.max(0, Math.min(100, Math.round(item.score * 100))),
    }));
    const bestScore = ranked[0] ? Number(ranked[0].score.toFixed(4)) : null;
    const marginDiff = ranked.length >= 2 ? Number((ranked[0].score - ranked[1].score).toFixed(4)) : null;
    return json({
        recognized,
        artifact: recognized ? ranked[0].name : null,
        best_score: bestScore,
        margin_score: marginDiff,
        threshold,
        margin,
        dimensions: configuredDimensions(env),
        candidates,
    });
}

async function createArtifact(request, env) {
    const body = await request.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!validName(name)) return error("Tên vật thể phải có 1–120 ký tự hợp lệ.");
    const id = crypto.randomUUID();
    try {
        await env.DB.prepare("INSERT INTO artifacts (id,name,name_key) VALUES (?,?,?)")
            .bind(id, name, nameKey(name))
            .run();
    } catch (caughtError) {
        if (String(caughtError.message).includes("UNIQUE")) return error("Vật thể này đã tồn tại.", 409);
        throw caughtError;
    }
    return json({ id, name, image_count: 0, ready_count: 0, failed_count: 0 }, 201);
}

async function addImage(request, env, artifactId) {
    const artifact = await env.DB.prepare("SELECT id,name FROM artifacts WHERE id=?")
        .bind(artifactId)
        .first();
    if (!artifact) return error("Không tìm thấy vật thể.", 404);
    const form = await request.formData();
    const file = form.get("file");
    const invalid = fileError(file);
    if (invalid) return error(invalid);
    const buffer = await file.arrayBuffer();
    if (!validJpeg(buffer)) return error("Ảnh không hợp lệ. Hãy dùng ảnh JPEG.");
    const id = crypto.randomUUID();
    const vectorId = id;
    const r2Key = `references/${artifactId}/${id}.jpg`;
    const digestValue = await digest(buffer);
    const filename =
        typeof file.name === "string" && file.name ? file.name.slice(0, 255) : `${id}.jpg`;
    const duplicate = await env.DB.prepare("SELECT id FROM reference_images WHERE digest=?").bind(digestValue).first();
    if (duplicate) return error("Ảnh này đã được import; hãy thử lại ảnh lỗi trong danh sách.", 409);
    await env.DB.prepare(
            `INSERT INTO reference_images (id,artifact_id,filename,digest,r2_key,vector_id,status,error,signature) VALUES (?,?,?,?,?,?, 'pending',NULL,?)`
        )
            .bind(id, artifactId, filename, digestValue, r2Key, vectorId, signature(env))
            .run();
    try {
        await env.IMAGES.put(r2Key, buffer, { httpMetadata: { contentType: "image/jpeg" } });
        const embedded = await embed(buffer, env);
        await env.VECTORIZE.upsert([
            { id: vectorId, values: embedded.vector, metadata: { artifact_id: artifactId } },
        ]);
        await env.DB.prepare("UPDATE reference_images SET status='ready', error=NULL WHERE id=?")
            .bind(id)
            .run();
        return json({ id, artifact_id: artifactId, filename, status: "ready" }, 201);
    } catch (caughtError) {
        await env.DB.prepare("UPDATE reference_images SET status='failed', error=? WHERE id=?")
            .bind(String(caughtError.message || "Import thất bại").slice(0, 500), id)
            .run()
            .catch(() => {});
        await env.VECTORIZE.deleteByIds([vectorId]).catch(() => {});
        return errorResponse(caughtError);
    }
}

function errorResponse(caughtError) {
    const message = String(caughtError?.message || "Import thất bại.");
    const status = message.includes("VECTOR_QUERY_ERROR")
        ? 503
        : message.startsWith("OpenRouter HTTP 429")
        ? 429
        : message.includes("quá chậm")
          ? 504
          : 502;
    return error(message.includes("VECTOR_QUERY_ERROR") ? "Vector search tạm thời không khả dụng. Hãy thử lại sau." : message, status);
}

async function retryImage(env, imageId) {
    const image = await env.DB.prepare("SELECT artifact_id,r2_key,vector_id,status,signature FROM reference_images WHERE id=?").bind(imageId).first();
    if (!image || image.status !== "failed") return error("Không tìm thấy ảnh lỗi.", 404);
    if (image.signature !== signature(env)) return error("Ảnh thuộc phiên bản model cũ; cần import lại.", 409);
    const object = await env.IMAGES.get(image.r2_key);
    if (!object) return error("Ảnh nguồn không còn trong R2; cần import lại.", 409);
    await env.DB.prepare("UPDATE reference_images SET status='pending',error=NULL WHERE id=?").bind(imageId).run();
    try {
        const embedded = await embed(await object.arrayBuffer(), env);
        await env.VECTORIZE.upsert([{ id: image.vector_id, values: embedded.vector, metadata: { artifact_id: image.artifact_id } }]);
        await env.DB.prepare("UPDATE reference_images SET status='ready',error=NULL WHERE id=?").bind(imageId).run();
        return json({ id: imageId, status: "ready" });
    } catch (caughtError) {
        await env.DB.prepare("UPDATE reference_images SET status='failed',error=? WHERE id=?").bind(String(caughtError.message).slice(0, 500), imageId).run();
        await env.VECTORIZE.deleteByIds([image.vector_id]).catch(() => {});
        return errorResponse(caughtError);
    }
}

async function deleteArtifact(env, artifactId) {
    const rows = await env.DB.prepare(
        "SELECT vector_id,r2_key FROM reference_images WHERE artifact_id=?"
    )
        .bind(artifactId)
        .all();
    const items = rows.results || [];
    if (
        !items.length &&
        !(await env.DB.prepare("SELECT id FROM artifacts WHERE id=?").bind(artifactId).first())
    )
        return error("Không tìm thấy vật thể.", 404);
    if (items.length) await env.VECTORIZE.deleteByIds(items.map((item) => item.vector_id));
    for (const item of items) await env.IMAGES.delete(item.r2_key);
    await env.DB.prepare("DELETE FROM reference_images WHERE artifact_id=?").bind(artifactId).run();
    await env.DB.prepare("DELETE FROM artifacts WHERE id=?").bind(artifactId).run();
    return json({ ok: true });
}

async function listImages(env, artifactId, request) {
    const artifact = await env.DB.prepare("SELECT id FROM artifacts WHERE id=?").bind(artifactId).first();
    if (!artifact) return error("Không tìm thấy vật thể.", 404);
    const result = await env.DB.prepare("SELECT id,artifact_id,filename,status,error,created_at FROM reference_images WHERE artifact_id=? ORDER BY created_at DESC,id DESC").bind(artifactId).all();
    const base = new URL(request.url).origin;
    return json({ images: (result.results || []).map(image => ({ ...image, thumbnail_url: `${base}/api/admin/images/${image.id}` })) });
}

async function readImage(env, imageId) {
    const image = await env.DB.prepare("SELECT r2_key,filename,status FROM reference_images WHERE id=?").bind(imageId).first();
    if (!image) return error("Không tìm thấy ảnh.", 404);
    const object = await env.IMAGES.get(image.r2_key);
    if (!object) return error("Ảnh không còn trong R2.", 404);
    return new Response(object.body, { headers: { "content-type": object.httpMetadata?.contentType || "image/jpeg", "content-disposition": `inline; filename="${image.filename.replace(/[^\w.-]/g, "_")}"` } });
}

async function deleteImage(env, imageId) {
    const image = await env.DB.prepare("SELECT vector_id,r2_key FROM reference_images WHERE id=?").bind(imageId).first();
    if (!image) return error("Không tìm thấy ảnh.", 404);
    await env.VECTORIZE.deleteByIds([image.vector_id]);
    await env.IMAGES.delete(image.r2_key);
    await env.DB.prepare("DELETE FROM reference_images WHERE id=?").bind(imageId).run();
    return json({ ok: true });
}

function security(response) {
    const headers = new Headers(response.headers);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("X-Frame-Options", "DENY");
    headers.set("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
    headers.set("Cache-Control", "no-store");
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}

async function asset(request, env, pathname) {
    return security(await env.ASSETS.fetch(request));
}

export default {
    async fetch(request, env) {
        try {
            const url = new URL(request.url);
            const path = url.pathname;
            const method = request.method;
            const contentLength = Number(request.headers.get("content-length") || 0);
            if (contentLength > MAX_REQUEST_BYTES)
                return security(error("Tổng upload vượt 32 MB.", 413));
            if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
                const origin = request.headers.get("Origin");
                if (origin && origin !== url.origin)
                    return security(error("Origin không được phép.", 403));
            }
            if (method === "OPTIONS") return security(new Response(null, { status: 204 }));
            if (path === "/healthz")
                return security(json({ status: "ok", service: "cloudflare-worker" }));
            if (path === "/api/status" && method === "GET") {
                const row = await env.DB.prepare(
                    "SELECT COUNT(*) AS count FROM reference_images WHERE status='ready' AND signature=?"
                ).bind(signature(env)).first();
                return security(
                    json({ ready: Number(row?.count) > 0, dimensions: configuredDimensions(env) })
                );
            }
            if (path === "/api/query" && method === "POST")
                return security(await queryImage(request, env));
            if (path.startsWith("/api/admin/")) {
                const denied = await requireAdmin(request, env);
                if (denied) return security(denied);
                if (path === "/api/admin/artifacts" && method === "GET")
                    return security(json({ artifacts: await listArtifacts(env) }));
                if (path === "/api/admin/artifacts" && method === "POST")
                    return security(await createArtifact(request, env));
                const artifactImages = path.match(/^\/api\/admin\/artifacts\/([^/]+)\/images$/);
                if (artifactImages && method === "GET") return security(await listImages(env, artifactImages[1], request));
                const retry = path.match(/^\/api\/admin\/images\/([^/]+)\/retry$/);
                if (retry && method === "POST") return security(await retryImage(env, retry[1]));
                const image = path.match(/^\/api\/admin\/images\/([^/]+)$/);
                if (image && method === "GET") return security(await readImage(env, image[1]));
                if (image && method === "DELETE") return security(await deleteImage(env, image[1]));
                const match = path.match(/^\/api\/admin\/artifacts\/([^/]+)(?:\/images)?$/);
                if (match && path.endsWith("/images") && method === "POST")
                    return security(await addImage(request, env, match[1]));
                if (match && method === "DELETE")
                    return security(await deleteArtifact(env, match[1]));
                return security(error("Không tìm thấy API.", 404));
            }
            if (path === "/admin" || path.startsWith("/admin/")) {
                const denied = await requireAdmin(request, env);
                if (denied) return security(denied);
            }
            if (path.startsWith("/api/")) return security(error("Không tìm thấy API.", 404));
            return asset(request, env, path);
        } catch (error) {
            console.error(error);
            return security(errorResponse(error));
        }
    },
};
