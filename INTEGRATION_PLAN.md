# Tích hợp nhận diện ảnh vào dự án chính

Yêu cầu hiện tại đã chốt: AI tự mô tả ảnh, sau đó tạo multimodal embedding từ cả ảnh và mô tả. Đối tượng là tấm tem in giống chín mẫu trong `data/Stamp`. UI/UX dự án chính đã có; stack/backend và hợp đồng ID chưa được phía dự án cung cấp.

Luồng được triển khai trong repo này là dịch vụ độc lập UI. Không triển khai quét video liên tục hoặc thay thế bằng image tracking.

## Gói tích hợp đã chuẩn bị

- [Hướng dẫn và trạng thái triển khai](integration/README.md).
- [OpenAPI 3.1 cho API đã triển khai](integration/openapi.json).
- [Adapter backend](integration/client.mjs) và [helper chuẩn hóa toàn ảnh](integration/prepare-image.js).
- [Phương pháp đánh giá trên tem](integration/STAMP_EVALUATION.md).

API hiện có: `GET /api/v1/catalog`, `POST /api/v1/recognitions`, `GET /api/v1/recognitions/{request_id}`. Tích hợp dùng backend-to-backend, token riêng, external ID, request ID và chống gửi lặp trong 24 giờ. API không phụ thuộc camera/crop/component React của công cụ thử nghiệm.

Ảnh tham chiếu và truy vấn đi qua cùng phiên bản description + embedding. Vector cũ được tách khỏi tìm kiếm; ảnh tham chiếu có thể được xử lý lại từ R2 mà không xóa/import trùng. Pipeline trả matched/uncertain/no_match; lỗi provider, index hoặc dữ liệu được trả riêng.

## Những việc cần phía dự án chính xác định

1. Backend/runtime, nơi đặt adapter, endpoint UI hiện gọi và giới hạn timeout của hosting.
2. ID hiện vật chính thức để gắn `external_object_id`, quyền người dùng và hạn mức theo tài khoản.
3. Quy tắc hiển thị ba trạng thái nghiệp vụ trên UI/UX có sẵn.
4. Staging riêng, tiêu chí chất lượng và bộ ảnh kiểm chứng thực địa.

Bản hiện tại phục vụ một danh mục. Queue nhập hàng loạt, webhook, nhiều tenant, server chuyển đổi mọi định dạng ảnh và quét liên tục là các phần chưa triển khai, chỉ bổ sung khi có yêu cầu cụ thể. Chuẩn bị tham chiếu trước khi mở cho khách; xem giới hạn pending/retry và chuẩn JPEG trong tài liệu tích hợp.

Chưa deploy remote, chưa gọi model trả phí để chuyển dữ liệu thật, chưa khẳng định độ chính xác thực địa. Kiểm thử local được ghi tại [TESTING.md](TESTING.md).
