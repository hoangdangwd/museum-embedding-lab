# Nhận diện hiện vật

Ứng dụng dành cho người dùng: nhập tên → mở camera → chụp ảnh → xem tên vật hoặc “Chưa nhận ra” → chụp lại. Ảnh chụp được gửi đến OpenRouter để tạo embedding rồi đối chiếu bộ tham chiếu do dev chuẩn bị.

Giao diện không có tải ảnh từ thư viện, quản lý ảnh mẫu, chỉnh ngưỡng, so sánh hai ảnh hay thông tin model/vector. API công khai chỉ phục vụ phiên người dùng, trạng thái sẵn sàng và nhận diện; không có API sửa bộ tham chiếu.

## Chạy local

Yêu cầu Python 3.11 trở lên:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
Copy-Item .env.example .env
```

Điền `OPENROUTER_API_KEY` vào `.env`. Mặc định dùng `google/gemini-embedding-2`.

Dev chuẩn bị ảnh ở `data/references/<tên-vật>/*.jpg`, sau đó nhập và tạo vector:

```powershell
.\.venv\Scripts\python.exe -m lab.cli import data/references
.\.venv\Scripts\python.exe -m lab.cli index
.\start.ps1
```

Mở http://127.0.0.1:8000. Camera cần HTTPS hoặc localhost và quyền truy cập camera của trình duyệt. Nhập tên bất kỳ; không cần mật khẩu. Biểu tượng người dùng ở góc trên cho phép đổi tên.

Dev nhập ảnh qua CLI; người dùng web chỉ chụp để nhận diện. Ảnh chụp không được thêm vào database. Các file `.env`, database, ảnh nguồn và báo cáo không nằm trong Git.

## Bộ tham chiếu và Cloudflare

Bộ đang sử dụng gồm **16 ảnh / 8 nhóm vật**: chai nước, thùng máy tính, lon Coca-Cola, mô hình, chìa khóa, laptop, khẩu trang, lon Pepsi. Vector đã tính có 3072 chiều, lưu trong `data/image-baseline-v1/lab.sqlite3` trên máy dev; dữ liệu này không được đưa lên repo public.

Dev xuất các vector đã có sang SQL rồi nạp vào D1:

```powershell
.\.venv\Scripts\python.exe -m scripts.export_catalog data/image-baseline-v1/lab.sqlite3 --output reports/deploy/catalog.sql
npx --yes wrangler@4.136.2 d1 execute museum-embedding-lab --remote --file reports/deploy/catalog.sql --yes
npx --yes wrangler@4.136.2 deploy
```

SQL tạo bảng `recognition_references` và upsert nhãn/vector theo signature + digest, không xóa các bản ghi khác. Chạy lại không nhân đôi cùng ảnh. Để thay hẳn một bộ tham chiếu, dev dùng version mới, tạo lại vector và đồng bộ `EMBEDDING_VERSION` trước khi deploy. Script chỉ xuất khi tất cả ảnh có vector đúng model/version và đã chuẩn hóa.

Bản nhận diện chỉ cần nhãn/vector; ảnh gốc giữ ở máy dev. Việc xuất SQL không gọi OpenRouter. Ảnh tham chiếu được chuẩn hóa bằng Pillow; ảnh camera dùng canvas của trình duyệt, cùng RGB/JPEG chất lượng 95 và cạnh dài tối đa 1600 px nhưng hai bộ mã hóa có thể tạo pixel hơi khác nhau.

Trên tài khoản Cloudflare mới, dev tạo D1 rồi cập nhật binding trong `wrangler.jsonc`, cấu hình secret `OPENROUTER_API_KEY` và `SESSION_SECRET` qua Wrangler. Bản deploy hiện tại có thể tái sử dụng secret cũ `ACCESS_PASSWORD` để ký cookie; secret này không còn được dùng làm mật khẩu đăng nhập.

`RECOGNITION_THRESHOLD` và `RECOGNITION_MARGIN` do dev cấu hình trên server, mặc định 0.8 và 0.05. Tham số gửi từ trình duyệt không thay đổi các ngưỡng này. Kết quả chỉ trả tên vật khi đạt cả hai ngưỡng; trường hợp chưa rõ trả “Chưa nhận ra”. Đây là ngưỡng thử nghiệm, chưa phải độ chính xác được bảo đảm.

## Kiểm thử cho dev

```powershell
.\.venv\Scripts\python.exe -m pytest -q
node --test tests/worker-session.test.mjs
.\.venv\Scripts\python.exe -m tests.ui_smoke
```

Kiểm thử giao diện dùng Edge headless, camera giả lập bằng luồng video và model fixture: chụp → tự nhận diện → chụp lại, lỗi quyền camera, kết quả không rõ, lỗi server và bố cục điện thoại. Không gọi API embedding thật.

CLI vẫn hỗ trợ `query` và `evaluate` để dev xem điểm số và kiểm tra chất lượng bộ ảnh. Xem [TESTING.md](TESTING.md) để biết khảo sát trước đây; các mô tả giao diện trong khảo sát đó thuộc bản thử nghiệm cũ.