# Nhận diện hiện vật qua ảnh

Ứng dụng React/Vite + Cloudflare Worker với ba chức năng chính:

1. **Tạo/chọn hiện vật** trong danh mục.
2. **Import ảnh tham chiếu**: chọn/chụp ảnh, xem trước/crop, xác nhận nhập và xem trạng thái xử lý.
3. **Nhận diện ảnh mới**: camera có khung dọc/ngang và **crop thật vùng trong khung**, xem trước JPEG đã cắt rồi xác nhận nhận diện. Luồng chọn ảnh từ thiết bị được giữ nguyên, chưa bổ sung crop.

Trang chính là **`/`**. Không còn gameplay tìm tem, nhiệm vụ/câu chuyện hay giao diện lab so sánh Met. Các URL `/admin`, `/admin/test`, `/admin/test/met` cũ chuyển về `/`; các API gameplay/lab/nhiệm vụ cũ trả `410 Gone`.

## Chạy dev với nhận diện thật

Yêu cầu Node.js 22.13+ (đã kiểm tra với Node 22.21), dùng pnpm. Trên máy chưa có lệnh `pnpm` trực tiếp, có thể dùng Corepack:

```powershell
corepack pnpm@10 run dev:setup
corepack pnpm@10 run dev
```

Mở **http://localhost:5173**. Đặt `OPENROUTER_API_KEY` trong `.dev.vars` (hoặc `.env` được Cloudflare plugin nạp), không nhập key trên giao diện và không commit secret.

Dev dùng D1/R2 local và Vectorize remote riêng **`museum-embedding-1536-dev`**, 1536 chiều, cosine. Index dev đã được tạo; với tài khoản mới cần tạo index và metadata index trước khi import ảnh:

```powershell
corepack pnpm@10 exec wrangler vectorize create museum-embedding-1536-dev --dimensions=1536 --metric=cosine
corepack pnpm@10 exec wrangler vectorize create-metadata-index museum-embedding-1536-dev --property-name=artifact_id --type=string
```

Không chạy lệnh create nếu index đã tồn tại. Production dùng `museum-embedding-1536`, không đổi dev sang index production chỉ để khởi động server.

## Bộ ảnh tham chiếu: ảnh bảo vật, không dùng ảnh tem

Bộ **production được chủ sở hữu duyệt là 30 reference/9 bảo vật**, đóng gói ở `data/production-catalog.json` và `data/catalog-releases/crop-bank30-v1/`: 10 baseline nguyên byte live +20 ảnh crop mới, **loại R1090**. `catalog:seed` mặc định chỉ nạp bộ này, dùng JPEG/mô tả/vector đã tính và được kiểm tra hash + full pipeline signature; **không gọi provider**, không re-encode baseline Gióng. Server chỉ chấp nhận ảnh đúng release/hash/hiện vật và dùng vector tin cậy đóng gói lúc build, không nhận vector từ client. `GET /api/admin/catalog-release?check_index=1` kiểm tra catalog, cache D1 và vector thực trong Vectorize (mỗi batch tối đa20 IDs). Với30 reference đã duyệt, Vectorize chỉ truy hồi ứng viên; xếp hạng/quyết định dùng **cosine chính xác từ vector D1**, không lấy điểm ANN xấp xỉ để vượt ngưỡng. Thiếu/hỏng cache approved thì fail-closed. Lý do: R0740 có cosine0,79997178 nhưng index trả0,8000294; không sửa bằng hạ/tăng threshold hoặc đổi số reference.

**45 ảnh JPEG trong `data/references/<mã-bảo-vật>/` và `data/artifacts.json` vẫn là snapshot nghiên cứu cục bộ**, không còn là nguồn seed mặc định. Chúng và `data/test/` được giữ nguyên để bảo toàn provenance; không tự seed cả45 hoặc di chuyển official partitions. Các nguồn từng làm final/holdout nay đã xem/tái sử dụng không còn là đánh giá độc lập. Pilot cùng phiên đạt32/37 known đúng khi bỏR1090 hậu kiểm, không phải recall production đã xác nhận.

Bộ ảnh Drive mới được lưu nguyên bản ở `data/incoming/`; 654 JPEG derivative đã được promote cục bộ vào reference/test và `data/evaluation/manifest.json` đã được sinh offline, chưa seed online hoặc gọi model. Xem **[kế hoạch phân chia 1.632 ảnh đã kiểm kê trên Drive](data/DATASET_PLAN.md)** và **[cấu trúc bộ ảnh](data/README.md)**. `npm run dataset:check` kiểm tra thư mục/hash trùng; `npm run dataset:scan` cập nhật danh sách file; `npm run dataset:prepare` chuẩn hóa JPEG và sinh manifest không gọi model.

| Tiền tố file trong `data/references/` | Bảo vật |
| --- | --- |
| `1793866086668_` | Cánh cửa chạm rồng |
| `1793866086670_` | Hai thiếu nữ và em bé |
| `1793866086672_` | Bình phong — mặt lá cây |
| `1793866086674_` | Kết nạp Đảng ở Điện Biên Phủ |
| `1793866086676_` | Phật Bà Quan Âm |
| `1793866086678_` | Hoàng hậu Ngọc Trúc |
| `1793866086680_` | Em Thúy |
| `1793866086682_` | Bác Hồ ở chiến khu Việt Bắc |
| `1793866086684_` | Bình phong — mặt nhân vật |
| `1793868757527_` | Gióng |

Có thể thêm nguồn nghiên cứu vào `data/references/<mã-bảo-vật>/` rồi chạy `npm run dataset:scan`, nhưng thao tác đó **không đổi bộ production đã freeze**. Nguồn mới phải được duyệt và tạo release mới trước khi seed production; hoặc chủ động import qua UI (luồng thường có phí model). `catalog:seed -- <URL> --source-folders` là chế độ nguồn thư mục lịch sử/có thể gọi model, không dùng cho đợt triển khai bộ30 và không tự coi là có quyền thay catalog.

Khi dựng **database mới hoặc môi trường production**, người triển khai nạp bộ nguồn một lần qua API quản trị (server cần đang chạy, có key/provider và Vectorize đúng môi trường):

```powershell
# Cần Chromium của Playwright cho bộ chuẩn hóa JPEG dùng chung với UI
corepack pnpm@10 exec playwright install chromium
# Xem kế hoạch, không ghi dữ liệu/không gọi model
corepack pnpm@10 run catalog:seed -- http://localhost:5173
# Nạp bộ production đã duyệt: ảnh/vector exact-byte, không phát sinh phí model
corepack pnpm@10 run catalog:seed -- http://localhost:5173 --apply
```

Có thể dùng Chrome đã cài bằng biến `PLAYWRIGHT_EXECUTABLE_PATH` trỏ tới `chrome.exe`. Production dùng URL HTTPS và Access service token (`CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`). Script không thay đổi dữ liệu production khi chạy với URL localhost.

- Bộ30 đã chuẩn bị bằng shared JPEG95/max1600 sau crop nguồn đầy đủ pixel; seed kiểm tra hash và giữ nguyên byte, không crop/encode lần nữa. Luồng UI/chế độ source-folders vẫn dùng **`src/media.js`** để chuẩn hóa.
- Giữ nguyên ID hiện vật và external mapping đã có. Các mã `stamp-*` chỉ là ID tương thích lịch sử, **không có nghĩa ảnh tham chiếu còn là tem**.
- So khớp mã/tên hiện vật và hash JPEG để bỏ qua ảnh đã sẵn sàng, kể cả ảnh nhập trước với tên file khác. Chạy lại không tạo bản sao hoặc gọi model lại cho ảnh này.
- Chỉ xóa JPEG tem có hash khớp bộ cũ trong `data/Stamp`, qua API để dọn cả D1/R2/Vectorize; không xóa ảnh tùy chỉnh. Chỉ xóa tem của một bảo vật sau khi **tất cả ảnh thay thế** của nó sẵn sàng. Gióng đã có ảnh hiện vật thật, không dùng tem thay thế.
- `data/Stamp` chỉ giữ để nhận biết và dọn dữ liệu lịch sử, không được seed làm tham chiếu nữa. CLI `scripts/seed-stamps.mjs` đã bị chặn; dùng `catalog:seed`.
- Luồng thường cho retry/reprocess trên bản ghi cũ. Riêng release đã duyệt **không tự retry/reprocess hoặc fallback gọi provider**; lỗi/pending cần kiểm tra rồi sửa có chủ đích. Nếu Vectorize lỗi sau khi đã lưu vector D1, có thể reindex vector đó mà không gọi model.
- Prompt mô tả hiện vật dùng phiên bản `artifact-visible-en-v1`, không còn yêu cầu tìm tem; ảnh dùng prompt cũ phải reprocess, không trộn vector cũ và mới.
- Nạp bộ production30 đã đóng gói cần **0 lượt model mới**. Chạy lại bỏ qua ảnh ready cùng byte/signature. Không tự seed khi mở trang/build; deploy code riêng không cập nhật D1/R2/Vectorize. Nạp ảnh thường ngoài release vẫn có phí và chịu hạn mức.

### Import reference bổ sung

- Tạo một hiện vật theo tên, chọn hiện vật đó rồi chọn/chụp ảnh tham chiếu.
- Mỗi lượt tối đa **8 ảnh**, mỗi ảnh dưới **15 MB**.
- Xem trước từng ảnh và crop nếu cần; xác nhận **Nhập toàn ảnh** hoặc **Nhập ảnh đã cắt**. Hủy ảnh chưa xác nhận không gọi provider.
- Browser chuẩn hóa hướng ảnh, JPEG cạnh dài tối đa **1600 px**, không phóng lớn ảnh nhỏ. Crop là khung chữ nhật thủ công, **không có segmentation/xóa nền tự động**.
- Server lưu metadata và vector trong D1, JPEG trong R2 và vector trong Vectorize. Ảnh lỗi hiển thị lý do; dùng **Thử lại** trên bản ghi lỗi, không upload trùng.
- Có thể xem phóng to, xóa ảnh hoặc xóa hiện vật cùng các reference của nó.

### Nhận diện

- Cần ít nhất **hai hiện vật khác nhau có ảnh sẵn sàng** để tính chênh lệch với đối thủ.
- Dùng **Chụp ảnh nhận diện** để mở camera hoặc **Chọn ảnh nhận diện** để dùng file trên thiết bị.
- Camera: chọn **Khung dọc / Khung ngang**, đưa một hiện vật nằm trọn trong khung, chụp và xem trước ảnh đã cắt. Có **Chụp lại**; chỉ bấm **Nhận diện ảnh** mới gọi provider. JPEG gửi đi đúng byte đã xem trước, không crop/encode lần hai.
- File chọn từ thiết bị vẫn gửi toàn ảnh sau chuẩn hóa; chưa tối ưu thêm hoặc xóa tính năng upload. Không tự scan video, không gửi ngay khi chọn/chụp ảnh.
- Vẫn chuẩn hóa hướng EXIF, chuyển sang JPEG nền trắng và thu nhỏ cạnh dài tối đa **1600 px**, không phóng lớn ảnh nhỏ. Ảnh lỗi hoặc có một chiều dưới **64 px** không được gửi. Crop ảnh **tham chiếu** vẫn được giữ riêng trong luồng import.
- Kết quả gồm hiện vật khớp hoặc chưa đủ rõ, điểm cao nhất, chênh lệch, thời gian và bảng ứng viên. Thông số ngưỡng/số chiều nằm trong phần mở rộng.
- Ảnh query chỉ dùng xử lý; không thêm vào reference/R2. Mỗi lần xác nhận gửi tạo một lượt mới, kể cả cùng ảnh; scene guard có thể dừng trước embedding. Lỗi/mất phản hồi không tự retry và có thể đã tính lượt.

Luồng mặc định: **ảnh → AI mô tả → semantic scene guard → Gemini Embedding 2 với cả ảnh và mô tả trong một input → Vectorize → gom `max` theo hiện vật → ngưỡng + margin → quyết định theo family**. Scene guard dùng cách diễn đạt tường minh trong mô tả hiện có; đây là heuristic ngôn ngữ bảo thủ, không phải segmentation hoặc model vision độc lập. Cùng một prompt/model mô tả được dùng cho reference và query; không truyền nhãn đáp án vào prompt. Giao diện thử nghiệm có thể xem mô tả dùng để đối chiếu.

Ảnh thuộc pipeline cũ không được dùng lẫn với pipeline mới. Sau migration `0005_description_integration.sql`, dùng **Cập nhật mô tả và vector** ở từng reference để chuyển phiên bản; thao tác này có thể gọi model trả phí. Mô tả/vector đã hoàn tất được lưu để tái sử dụng khi retry. `RECOGNITION_PIPELINE=image-v1` chỉ giữ khả năng tương thích với pipeline ảnh thuần cũ.

## Tích hợp vào dự án chính

Giữ UI/UX của dự án đích và gọi dịch vụ từ backend. Đã có `POST /api/v1/recognitions`, `GET /api/v1/recognitions/{request_id}` và `GET /api/v1/catalog`, dùng token riêng, external ID, mã lỗi và idempotency 24 giờ. API nhận toàn ảnh đã chuẩn hóa; không bắt buộc crop. Idempotency này áp dụng cho `/api/v1`, còn công cụ thử nghiệm `/api/admin/query` vẫn gửi một lượt mới mỗi lần xác nhận.

Xem [gói tích hợp](integration/README.md), [OpenAPI](integration/openapi.json), [adapter backend](integration/client.mjs) và [kế hoạch đánh giá chín tem lịch sử](integration/STAMP_EVALUATION.md). Bộ tham chiếu đã đổi sang ảnh bảo vật; kết quả đánh giá tem cũ không đại diện cho bộ mới. Bộ ảnh hiện tại đã được đồng bộ lên [bản online](https://museum-embedding-lab.hoangdangww2810.workers.dev); đã kiểm tra ảnh hiển thị và giữ nguyên ID hiện vật, chưa kiểm chứng độ chính xác trên ảnh chụp bảo tàng.

## Camera

Camera trực tiếp có đổi camera, zoom **1×–4×** bằng hai ngón/thanh trượt/nút, và đèn nếu thiết bị hỗ trợ. Ưu tiên zoom phần cứng; API thiếu/lỗi/bỏ qua lệnh thì dùng zoom số. `camera-guide-v1` hiển thị khung dọc3:4 hoặc ngang4:3 và làm tối bên ngoài. Chỉ vùng chữ nhật đó được lấy từ pixel video gốc, tính đúng `object-fit:cover`, zoom số và kích thước viewport hiện tại; không chụp màn hình preview. Crop trước thu nhỏ JPEG95/max1600. Đây là hướng dẫn căn chủ thể, không phải object detector/segmentation. Đổi/đóng camera tắt track cũ; camera bị từ chối vẫn có thể chọn ảnh.

Cần HTTPS hoặc localhost và quyền camera. Kiểm thử mô phỏng không thay thế kiểm tra iPhone/Android thực tế.

## Bảo mật, chi phí và dữ liệu

- Toàn bộ app hiện là công cụ quản lý reference/nhận diện; production cần **Cloudflare Access bảo vệ trang `/` và API `/api/admin/*`, `/api/query`**. Khuyến nghị bảo vệ toàn hostname của công cụ. Worker kiểm tra Access cho trang chính và các API quản trị; đặt `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`.
- `ALLOW_ADMIN_LOCAL=true` chỉ cho phép bypass tại `localhost`/`127.0.0.1`, không mở qua hostname LAN.
- Hạn mức `DAILY_EMBEDDING_LIMIT`: production mặc định **200**, dev **30** lượt gọi model/ngày UTC. Ảnh mới đặt chỗ nguyên tử **2 lượt** trước provider: mô tả và embedding; lỗi vẫn tính lượt đã đặt chỗ. Retry có mô tả hợp lệ chỉ đặt chỗ một lượt embedding. Đặt bằng 0 để dừng lượt trả phí. Đây không phải ngân sách USD chính xác.
- Cosine không phải xác suất; ngưỡng `0.8`, margin `0.05` vẫn giữ nguyên. Production có thêm reject-only hard-negative guard riêng cho trường hợp tượng ngoài catalog giống Phật Bà Quan Âm: guard chỉ chạy khi ứng viên cao nhất là Phật Bà, so sánh candidate score với nhóm 7 vector hard-negative và chuyển sang `uncertain` nếu hard-negative vượt candidate quá `0.009`; guard không đổi ngưỡng chung, không đổi sang artifact khác. Hoàng hậu Ngọc Trúc và các hiện vật khác không bị ép phải có hard-negative.
- Policy `algorithm-first-v1` chạy semantic scene guard sau description: chỉ các mô tả nói rõ nhiều artwork/artifact mà không có primary target mới trả `uncertain` (`multiple_artifacts`), còn nhiều nhân vật/lá/panel bên trong một tác phẩm không bị tính nhầm. `no_clear_artifact` cũng trả `uncertain`; embedding và Vectorize không được gọi sau guard.
- Runtime family routing dùng `external_object_id`: 7 hiện vật phẳng được dành sẵn cổng planar geometry; hai tượng đi theo embedding, trong đó chỉ Phật Bà có hard-negative. `RECOGNITION_GEOMETRY_MODE=off` là mặc định production; chưa bật geometry rescue khi chưa có service binding trích xuất local features và ROI đã kiểm chứng. Không coi kết quả OpenCV offline là bằng chứng production. Xem [contract và điều kiện bật geometry](integration/GEOMETRY.md).
- Vector tham chiếu lưu D1 để reindex/retry có thể tái sử dụng mà không gọi embedding lại. Vectorize có thể cần thời gian cập nhật sau import.
- Giữ migration lịch sử để tương thích database đã áp dụng. Các bảng gameplay cũ không được dùng; bảng `usage_buckets` và `catalog_state` được tái sử dụng cho hạn mức và phiên bản danh mục. Migration `0005` bổ sung description, external ID và phản hồi yêu cầu tích hợp, không xóa reference.
- Không commit `.env`, `.dev.vars`, `dist/`; build Worker có thể chứa biến môi trường local.

## Quy ước cập nhật bản deploy

Theo yêu cầu của chủ dự án, mỗi thay đổi cần cập nhật **cả bản deploy**, không chỉ local:

1. Chạy kiểm thử liên quan và `npm run deploy` (build, migration remote, deploy Worker/assets).
2. Khi đổi bộ ảnh, sao lưu metadata/ảnh cũ vào `reports/` trước khi dọn dữ liệu, sau đó chạy `npm run catalog:seed -- https://museum-embedding-lab.hoangdangww2810.workers.dev --apply`. Deploy code không tự thay dữ liệu D1/R2/Vectorize.
3. Kiểm tra API và giao diện online; báo rõ nếu deploy hoặc đồng bộ dữ liệu bị chặn. Không commit backup hoặc secrets.

## Demo và kiểm thử không tốn API

```powershell
corepack pnpm@10 run build
node scripts/demo-server.mjs
```

Mở **http://localhost:4179**. Demo có 5 hiện vật mẫu, D1/R2 trong RAM và OpenRouter/Vectorize mô phỏng; nhận diện mặc định khớp hiện vật đầu tiên, không chứng minh chất lượng model. Dữ liệu demo mất khi dừng server. Không dùng server demo trong production.

```powershell
corepack pnpm@10 run test
corepack pnpm@10 run build
corepack pnpm@10 exec playwright test
```

Xem [TESTING.md](TESTING.md) để biết phạm vi kiểm tra và giới hạn môi trường.

## Đánh giá offline và dựng lại chỉ mục

Dataset MET và lab cũ đã được gỡ khỏi dự án. Script `scripts/recognition-eval.mjs` hỗ trợ cả manifest ảnh thuần lịch sử và manifest mới có metadata `pipeline` cho description + ảnh: xem [hướng dẫn đánh giá tem](integration/STAMP_EVALUATION.md). Chép ảnh test theo [hướng dẫn bộ ảnh](data/README.md), chạy `npm run dataset:prepare` để sinh `data/evaluation/manifest.json` trước khi chạy các lệnh `eval:*`. Lệnh `eval:embed` gọi provider trả phí trực tiếp, ngoài hạn mức Worker.

### Hard-negative riêng cho tượng dễ nhầm Phật Bà Quan Âm

Owner đã duyệt áp dụng riêng nhóm tượng ngoài catalog `R0745–R0751`. Migration `0006` lưu **7 vector reject-only** trong bảng D1 `recognition_hard_negatives`, gắn với external ID `stamp-phat-ba-quan-am` và cùng pipeline signature; không tạo artifact/reference và không thêm vector này vào Vectorize.

```powershell
npm run hard-negative:seed -- https://museum-embedding-lab.hoangdangww2810.workers.dev
npm run hard-negative:seed -- https://museum-embedding-lab.hoangdangww2810.workers.dev --apply
```

Lệnh dùng `data/evaluation/full-calibration-manifest.json` và cache `full-calibration-embeddings.json` hiện có, **không gọi provider**. Không có `--apply` thì chỉ đọc và kiểm tra. Admin API kiểm tra signature, normalize vector, thay nhóm nguyên tử và tăng catalog revision. `GET /api/admin/hard-negatives` trả metadata nhóm, không trả ảnh/vector.

Rule: sau khi score/margin cơ bản đạt, chỉ veto nếu `candidate_score - max(hard_negative_cosine) < RECOGNITION_HARD_NEGATIVE_GAP`. Owner đã duyệt đổi riêng gap production từ **`-0.08` sang `-0.009`** cho bank30; threshold `0.8`, margin `0.05`, geometry `off` và 7 vector negative giữ nguyên. Dev vẫn giữ gap `-0.08`. Guard chỉ dành cho Phật Bà, không mở bank Hoàng hậu. Ngưỡng mới được chọn offline từ calibration, loại nguồn query trùng reference, bỏ self-vector và thử bỏ thêm từng vector bank; trung điểm khoảng phân cách bền hơn được làm tròn thành `-0.009`. Trên cache ảnh gốc, ứng viên giữ 55/62 Phật Bà đúng và không còn negative nhận thành Phật Bà; vẫn có 2 ambiguous nhận thành Bình phong. Đây không phải kiểm định độc lập hoặc fresh-provider/live-Vectorize accuracy: các ảnh tương quan cùng object/session, image-jackknife còn nhạy với R0745, và lỗi upload mới chưa được tái hiện. Chi tiết nghiên cứu và giới hạn ở `reports/hard-negative-gap-research-v1/decision.md`; bằng chứng rollout ở `reports/production-gap-minus-0009-v1/` (đều gitignored). Không dùng các số lịch sử của bộ10 hoặc bộ45 để xác nhận bank30.

Ảnh bank từ calibration nay là **dữ liệu guard đã học**, không còn là unknown holdout độc lập. Nghiên cứu có leave-one-out để tránh so một ảnh với chính nó nhưng các ảnh vẫn cùng object/session. Nếu thay bộ reference, phải đánh giá lại guard; không áp gap production cho bộ 45 reference rồi coi là cùng policy. Request tích hợp đã có idempotency key vẫn replay kết quả cũ trong 24 giờ; dùng lượt/key mới để thử policy mới.

Dựng lại Vectorize từ vector/reference đã lưu:

```powershell
corepack pnpm@10 run catalog:reindex -- http://localhost:5173
```

Production cần Access service token được cấp phép (`CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` trong shell). Không in/commit secrets; giữ backup D1/R2.
