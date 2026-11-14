# Kiểm tra app import reference & nhận diện

## Trạng thái hiện tại

- Catalog production: `crop-bank32-session2-v1`, 32 reference /9 hiện vật. Giữ nguyên bank30 và chỉ thêm `S2001`, `S2003`; không seed R1090 hoặc query/test photos.
- Quyết định nhận diện dùng mô tả → semantic scene guard → joint image/text embedding → Vectorize retrieval → exact cosine D1 cho release đã duyệt → threshold0.8/margin0.05 → reject-only hard-negative cho hai tượng, gap production-0.009. Dev gap-0.08; quota production100000/dev30.
- Geometry đã bị xóa hoàn toàn khỏi runtime, config production/dev, API/schema, UI và active research scripts/tests. Không còn family routing/rescue/conflict/service binding. Nguồn lịch sử và tài liệu trước thay đổi được lưu ignored tại `reports/geometry-removal-v1/archive/`, không tham gia build/test/deploy.
- Jev implementation không bị thay đổi bởi việc gỡ geometry. Online vẫn `JEV_MODE=off` vì Workers Free CPU10ms gây`exceededCpu` khi chuẩn hóaJPEG. Không bật lại hoặc tự nâng gói trong thay đổi này. Xem `integration/JEV.md`.
- Ảnh/crop/repeat cùng nguồn không phải independent accuracy. Test phần mềm dùng mocks không xác nhận chất lượng model thực tế.

## Lệnh kiểm tra

```bash
npm test
npm run build
npx playwright test
python -m unittest discover -s tests -p '*_test.py'
```

Browser tests dùng `scripts/demo-server.mjs`: SQLite thật trongRAM, R2/provider/Vectorize giả lập, không paid calls. Không dùng demo server cho production. Có thể đặt `PLAYWRIGHT_EXECUTABLE_PATH` cho Chromium có sẵn; Firefox/WebKit dùng cài đặt Playwright.

## Node / Worker

- `tests/recognition-policy.test.mjs`: semantic guard chỉ từ chối cảnh nhiều artwork không có primary hoặc không rõ artifact; không đếm nhân vật/lá/panel nội tại. Cùng threshold/margin cho mọi hiện vật; không rescue nhánh phụ, không chọn runner-up. Hai bank chỉ veto đúng sculpture externalID.
- `tests/geometry-removal.test.mjs`: regression bảo vệ việc xóa adapter/config/schema/UI và runtime hooks; legacy env/evidence không thể kích hoạt lại service hoặc thay quyết định. Hai API trả matched/uncertain/semantic-stop không còn geometry/family/timing fields; matched path không đọc R2 khi Jev tắt. Tất cả dùng mocks, không network/provider thật.
- `tests/catalog-release.test.mjs`: exact-byte/hash/signature/external-ID, giữ10baseline và Gióng literal liveJPEG, không client vectors, import approved không API/quota/model calls, duplicate/retry/reindex, dry-run GET-only, idempotence và kiểm tra vector/namespace/metadata với batch<=20. Boundary fixture: ANN0.8000294 nhưng exact0.79997178 không được vượt ngưỡng0.8. Missing/corrupt approved vector fail closed.
- `tests/hard-negative.test.mjs`: atomic replace, normalized vectors, signature, disabled/old/corrupt rows, target scope, cả hai guardbanks, unrounded gap boundary, không switch runner-up. Guard data không được đưa vào reference catalog.
- `tests/integration.test.mjs`: existing description prompt và joint input, scene stop trước embedding/index, idempotency/concurrent duplicate/status lookup, JPEG validation, token/server-only, external mapping, provider/index/catalog failures, quota, namespace, saved descriptions/vectors, transientVectorize retry không gọi lại model.
- `tests/worker.test.mjs`, `catalog.test.mjs`: admin authorization, root/legacy routes, image import/reindex/query, max-per-artifact ranking, different runner-up, catalog availability và quota.
- `tests/integration-client.test.mjs`: HTTPS/origin, credentials confined to backend, stable idempotency keys và không tựretry.
- `tests/jev-{production,runtime}.test.mjs`: fixed v2/cutoff/strictresponse, trusted winner provenance, realWASM32JPEG normalization, image/memory bounds, money/count/concurrency/circuit SQL, timeout kể cả fetch/stream treo, schema/provider/network error fail closed, khôngretry/runner-up, redaction, off/shadow/enforce. Node-only WASM loader không deploy.
- `tests/camera-{zoom,crop-dataset}.test.mjs`: camera cover/zoom/frame mapping, source hashes/ROI approval, partition/group leakage, closed track, async hardware zoom fallback. Không liên quan tới đối chiếu đặc trưng hình học hiện vật.
- Evaluation/seed/dataset tests: đường dẫn/hashes/duplicate/normalizedJPEG/signature/cache, no provider trong scan/prepare, seed đúng approved package. Held-out photos không được seed.

## Browser

- `tests/browser/recognition.spec.mjs`: import và query, preview/cancel/objectURL, scene/uncertain/matched display, hard-negative/Jev refusal không giả match, privacy notice, provider errors không tựretry, concurrent-edit lock, minimumtwo artifacts, legacy removed routes.
- `tests/browser/media.spec.mjs`: pixel camera known-pattern, cropped guide và JPEG upload khớp previewbytes, portrait/landscape/zoom/camera switch, file upload toànảnh, resize/EXIF/fallback, release tracks/URLs. Xóa geometry matcher không được làm hỏng camera crop/zoom.
- `tests/browser/api.test.mjs`: lostresponse không tựsubmit và không hứa retry miễnphí.
- WebKit Windows thiếu một số canvas/camera APIs; known camera skips phải báo riêng. Browser mô phỏng không thay kiểm tra iPhone/Android vật lý.

## Kiểm tra online / triển khai

1. Chạy relevanttests/build và `git diff --check`.
2. Dùng `npm run deploy`, giữ bindings/secrets/quota/catalog/guards.
3. Kiểm tra `/healthz`, `/api/status`, `/api/admin/catalog-release?check_index=1`, `/api/admin/hard-negatives`, `/api/admin/usage`, `/api/admin/jev` và giao diện.
4. Geometry removal không cần catalog seeding, migration hoặc paid smoke. Có thể kiểm chứng actual`recognize()` local qua cached/mocked provider; không gọi đó là fresh-provider/liveANN accuracy.
5. Không sửa lại snapshot/báo cáo cũ để làm giống schema mới. `/api/v1` idempotent responses cũ có thể giữ trường legacy trong thời hạn24h; chúng là lịch sử, không phải nhánh runtime còn hoạt động.

## Evidence lịch sử

Các rollout bank30/bank32/gap và nghiên cứu trước vẫn ở ignored`reports/` cùng số liệu/giới hạn gốc. Nội dung TESTING và DATASET_PLAN trước gỡ geometry, scripts/tests/adapter/contract đã nghỉ dùng được lưu tại `reports/geometry-removal-v1/archive/`. Không chạy lại chúng như hướng dẫn triển khai hiện hành.
