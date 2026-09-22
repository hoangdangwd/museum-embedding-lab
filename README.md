**Embedding Lab — thử nhận diện hiện vật bằng ảnh**

Ứng dụng thử nghiệm chạy trên máy, gửi ảnh đến **OpenRouter để tạo image embedding**, rồi so sánh cosine với bộ ảnh tham chiếu. Mặc định: `google/gemini-embedding-2`. Đã chạy khảo sát thực tế trên bộ ảnh trong `image/`; xem kết quả và quy trình test tiếp theo trong [TESTING.md](TESTING.md).

**Chạy ngay trên máy này**

Môi trường `.venv` đã được chuẩn bị. Điền key vào `.env` trong thư mục dự án:

```dotenv
EMBEDDING_PROVIDER=openrouter
OPENROUTER_API_KEY=YOUR_KEY_HERE
OPENROUTER_MODEL=google/gemini-embedding-2
EMBEDDING_VERSION=1
```

Mở PowerShell tại thư mục dự án và chạy:

```powershell
.\start.ps1
```

Nếu PowerShell chặn script, dùng lệnh tương đương:

```powershell
.\.venv\Scripts\python.exe -m uvicorn lab.app:app --host 127.0.0.1 --port 8000
```

Mở **http://127.0.0.1:8000**. Khi sửa `.env`, dừng server bằng Ctrl+C rồi chạy lại. Không đưa API key vào giao diện hoặc mã JavaScript; `.env` đã nằm trong `.gitignore`.

**Cách test trên giao diện**

Khi mở ứng dụng, nhập **tên người dùng** để bắt đầu; không cần mật khẩu. Tên được giữ trong cookie phiên tối đa 7 ngày và hiển thị trên trang chính. Bấm **Đổi tên người dùng** để kết thúc phiên và nhập tên khác. Đây là tên hiển thị, không phải tài khoản riêng; bộ ảnh tham chiếu vẫn dùng chung.

1. Điền tên/mã hiện vật, ví dụ `binh-gom-01`; chọn nhiều ảnh của đúng vật đó rồi bấm **Thêm ảnh tham chiếu**.
2. Lặp lại với các vật khác. Nên có ít nhất 2 vật để kiểm tra độ phân biệt; lý tưởng là 5–7 vật và 8–12 ảnh/vật.
3. Bấm **Tạo embedding**. Chỉ ảnh chưa có vector của model hiện tại mới được gửi đi; nếu lỗi giữa chừng, bấm lại để tiếp tục.
4. Chọn một ảnh mới trong **Thử một ảnh mới**, chọn hiện vật mục tiêu nếu cần, rồi bấm **Tạo embedding & tìm hiện vật**.
5. Xem top hiện vật, ảnh tham chiếu gần nhất, cosine, chênh lệch top 1–2, chiều vector và thời gian embedding/tìm kiếm. Có thể tải JSON chứa toàn bộ vector truy vấn.

Tab **So sánh 2 ảnh** hoạt động ngay cả khi chưa có bộ tham chiếu: tải ảnh A và B, ứng dụng gọi embedding riêng cho mỗi ảnh và hiển thị cosine giữa hai vector.

Ảnh JPEG, PNG và WebP được hỗ trợ, tối đa 15 MB và 30 megapixel mỗi ảnh. HEIC cần xuất sang JPEG. Hệ thống xoay theo EXIF, chuyển RGB, đặt nền trắng cho ảnh trong suốt, giới hạn cạnh dài 1600 pixel và mã hóa JPEG trước khi gửi model. Cùng một quy trình được dùng cho ảnh mẫu và ảnh test.

**Đọc kết quả đúng cách**

- Điểm hiện vật là cosine cao nhất trong các góc tham chiếu của vật đó. Top 1 và top 2 luôn là hai hiện vật khác nhau.
- `0.80` và khoảng cách `0.05` trên giao diện chỉ là giá trị thử ban đầu, chưa được hiệu chỉnh cho model/dữ liệu của bạn.
- Cosine **không phải xác suất đúng**. Kết quả “phù hợp với ngưỡng” chưa chứng minh hai ảnh là cùng một hiện vật.
- Nếu chỉ có một hiện vật, ứng dụng vẫn trả điểm nhưng không tự xác nhận vì chưa đánh giá được độ phân biệt.
- Điểm thấp → `low_similarity`; hai ứng viên sát nhau → `ambiguous`; ứng viên rõ nhất khác mục tiêu → `wrong_target`.
- Ảnh trùng tham chiếu được cảnh báo, không xem là bằng chứng model nhận được góc mới.
- Nếu đổi model, ảnh gốc được giữ và vector cũ được tách riêng. Bấm tạo embedding để xây bộ vector của model mới. Nếu provider cập nhật model dưới cùng tên, tăng `EMBEDDING_VERSION` để tránh dùng lại cache cũ.

**Chuẩn bị bộ ảnh để đo theo lô**

Có thể tải trực tiếp trên web, hoặc sắp xếp ảnh theo thư mục:

```text
data/
  references/
    binh-gom-01/
      front.jpg
      side.jpg
    binh-gom-02/
      front.jpg
      side.jpg
  test/
    binh-gom-01/
      new-angle.jpg
    binh-gom-02/
      low-light.jpg
    _unknown/
      object-not-in-catalog.jpg
```

Tên thư mục con phải khớp tên/mã hiện vật. `_unknown` dành cho ảnh ngoài danh mục. Giữ ảnh test tách biệt; nên chụp vào buổi khác, đổi nền/ánh sáng, có vật dễ nhầm và ảnh qua kính. Không chia những ảnh liên tiếp gần giống nhau vào cả bộ mẫu lẫn bộ test.

```powershell
# Nhập ảnh và tạo vector
.\.venv\Scripts\python.exe -m lab.cli import data/references
.\.venv\Scripts\python.exe -m lab.cli index

# Thử một ảnh
.\.venv\Scripts\python.exe -m lab.cli query data/test/binh-gom-01/new-angle.jpg --target binh-gom-01

# Đánh giá bộ test; tạo reports/evaluation.json và reports/evaluation.csv
.\.venv\Scripts\python.exe -m lab.cli evaluate data/test --threshold 0.8 --margin 0.05
```

Báo cáo bao gồm số mẫu, số lỗi, ảnh test trùng tham chiếu bị loại, top-1 accuracy, precision của các lần chấp nhận, tỷ lệ nhận đúng và tỷ lệ nhận nhầm ảnh ngoài danh mục. Trường hợp không có mẫu phù hợp được báo `null`, không phải 0%. Báo cáo đánh giá tìm kiếm theo danh mục, chưa đánh giá đầy đủ việc chọn sai mục tiêu nhiệm vụ. Không dùng tập test để chọn ngưỡng rồi báo đó là độ chính xác độc lập.

**Lưu trữ và giới hạn vận hành**

Ảnh tham chiếu đã chuẩn hóa và vector lưu trong `data/lab.sqlite3`, giữ nguyên qua các lần khởi động. Ảnh test không được lưu vào database; server chỉ dùng chúng để xử lý request. Khi dùng OpenRouter, ảnh được gửi đến OpenRouter/provider và chịu chính sách xử lý dữ liệu của các dịch vụ đó. Mỗi lần so sánh 2 ảnh gọi embedding 2 lần; mỗi truy vấn gọi 1 lần; thông tin `usage` được giữ trong kết quả JSON nếu provider trả về.

Bản chạy trên máy mặc định chỉ lắng nghe `127.0.0.1`. Ứng dụng dùng phiên theo tên hiển thị, chưa có tài khoản riêng hoặc hàng đợi tác vụ. Thời gian hiển thị là thời gian xử lý server, chưa gồm upload từ trình duyệt. Giao diện chưa phải ứng dụng sưu tập tem.

**Cài trên máy mới và kiểm thử mã**

Yêu cầu Python 3.11 trở lên:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
Copy-Item .env.example .env
.\.venv\Scripts\python.exe -m pytest -q
```

Kiểm thử giao diện trên Windows có Edge: `.\.venv\Scripts\python.exe -m tests.ui_smoke`. Lượt kiểm thử này dùng model giả lập và database riêng trong `reports/ui-smoke/`, không thêm ảnh thử vào bộ tham chiếu của bạn.

Các test tự động dùng vector fixture và phản hồi HTTP giả lập để kiểm tra luồng, chống trộn model, ảnh sai, tiếp tục index sau lỗi và đo lường. Chúng **không đo chất lượng của model OpenRouter thật**. Việc đó cần API key và bộ ảnh của bạn.

Hỗ trợ tùy chọn model local: cài `requirements-local.txt`, đặt `EMBEDDING_PROVIDER=local`, rồi chạy `python -m lab.cli prepare` để tải SigLIP 2. Nhánh local chưa được kiểm chứng bằng lượt suy luận thật trong phiên triển khai này.

Mã chính: `lab/images.py` đọc ảnh; `lab/embeddings.py` gọi model; `lab/store.py` lưu ảnh/vector; `lab/service.py` lập chỉ mục và so sánh; `lab/app.py` cung cấp API; `lab/cli.py` nhập/đánh giá theo thư mục. Tài liệu API tương tác tại **http://127.0.0.1:8000/docs**.

Định dạng OpenRouter được đối chiếu với [schema chính thức](https://openrouter.ai/openapi.json) và [API embeddings](https://openrouter.ai/docs/api/api-reference/embeddings/submit-an-embedding-request): `input` chứa các object `content`, mỗi ảnh là một phần `image_url` dạng data URL. Model được kiểm tra có `image` trong `input_modalities` trước khi gửi ảnh, dựa trên [danh mục embedding models](https://openrouter.ai/api/v1/embeddings/models).
