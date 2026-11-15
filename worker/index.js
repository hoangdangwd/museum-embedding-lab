import { usageStats, cleanup } from './limits.js';
import { embed, normalize, signature, pipelineConfig, vectorScope, sha256 as digest, PipelineError } from './pipeline.js';
import { integrationApi } from './integration.js';
import { classifyScene, decideRecognition, DECISION_VERSION, HARD_NEGATIVE_TARGET, HARD_NEGATIVE_TARGETS, isHardNegativeTarget } from './recognition-policy.js';
import { approvedCatalogReference, catalogReleaseStatus, exactReleaseReferenceScore } from './catalog-release.js';
import { jevConfig, jevStatus, cleanupJev } from './jev-budget.js';
import { applyJev } from './jev.js';
import { provisionJevReference } from './jev-normalizer.js';

const MAX_REQUEST_BYTES = 18 * 1024 * 1024;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
let accessJwks;

function json(data, status = 200, headers = {}) {
    return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
}
function error(message, status = 400) { return json({ detail: message }, status); }
function configuredDimensions(env) { return pipelineConfig(env).dimensions; }

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

async function readUpload(file) {
    const invalid = fileError(file);
    const buffer = invalid ? null : await file.arrayBuffer();
    if (invalid || !validJpeg(buffer)) {
        const err = new Error(invalid || 'Ảnh không hợp lệ. Hãy dùng ảnh JPEG.');
        err.status = 400;
        throw err;
    }
    return buffer;
}

async function accessAllowed(request, env) {
    if (env.ALLOW_ADMIN_PUBLIC === "true") return true;
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
    SELECT a.id, a.name, a.external_object_id, a.created_at, COUNT(i.id) AS image_count,
      SUM(CASE WHEN i.status = 'ready' AND i.signature=? THEN 1 ELSE 0 END) AS ready_count,
      SUM(CASE WHEN i.signature<>? THEN 1 ELSE 0 END) AS outdated_count,
      SUM(CASE WHEN i.status = 'failed' THEN 1 ELSE 0 END) AS failed_count
    FROM artifacts a LEFT JOIN reference_images i ON i.artifact_id = a.id
    GROUP BY a.id ORDER BY a.created_at DESC, a.id DESC
  `
    ).bind(signature(env), signature(env)).all();
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
    return json(await recognize(await readUpload(form.get('file')), env));
}

// Retry only Vectorize queries; description and embedding must not be charged again.
async function queryVectors(env, vector, options, retryEmpty = true) {
    for (let attempt = 0; attempt < 4; attempt++) {
        try {
            const result = await env.VECTORIZE.query(vector, options);
            if (!retryEmpty || result.matches?.length || attempt === 3) return result;
        } catch (caughtError) {
            const message = String(caughtError?.message || '');
            if (!message.includes('VECTOR_QUERY_ERROR')) throw caughtError;
            if (attempt === 3 || !message.includes('VECTOR_QUERY_ERROR: Status + 500')) {
                throw new PipelineError('VECTOR_QUERY_ERROR', 'Vector search tạm thời không khả dụng. Hãy thử lại sau.', 503);
            }
        }
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
}

export async function recognize(buffer, env) {
    const threshold = Number(env.RECOGNITION_THRESHOLD || '0.8');
    const margin = Number(env.RECOGNITION_MARGIN || '0.05');
    const hardNegativeGap = Number(env.RECOGNITION_HARD_NEGATIVE_GAP ?? '0');
    if (!Number.isFinite(threshold) || threshold < -1 || threshold > 1 || !Number.isFinite(margin) || margin < 0 || margin > 2 || !Number.isFinite(hardNegativeGap) || hardNegativeGap < -2 || hardNegativeGap > 2) throw new PipelineError('INVALID_CONFIGURATION', 'Ngưỡng nhận diện không hợp lệ.', 503);
    const ready = await env.DB.prepare(
        "SELECT COUNT(DISTINCT artifact_id) AS count FROM reference_images WHERE status='ready' AND signature=?"
    ).bind(signature(env)).first();
    if (Number(ready?.count) < 2) throw new PipelineError('CATALOG_NOT_READY', 'Cần ít nhất hai hiện vật sẵn sàng cùng phiên bản để nhận diện.', 409);
    const scope = await vectorScope(env);
    const embedded = await embed(buffer, env, { semanticGuard: classifyScene });
    if (embedded.semantic_guard?.reject) return {
      recognized: false, status: 'uncertain', reason: embedded.semantic_guard.scene === 'multi_artifact_scene' ? 'multiple_artifacts' : 'no_clear_artifact',
      artifact_id: null, artifact: null, best_score: null, margin_score: null, threshold, margin,
      decision_version: DECISION_VERSION, decision_source: null,
      semantic_guard: embedded.semantic_guard,
      hard_negative_triggered: false, hard_negative_score: null, hard_negative_gap: null,
      dimensions: configuredDimensions(env), pipeline_version: pipelineConfig(env).mode, pipeline_signature: signature(env),
      description: embedded.description, timings: embedded.timings, candidates: [],
    };
    const matches = await queryVectors(env, embedded.vector, { ...scope, topK: 50, returnMetadata: "all" });
    async function rankMatches(input) {
      const scores = new Map();
      for (const match of input) {
        if (typeof match.metadata?.artifact_id !== "string" || !Number.isFinite(match.score)) continue;
        scores.set(match.id, match.score);
      }
      const ids = [...scores.keys()];
      if (!ids.length) return [];
      const placeholders = ids.map(() => "?").join(",");
      const rows = await env.DB.prepare(
        `SELECT a.id,a.name,a.external_object_id,i.vector_id,i.digest,i.vector_json FROM reference_images i JOIN artifacts a ON a.id=i.artifact_id WHERE i.vector_id IN (${placeholders}) AND i.status='ready' AND i.signature=?`
    )
        .bind(...ids, signature(env))
        .all();
      const best = new Map();
      for (const row of rows.results || []) {
        const score = exactReleaseReferenceScore(row.digest, row.external_object_id, row.vector_json, embedded.vector, env) ?? scores.get(row.vector_id);
        const previous = best.get(row.id);
        if (Number.isFinite(score) && (!previous || score > previous.score || (score === previous.score && row.vector_id.localeCompare(previous.reference.vector_id) < 0))) best.set(row.id, { id: row.id, name: row.name, external_object_id: row.external_object_id, score, reference: { vector_id: row.vector_id, digest: row.digest } });
      }
      return [...best.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    }
    let ranked = await rankMatches(matches.matches || []);
    // A large number of views of one object must never remove the runner-up.
    if (ranked.length === 1) {
      const other = await queryVectors(env, embedded.vector, { ...scope, topK: 50, returnMetadata: 'all', filter: { artifact_id: { $ne: ranked[0].id } } }, false);
      const alternatives = await rankMatches(other.matches || []);
      ranked = [...ranked, ...alternatives.filter(item => item.id !== ranked[0].id)].sort((a,b) => b.score-a.score);
    }
    const baseRecognized =
        ranked.length >= 2 &&
        ranked[0].score >= threshold &&
        ranked[0].score - ranked[1].score >= margin;
    let hardNegativeScore = null;
    let hardNegativeTriggered = false;
    // Reject-only hard-negative lookup is scoped to explicitly approved targets.
    // Internal UUIDs must never be compared to dataset IDs.
    if (isHardNegativeTarget(ranked[0]?.external_object_id)) {
      const hardRows = await env.DB.prepare(
        `SELECT vector FROM recognition_hard_negatives
         WHERE target_artifact_id=? AND signature=? AND enabled=1`
      ).bind(ranked[0].id, signature(env)).all();
      for (const row of hardRows.results || []) {
        try {
          const vector = normalize(JSON.parse(row.vector));
          const score = embedded.vector.reduce((sum, value, index) => sum + value * vector[index], 0);
          if (Number.isFinite(score)) hardNegativeScore = Math.max(hardNegativeScore ?? -1, score);
        } catch {
          throw new PipelineError('HARD_NEGATIVE_INVALID', 'Dữ liệu đối chiếu hard-negative không hợp lệ; chưa thể xác nhận.', 503);
        }
      }
      hardNegativeTriggered = baseRecognized && hardNegativeScore !== null && ranked[0].score - hardNegativeScore < hardNegativeGap;
    }
    const decision = decideRecognition({ ranked, threshold, margin, hardNegativeTriggered });
    const recognized = decision.recognized;
    const candidates = ranked.slice(0, 5).map((item, index) => ({
        rank: index + 1,
        id: item.id,
        name: item.name,
        score: Number(item.score.toFixed(4)),
    }));
    const bestScore = ranked[0] ? Number(ranked[0].score.toFixed(4)) : null;
    const marginDiff = ranked.length >= 2 ? Number((ranked[0].score - ranked[1].score).toFixed(4)) : null;
    const baselineResult = {
        recognized,
        status: decision.status,
        reason: decision.reason,
        decision_version: DECISION_VERSION,
        decision_source: decision.source,
        semantic_guard: embedded.semantic_guard,
        artifact_id: decision.artifact?.id || null,
        artifact: decision.artifact?.name || null,
        best_score: bestScore,
        margin_score: marginDiff,
        threshold,
        margin,
        hard_negative_triggered: hardNegativeTriggered,
        hard_negative_score: hardNegativeScore === null ? null : Number(hardNegativeScore.toFixed(4)),
        hard_negative_gap: hardNegativeScore === null || !ranked[0] ? null : Number((ranked[0].score - hardNegativeScore).toFixed(4)),
        dimensions: configuredDimensions(env),
        pipeline_version: pipelineConfig(env).mode,
        pipeline_signature: signature(env),
        description: embedded.description,
        timings: embedded.timings,
        candidates,
    };
    return await applyJev(baselineResult, buffer, env, ranked[0]);
}

function validHardNegativeKey(value) {
    return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
}

async function listHardNegatives(env) {
    const result = await env.DB.prepare(
        `SELECT h.group_key, h.signature, a.external_object_id AS target_external_object_id,
                COUNT(*) AS vector_count, MAX(h.created_at) AS updated_at
         FROM recognition_hard_negatives h
         JOIN artifacts a ON a.id=h.target_artifact_id
         WHERE h.enabled=1
         GROUP BY h.group_key,h.signature,a.external_object_id
         ORDER BY h.group_key`
    ).all();
    return json({ hard_negatives: result.results || [] });
}

async function replaceHardNegatives(request, env, groupKey) {
    if (!validHardNegativeKey(groupKey)) return error('Nhóm hard negative không hợp lệ.');
    const body = await request.json().catch(() => null);
    const targetExternalId = body?.target_external_object_id;
    const vectors = body?.vectors;
    if (body?.signature !== signature(env)) return error('Hard negative không cùng pipeline signature.', 409);
    if (!validExternalId(targetExternalId) || !Array.isArray(vectors) || vectors.length < 1 || vectors.length > 64) return error('Hard negative phải có artifact đích và 1–64 vector hợp lệ.');
    const target = await env.DB.prepare('SELECT id FROM artifacts WHERE external_object_id=?').bind(targetExternalId).first();
    if (!target) return error('Không tìm thấy artifact đích theo external_object_id.', 404);
    if (!isHardNegativeTarget(targetExternalId)) return error('Hard negative chưa được duyệt cho artifact đích này.');
    const seen = new Set();
    const normalized = [];
    for (const item of vectors) {
      if (!validHardNegativeKey(item?.id) || seen.has(item.id) || typeof item.digest !== 'string' || !/^[a-f0-9]{64}$/.test(item.digest)) return error('Hard negative có id/digest không hợp lệ.');
      seen.add(item.id);
      try { normalized.push({ id: item.id, digest: item.digest, vector: normalize(item.vector) }); }
      catch { return error('Hard negative có vector không hợp lệ.'); }
    }
    const currentSignature = signature(env);
    const statements = [env.DB.prepare('DELETE FROM recognition_hard_negatives WHERE target_artifact_id=? AND signature=? AND group_key=?').bind(target.id,currentSignature,groupKey)];
    for (const item of normalized) statements.push(env.DB.prepare(
      `INSERT INTO recognition_hard_negatives(id,target_artifact_id,signature,group_key,digest,vector,enabled)
       VALUES(?,?,?,?,?,?,1)`
    ).bind(item.id,target.id,currentSignature,groupKey,item.digest,JSON.stringify(item.vector)));
    statements.push(env.DB.prepare('UPDATE catalog_state SET revision=revision+1 WHERE id=1'));
    await env.DB.batch(statements);
    return json({ group_key: groupKey, target_external_object_id: targetExternalId, vector_count: normalized.length, signature: currentSignature });
}

async function createArtifact(request, env) {
    const body = await request.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!validName(name)) return error("Tên vật thể phải có 1–120 ký tự hợp lệ.");
    const externalId = body.external_object_id ?? null;
    if (externalId !== null && !validExternalId(externalId)) return error('external_object_id không hợp lệ.');
    const id = crypto.randomUUID();
    try {
        await env.DB.prepare("INSERT INTO artifacts (id,name,name_key,external_object_id) VALUES (?,?,?,?)")
            .bind(id, name, nameKey(name), externalId)
            .run();
    } catch (caughtError) {
        if (String(caughtError.message).includes("UNIQUE")) return error("Vật thể này đã tồn tại.", 409);
        throw caughtError;
    }
    return json({ id, name, external_object_id: externalId, image_count: 0, ready_count: 0, failed_count: 0 }, 201);
}

function validExternalId(value) { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value); }

async function mapArtifact(request, env, id) {
    const body = await request.json().catch(() => null);
    if (!validExternalId(body?.external_object_id)) return error('external_object_id không hợp lệ.');
    try {
        const updated = await env.DB.prepare('UPDATE artifacts SET external_object_id=? WHERE id=?').bind(body.external_object_id,id).run();
        return updated.meta?.changes ? json({ id, external_object_id: body.external_object_id }) : error('Không tìm thấy hiện vật.',404);
    } catch (caught) {
        if (String(caught.message).includes('UNIQUE')) return error('external_object_id đã được dùng.',409);
        throw caught;
    }
}

async function addImage(request, env, artifactId) {
    const artifact = await env.DB.prepare("SELECT id,name,external_object_id FROM artifacts WHERE id=?")
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
    // Any supplied release field is fail-closed. Never fall back to a paid call.
    // Values/descriptions come from trusted build-time data, not client metadata.
    const approved = form.has('catalog_release')
        ? approvedCatalogReference(form.get('catalog_release'), digestValue, artifact.external_object_id, env)
        : null;
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
        const embedded = approved || await embed(buffer, env, { onDescription: (text, version) => env.DB.prepare('UPDATE reference_images SET description=?,description_signature=? WHERE id=?').bind(text, version, id).run() });
        if (approved) await env.DB.prepare('UPDATE reference_images SET description=?,description_signature=? WHERE id=?').bind(approved.description, approved.descriptionSignature, id).run();
        await env.DB.prepare('UPDATE reference_images SET vector_json=? WHERE id=?').bind(JSON.stringify(embedded.vector),id).run();
        await env.VECTORIZE.upsert([
            { id: vectorId, ...(await vectorScope(env)), values: embedded.vector, metadata: { artifact_id: artifactId } },
        ]);
        await env.DB.prepare("UPDATE reference_images SET status='ready', error=NULL WHERE id=?")
            .bind(id)
            .run();
        return json({ id, artifact_id: artifactId, filename, status: "ready", ...(approved ? { catalog_release: approved.releaseId, review_id: approved.reviewId, provider_calls: 0 } : {}) }, 201);
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
    const vectorError = message.includes("VECTOR_QUERY_ERROR");
    const status = vectorError ? 503 : caughtError.status || (message.startsWith("OpenRouter HTTP 429")
        ? 429
        : message.includes("quá chậm")
          ? 504
          : 502);
    return error(vectorError ? "Vector search tạm thời không khả dụng. Hãy thử lại sau." : message, status);
}

async function retryImage(env, imageId, rebuild = false, reprocess = false) {
    const image = await env.DB.prepare("SELECT artifact_id,r2_key,vector_id,status,signature,vector_json,description,description_signature FROM reference_images WHERE id=?").bind(imageId).first();
    if (!image || (!rebuild && !reprocess && image.status !== 'failed')) return error("Không tìm thấy ảnh cần xử lý.", 404);
    if (image.signature !== signature(env) && !reprocess) return error("Ảnh thuộc pipeline cũ; dùng Tạo lại mô tả và vector.", 409);
    const object = await env.IMAGES.get(image.r2_key);
    if (!object) return error("Ảnh nguồn không còn trong R2; cần import lại.", 409);
    const claim = await env.DB.prepare("UPDATE reference_images SET status='pending',error=NULL WHERE id=? AND status<>'pending'").bind(imageId).run();
    if (!claim.meta?.changes) return error("Ảnh đang được xử lý.", 409);
    try {
        const current = image.signature === signature(env);
        const vector = current && image.vector_json ? normalize(JSON.parse(image.vector_json)) : (await embed(await object.arrayBuffer(), env, {
            cachedDescription: { text: image.description, signature: image.description_signature },
            onDescription: (text, version) => env.DB.prepare('UPDATE reference_images SET description=?,description_signature=? WHERE id=?').bind(text,version,imageId).run(),
        })).vector;
        await env.DB.prepare('UPDATE reference_images SET vector_json=?,signature=? WHERE id=?').bind(JSON.stringify(vector),signature(env),imageId).run();
        await env.VECTORIZE.upsert([{ id: image.vector_id, ...(await vectorScope(env)), values: vector, metadata: { artifact_id: image.artifact_id } }]);
        await env.DB.prepare("UPDATE reference_images SET status='ready',error=NULL WHERE id=?").bind(imageId).run();
        return json({ id: imageId, status: "ready" });
    } catch (caughtError) {
        await env.DB.prepare("UPDATE reference_images SET status='failed',error=? WHERE id=?").bind(String(caughtError.message).slice(0,500),imageId).run();
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
    const result = await env.DB.prepare("SELECT id,artifact_id,filename,status,error,created_at,signature,description FROM reference_images WHERE artifact_id=? ORDER BY created_at DESC,id DESC").bind(artifactId).all();
    const base = new URL(request.url).origin;
    return json({ images: (result.results || []).map(image => ({ ...image, needs_reprocess: image.signature !== signature(env), thumbnail_url: `${base}/api/admin/images/${image.id}` })) });
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
    async scheduled(event, env, ctx) { ctx.waitUntil(Promise.all([cleanup(env), cleanupJev(env)])); },
    async fetch(request, env) {
        try {
            const url = new URL(request.url);
            const path = url.pathname;
            const method = request.method;
            if (path === '/api/v1' || path.startsWith('/api/v1/')) return security(await integrationApi(request, env, recognize));
            const contentLength = Number(request.headers.get("content-length") || 0);
            if (contentLength > MAX_REQUEST_BYTES)
                return security(error("Tổng upload vượt 18 MB.", 413));
            if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
                const origin = request.headers.get("Origin");
                if (origin && origin !== url.origin)
                    return security(error("Origin không được phép.", 403));
                if (request.headers.get('Sec-Fetch-Site') === 'cross-site') return security(error('Origin không được phép.',403));
            }
            if (method === "OPTIONS") return security(new Response(null, { status: 204 }));
            if (path === "/healthz")
                return security(json({ status: "ok", service: "cloudflare-worker", jev: jevConfig(env).mode }));
            if (path === "/api/status" && method === "GET") {
                const row = await env.DB.prepare(
                    "SELECT COUNT(*) AS count FROM reference_images WHERE status='ready' AND signature=?"
                ).bind(signature(env)).first();
                return security(
                    json({ ready: Number(row?.count) > 0, dimensions: configuredDimensions(env) })
                );
            }
            if (path === '/api/game' || path.startsWith('/api/game/') || path.startsWith('/api/met-lab/'))
                return security(error('Chức năng này đã được gỡ bỏ.', 410));
            if (path === '/api/query' && method === 'POST') {
                const denied = await requireAdmin(request,env);
                return security(denied || await queryImage(request,env));
            }
            if (path.startsWith("/api/admin/")) {
                const denied = await requireAdmin(request, env);
                if (denied) return security(denied);
                if (path === '/api/admin/usage' && method === 'GET') return security(await usageStats(env));
                if (path === '/api/admin/jev' && method === 'GET') return security(json(await jevStatus(env)));
                const jevReference = path.match(/^\/api\/admin\/jev\/references\/([a-f0-9]{64})$/);
                if (jevReference && ['GET','PUT'].includes(method)) return security(await provisionJevReference(request,env,jevReference[1]));
                if (path === '/api/admin/query' && method === 'POST') return security(await queryImage(request,env));
                if (/^\/api\/admin\/artifacts\/[^/]+\/mission$/.test(path)) return security(error('Chức năng nhiệm vụ đã được gỡ bỏ.', 410));
                if (path === "/api/admin/artifacts" && method === "GET")
                    return security(json({ artifacts: await listArtifacts(env) }));
                if (path === '/api/admin/catalog-release' && method === 'GET')
                    return security(json(await catalogReleaseStatus(env, url.searchParams.get('check_index') === '1')));
                if (path === '/api/admin/hard-negatives' && method === 'GET')
                    return security(await listHardNegatives(env));
                const hardNegative = path.match(/^\/api\/admin\/hard-negatives\/([^/]+)$/);
                if (hardNegative && method === 'PUT')
                    return security(await replaceHardNegatives(request, env, decodeURIComponent(hardNegative[1])));
                if (path === "/api/admin/artifacts" && method === "POST")
                    return security(await createArtifact(request, env));
                const artifactImages = path.match(/^\/api\/admin\/artifacts\/([^/]+)\/images$/);
                if (artifactImages && method === "GET") return security(await listImages(env, artifactImages[1], request));
                const retry = path.match(/^\/api\/admin\/images\/([^/]+)\/retry$/);
                if (retry && method === "POST") return security(await retryImage(env, retry[1]));
                const reprocess = path.match(/^\/api\/admin\/images\/([^/]+)\/reprocess$/);
                if (reprocess && method === 'POST') return security(await retryImage(env,reprocess[1],false,true));
                const mapping = path.match(/^\/api\/admin\/artifacts\/([^/]+)$/);
                if (mapping && method === 'PATCH') return security(await mapArtifact(request,env,mapping[1]));
                const rebuild = path.match(/^\/api\/admin\/images\/([^/]+)\/reindex$/);
                if (rebuild && method === 'POST') return security(await retryImage(env,rebuild[1],true));
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
            if (path === '/' || path === '/index.html' || path === '/admin' || path.startsWith('/admin/')) {
                const denied = await requireAdmin(request, env);
                if (denied) return security(denied);
                if (path.startsWith('/admin')) return security(new Response(null, { status: 302, headers: { Location: '/' } }));
            }
            if (path.startsWith("/api/")) return security(error("Không tìm thấy API.", 404));
            return asset(request, env, path);
        } catch (error) {
            console.error(error);
            return security(errorResponse(error));
        }
    },
};
