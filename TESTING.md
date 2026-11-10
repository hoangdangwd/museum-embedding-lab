# Kiểm tra app import reference & nhận diện

Phạm vi web hiện tại: tạo/chọn hiện vật, import ảnh tham chiếu, chụp/chọn ảnh query và xem kết quả. Gameplay tìm tem và lab so sánh đã được gỡ; các bài test của chúng được thay bằng test kiểm tra route/API đã tắt và luồng đơn giản hiện tại.

## Production Phật Bà gap -0.009

- Owner đã duyệt đổi duy nhất gap production từ `-0.08` sang `-0.009`; giữ bank30, 7 reject-only vectors, threshold `0.8`, margin `0.05`, geometry `off`, quota và secrets. Dev vẫn giữ gap cũ. Không seed lại catalog/bank hoặc gọi model mới.
- `tests/hard-negative.test.mjs` bảo vệ cấu hình production, quyết định hai phía của ranh giới `-0.009` bằng điểm chưa làm tròn, quét đủ 7 negative, chặn R0744-like và giữ R1578-like; các test zero-gap/target scope/fail-closed cũ vẫn giữ.
- Nghiên cứu ở ignored `reports/hard-negative-gap-research-v1/`: chọn từ calibration sau loại R1610 source-overlap, bỏ self-vector và thử bỏ thêm từng vector bank. Actual Worker kiểm tra 1.488 quyết định bằng cached provider outputs và exact index cục bộ, không phải live Vectorize hoặc independent validation. Image-jackknife còn nhạy với R0745; ảnh cùng object/session và chưa đo fresh-provider variability.
- Bằng chứng deploy, snapshot trước/sau, xác minh settings/secrets bindings, catalog/index và rollback nằm ở ignored `reports/production-gap-minus-0009-v1/`. Lượt upload mới chưa được tái hiện bằng provider thật.

- Rollout đã hoàn tất: Worker `0a6e4ccc-a2b1-4812-86e5-e9ac24712b1e`; 125 Node +42 browser recognition tests đạt, build/deploy thành công. Snapshot live xác minh chỉ gap binding đổi, 30 JPEG/vector reference và 7 guard vectors giữ nguyên; usage vẫn 18/200. UI live khớp bundle đã test; kiểm tra từ chối trên trang live dùng response mô phỏng bị chặn tại browser, không phải nhận diện ảnh thật.

## Production catalog30 — nạp vector đã duyệt, không gọi model

- Owner duyệt `crop-bank30-v1`:30 refs/9 artifacts,10 baseline nguyên byte+20 crop mới, loạiR1090. Package ở `data/production-catalog.json`; `catalog:seed` mặc định không seed45 nguồn nghiên cứu.
- `tests/catalog-release.test.mjs`: package/hash/signature, Gióng đúng literal live JPEG, import không API key/quota/provider, từ chối release/hash/external-ID/signature sai trước ghi, không nhận client vectors, admin Access/duplicate, phục hồi reindex từ vector lưu sau lỗi index, dry-run GET-only, idempotence và kiểm vector/namespace/metadata thực. Có fixture vector query `tests/fixtures/catalog-boundary-query.json` chỉ để regression, không seed: ANN0,8000294 nhưng cosine thật0,79997178 phải `uncertain` với threshold0,8 nguyên vẹn; cache approved thiếu/hỏng không được fallback. GET Vectorize chia batch<=20. Các bài test không phát sinh model calls thật.
- Pilot development32/37 known đúng sau bỏR1090 hậu kiểm; không phải blind final hay independent precision/recall. Không đổi nguồn/nhãn/official partitions và không hạ0.8/0.05 hoặc mở bank Hoàng hậu. Xem evidence rollout/backup trong ignored `reports/production-bank30-v1/`.

## Camera-guide-v1 và dataset crop (mới)

- Camera có guide dọc/ngang và crop thật từ video nguồn, không chụp screenshot; mapping cover/zoom/rotation được kiểm tra bằng geometry và pixel. Preview và JPEG upload camera khớp byte; file upload không thêm crop.
- Browser suite: **76 đạt, 5 skip** (camera canvas WebKit Windows). Camera vật lý iOS/Android và độ chính xác nhận diện ảnh crop thật chưa được kiểm chứng.
- `tests/camera-crop-dataset.test.mjs` và `tests/build_camera_crop_queue_test.py`: queue/hash, không tự gán crop/nhãn, chặn reference/test/holdout leakage, yêu cầu nhãn sau crop và góc/chất lượng/nhóm đã duyệt.
- `python scripts/build-camera-crop-queue.py`: inventory1642 gồm1632 incoming+10baseline, 45references/508calibration/183final/906unassigned. Không crop hay gọi provider tự động. Output riêng trong ignored `reports/camera-crop-dataset-v1/`.
- Bộ vector toàn ảnh trước đây **không** chứng minh chất lượng sau crop. Chưa có cấu hình mới được tối ưu/chốt từ dữ liệu crop; không seed thêm reference hoặc gọi model trả phí trong bước chuẩn bị.

## Kết quả trước đó — algorithm-first-v1

- `npm test`: **97/97 đạt**. `npm run test:ui`: **72 đạt, 3 skip** trên Chromium/Firefox/WebKit; ba skip là camera WebKit Windows đã biết. Production build và `npm run deploy` thành công.
- Đã deploy Worker/assets; kiểm tra live health/status, 9 artifacts/10 ready references, 7 hard-negative vectors chỉ cho Phật Bà và UI mới bằng Chromium không có page error. Không upload ảnh hoặc gọi provider thật trong lần kiểm tra này.
- `node scripts/replay-algorithm-first.mjs` replay đúng `recognize()` bằng snapshot 10 production references và 508 cached calibration descriptions/vectors; geometry `off`, leave-one-out hard-negative, không provider/final/catalog write. Kết quả trong `reports/algorithm-first-v1/`: giữ **87 known correct accepts, 38 Phật Bà**, không mất known accept so với policy hard-negative cũ; vẫn còn **2 ambiguous false accepts**.
- Guard dừng 113/508 ảnh trước embedding/index (96 positive theo nhãn hiện có và 17 negative; các positive này vốn chưa được policy cũ accept). Đây không phải 113 ảnh được xác minh lại là ambiguous, không đổi ground truth. Chỉ giảm lời gọi embedding trong replay từ 508 xuống 395; không chứng minh giảm false accepts hoặc tăng recall ngoài sample đã xem.
- `worker/geometry.js` chỉ là adapter/validator cho service binding đáng tin cậy, **không có feature extractor production**. Không được coi test geometry bằng evidence giả lập là live homography. Điều kiện hoàn thiện/bật nằm trong `integration/GEOMETRY.md`.

## Lệnh kiểm tra

```powershell
corepack pnpm@10 run test
corepack pnpm@10 run build
corepack pnpm@10 exec playwright test
```

Nếu chưa có browser tương ứng:

```powershell
corepack pnpm@10 exec playwright install chromium firefox webkit
```

Có thể đặt `PLAYWRIGHT_EXECUTABLE_PATH` tới Chromium có sẵn; config chỉ áp dụng biến đó cho project Chromium. Test browser dùng server Node demo local, SQLite thật trong RAM, R2/OpenRouter/Vectorize mô phỏng; không gọi API trả phí. Không dùng server demo trong production.

## Unit / Worker

- `tests/catalog.test.mjs`: danh mục không phụ thuộc nhiệm vụ; root/URL legacy/API quản trị vẫn yêu cầu quyền; URL cũ redirect; API gameplay/lab/nhiệm vụ trả 410 và không gọi provider; import/ảnh trùng/nhận diện/reindex; reindex dùng vector đã lưu; hạn mức đặt chỗ nguyên tử; cron chỉ dọn bộ đếm hết hạn, không xóa reference.
- `tests/worker.test.mjs`: từ chối upload không hợp lệ; Access; model/số chiều; gom `max` theo hiện vật; bỏ vector cũ; tìm đối thủ khi topK chỉ có một ID; ngưỡng do server quyết định.
- `tests/recognition-policy.test.mjs`: semantic guard bảo thủ, family routing planar/sculpture, hard-negative target scope, geometry quality gates/conflict/multi-target và service binding an toàn.
- `tests/camera-zoom.test.mjs`: khung ảnh sau zoom, zoom phần cứng/số, fallback API thiếu/lỗi/bỏ qua lệnh, coalesce thay đổi và đóng track khi còn lệnh chờ.
- `tests/recognition-eval.test.mjs`: kiểm tra công cụ đánh giá offline bằng dữ liệu mô phỏng, không cần dataset MET hoặc gọi provider.
- `tests/integration.test.mjs`: description + joint embedding cho reference/query, semantic scene guard dừng trước embedding/index, định tuyến geometry theo external ID, hard-negative chỉ cho Phật Bà, tái sử dụng mô tả khi retry, chuyển pipeline cũ, namespace, hạn mức, token tích hợp, validation JPEG, external ID, idempotency và request song song, lỗi provider/index/danh mục thay đổi. SQLite thật trong RAM; provider/Vectorize/R2 mô phỏng.
- `tests/integration-client.test.mjs`: adapter backend giữ ID hành động, không tự retry, chặn redirect và endpoint không phù hợp. Eval offline cũng được kiểm tra dùng cùng prompt/input với Worker và giữ mô tả khi bước embedding lỗi.

## Browser

- `tests/browser/recognition.spec.mjs`: trang chính có import/nhận diện, không còn sổ tem/lab; tạo/import reference; xem trước toàn ảnh/xác nhận query, không có UI crop; kết quả khớp/chưa đủ rõ; query không thêm vào reference; hủy/ảnh hỏng/ảnh quá nhỏ không gọi provider; đổi/hủy ảnh giải phóng object URL; provider lỗi không auto-retry; khóa sửa danh mục khi nhận diện; yêu cầu hai hiện vật; lỗi import/retry; URL legacy về trang chính và API bị gỡ; camera bị từ chối có file fallback.
- `tests/browser/api.test.mjs`: mô phỏng phản hồi query thất lạc sau khi server đã xử lý; không hứa lượt gửi lại miễn phí/cache; không auto-retry; chỉ gọi thêm khi người dùng xác nhận.
- `tests/browser/media.spec.mjs`: camera canvas pixel biết trước; chỉ crop vùng guide dọc/ngang sau zoom/xoay viewport/đổi camera; pixel ngoài khung không đi vào crop; JPEG query đúng SHA-256 của preview; đóng track, pinch, chụp lại/hủy không gọi provider. File upload vẫn giữ toàn ảnh, có resize/EXIF và HTML image fallback. Crop reference theo batch giữ riêng từng ảnh và đúng pixel.

Screenshots/trace ở `reports/`. Kiểm thử tại viewport điện thoại/desktop không thay thế thiết bị vật lý.

**Giới hạn WebKit trên Windows:** không có `canvas.captureStream()`, nên ba ca camera mô phỏng skip. Crop/EXIF/file upload/nhận diện vẫn kiểm tra được. Cần test camera trên Safari iOS/macOS thật.

## Lịch sử trước camera-guide-v1: bỏ crop thủ công khi nhận diện

- Luồng query dùng preview toàn ảnh, không có nút khoanh vùng, slider hoặc trạng thái crop; vẫn cần bấm **Nhận diện ảnh** để gọi provider.
- Crop trong luồng import reference và zoom/khung ngắm camera không thay đổi. File query chỉ được chuẩn hóa hướng, JPEG/nền trắng và kích thước, không cắt thêm sau khi chụp/chọn.
- `npm test`: **51/51 đạt**.
- `npm run test:ui`: production build thành công; Chromium/Firefox/WebKit **63 đạt, 3 skip** (camera WebKit Windows).
- Regression test kiểm tra pixel ảnh query nguyên khung sau resize 2400×1800 → 1600×1200, fallback HTML image, EXIF 90°, khung camera sau zoom; ảnh lỗi/quá nhỏ, hủy/đổi ảnh và giải phóng object URL không gọi provider. Các test crop reference vẫn đạt.
- Log: `reports/no-recognition-crop-unit.log`, `reports/no-recognition-crop-ui.log`. Chromium dùng `PLAYWRIGHT_EXECUTABLE_PATH` như mô tả bên dưới. Không gọi provider thật hoặc deploy remote.

## Kết quả kiểm tra description + multimodal embedding (trước khi bỏ crop nhận diện)

- Build thành công.
- **39/39 unit/API/adapter/evaluation test đạt**.
- Playwright Chromium/Firefox/WebKit: **48 đạt, 3 skip** (camera WebKit Windows như trên).
- Chromium mặc định yêu cầu revision 1243 chưa có trên máy; 17 ca Chromium được chạy lại thành công bằng `PLAYWRIGHT_EXECUTABLE_PATH` trỏ tới `chromium-1234/chrome-win64/chrome.exe`. Firefox/WebKit đạt 31 ca, 3 skip trong lượt đầu. Sandbox chặn spawn trình duyệt nên các lượt browser chạy với quyền đã được cấp.
- Migration `0005_description_integration.sql` đã áp dụng thành công vào D1 **local**; không áp remote.
- Demo browser chạy pipeline description + ảnh với cả hai provider được mô phỏng. Không gọi model trả phí hoặc thay đổi D1/R2/Vectorize remote.
- Các kiểm tra import/query dùng provider mô phỏng, không chứng minh độ chính xác model thật; chưa thử camera điện thoại vật lý.

## Kiểm tra sau pull `6c0b79d` (Vectorize retry)

Pull fast-forward từ `origin/main`, khôi phục các thay đổi local và giải quyết xung đột ở `worker/index.js` mà vẫn giữ namespace, pipeline description và yêu cầu hai hiện vật để đối chiếu.

- Retry tối đa bốn lần cho lỗi Vectorize `Status + 500`, áp dụng cả truy vấn chính và tìm hiện vật đối chiếu. Không chạy lại description/embedding khi retry index; lỗi không tạm thời không tự retry.
- Lỗi Vectorize được trả thành `503`; API tích hợp giữ mã `VECTOR_QUERY_ERROR`, `retryable: true` và replay cùng Idempotency-Key không gọi lại model.
- Cập nhật hai test upstream theo danh mục tối thiểu hai hiện vật; bổ sung regression test cho truy vấn đối chiếu, namespace, số lần gọi model và lỗi/cache của API tích hợp. Các regression test đã tái hiện lỗi trước khi sửa.
- `npm audit fix` không dùng `--force`: lockfile cập nhật Cloudflare Vite plugin `1.62.3`, Wrangler `4.145.0`, Undici `7.29.1` và dependency liên quan; giữ nguyên range trong `package.json`.

Kết quả chạy lại sau `npm ci`:

| Kiểm tra | Kết quả |
| --- | --- |
| `npm ci` | Thành công |
| `npm test` | **51/51 đạt** |
| `npm run test:ui` (bao gồm production build) | **51 đạt, 3 skip** trên Chromium/Firefox/WebKit |
| `npm audit --audit-level=low` | **0 vulnerability được báo cáo** |
| `npx --no-install wrangler deploy --dry-run --outdir reports/worker-dry-run` | Đóng gói Worker/assets thành công, không deploy |

Chromium chạy với `PLAYWRIGHT_EXECUTABLE_PATH` trỏ tới browser có sẵn `chromium-1234/chrome-win64/chrome.exe`; ba skip vẫn là camera mô phỏng WebKit Windows. Log: `reports/pull-install.log`, `reports/pull-unit-final.log`, `reports/pull-ui-final.log`, `reports/pull-audit-final.log`, `reports/pull-worker-dry-run.log`. Không gọi model thật, không apply migration remote hoặc thay đổi tài nguyên production. Kết quả này không thay thế thử thiết bị camera/model thật.

## Đánh giá ảnh thật

Chuẩn bị bộ ảnh riêng theo [STAMP_EVALUATION.md](integration/STAMP_EVALUATION.md); ảnh nguồn hiện tại là chín tem trong `data/Stamp`. Chưa có số đo chất lượng model thật trên ảnh chụp bảo tàng.

- Dùng ảnh `references/` để import; dùng ảnh `calibration/` cho chọn ngưỡng, `final/` cho đánh giá độc lập và `_unknown` cho từ chối ngoài danh mục. Không lấy query làm reference.
- Import/query qua app gọi embedding thật và dùng hạn mức Worker. Runner offline có phí trực tiếp, không chịu hạn mức Worker; chỉ chạy có chủ đích.
- Trước triển khai: kiểm tra góc nghiêng, phản chiếu kính, nền phức tạp, ảnh nhiều vật, vật tương tự ngoài danh mục, crop/toàn ảnh; giữ nguyên nguồn ảnh/hash/attribution.
- Đo số lỗi/tổng mẫu, nhận nhầm unknown, độ trễ và chi phí. Cosine không phải xác suất, build/test phần mềm đạt không có nghĩa nhận diện ảnh thực tế đã được xác nhận.
- Thử HTTPS/quyền camera, zoom/đổi camera và file fallback trên iPhone/Android/trình duyệt nhúng mục tiêu.
- Hard-negative guard riêng cho tượng ngoài catalog giống Phật Bà: `tests/hard-negative.test.mjs` kiểm tra signature, normalize, atomic replace, từ chối target khác, disabled/old/corrupt vectors, zero-gap boundary và không đổi runner-up; browser test kiểm tra UI không tuyên bố match. Không có bank thì Hoàng hậu và các hiện vật khác đi theo embedding bình thường.
- Geometry production mặc định `RECOGNITION_GEOMETRY_MODE=off`. Policy đã có cổng `off/shadow/enforce`, nhưng chỉ bật `shadow/enforce` sau khi gắn service binding trích xuất feature đã kiểm chứng; nghiên cứu OpenCV offline không tự trở thành evidence production. `npm run hard-negative:seed -- <HTTPS URL> --apply` nạp lại 7 vector từ cache, không gọi provider.
- Lịch sử bộ10 dùng `RECOGNITION_HARD_NEGATIVE_GAP=-0.08`, vì gap `0` khi replay với 10 production references làm mất nhiều ảnh Phật Bà thật. Production bank30 nay dùng gap `-0.009` theo phê duyệt riêng; số liệu bộ10 sau đây không đại diện cho cấu hình mới. `reports/hard-negative-veto-v1/production-worker-replay.json` là replay cache của đúng hàm Worker trên 508 calibration: 87/436 known correct accepts, 6 false accepts bị chặn, còn 2 ambiguous false accepts. Đây không phải live-image/provider holdout.

## Optimized family-specific geometry (offline)

- `python scripts/optimized-geometry-study.py --output reports/optimized-geometry-study-v1 --workers 4` đã chạy đủ 508 calibration, so sánh homography cho artifact phẳng và affine cho Hoàng hậu/Phật Bà; không provider/final/production.
- `python scripts/evaluate-family-hybrid.py` đánh giá family hybrid: embedding primary, geometry rescue đúng family, conflict/multi-target reject. Best zero-observed-error candidate: **254/436**, +22 so với hybrid planar cũ 232/436 và +130 so với embedding candidate 124/436. Vẫn reject 182/436, Hoàng hậu chỉ 5/47; đây là exploratory, chưa deploy.
- `python scripts/build-unrecognized-review.py` trực quan hóa toàn bộ 182 ảnh chưa nhận diện: sinh 8 contact sheets JPEG (`sheet-01.jpg` đến `sheet-08.jpg`), trang HTML tương tác lọc theo lý do/ngưỡng/artifact (`reports/unrecognized-calibration-review-v1/index.html`) và báo cáo phân bố ngưỡng chi tiết `summary.md`.
- `reports/optimized-geometry-study-v1/interpretation.md` ghi breakdown và lý do chưa dùng Worker. Affine là cải thiện đúng hướng cho 3-D nhưng chưa đủ chất lượng hoàn thiện.
- `tests/evaluate_family_hybrid_test.py` và `tests/build_unrecognized_review_test.py` bảo vệ pipeline đánh giá và sinh báo cáo trực quan.

## Reconsideration: 232/436 là quá thấp

- `python scripts/audit-hybrid-rejections.py` phân rã 204 known-positive rejects của conservative hybrid; output `reports/hybrid-rejection-audit-v1/` có bảng theo artifact/reason/geometry và 43 ảnh đại diện. 196/204 là clutter, 8/204 clean; 193 thiếu combined evidence, 11 multi-target guard.
- `reports/recommended-policy-v1/reconsideration.md` rút lại candidate 232/436 như completion policy. Nhiều rejects không phải ảnh quá nhỏ/mờ; một số tranh/tượng nhìn thấy hợp lý nhưng geometry phẳng thất bại, nhất là artifact 3-D. Không thể giải quyết overlap giữa unknown và positive Phật Bà bằng scalar threshold.

## Recommended policy v1 (offline, chưa deploy)

- `reports/recommended-policy-v1/policy.json` chốt recommendation nghiên cứu: không dùng scalar duy nhất; embedding `max` score >=0.86, margin >=0.13 kết hợp local target geometry >=24 inliers, margin >=20, runner-up <10. Conflict/multi-target: reject + gợi ý retake. Partial/occluded single target được phép nếu evidence riêng mạnh.
- `python scripts/audit-recommended-policy.py` kiểm tra provenance/metrics: 232/436 correct accepts, observed precision 232/232, wrong artifact 0, false accepts unknown/ambiguous/low-quality 0 trong calibration. Đây là verification offline, không phải approval/deploy.
- Scalar fallback `0.90/0.10` an toàn hơn trên calibration nhưng chỉ 77/436 correct accepts; scalar `0.8/0.05` chẩn đoán quá permissive. Không thay current online config tự động.

## Semantics visibility v2 (offline, chưa deploy)

- Owner semantics: ảnh có nhiều catalog artifacts thì reject và gợi ý retake; ảnh quá nhỏ/mờ/nhòe đến mức người bình thường phải đoán thì reject/retake; ảnh một artifact chỉ bị khuất/chụp một phần vẫn có thể confirm nếu phần thấy đủ đặc trưng và không có artifact cạnh tranh.
- `reports/visibility-policy-v2/policy.json` là sidecar semantics; chưa đổi official labels, UI, Worker hay production.
- `python scripts/audit-visibility-policy.py` đối chiếu semantics với các kết quả cache. Dataset hiện chưa có human-effort visibility labels, nên chưa được phép báo recall riêng cho small/blurry/occluded/partial.
- Local 12–23 inliers là borderline; local >=24, margin >=20, runner-up <10 là candidate mạnh hơn nhưng chưa approved numeric policy. Embedding cosine và local inliers là hai scale khác nhau.

## Nghiên cứu offline: visibility, local features và hybrid

- `python scripts/build-visibility-threshold-review.py` tạo 21 known-clutter examples quanh biên 12–26 local inliers; chỉ review-only, không gán nhãn visibility chính thức. Chi tiết: `reports/visibility-threshold-review-v1/interpretation.md`.
- Tách hai scale: embedding cosine/margin và local SIFT inliers/margin; không coi chúng là cùng một điểm. Hiện online vẫn là `wrangler.jsonc` 0.8/0.05 với 10 production references; các số 0.86/0.13 dùng 45 references offline và không phải end-to-end production measurement.
- Audit hybrid ở `reports/hybrid-conflict-study-v2/`: 508 calibration được tách thành both-agree, embedding-only, geometry-only, multi-target-veto và neither. Không dùng final/provider, không deploy. Hai catalog targets có thể xử lý như reject/retake theo yêu cầu hiện tại, nhưng cần áp dụng nhất quán cho positive clutter.
- `reports/hybrid-sensitivity-v1/` là sensitivity hậu nghiệm; không chọn cấu hình tốt nhất làm policy.
- Tests nghiên cứu: `tests/local_feature_study_test.py`, `tests/report_local_feature_study_test.py`, `tests/hybrid_conflict_study_test.py`. Các điểm inlier không phải confidence/probability; kết quả cùng calibration đã xem nhiều lần, không phải holdout độc lập.
