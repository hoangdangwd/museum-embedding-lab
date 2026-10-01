# Nhận diện hiện vật qua ảnh

Ứng dụng React/Vite + Cloudflare Worker với ba chức năng chính:

1. **Tạo/chọn hiện vật** trong danh mục.
2. **Import ảnh tham chiếu**: chọn/chụp ảnh, xem trước/crop, xác nhận nhập và xem trạng thái xử lý.
3. **Nhận diện ảnh mới**: chụp bằng camera trực tiếp hoặc chọn ảnh từ thiết bị, xem trước/crop, xác nhận gửi rồi xem kết quả và ứng viên.

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

## Bộ ảnh tham chiếu có sẵn: 9 tem

Chín ảnh nguồn trong `data/Stamp` và tên/mã trong `data/Stamp/catalog.json` được giữ cùng mã nguồn. **Danh mục dev hiện tại đã được nạp đủ 9 tem**, mỗi tem có một JPEG, mô tả và vector thật. Người dùng mở ứng dụng là có thể chọn tem để xem ảnh hoặc nhận diện, không cần tự import. Giao diện tự chọn một hiện vật có ảnh sẵn sàng khi mở trang.

Khi dựng **database mới hoặc môi trường production**, người triển khai nạp bộ nguồn một lần qua API quản trị (server cần đang chạy, có key/provider và Vectorize đúng môi trường):

```powershell
# Cần Chromium của Playwright cho bộ chuẩn hóa JPEG dùng chung với UI
corepack pnpm@10 exec playwright install chromium
# Xem kế hoạch, không ghi dữ liệu/không gọi model
corepack pnpm@10 run catalog:seed -- http://localhost:5173
# Nạp mẫu còn thiếu; dùng pipeline và hạn mức của Worker
corepack pnpm@10 run catalog:seed -- http://localhost:5173 --apply
```

Có thể dùng Chrome đã cài bằng biến `PLAYWRIGHT_EXECUTABLE_PATH` trỏ tới `chrome.exe`. Production dùng URL HTTPS và Access service token (`CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`). Script không thay đổi dữ liệu production khi chạy với URL localhost.

- Chuẩn hóa WebP có alpha thành JPEG nền trắng, cạnh dài tối đa 1600 px, chất lượng 0.95 bằng **`src/media.js`**, giữ nguyên ảnh nguồn.
- Dùng mã tem làm `external_object_id` cho hiện vật mới; nếu hiện vật cùng tên đã tồn tại thì giữ nguyên mapping. Khi tích hợp dự án chính, ánh xạ lại sang ID thật nếu cần.
- So khớp mã/tên hiện vật và hash JPEG để bỏ qua ảnh đã sẵn sàng, kể cả ảnh nhập trước với tên file khác. Chạy lại không tạo bản sao hoặc gọi model lại cho ảnh này.
- Ảnh lỗi được retry trên bản ghi cũ, tận dụng mô tả/vector đã lưu; ảnh pipeline cũ được reprocess. Không gửi lại ảnh đang `pending`; lỗi được báo và script thoát khác 0.
- Nạp mới cả bộ cần **18 lượt model** (9 mô tả + 9 embedding). Không tự chạy seed/model khi người dùng mở trang hoặc build; metadata/ảnh/vector được giữ trong D1/R2/Vectorize, không chỉ là ảnh minh họa trên UI.

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
- Xem trước/crop rồi bấm **Nhận diện ảnh**. Không tự scan video, không gửi ngay khi chọn/chụp ảnh.
- Kết quả gồm hiện vật khớp hoặc chưa đủ rõ, điểm cao nhất, chênh lệch, thời gian và bảng ứng viên. Thông số ngưỡng/số chiều nằm trong phần mở rộng.
- Ảnh query chỉ dùng xử lý; không thêm vào reference/R2. Mỗi lần xác nhận gửi gọi embedding mới, kể cả cùng ảnh; lỗi/mất phản hồi không tự retry và có thể đã tính lượt.

Luồng mặc định: **ảnh → AI mô tả → Gemini Embedding 2 với cả ảnh và mô tả trong một input → Vectorize → gom `max` theo hiện vật → ngưỡng + margin**. Cùng một prompt/model mô tả được dùng cho reference và query; không truyền nhãn đáp án vào prompt. Giao diện thử nghiệm có thể xem mô tả dùng để đối chiếu.

Ảnh thuộc pipeline cũ không được dùng lẫn với pipeline mới. Sau migration `0005_description_integration.sql`, dùng **Cập nhật mô tả và vector** ở từng reference để chuyển phiên bản; thao tác này có thể gọi model trả phí. Mô tả/vector đã hoàn tất được lưu để tái sử dụng khi retry. `RECOGNITION_PIPELINE=image-v1` chỉ giữ khả năng tương thích với pipeline ảnh thuần cũ.

## Tích hợp vào dự án chính

Giữ UI/UX của dự án đích và gọi dịch vụ từ backend. Đã có `POST /api/v1/recognitions`, `GET /api/v1/recognitions/{request_id}` và `GET /api/v1/catalog`, dùng token riêng, external ID, mã lỗi và idempotency 24 giờ. API nhận toàn ảnh đã chuẩn hóa; không bắt buộc crop. Idempotency này áp dụng cho `/api/v1`, còn công cụ thử nghiệm `/api/admin/query` vẫn gửi một lượt mới mỗi lần xác nhận.

Xem [gói tích hợp](integration/README.md), [OpenAPI](integration/openapi.json), [adapter backend](integration/client.mjs) và [kế hoạch đánh giá chín tem](integration/STAMP_EVALUATION.md). Chưa deploy remote hoặc kiểm chứng độ chính xác trên ảnh chụp bảo tàng.

## Camera

Camera trực tiếp có đổi camera, zoom **1×–4×** bằng hai ngón/thanh trượt/nút, và đèn nếu thiết bị hỗ trợ. Ưu tiên zoom phần cứng; API thiếu/lỗi/bỏ qua lệnh thì dùng zoom số. Ảnh chụp tương ứng vùng đang thấy trong khung ngắm. Đổi/đóng camera tắt track cũ; camera bị từ chối vẫn có thể chọn ảnh.

Cần HTTPS hoặc localhost và quyền camera. Kiểm thử mô phỏng không thay thế kiểm tra iPhone/Android thực tế.

## Bảo mật, chi phí và dữ liệu

- Toàn bộ app hiện là công cụ quản lý reference/nhận diện; production cần **Cloudflare Access bảo vệ trang `/` và API `/api/admin/*`, `/api/query`**. Khuyến nghị bảo vệ toàn hostname của công cụ. Worker kiểm tra Access cho trang chính và các API quản trị; đặt `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`.
- `ALLOW_ADMIN_LOCAL=true` chỉ cho phép bypass tại `localhost`/`127.0.0.1`, không mở qua hostname LAN.
- Hạn mức `DAILY_EMBEDDING_LIMIT`: production mặc định **200**, dev **30** lượt gọi model/ngày UTC. Ảnh mới đặt chỗ nguyên tử **2 lượt** trước provider: mô tả và embedding; lỗi vẫn tính lượt đã đặt chỗ. Retry có mô tả hợp lệ chỉ đặt chỗ một lượt embedding. Đặt bằng 0 để dừng lượt trả phí. Đây không phải ngân sách USD chính xác.
- Cosine không phải xác suất; ngưỡng `0.8`, margin `0.05` là cấu hình khởi đầu, chưa xác nhận trên ảnh triển khai.
- Vector tham chiếu lưu D1 để reindex/retry có thể tái sử dụng mà không gọi embedding lại. Vectorize có thể cần thời gian cập nhật sau import.
- Giữ migration lịch sử để tương thích database đã áp dụng. Các bảng gameplay cũ không được dùng; bảng `usage_buckets` và `catalog_state` được tái sử dụng cho hạn mức và phiên bản danh mục. Migration `0005` bổ sung description, external ID và phản hồi yêu cầu tích hợp, không xóa reference.
- Không commit `.env`, `.dev.vars`, `dist/`; build Worker có thể chứa biến môi trường local.

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

Dataset MET và lab cũ đã được gỡ khỏi dự án. Script `scripts/recognition-eval.mjs` hỗ trợ cả manifest ảnh thuần lịch sử và manifest mới có metadata `pipeline` cho description + ảnh: xem [hướng dẫn đánh giá tem](integration/STAMP_EVALUATION.md). Chuẩn bị `data/evaluation/manifest.json` trước khi chạy các lệnh `eval:*`. Lệnh `eval:embed` gọi provider trả phí trực tiếp, ngoài hạn mức Worker.

Dựng lại Vectorize từ vector/reference đã lưu:

```powershell
corepack pnpm@10 run catalog:reindex -- http://localhost:5173
```

Production cần Access service token được cấp phép (`CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` trong shell). Không in/commit secrets; giữ backup D1/R2.
