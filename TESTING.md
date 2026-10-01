# Kiểm tra app import reference & nhận diện

Phạm vi web hiện tại: tạo/chọn hiện vật, import ảnh tham chiếu, chụp/chọn ảnh query và xem kết quả. Gameplay tìm tem và lab so sánh đã được gỡ; các bài test của chúng được thay bằng test kiểm tra route/API đã tắt và luồng đơn giản hiện tại.

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
- `tests/camera-zoom.test.mjs`: khung ảnh sau zoom, zoom phần cứng/số, fallback API thiếu/lỗi/bỏ qua lệnh, coalesce thay đổi và đóng track khi còn lệnh chờ.
- `tests/recognition-eval.test.mjs`: kiểm tra công cụ đánh giá offline bằng dữ liệu mô phỏng, không cần dataset MET hoặc gọi provider.
- `tests/integration.test.mjs`: description + joint embedding cho reference/query, tái sử dụng mô tả khi retry, chuyển pipeline cũ, namespace, hạn mức hai lượt, token tích hợp, validation JPEG, external ID, idempotency và request song song, lỗi provider/index/danh mục thay đổi. SQLite thật trong RAM; provider/Vectorize/R2 mô phỏng.
- `tests/integration-client.test.mjs`: adapter backend giữ ID hành động, không tự retry, chặn redirect và endpoint không phù hợp. Eval offline cũng được kiểm tra dùng cùng prompt/input với Worker và giữ mô tả khi bước embedding lỗi.

## Browser

- `tests/browser/recognition.spec.mjs`: trang chính có import/nhận diện, không còn sổ tem/lab; tạo/import reference; crop/xác nhận query; kết quả khớp/chưa đủ rõ; query không thêm vào reference; hủy/ảnh hỏng/vùng crop quá nhỏ không gọi provider; provider lỗi không auto-retry; khóa sửa danh mục khi nhận diện; yêu cầu hai hiện vật; lỗi import/retry; URL legacy về trang chính và API bị gỡ; camera bị từ chối có file fallback.
- `tests/browser/api.test.mjs`: mô phỏng phản hồi query thất lạc sau khi server đã xử lý; không hứa lượt gửi lại miễn phí/cache; không auto-retry; chỉ gọi thêm khi người dùng xác nhận.
- `tests/browser/media.spec.mjs`: camera từ canvas có pixel biết trước; chụp đúng vùng sau zoom/xoay viewport/đổi camera; đóng track; pinch; crop batch giữ riêng từng ảnh; JPEG crop đúng pixel; EXIF; HTML image decoding fallback; hủy hoặc ảnh lỗi không gọi embedding.

Screenshots/trace ở `reports/`. Kiểm thử tại viewport điện thoại/desktop không thay thế thiết bị vật lý.

**Giới hạn WebKit trên Windows:** không có `canvas.captureStream()`, nên ba ca camera mô phỏng skip. Crop/EXIF/file upload/nhận diện vẫn kiểm tra được. Cần test camera trên Safari iOS/macOS thật.

## Kết quả kiểm tra description + multimodal embedding

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
