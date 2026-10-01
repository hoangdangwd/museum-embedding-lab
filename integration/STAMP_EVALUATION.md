# Đánh giá pipeline description + multimodal embedding trên tem

Đối tượng là chín tấm tem in giống `data/Stamp`, không phải tranh/tượng gốc. Bộ nguồn hiện có chín WebP 1122×1402 với alpha; chưa có bộ ảnh chụp tại bảo tàng. Các mã bên dưới cũng được script `catalog:seed` dùng làm `external_object_id` khi tạo mới hiện vật; khi tích hợp phải ánh xạ sang ID thật của dự án chính nếu khác. Bộ dev đã được nạp sẵn 9 ảnh qua pipeline thật; xem hướng dẫn seed trong README khi dựng môi trường mới.

| Tệp nguồn | Mã đề xuất |
| --- | --- |
| stamp-bac-ho-viet-bac-v5.webp | stamp-bac-ho-viet-bac |
| stamp-binh-phong-v5.webp | stamp-binh-phong |
| stamp-canh-cua-cham-rong-v5.webp | stamp-canh-cua-cham-rong |
| stamp-em-thuy-v5.webp | stamp-em-thuy |
| stamp-giong-v5.webp | stamp-giong |
| stamp-hai-thieu-nu-em-be-v5.webp | stamp-hai-thieu-nu-em-be |
| stamp-hoang-hau-ngoc-truc-v5.webp | stamp-hoang-hau-ngoc-truc |
| stamp-ket-nap-dang-dien-bien-v5.webp | stamp-ket-nap-dang-dien-bien |
| stamp-phat-ba-quan-am-v5.webp | stamp-phat-ba-quan-am |

## Chuẩn bị dữ liệu

1. Giữ nguyên ảnh nguồn. Chuẩn hóa một bản JPEG qua cùng helper với app để làm reference. Lưu hash/nguồn và ID; không lấy tên file/tên tem làm đầu vào mô tả query.
2. Khi chưa có ảnh thực địa, tạo ảnh kiểm thử biến đổi phối cảnh, kích thước tem trong khung, độ sáng, nhòe, nền và phản sáng; giữ nguyên nội dung hình minh họa. Báo cáo đây là dữ liệu mô phỏng, không phải độ chính xác thực địa. Các biến thể dùng thử bổ sung reference phải tách khỏi query đánh giá.
3. Chụp bản in bằng điện thoại để thử thao tác camera thực tế; sau đó lấy ảnh bảo tàng. Quy mô thăm dò: 10–20 ảnh/tem qua nhiều buổi/điện thoại, cộng ảnh không chứa tem và mẫu ngoài danh mục. Quy mô này chưa chứng minh tỷ lệ lỗi rất thấp.
4. Tách `references`, `calibration`, `final` theo buổi chụp/nền/cấu hình tạo ảnh. Cả chín ID được phép xuất hiện trong các tập vì đây là nhận diện danh mục cố định, nhưng không trộn ảnh query với reference hoặc để các frame gần như trùng nhau vào cả calibration/final.
5. Query chính là toàn ảnh người dùng gửi, không dùng crop chuẩn do người gán nhãn tạo sẵn để làm đẹp kết quả. Có nhiều tem mà chưa rõ mục tiêu thì gán ambiguous; dùng low_quality cho ảnh không đủ thông tin, out_of_catalog cho ảnh ngoài danh mục.

## Runner offline

`scripts/recognition-eval.mjs` hỗ trợ metadata pipeline trong `data/evaluation/manifest.json`. Ví dụ metadata (thêm entries với file JPEG và sha256 thật):

```json
{
  "version": 1,
  "model": "google/gemini-embedding-2",
  "dimensions": 1536,
  "signature": "openrouter|google/gemini-embedding-2|2|1536|rgb-exif-white-jpeg95-max1600-v1|image-description-v1|google/gemini-2.5-flash|stamp-visible-en-v1",
  "pipeline": {
    "mode": "image-description-v1",
    "description_model": "google/gemini-2.5-flash",
    "embedding_version": "2",
    "preprocess_version": "rgb-exif-white-jpeg95-max1600-v1"
  },
  "entries": []
}
```

Mỗi entry dùng `file` tương đối bắt đầu bằng partition, `partition`, `expected`, `sha256`; query thêm `scenario`. Scenario hợp lệ: `known_clean`, `known_clutter`, `out_of_catalog`, `ambiguous`, `low_quality`. Ba scenario cuối có expected tương ứng `_unknown`, `_ambiguous`, `_low_quality`. Manifest cần đủ ba partition và ít nhất hai ID reference. File mẫu trên chưa phải dataset có thể chạy.

Runner dùng cùng prompt và cấu trúc joint embedding với Worker, cache mô tả theo hash/signature để giữ kết quả đã hoàn tất khi bước sau lỗi. Manifest ảnh thuần lịch sử vẫn đọc được, nhưng phải báo cáo riêng. `eval:embed` gọi provider trả phí trực tiếp và **không chịu hạn mức Worker**; chạy có chủ đích sau khi kiểm tra số ảnh. Việc seed bộ tham chiếu đã gọi provider để tạo mô tả/vector; chưa chạy bộ query đánh giá hoặc tạo số đo độ chính xác thực địa.

Sau khi tạo manifest, thư mục `reports` và cấu hình key ở shell:

```powershell
npm run eval:embed
npm run eval:calibrate
npm run eval:final
```

Worker hiện gom `max` theo hiện vật. Runner còn so sánh `top2_mean`; chỉ kết quả với `max` áp dụng trực tiếp cho Worker. Nếu calibration chọn `top2_mean`, phải coi đó là phương án thử nghiệm và chưa chuyển ngưỡng đó vào production. Offline dùng cosine chính xác trên mọi reference; cần thêm thử API thật vì topK/độ trễ cập nhật Vectorize có thể khác.

## Báo cáo cần có

- Top-1 trên ảnh đã biết; độ chính xác của các kết quả được chấp nhận; tỷ lệ ảnh hợp lệ được chấp nhận đúng; tỷ lệ yêu cầu chụp lại.
- Số nhận nhầm/tổng mẫu ngoài danh mục, ambiguous và low_quality. Báo theo từng tem và điều kiện chụp, kèm số đếm thực tế.
- Độ trễ tổng p50/p95, riêng bước mô tả/embedding; lượt model và chi phí đo thực tế. Không lấy thời gian provider mô phỏng làm số đo.
- Kiểm tra thủ công description của ca lỗi: bỏ sót hình chính, bị chi phối bởi khung chung, đọc sai chữ hoặc suy diễn tên tác phẩm. Đổi prompt phải tăng DESCRIPTION_VERSION, tái tạo reference và chạy lại đánh giá.
- Chốt ngưỡng trên calibration trước khi chạy final độc lập. Sau khi xem final rồi sửa model/prompt/ngưỡng, cần final mới.

Kiểm thử phần mềm đạt chỉ chứng minh hành vi hệ thống trong các ca đã kiểm tra; việc mở cho khách cần bộ ảnh thực địa và tiêu chí chất lượng thống nhất với dự án chính.
