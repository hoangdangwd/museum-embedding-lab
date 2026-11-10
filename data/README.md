# Bộ ảnh bảo vật: tham chiếu và kiểm thử tách riêng

**Nguồn production đã duyệt:30 ảnh/9 bảo vật**, ở `production-catalog.json` và `catalog-releases/crop-bank30-v1/`, gồm10 baseline nguyên byte live +20 crop mới, loạiR1090. `npm run catalog:seed -- <HTTPS URL> --apply` mặc định chỉ nạp bộ này bằng vector/mô tả tin cậy đóng gói trong Worker, **0 paid calls**. Hash ảnh/external ID/release/signature phải khớp; không fallback provider và không nhận vector từ client. Bộ30 là hậu kiểm cùng phiên, chưa có xác nhận độc lập; không tự dọn/đổi official partition hay seed query.

Thư mục nghiên cứu lịch sử vẫn có **45 ảnh tham chiếu cho 9 bảo vật**, gồm **Gióng** và nhiều góc nhìn của **Bình phong**. 10 ảnh baseline ban đầu vẫn được giữ nguyên; 35 ảnh Drive mới được thêm dưới dạng JPEG chuẩn hóa có truy vết. Ảnh gốc không bị di chuyển, crop hoặc ghi đè. ID `stamp-*` là mã tương thích lịch sử, không phải ảnh tem.

## Bộ ảnh Drive mới — đã promote cục bộ, chưa seed online

Đã tải đủ **1.632/1.632 ảnh, 2,283 GB**, vào `data/incoming/drive-1jYzY5U3Yc6R_3CdUz7h0T8rYOBFGb7VH/originals/`, giữ nguyên 11 thư mục nguồn; hash đối chiếu đủ, metadata đều đọc được. Danh sách Drive hiện có **1.632 ảnh** (827 ảnh trong 9 thư mục bảo vật, 805 trong `Khác`/`Khác 2`), gồm **1.443 HEIC + 189 JPG**. `incoming/` được Git ignore. Đã copy cục bộ 35 reference + 436 calibration + 183 final từ staging JPEG; 15 ảnh `_low_quality`/`_ambiguous` được đặt vào nhóm negative tương ứng. Chưa seed/deploy online.

Xem **[kế hoạch chia tập và ngân sách](DATASET_PLAN.md)** trước khi xử lý. HEIC cần chuyển đổi có truy vết; không chỉ đổi đuôi file hay chép trực tiếp vào thư mục được scanner quét. Hai thư mục Khác cần duyệt nhãn vì có thể vẫn chứa 9 bảo vật.

## Camera crop và đợt đánh giá mới

Camera hiện có khung dọc/ngang và crop thật trước khi nhận diện; file upload chưa thêm crop. Xem **[kế hoạch crop toàn dataset, ngân sách và ranh giới reference/test](CAMERA_CROP_PLAN.md)**. `python scripts/build-camera-crop-queue.py` tạo queue1642ảnh offline, không tự duyệt ROI/nhãn hoặc gọi provider. Mô tả/vector toàn ảnh không được gắn lại cho crop mới. Pilot crop đã chạy: bộ30 hậu kiểm đạt32/37 known đúng và0/16 negative false accept trên chính53 query phát triển đã xem; không phải independent validation hoặc phép so crop-vs-whole. Phạm vi production được duyệt riêng chỉ gồm30 ảnh đóng gói; xem `reports/production-bank30-v1/`.

## Đặt ảnh vào đâu?

```text
data/
  artifacts.json                         # Mã/tên bảo vật + danh sách tham chiếu do scan sinh ra
  references/
    stamp-giong/                         # Chỉ ảnh muốn đưa vào chỉ mục nhận diện
      1793868757527_....jpg
      mat-truoc/anh-002.jpg               # Có thể tự chia thêm góc/mặt/buổi chụp
    stamp-binh-phong/                     # Hai mặt cùng một bảo vật, không tách ID
    ...                                  # Đã tạo đủ thư mục cho 9 bảo vật
  test/
    stamp-giong/
      calibration/                       # Dùng chọn ngưỡng
        known_clean/                     # Ảnh rõ, ít nền
        known_clutter/                   # Góc nghiêng, nền phức tạp, phản chiếu...
      final/                             # Chỉ dùng đánh giá sau khi chốt ngưỡng
        known_clean/
        known_clutter/
    stamp-binh-phong/
      calibration/known_clean/
      calibration/known_clutter/
      final/known_clean/
      final/known_clutter/
    ...                                  # Đã tạo cùng cấu trúc cho 9 bảo vật
    _unknown/{calibration,final}/         # Vật không thuộc 9 bảo vật trong danh mục
    _ambiguous/{calibration,final}/       # Nhiều vật/không có đáp án duy nhất
    _low_quality/{calibration,final}/     # Mờ/tối/quá kém, mong muốn từ chối
  evaluation/                            # JPEG + manifest sinh tự động, không sửa tay
  Stamp/                                 # Nguồn tem cũ chỉ để dọn dữ liệu lịch sử
```

### Mã thư mục

| Mã | Bảo vật |
| --- | --- |
| `stamp-bac-ho-viet-bac` | Bác Hồ ở chiến khu Việt Bắc |
| `stamp-binh-phong` | Bình phong (cả hai mặt) |
| `stamp-canh-cua-cham-rong` | Cánh cửa chạm rồng |
| `stamp-em-thuy` | Em Thúy |
| `stamp-giong` | Gióng |
| `stamp-hai-thieu-nu-em-be` | Hai thiếu nữ và em bé |
| `stamp-hoang-hau-ngoc-truc` | Hoàng hậu Ngọc Trúc |
| `stamp-ket-nap-dang-dien-bien` | Kết nạp Đảng ở Điện Biên Phủ |
| `stamp-phat-ba-quan-am` | Phật Bà Quan Âm |

## Quy trình thêm khoảng 2.000 ảnh

1. Chia ảnh theo **bảo vật**, sau đó chia **tham chiếu/test**. Không cần tạo 2.000 thư mục cho từng file. JPG/JPEG/PNG/WebP (mỗi ảnh tối đa 15 MB), có thể thêm thư mục con cho buổi chụp hoặc góc nhìn.
2. Giữ ảnh test **độc lập**: không dùng lại file, bản crop/resize hoặc ảnh gần trùng của reference. Tách theo buổi chụp/thiết bị/người chụp giữa reference, calibration và final để tránh kết quả đẹp giả. Lệnh kiểm tra chỉ phát hiện bản trùng byte; bước chuẩn hóa còn phát hiện JPEG chuẩn hóa trùng, không phát hiện mọi ảnh gần trùng.
3. Có thể bắt đầu khoảng **20% reference / 40% calibration / 40% final**, không phải tỷ lệ bắt buộc. Cần đại diện đủ góc/mặt/ánh sáng, cả unknown/ambiguous/low_quality; không cần nạp tất cả ảnh làm reference. Bộ local hiện đã có 45 reference và 619 ảnh test; không sao chép reference sang test.
4. Sau khi chép ảnh, chạy:

   ```powershell
   npm run dataset:check                 # Kiểm tra tên thư mục, dung lượng, hash trùng; không ghi
   npm run dataset:scan                  # Kiểm tra + cập nhật files trong artifacts.json
   npm run dataset:prepare               # Decode/chuẩn hóa JPEG và sinh manifest đánh giá
   ```

   Ba lệnh này **không gọi model, không có phí API, không thay dữ liệu online**. `check`/`scan` chỉ kiểm tra cấu trúc/hash, không chứng minh file giải mã được; `prepare` giải mã bằng Chromium dùng chung `src/media.js` với UI. Cần Playwright Chromium hoặc `PLAYWRIGHT_EXECUTABLE_PATH`. Chưa có test trong cả calibration và final thì `prepare` báo thiếu và không sinh manifest mới.

5. Nạp **chỉ references/** lên online (có phí cho ảnh mới):

   ```powershell
   npm run catalog:seed -- https://museum-embedding-lab.hoangdangww2810.workers.dev
   npm run catalog:seed -- https://museum-embedding-lab.hoangdangww2810.workers.dev --apply
   ```

   **Mặc định seed dùng production-catalog30 đã freeze**, không tự quét45 nguồn nghiên cứu. Chỉ `--source-folders` mới dùng cách quét `references/` lịch sử (có thể phát sinh phí, cần duyệt riêng); cả hai không tự import `test/`. Chạy lại bỏ qua ảnh sẵn sàng giống byte JPEG đã chuẩn hóa, không tạo bản sao. `files` trong JSON là snapshot để xem/kiểm tra, thư mục thực tế mới là nguồn quét. Xóa file local không tự xóa reference online (ngoại trừ tem lịch sử khớp hash); muốn gỡ ảnh dùng UI/API có chủ đích.

6. Sau khi có đủ bộ test, tạo vector và đo chất lượng:

   ```powershell
   # CÓ PHÍ trực tiếp qua OpenRouter, cần OPENROUTER_API_KEY trong shell
   npm run eval:embed
   npm run eval:calibrate
   npm run eval:final
   ```

   `dataset:prepare` sinh JPEG ở `data/evaluation/{references,calibration,final}/` và manifest tương thích runner hiện tại, cùng cấu hình production (`EMBEDDING_VERSION=1`). Nếu đổi pipeline production thì cập nhật cấu hình sinh manifest tương ứng. Cache embedding được giữ riêng, chạy lại tái sử dụng hash đã xử lý. Không thay bộ ảnh sau khi đã đo final rồi tiếp tục dùng kết quả cũ; kết quả final phải gắn với bộ reference/manifest đã chốt.

### Chi phí và an toàn

- Production đang giới hạn **200 lượt model/ngày UTC**, ảnh reference mới thường cần **2 lượt** (mô tả + embedding): tối đa khoảng 100 ảnh mới/ngày nếu không có lượt khác. Ví dụ nạp mới 2.000 reference cần khoảng 4.000 lượt, không thể hoàn tất trong một ngày với hạn mức hiện tại. Không tự nâng hạn mức; seed báo lỗi khi hết và có thể chạy lại ngày sau.
- `eval:embed` chạy trực tiếp, **không chịu hạn mức Worker** và không tự dùng lại vector đã nạp online. Ví dụ 2.000 ảnh đánh giá chưa cache có thể cần khoảng 4.000 lượt model; chỉ chạy khi đã cân nhắc ngân sách.
- Ảnh `test/` và dữ liệu sinh ở `evaluation/` được Git ignore để không vô tình commit bộ ảnh lớn/riêng tư; cấu trúc test được giữ qua `.gitkeep`. Hiện local đã có 619 JPEG test và `data/evaluation/manifest.json` với 664 mục (45 reference, 436 calibration, 183 final), đều là derivative offline. Evaluation cost-optimized dùng manifest riêng 325 mục và đã xử lý provider có cache; báo cáo ở `reports/evaluation-cost-optimized-v1/`. Phần mở rộng calibration đã hoàn thành: 508 calibration gồm 436 positive + 72 negative review-only, cache tổng hợp 736 vector. Audit mới nhất ở `reports/evaluation-full-calibration-v1/summary.md`; policy 0.86/0.13 chưa được duyệt production, final tái sử dụng không phải holdout độc lập mới. Ảnh tham chiếu JPG/JPEG/PNG/WebP chữ thường được phép theo dõi Git. Sao lưu bộ 2.000 ảnh ngoài Git hoặc dùng kho dữ liệu/Git LFS theo nhu cầu.
- Muốn thêm **bảo vật mới**, thêm một mục có `id`, `name`, `files: []` vào `artifacts.json` rồi tạo thư mục tương ứng; không đổi ID các bảo vật hiện có.
