**Kết quả kiểm tra ảnh và phương pháp test — 22/09/2026**

Đã kiểm tra trực quan và đọc toàn bộ 39 ảnh trong `image/`, sau đó chạy embedding thật qua OpenRouter với `google/gemini-embedding-2`. Vector có 3072 chiều; provider trả tên native `gemini-embedding-2`. Lỗi kiểm tra tên model đã được sửa để chấp nhận đúng alias từ danh mục, vẫn từ chối model không liên quan.

**Bộ ảnh hiện có**

| Nhóm | Tổng ảnh | Tham chiếu | Ảnh thử khảo sát |
| --- | ---: | ---: | ---: |
| bottle | 6 | 2 | 4 |
| case pc | 3 | 2 | 1 |
| coca can | 6 | 2 | 4 |
| figure | 3 | 2 | 1 |
| key | 6 | 2 | 4 |
| laptop | 3 | 2 | 1 |
| mask | 6 | 2 | 4 |
| pepsi can | 6 | 2 | 4 |
| Tổng | 39 | 16 | 23 |

Tất cả ảnh đọc được, không phát hiện ảnh trùng hoàn toàn sau chuẩn hóa. Dung lượng khoảng 0,27–0,92 MB/ảnh, trong giới hạn upload. Bộ ảnh có góc chụp đa dạng, góc nhìn từ trên xuống, che bởi tay, khác khoảng cách và trạng thái laptop đóng/mở.

Các hạn chế chính: phần lớn cùng phòng/nền bàn; một số góc khá gần nhau; case PC, figure và laptop chỉ còn một ảnh thử mỗi nhóm; chưa có ảnh vật ngoài danh mục. Kết quả hiện tại chỉ là khảo sát để tìm lỗi. Không phải kiểm thử độc lập cuối cùng và chưa chứng minh khả năng phân biệt hai vật cùng mẫu mã.

**Cách chia đã thực hiện**

Hai ảnh tham chiếu mỗi nhóm được chọn theo góc nhìn trước khi xem điểm model. Ảnh gốc trong `image/` được giữ nguyên. Các bản sao đã nằm tại:

- `data/image-baseline-v1/references/`: 16 ảnh tham chiếu.
- `data/image-baseline-v1/probe/`: 23 ảnh thử khảo sát.
- `data/image-baseline-v1/lab.sqlite3`: database riêng, có 16 vector thật đã lưu.
- `data/image-baseline-v1/manifest.json`: danh sách ảnh thuộc từng tập và SHA-256.

Không nhập toàn bộ `image/` làm ảnh tham chiếu rồi dùng lại chính các ảnh đó để báo độ chính xác. Database khảo sát tách khỏi `data/lab.sqlite3` của giao diện.

**Kết quả thực tế**

Ngưỡng cosine = 0,80; chênh lệch giữa hai hiện vật đầu = 0,05.

- Xếp hạng đầu đúng: **23/23**.
- Chấp nhận đúng ngay: **20/23 = 87,0%**.
- Cấp nhầm trong các lần chấp nhận: **0/20**.
- Chưa đủ chắc chắn, cần chụp lại: **3/23**.
- Lỗi gọi API/đọc ảnh trong lượt đánh giá: **0**.
- Tỷ lệ nhận nhầm vật ngoài danh mục: **chưa đo bằng ảnh ngoài danh mục thật**.
- Thời gian xử lý một ảnh: trung vị khoảng **3,07 giây**, p95 khoảng **4,29 giây**, chưa tính upload từ trình duyệt. Đây là số đo một lượt trên kết nối hiện tại.

| Ảnh cần chụp lại | Cosine đúng vật | Chênh lệch top 1–2 | Nguyên nhân theo quy tắc hiện tại |
| --- | ---: | ---: | --- |
| `case pc/case_pc_002.jpg` | 0,7861 | 0,1873 | Cosine dưới 0,80; ảnh mặt sau khác nhiều so với mặt trước/kính hông. |
| `key/key_001.jpg` | 0,7841 | 0,2580 | Cosine dưới 0,80; chìa khóa nhỏ, treo trên tường thay vì nằm trên bàn. |
| `pepsi can/pepsi_can_004.jpg` | 0,8222 | 0,0477 | Chênh lệch dưới 0,05; góc gần như chỉ thấy nắp lon, gần với Coca có điểm 0,7745. |

Ba ảnh vẫn được xếp đúng top 1. Đây là các lần từ chối ảnh đúng, không phải xếp nhầm sang hiện vật khác. Với góc nắp lon thiếu đặc điểm phân biệt, yêu cầu chụp thêm phần thân lon là phản hồi hợp lý.

Chi tiết từng ảnh: [baseline.csv](reports/image-audit/baseline.csv), [baseline.json](reports/image-audit/baseline.json). Tổng quan ảnh: [contact-sheet.jpg](reports/image-audit/contact-sheet.jpg); kiểm tra định dạng/trùng ảnh: [audit.json](reports/image-audit/audit.json).

**Vì sao không nên hạ ngưỡng để đạt 23/23 ngay?**

Đã thử một phép kiểm tra bổ sung không gọi API: với mỗi ảnh thử, loại hiện vật đúng khỏi danh sách ứng viên rồi xem hệ thống có nhận nhầm sang vật còn lại không. Các điểm embedding không phụ thuộc vào danh mục, nên có thể dùng lại top ứng viên đã lưu. Đây là mô phỏng một loại vật bị thiếu khỏi danh mục; nó không thay thế bộ ảnh vật mới thật.

| Cosine / chênh lệch | Chấp nhận đúng trong 23 ảnh khi đủ danh mục | Nhận nhầm khi bỏ hiện vật đúng khỏi danh mục, 23 tình huống mô phỏng |
| --- | ---: | ---: |
| 0,75 / 0,02 | 23 | 4 |
| 0,75 / 0,05 | 22 | 4 |
| 0,80 / 0,02 | 21 | 0 |
| **0,80 / 0,05** | **20** | **0** |
| 0,85 / 0,05 | 18 | 0 |

Đề xuất tiếp tục với 0,80 / 0,05 làm mốc so sánh. Chưa chốt ngưỡng triển khai từ tập này. 0 lỗi trong 23 tình huống nhỏ không chứng minh tỷ lệ sai thực tế bằng 0.

**Quy trình test hiệu quả tiếp theo**

1. **Giữ lượt hiện tại làm mốc.** Dùng 16 ảnh tham chiếu và 23 ảnh khảo sát đã chia. Ghi rõ model, ngưỡng, danh mục và số góc tham chiếu. Khi thử model khác, giữ nguyên dữ liệu và quy tắc để so sánh công bằng; sau đó hiệu chỉnh ngưỡng riêng cho từng model trên tập hiệu chỉnh.
2. **Bổ sung ảnh tham chiếu có mục đích.** Chụp thêm mặt sau case PC, chìa khóa treo trên tường, lon nhìn xiên vẫn thấy thân/nhãn. Giữ khoảng 3–5 góc khác nhau mỗi vật; thêm ảnh gần như giống nhau ít giúp kiểm chứng. Nếu chuyển một ảnh lỗi sang bộ tham chiếu, phải bỏ nó khỏi phần test và thay bằng ảnh chụp mới.
3. **Dùng bộ hiện tại để hiệu chỉnh, không gọi nó là tập test cuối.** Thử các ngưỡng bằng điểm đã lưu; thay đổi dữ liệu/model thì chạy lại khảo sát. Không chọn ngưỡng chỉ để tối đa số ảnh được chấp nhận: xem cả nhận nhầm và tỷ lệ từ chối ảnh đúng.
4. **Bổ sung ít nhất 20–30 ảnh ngoài danh mục cho hiệu chỉnh.** Bao gồm một lon khác, chai khác, chùm chìa khóa khác, laptop khác; ảnh bàn trống, bàn chỉ có vật khác và ảnh có nhiều vật. Đặc biệt thêm một lon cùng nhãn/mẫu hoặc một vật cùng kiểu để kiểm tra nhận đúng vật cụ thể thay vì chỉ nhận loại vật. Nếu hai vật không có chi tiết nhìn thấy để phân biệt, cần đổi cách chụp/xác minh.
5. **Chụp tập test cuối ở buổi khác, sau khi chốt cấu hình.** Mục tiêu ban đầu: 10 ảnh mới mỗi nhóm = 80 ảnh thuộc danh mục, cộng 30 ảnh vật ngoài danh mục khác với ảnh đã dùng hiệu chỉnh. Nhờ người khác chụp hoặc dùng điện thoại khác nếu có thể. Tách cả buổi chụp, không chỉ đổi tên file hoặc cắt ảnh cũ.
6. **Phủ các điều kiện thực tế.** Trong 10 ảnh/vật, cố gắng có ảnh sáng bình thường, nền mới, xa hơn, hơi lệch, ánh sáng yếu, bị che một phần và góc khó. Chụp thêm qua kính nếu có thể; không suy rộng kết quả ảnh bàn trong phòng sang tủ kính bảo tàng.
7. **Chạy cuối một lần và xem số lỗi cụ thể.** Ghi top 1 đúng, chấp nhận đúng, nhận nhầm, yêu cầu chụp lại, lỗi API và thời gian chờ. Báo cáo theo từng vật/điều kiện, kèm số mẫu. Nếu dùng kết quả test cuối để sửa hệ thống, cần một đợt ảnh mới để xác nhận sau sửa.

Tỷ lệ chấp nhận đúng và tỷ lệ nhận nhầm phải được đọc cùng nhau. Với 30 ảnh ngoài danh mục, một lỗi đã tương đương 3,3%; bộ này phù hợp phát hiện lỗi rõ ràng, chưa đủ xác nhận một cam kết tỷ lệ sai rất thấp.

**Lệnh có thể dùng ngay**

Thử các ngưỡng trên báo cáo đã có, **không gọi API và không tính thêm lượt embedding**:

```powershell
.\.venv\Scripts\python.exe scripts/rescore_probe.py reports/image-audit/baseline.json --threshold 0.8 --margin 0.05 --output reports/image-audit/rescore.json
```

Đổi `--threshold` và `--margin` để khảo sát. Script cũng xuất bảng 24 cặp ngưỡng và phép mô phỏng bỏ hiện vật đúng khỏi danh mục. Điểm được giữ nguyên, vì vậy thay đổi này chỉ kiểm tra quy tắc chấp nhận/từ chối.

Nếu cần tạo lại bản chia từ ảnh gốc:

```powershell
.\.venv\Scripts\python.exe scripts/prepare_image_test.py
```

Chạy lại model trên 23 ảnh khảo sát; thao tác này **gọi API lại cho 23 ảnh**:

```powershell
.\.venv\Scripts\python.exe -m lab.cli --database data/image-baseline-v1/lab.sqlite3 evaluate data/image-baseline-v1/probe --threshold 0.8 --margin 0.05 --output reports/image-audit/baseline-rerun.json
```

Với ảnh mới, đặt theo cấu trúc `data/final-test/<tên nhóm>/*.jpg`; vật ngoài danh mục vào `data/final-test/_unknown/`. Sau khi đã chốt/bổ sung ảnh tham chiếu trong database khảo sát, chạy:

```powershell
.\.venv\Scripts\python.exe -m lab.cli --database data/image-baseline-v1/lab.sqlite3 evaluate data/final-test --threshold 0.8 --margin 0.05 --output reports/final-test.json
```

Để thử sai mục tiêu nhiệm vụ: chạy `query` với ảnh Coca nhưng `--target "pepsi can"`, hoặc chọn mục tiêu đó trên giao diện sau khi nhập bộ tham chiếu. Kết quả phù hợp là `wrong_target` nếu ảnh rõ; ảnh mơ hồ nên bị yêu cầu chụp lại. Chỉ dùng lệnh theo lô hiện tại chưa đo riêng được toàn bộ tình huống nhiệm vụ sai mục tiêu.
