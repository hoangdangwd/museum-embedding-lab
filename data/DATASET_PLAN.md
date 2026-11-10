# Kế hoạch xử lý bộ ảnh Drive — đã đánh giá local/chưa seed production

Nguồn do chủ dự án cung cấp: <https://drive.google.com/drive/folders/1jYzY5U3Yc6R_3CdUz7h0T8rYOBFGb7VH>.

## 1. Vị trí và phạm vi nhập

```text
data/incoming/drive-1jYzY5U3Yc6R_3CdUz7h0T8rYOBFGb7VH/
  originals/                   # Ảnh gốc, giữ nguyên tên và 11 thư mục Drive
  source-files.json            # Danh sách nguồn + Drive file ID
  download-log.jsonl           # Lịch sử tải/resume + SHA-256, không phải split
  download-summary.json        # Kết quả lượt tải cuối cùng
```

`incoming/` được Git ignore và **không thuộc** nguồn seed hay assets website. Đã copy cục bộ các derivative đã duyệt vào `references/`/`test/`; chưa seed R2/Vectorize hoặc gọi OpenRouter. Production vẫn đang phục vụ **10 reference của 9 bảo vật**; local có 45 reference.

Danh sách Drive tại lần kiểm kê này có **1.632 file**, không phải đủ 2.000: **827 ảnh trong 9 thư mục bảo vật**, **805 ảnh trong hai thư mục Khác**. Nếu Drive còn thư mục chưa chia sẻ hoặc bổ sung ảnh sau này, cần chạy lại discovery và đối chiếu trước khi gọi đây là bộ dữ liệu cuối cùng.

| Thư mục gốc | HEIC | JPG | Tổng | Reference mới đề xuất vòng đầu* |
| --- | ---: | ---: | ---: | ---: |
| Bác Hồ ở chiến khu Việt Bắc | 64 | 15 | 79 | 8 |
| Bình phong | 71 | 23 | 94 | 12 — cân bằng hai mặt |
| Cánh cửa chạm rồng | 41 | 16 | 57 | 8 |
| Em Thúy | 70 | 17 | 87 | 8 |
| Gióng | 80 | 28 | 108 | 8 |
| Hai thiếu nữ và em bé | 91 | 11 | 102 | 8 |
| Hoàng hậu Ngọc Trúc | 74 | 21 | 95 | 10 — nhiều góc tượng |
| Kết nạp Đảng ở Điện Biên Phủ | 73 | 30 | 103 | 8 |
| Phật Bà Quan Âm | 80 | 22 | 102 | 10 — nhiều góc tượng |
| Khác | 200 | 6 | 206 | 0 |
| Khác 2 | 599 | 0 | 599 | 0 |
| **Tổng** | **1.443** | **189** | **1.632** | **80** |

\* Đây là mục tiêu tối đa ban đầu để thảo luận, **chưa chọn file hay áp dụng**. Không lấy đủ số bằng mọi giá nếu ảnh gần trùng hoặc thiếu chất lượng. Các số phân bổ sẽ thay đổi sau kiểm tra nhãn và nhóm chụp.

## 2. Kết quả tải và kiểm kê đã hoàn tất

- **1.632/1.632 file đã tải đủ**, không còn file `.part` trong cây `originals/`; tổng **2.282.858.992 byte** (2,283 GB / 2,126 GiB).
- SHA-256 được tính khi tải và tính lại độc lập khi audit, khớp đủ 1.632 file. Không phát hiện bản trùng **byte**; chưa chạy dò gần trùng.
- Metadata/kích thước đọc được trên cả 1.632 ảnh, không báo file lỗi ở bước này. Đã tạo **11 contact sheet**, mỗi thư mục 16 ảnh mẫu (176 ảnh được giải mã làm preview), không phải đã duyệt/giải mã toàn bộ ảnh.
- EXIF: **1.443 ảnh từ iPhone XR**, **189 ảnh từ thiết bị `22041216G`**, tất cả ghi ngày **2026-11-05**. Chín bảo vật chủ yếu được chụp trong khoảng 09:56–10:11, mỗi thư mục khoảng 1–3 phút. Vì vậy bộ này chưa chứng minh được khả năng tổng quát sang ngày chụp khác.
- Xem mẫu đã thấy góc xa/gần, phản chiếu kính, người che, biển tên và ảnh chỉ chụp chi tiết. Ghi chú kiểm kê ban đầu cho rằng `Khác/IMG_2373.HEIC` có Gióng là **sai**: đối chiếu bản 1.600 px ở lượt review sau thấy tranh đỏ có hình người đen/trắng, không phải bố cục ngựa Gióng. Nhiều ảnh Khác khác có target thật; vẫn không được coi cả thư mục là unknown tự động.
- Báo cáo đầy đủ: `reports/drive-inventory/files.csv`, `summary.json`, `01-contact.jpg` tới `11-contact.jpg`. Các báo cáo/ảnh này được Git ignore.

## 3. Xử lý theo từng điểm duyệt

Theo yêu cầu chủ dự án, bắt đầu với **bước kiểm tra offline có thể làm lại**, nhưng phải hỏi trước các quyết định ảnh hưởng nhãn, chia tập, danh sách reference, chi phí model hoặc danh mục production.

### Đã hoàn tất: workspace duyệt đầy đủ

Giải mã được **1.632 ảnh incoming + 10 baseline**, không lỗi/hash lệch; tạo 1.642 preview và 73 contact sheet. 30 cặp dHash nghi gần trùng, không có cặp baseline ở ngưỡng <=4; điều này **không chứng minh** không có crop/gần trùng với baseline. Bảng CSV đủ 1.632 dòng và mỗi ảnh xuất hiện đúng một lần trên contact sheet. Chưa có nhãn/partition được duyệt.

Công cụ `scripts/prepare-review.py` kiểm tra lại hash và giải mã toàn bộ pixel ảnh chính, tạo bản preview không chứa EXIF và contact sheet bao phủ tất cả ảnh; không ghi đè ảnh gốc. Nó đối chiếu dHash của ảnh incoming và 10 baseline để lập **cặp nghi gần trùng**, không tự khẳng định là trùng/xóa/gộp. dHash có thể báo nhầm ở ảnh ít chi tiết và bỏ sót crop/đổi phối cảnh.

```text
reports/drive-review-v1/
  index.html                 # Mở bằng trình duyệt để xem toàn bộ contact sheet
  review.csv                 # Mã ảnh, nguồn/hash, nhãn gợi ý; nhãn duyệt/partition còn trống
  images.json                # Kết quả decode, kích thước và dHash
  candidate-pairs.json       # Gợi ý cặp gần trùng, cần duyệt
  sheets.json                # Ánh xạ mã ảnh tới contact sheet
  summary.json               # Tổng hợp kết quả và phiên bản decoder
  previews/                  # Preview <= 480px, không dùng làm ảnh đánh giá
  sheets/                    # 24 ảnh/trang, không bỏ sót ảnh lỗi
```

`capture_bucket_hint` chỉ nhóm sơ bộ theo thư mục nguồn + thiết bị + ngày; **không phải** các nhóm chụp độc lập đã được duyệt. Không tự đặt ngưỡng thời gian để chia nhỏ một chuỗi burst thành các tập khác nhau. Workspace không gán `partition`, `approved_artifact_id`, không chuyển đổi bộ JPEG production và không gọi provider.

Các quyết định cần hỏi trước bước kế tiếp:

1. Chọn cách đánh giá: giữ thiết bị `22041216G` làm final cross-device, hay chia đại diện cả hai máy theo nhóm để mô phỏng sử dụng thực tế? Không thể gọi hai phương án là tương đương; cùng ngày chụp vẫn là giới hạn.
2. Với ảnh chỉ thấy một phần target, nhiều target hoặc chụp chủ yếu biển tên: thống nhất mong muốn nhận diện/từ chối, trước khi phê duyệt nhãn trong Khác và ảnh khó.
3. Có duyệt mục tiêu **tối đa 80 reference mới** (không ép đủ số) và giữ 10 baseline? Duyệt mục tiêu này không đồng nghĩa duyệt các file cụ thể hoặc cho phép gọi model trả phí.

Đã nhận câu trả lời của chủ dự án: **A**, đồng ý quy tắc partial/multiple/label và đồng ý tối đa 80 reference mới. Bản đề xuất hiện ở `reports/drive-split-proposal-v5/` (ignored):

- `proposal.csv`: 1.632 dòng, vẫn chưa gán partition/nhãn được duyệt.
- `reference-candidates.html`: 80 ứng viên tự chọn theo dHash max-min; sau xem preview sơ bộ, 35 ảnh còn giữ để chủ dự án xem xét, 45 ảnh tạm hoãn vì rộng/xa, người che, mờ, cắt mép hoặc trùng hướng. Đây là sàng lọc hỗ trợ, chưa phải phê duyệt.
- `final.html`: 183 JPG từ `22041216G` trong 9 thư mục bảo vật, ứng viên final cross-device; vẫn cần duyệt nhãn/chất lượng/nhóm chụp. Cả **189 ảnh của thiết bị này** được giữ cờ `holdout_device_reserved=True`; 6 ảnh trong Khác chưa gán nhãn, nhưng cũng không được dùng làm reference/calibration.
- `manual-review.json`: 805 ảnh `Khác`/`Khác 2`, không tự gán unknown.
- `summary.json`: 564 ảnh iPhone còn lại là calibration candidate trước khi loại nhóm burst; 45 ứng viên reference bị hoãn chưa bị đưa sang calibration.

**Điểm cần hỏi tiếp:** chủ dự án có đồng ý dùng phần iPhone còn lại làm tập phát triển/calibration **cùng buổi, có tương quan với reference**, không gọi là kiểm thử độc lập; hay muốn bổ sung buổi chụp khác trước khi chọn ngưỡng? EXIF cho thấy phần lớn mỗi bảo vật là một chuỗi liên tục với khoảng cách tối đa giữa hai frame chỉ 2–25 giây. Không có cơ sở tự cắt các chuỗi này thành nhóm độc lập. Final cross-device vẫn cùng ngày/cảnh và chỉ là đo khác thiết bị, không phải khác buổi.

Sau khi chốt phạm vi này và duyệt danh sách/nhãn, mới xác nhận manifest trước khi chuyển ảnh vào reference/test hoặc thay catalog online.

Chạy offline (cần dependency Python tùy chọn ở phần công cụ):

```powershell
python scripts/prepare-review.py data/incoming/drive-1jYzY5U3Yc6R_3CdUz7h0T8rYOBFGb7VH --output reports/drive-review-v1
```

Không ghi đè workspace đã có `review.csv`, tránh mất quyết định duyệt thủ công. Chạy lại chọn output mới.

### Cập nhật mới nhất — đã chuẩn hóa staging, chưa áp dụng chia tập

Chủ dự án đã duyệt 35 reference candidate, chấp nhận calibration iPhone cùng buổi và cho phép **chuẩn hóa vào staging + giữ cả 17 ảnh final có cảnh báo để xem lớn**. Quyền này **không bao gồm** áp nhãn/chia tập chính thức, gọi model hoặc thay production.

- `data/staging/drive-normalized-v1/` (ignored): **782/782 JPEG thành công**, gồm 35 reference candidate + 564 calibration candidate + 183 final candidate. Cạnh dài <=1.600 px, toàn khung, dùng chính `src/media.js`; ảnh gốc không bị ghi đè.
- `scripts/stage-decode.py`: HEIC 8-bit qua ICC sang sRGB với rendering intent perceptual (0), EXIF orientation, trung gian lossless không metadata; JPEG gốc đưa thẳng vào browser. Có journal/resume với hash. `color-policy-correction.json` đính chính một nhãn mô tả intent ban đầu ghi sai, không đổi byte ảnh.
- `scripts/stage-jpeg.mjs`: Chromium headless, chặn request ra ngoài, hash nguồn/trung gian/JPEG và resume; không quét staging vào catalog. `source-to-jpeg.csv`, `staging-manifest.json`, `verification.json` lưu truy vết; chưa có nhãn/partition chính thức.
- Đã kiểm tra pixel decode/kích thước/hash/EXIF trên cả 782 JPEG; **0 nhóm JPEG chuẩn hóa trùng hệt**, giữ đủ 17 ảnh khó. Điều này không chứng minh các nhóm chụp độc lập.
- `reports/drive-final-large-review-v1/index.html`: xem riêng 17 JPEG lớn; `reports/drive-final-large-review-v1.json` chỉ **đề xuất** 2 `known_clutter`, 10 `_low_quality`, 5 `_ambiguous`. Nhãn chính thức vẫn trống. Mờ không tự động đồng nghĩa phải từ chối; chủ dự án cần duyệt các trường hợp biên.
- `reports/drive-staging-leakage-audit-v1.json`: thiết bị final không rò sang reference/calibration; còn **1 cặp dHash gợi ý xuyên role** và **22 nhóm cùng giây xuyên reference/calibration** cần rà soát. Không tự chuyển/xóa ảnh hoặc gọi calibration là độc lập.
- 805 ảnh Khác/Khác 2 vẫn chờ duyệt, 45 reference hoãn vẫn ngoài staging. 6 ảnh Khác của thiết bị holdout tiếp tục được bảo vệ.

### Cập nhật tiếp — 17 nhãn review đã duyệt, sàng lọc 805 ảnh Khác

Chủ dự án đồng ý đề xuất nhãn 17 ảnh khó và rà soát offline 805 ảnh Khác + nhóm burst. `reports/drive-final-labels-approved-v1.json` ghi **17 nhãn review đã duyệt** (2 known_clutter, 10 low_quality, 5 ambiguous), kèm hash proposal/nguồn/JPEG; partition vẫn null, không thay manifest candidate hoặc staging.

`scripts/review-followup.py` dùng các contact sheet đã có, không chuyển HEIC/chuẩn hóa thêm. Đã xem đủ **34 sheet / 805 ảnh** ở mức preview, xác minh lại hash cả 805 ảnh gốc. Kết quả ở `reports/drive-followup-review-v1/`:

- 56 ảnh thấy target trong danh mục ở preview (có cả 9 bảo vật); 60 ảnh cần xác minh target, 23 ảnh cần kiểm tra chất lượng/biển tên: **139 ảnh ưu tiên xem lớn**.
- 666 ảnh chưa thấy target ở preview **không đồng nghĩa** đã duyệt `_unknown`; mọi approved label và partition của 805 ảnh vẫn trống. Không seed danh sách này. 6 ảnh holdout tiếp tục được bảo vệ.
- 22 nhóm cùng giây và 1 cặp dHash xuyên role đã xem bằng preview đối chiếu metadata. `burst-proposal.json` đề xuất giữ 35 reference candidate, **tạm hoãn 28 calibration candidate** liên quan; nếu duyệt thì còn 536 calibration candidate. Chưa áp dụng, không xóa ảnh. Đây chỉ là biện pháp tối thiểu, chưa xử lý mọi burst ở các giây kề nhau và không biến calibration cùng buổi thành độc lập.
- Ghi chú cũ về `Khác/IMG_2373.HEIC` có Gióng chưa được xác nhận ở preview hiện tại; ảnh `R1277` giữ trạng thái unresolved để đối chiếu ảnh lớn, không dùng ghi chú cũ làm ground truth. Nhiều ảnh khác đã thấy target rõ nên nguyên tắc không coi Khác là unknown vẫn giữ nguyên.

Hai điểm duyệt của lượt trước đã được chủ dự án trả lời **“đồng ý cả hai”**: tạo preview lớn cho 139 ảnh và ghi nhận tạm hoãn 28 calibration candidate, đồng thời tiếp tục rà burst kề giây. Không bao gồm duyệt nhãn mới hoặc chia tập chính thức.

### Trạng thái hiện tại — 139 preview lớn và 28 candidate hold đã được duyệt

`scripts/review-large.py` tạo workspace mới trong ignored `reports/drive-large-manual-review-v1/`, không ghi đè báo cáo cũ:

- **139/139 JPEG xem lớn thành công**, toàn khung, không phóng lớn, cạnh dài <=1.600 px, không EXIF; ICC sang sRGB perceptual như helper staging. Đây là derivative Pillow để review, **không phải** JPEG evaluation qua `src/media.js`. `manifest.json` và journal lưu hash nguồn/preview/cấu hình.
- `candidate-holds-approved.json` là **overlay hiệu lực ở cấp candidate**: 28 calibration candidate tạm hoãn, **536 candidate còn lại chưa bị hoãn**, 35 reference và 183 final candidate giữ nguyên. Không xóa/di chuyển ảnh; manifest v2 và 782 JPEG staging được giữ bất biến. Các bước chọn candidate sau phải đọc cả overlay này; không diễn giải 564 calibration JPEG lịch sử là 564 candidate còn đủ điều kiện. Không áp dụng overlay vào pipeline/catalog chính thức trong lượt này.
- Đã xem 24 montage lớn bao phủ 139 ảnh, trong đó **17 ảnh biên mở riêng tới 1.600 px**. Không khẳng định đã mở riêng toàn bộ 139 ảnh ở kích thước đầy đủ. `visual-review-proposal.json` đề xuất **60 known_clutter, 31 unknown, 20 low_quality, 7 ambiguous; 21 tiếp tục unresolved**. Cả 118 đề xuất nhãn đều **chưa được chủ dự án duyệt**. 666 ảnh ngoài queue không được tự gán unknown.
- Tượng nhiều tay có hào quang tròn màu vàng trong R0744–R0751 **khác** target Phật bà Quan Âm tay đỏ xòe mở trong baseline; không suy diễn cùng chủ đề là cùng hiện vật. R1277 được mở riêng: đính chính nhận xét sai về Gióng, chỉ đề xuất unknown, chưa làm ground truth.
- `adjacent-burst-proposal.json`: đã xem 9 montage của **108 cặp kề giây / 100 calibration candidate khác**. Đề xuất tạm hoãn thêm 100 ảnh do tương quan góc chụp/chuỗi liên tiếp, **chưa áp dụng và chưa duyệt**. Nếu được duyệt mới còn 436 calibration candidate, tổng 128 hold. Hiện tại vẫn là 28 hold / 536 chưa hold. Cửa sổ một giây chỉ để tìm dấu hiệu; không phải ranh giới hợp lệ để gọi phần còn lại độc lập, không chứng minh trùng pixel, chưa giải quyết chuỗi dài hơn.
- `index.html` xem ảnh; `label-proposals.html` xem đề xuất và lý do. Cả hai được mở Chromium, mỗi trang 139 ảnh hợp lệ, không lỗi script/request remote. `verification.json` kiểm tra lại 1.632 hash gốc + 10 baseline + 782 JPEG staging + 139 preview; toàn bộ 189 ảnh holdout vẫn được bảo vệ. Nhãn/partition chính thức tiếp tục null.
- Tại thời điểm review cũ, test Python **43/43**, Node **71/71**, build đạt; khi đó dataset chính thức vẫn 9 bảo vật / 10 reference / 0 calibration / 0 final. GET online lúc đó trả HTTP 200, production không đổi. Sau đó local đã promote dataset; production vẫn chưa seed/deploy và Cloudflare 7403 chưa được khắc phục.

**Cập nhật sau phản hồi “đồng ý cả hai”:** `reports/drive-review-approval-v2/` ghi nhận đúng phạm vi đã duyệt: 118 nhãn review-only và tổng 128 candidate hold (28 cũ + 100 mới), còn 436 calibration candidate; không áp partition/official label. 189 ảnh thiết bị `22041216G` vẫn được bảo vệ. Bản overlay cũ 28 hold và proposal đóng băng vẫn giữ bất biến để truy vết.

- Đã rà riêng 21 ảnh unresolved bằng preview lớn hiện có, không tạo derivative mới. Sau khi chủ dự án trả lời **“ok duyệt”**, `reports/drive-review-approval-v3/` ghi nhận thêm đúng **14 nhãn review-only**: 12 `_low_quality` và 2 `_unknown`; 7 ảnh vẫn unresolved (`R0865, R0868, R0869, R0873, R0981, R0983, R1083`). Tổng review label đã duyệt là **132/139**, với 60 `known_clutter`, 33 `_unknown`, 32 `_low_quality`, 7 `_ambiguous`; official partition/label vẫn null. Overlay v2 và proposal đóng băng không bị ghi đè.
- Report HTML có 21 article/22 ảnh hợp lệ, 0 lỗi script, 0 request ngoài; hash 1.632 incoming + 10 baseline + 139 preview + 782 staging khớp. Không provider/upload/production mutation.

**Đã áp dụng partition manifest sau khi chủ dự án nói “áp dụng”:** `scripts/apply-approved-split.py --apply-approved-partitions` tạo manifest chính thức mới tại `reports/drive-official-split-v1/`. Đây là áp dụng ở cấp manifest, không copy/move ảnh; candidate v2, staging, incoming và active catalog không bị ghi đè. Draft nguồn vẫn giữ nguyên tại `reports/drive-approved-split-proposal-v1/`.

Manifest chính thức hiện có:

- 35 reference candidates — chưa copy/chưa duyệt chính thức;
- 564 calibration candidates theo nguồn, trong đó 128 bị hold và 436 còn eligible theo overlay — không coi 436 là độc lập burst;
- 183 ứng viên final cross-device từ thiết bị `22041216G` — vẫn chưa phải final partition;
- 850 dòng manual/deferred nằm ngoài split draft (805 `Khác`/`Khác 2` + 45 reference deferred), không tự động biến thành unknown;
- 132 review labels đã duyệt chỉ được giữ ở trường review-only; 7 ảnh (`R0865, R0868, R0869, R0873, R0981, R0983, R1083`) vẫn unresolved.

- 35 `references`;
- 436 `calibration`;
- 183 `final`;
- 978 dòng bị loại khỏi partition chính thức (128 hold + 850 manual/deferred).

`official_partition` và `approved_artifact_id` đã được ghi trong manifest mới. Sau khi được phép rà scenario bảo thủ, `scenario` đã được gán **604/619 dòng eligible** trong `reports/drive-official-split-v1/`: 153 `known_clean`, 451 `known_clutter`; 15 dòng kế thừa `_low_quality`/`_ambiguous` vẫn để null và loại khỏi scenario evaluation. Có truy vết từng dòng trong `scenario_review_version`, `scenario_review_basis`, `scenario_reason`, cùng hash JPEG chuẩn hóa; `reports/drive-scenario-approved-v2-applied/` là bản ghi kết quả riêng. Không xử lý 128 hold hay 850 dòng ngoài partition.

Đã thực hiện bước local-only theo phê duyệt: copy 654 JPEG derivative đã xác minh (35 reference, 436 calibration, 183 final) vào `data/references/` và `data/test/`; originals không đổi. 15 ảnh review-only `_low_quality`/`_ambiguous` được giữ ở nhóm negative tương ứng. `npm run dataset:check` pass với 45 reference, 436 calibration, 183 final.

Theo kế hoạch tiết kiệm chi phí đã được duyệt, đã chuẩn hóa thêm 25 negative calibration review-only (18 `_unknown`, 7 `_ambiguous`) trong staging riêng, chọn 72 positive calibration đại diện và tạo manifest cost-optimized 325 dòng: 45 reference, 97 calibration, 183 final. Đã gọi provider cho 325 ảnh duy nhất với cache; không dùng final để chọn threshold.

Sau pilot, đã xử lý thêm 411 ảnh để có 508 calibration (436 positive + 33 unknown + 7 ambiguous + 32 low-quality); cache tổng hợp `data/evaluation/full-calibration-embeddings.json` có 736 vector/mô tả. `data/evaluation/full-calibration-manifest.json` có 45 reference + 508 calibration + 1 sentinel final kỹ thuật; chỉ 508 calibration được đưa vào grid.

Audit mới nhất: `reports/evaluation-full-calibration-v1/summary.md` và `summary.json`, tái tạo bằng `python scripts/report-full-calibration-evaluation.py`. Cấu hình 0.86/0.13 chỉ là candidate: 124/436 accept đúng, 2/7 ambiguous false accept. Không đổi nhãn ambiguous để bỏ qua lỗi. Final đã được xem/quét nhiều ngưỡng trước policy v2, nên tái sử dụng chỉ là diagnostic, không phải kiểm thử độc lập mới. Báo cáo cũ được giữ dưới `pre-audit-*`; tổng phí evaluation trước đây chưa đủ chứng từ xác nhận. Không có thay đổi production; Cloudflare 7403 chưa được xử lý.

### Nghiên cứu tiếp theo — chỉ dùng cache và calibration

`reports/cached-retrieval-study-v1/` so sánh max, top2_mean, top3_mean, centroid từ 45 reference. Max có top-1 calibration cao nhất (366/436); centroid có một số điểm recall/precision tốt hơn nhưng chỉ là in-sample exploratory, chưa chọn production. Không dùng final, không provider mới.

`reports/calibration-error-review-v1/` chứa 90 ảnh review-only (70 lỗi, 2 negative accept, 18 controls), bốn sheet và trang HTML offline. Đã xem cả bốn sheet, mở riêng Q021/R0260 và Q069/R1446. Q021 gán known_clean nhưng ảnh mờ; Q069 foreground là tượng, tranh mục tiêu nằm phía sau. Các ảnh positive multi-target cần đối chiếu quy tắc với R0928/R0929 ambiguous. Không tự đổi nhãn, không loại các ảnh khó để tăng metric. Sáu source trace đã xác minh hash gốc và normalized hash. Nguyên tắc hiện tại vẫn binary recognition, không thay UI/gameplay, không bắt người dùng chụp thêm.

### Thử nghiệm xác minh cục bộ — chưa áp dụng online

`reports/local-feature-study-v3/` hoàn thành SIFT/RANSAC trên 45 reference và 508 calibration, không final/provider. ROI reference-only thủ công ở `reports/local-feature-rois-v1/`, không thay ảnh/nhãn/catalog. Một điểm không quan sát lỗi trên calibration xác nhận đúng 197/436 (124/345 clutter), so với 124/436 của embedding candidate cũ; nhưng mất 35 ảnh trước đã xác nhận đúng, và Hoàng hậu đạt 0/47 ở điểm bảo thủ này. Cấu hình kết hợp có coverage cao hơn nhưng vẫn có wrong-artifact và ambiguous false accepts. Đây là fit trên calibration cùng buổi chụp, không phải holdout/SLA. Chi tiết cùng đối chiếu inlier/ảnh lỗi: `reports/local-feature-study-v3/interpretation.md`. Không deploy OpenCV/Python hoặc dịch vụ mới; chưa chọn policy.

### Audit xung đột embedding + geometry — chưa áp dụng online

`reports/hybrid-conflict-study-v2/` đã tách 508 calibration thành các trạng thái bằng chứng thay vì gộp union: 89 both-agree, 37 embedding-only, 108 geometry-only, 11 multi-target-veto, 263 neither. Fixed candidate `candidate_union_both_vetoes` đạt 232/436 correct accepts và không có false accept quan sát trên 72 negatives; nhưng đây là calibration đã xem nhiều lần. 11 multi-target-veto đều là ảnh `Hai thiếu nữ` clutter; hai ambiguous R0928/R0929 bị weak-conflict guard từ chối vì embedding và local geometry chỉ hai hiện vật khác nhau. `reports/hybrid-conflict-study-v2/interpretation.md` và `topology-review-sheet.jpg` ghi rõ không được suy ra policy production từ số này.

`reports/hybrid-sensitivity-v1/` cho thấy 81 biến thể lân cận chỉ 28 biến thể không lỗi quan sát, correct accepts dao động 217–244. Không chọn cấu hình tốt nhất hậu nghiệm, không deploy.

### Visibility semantics v2 — đã thống nhất về nghiệp vụ, chưa có số production

Semantics hiện tại: nhiều catalog artifacts trong một ảnh thì reject và gợi ý retake; quá nhỏ/mờ/nhòe đến mức người bình thường phải đoán thì reject/retake; một artifact bị khuất/chụp một phần vẫn có thể confirm nếu phần thấy đủ đặc trưng và không có artifact cạnh tranh. Sidecar tại `reports/visibility-policy-v2/policy.json`; chưa đổi official labels/UI/Worker/production.

Calibration hiện chưa có nhãn human-effort cho `small`, `blurry`, `occluded`, `partial_recognizable`, `too_difficult`, nên chưa báo recall riêng cho các nhóm này. Audit cache tại `reports/visibility-policy-v2/summary.md`: local 12–23 inliers là borderline; >=24 inliers, margin >=20, runner-up <10 là candidate mạnh hơn nhưng numeric policy chưa được duyệt. Retake là recovery path cho reject, không thêm business outcome thứ ba.

### Recommendation policy v1 — ngưỡng nghiên cứu phù hợp nhất, chưa deploy

Sau khi áp semantics retake cho multi-target/ảnh quá khó và cho phép partial/occluded nếu evidence đủ mạnh, recommendation hiện tại là hybrid, không phải một scalar: embedding `max` score >=0.86, margin >=0.13; local target geometry >=24 inliers, margin >=20, runner-up <10; nếu hai nhánh mạnh nhưng chỉ hai artifacts khác nhau hoặc có multi-target thì reject + gợi ý retake; nếu một nhánh mạnh và nhánh kia yếu thì có thể confirm artifact duy nhất. Calibration-only result: 232/436 correct accepts, observed precision 232/232, zero wrong-known/unknown/ambiguous/low-quality false accepts. Scalar 0.90/0.10 có 77/436; scalar 0.8/0.05 quá permissive trong diagnostic 45-reference.

Recommendation sidecar/audit: `reports/recommended-policy-v1/{policy.json,summary.md,audit.json}`. Chưa implement local geometry vào Worker, chưa đổi threshold/catalog/deploy; cần gate latency/memory/cost, visibility review và approved final evaluation trước production.

### Reconsideration: 232/436 quá thấp cho completion policy

Audit `reports/hybrid-rejection-audit-v1/` cho thấy conservative hybrid reject 204/436 known positives: 196 clutter, 8 clean; 193 thiếu combined evidence và 11 multi-target. Contact sheet có những ảnh tranh/tượng nhìn thấy đủ hợp lý nhưng local geometry/embedding gate không qua, đặc biệt Hoàng hậu/Phật Bà 3-D. Unknown R0745/R0746 lại có embedding cao tương tự một số positive Phật Bà nhưng geometry không hợp lệ; hạ scalar threshold sẽ tăng false accept. Vì vậy candidate 232/436 được rút lại như completion policy; chỉ giữ làm safety diagnostic. Cần representation/verification tốt hơn cho 3-D và human-effort visibility review, không tiếp tục tinh chỉnh một global threshold mù.

### Optimized family geometry — cải thiện thật nhưng chưa hoàn thiện

Đã chạy lại 508 calibration với homography cho 7 artifact phẳng và affine cho Hoàng hậu/Phật Bà, embedding primary, geometry chỉ rescue đúng family hoặc reject conflict/multi-target. Candidate tốt nhất không có lỗi quan sát đạt **254/436**, tăng 22 so với hybrid planar 232/436 và tăng 130 so với embedding candidate 124/436. Tuy nhiên vẫn reject 182/436; Hoàng hậu chỉ 5/47. Affine đúng hướng cho 3-D nhưng chưa đủ để thêm vào Worker. Chi tiết `reports/optimized-geometry-study-v1/interpretation.md`; không final/provider/production.

## 4. Quy trình đề xuất sau điểm duyệt

### Bước A — Lưu nguồn và kiểm kê không mất dữ liệu

- Giữ ảnh gốc bất biến, SHA-256 cho từng file và ánh xạ về Drive; không đổi đuôi HEIC thành JPG, không ghi đè bản gốc.
- Kiểm tra số file tải thực tế so với discovery, file rỗng/HTML, dung lượng, kích thước, định dạng và EXIF máy chụp/thời gian. Báo riêng file không đọc được.
- Bảng metadata và contact sheet mẫu đặt trong `reports/drive-inventory/`. Đọc metadata mọi file **không đồng nghĩa** đã giải mã toàn bộ pixel; bước chuẩn hóa sau phải giải mã toàn bộ ảnh được chọn.
- Contact sheet và metadata chỉ dùng kiểm tra nhãn/chất lượng, không gửi ảnh cho dịch vụ AI ở bước này. Không xuất GPS vào báo cáo.

### Bước B — Duyệt nhãn và gom nhóm, trước khi chia tập

Tạo bảng duyệt (CSV/JSON) với các trường:

```text
source_file, source_sha256, artifact_id, label_status,
camera_model, captured_at, capture_group, duplicate_group,
view_or_side, quality, scenario, partition, reason, reviewed
```

- 9 tên thư mục là **nhãn ban đầu**, không phải đáp án được đảm bảo đúng 100%. Kiểm tra ảnh chỉ chụp biển tên, ảnh thiếu vật, ảnh nhiều bảo vật hoặc ảnh đặt nhầm thư mục.
- `Khác`/`Khác 2` được dùng làm **nguồn ứng viên negative**, chưa tự động coi mọi ảnh là `_unknown`. Nếu có một trong 9 bảo vật, phải chuyển nhãn đúng hoặc đánh dấu ambiguous; ảnh toàn cảnh có chứa target không được gán unknown một cách máy móc.
- SHA-256 để gom trùng byte; sau đó dùng perceptual hash/so sánh ảnh thu nhỏ và xem lại bằng mắt để gom ảnh gần trùng, bản crop/resize, ảnh chụp liên tiếp. So sánh cả với **10 reference baseline hiện có**; ảnh là bản sao/crop của baseline không được đi vào calibration/final. Ngưỡng hash chỉ gợi ý, không được xóa hoặc hợp nhất ảnh khác vật tự động.
- Dựa vào thiết bị + EXIF + cảnh/góc chụp để tạo `capture_group`. Ảnh cùng lượt chụp/burst hoặc các bản biến đổi của cùng ảnh phải ở **cùng một partition**, hoặc loại khỏi đánh giá nếu là bản thừa.
- Không chia ngẫu nhiên theo từng file hay đuôi HEIC/JPG. Mẫu EXIF đã cho thấy ảnh liên tiếp cùng giây và ít nhất hai thiết bị; tách file ngẫu nhiên rất dễ làm kết quả quá lạc quan.
- Nếu chỉ có một chuỗi chụp dài cho một vật/góc, không tùy tiện cắt chuỗi thành ba phần rồi gọi là độc lập. Giữ chuỗi trong một tập và bổ sung buổi chụp khác, hoặc ghi rõ giới hạn đánh giá cùng buổi.

### Bước C — Chuẩn hóa HEIC có truy vết

- Dùng HEIF decoder để chuyển **bản làm việc** từ HEIC sang RGB/sRGB, áp dụng hướng ảnh; xử lý HDR/tone mapping nhất quán nếu có và kiểm tra bằng mắt trên mẫu từng máy.
- Ảnh JPEG cuối cùng dùng cùng quy tắc app: toàn khung, nền trắng, không phóng lớn, cạnh dài tối đa 1.600 px, JPEG chất lượng 0,95. Nếu cần hai bước để giải mã HEIC rồi đưa qua `src/media.js`, lưu rõ phiên bản và tránh nén mất dữ liệu nhiều lần.
- Không mặc định crop reference cho đẹp mà giữ query toàn khung nếu không đo tác động; reference nên có cả góc nhìn thực tế, không chỉ ảnh cắt sát tác phẩm.
- Giữ bảng `original_sha256 → normalized_sha256`. Bản gốc và các bản chuẩn hóa/crop của nó kế thừa cùng `capture_group`/partition.
- Scanner hiện tại chỉ nhận JPG/JPEG/PNG/WebP. **Không chuyển HEIC thẳng vào `references/`/`test/`** vì sẽ không được quét. Cần bổ sung công cụ chuẩn hóa HEIC trước khi áp dụng chia tập; các script tải/audit hiện tại không tự thực hiện bước này.

### Bước D — Chọn reference nhỏ nhưng đa dạng

**Trạng thái hiện tại:** local có 45 reference, 436 calibration và 183 final theo manifest chính thức; 15 negative review-only nằm trong `_low_quality`/`_ambiguous`. Pilot 325 ảnh và phần mở rộng calibration đã hoàn thành; cache tổng hợp có 736 ảnh duy nhất. Policy mới chưa được duyệt để triển khai. 35 reference mới chưa được seed production. 45 reference hoãn vẫn ngoài split, 128 hold và 850 manual/deferred vẫn ngoài partition.

Giữ 10 reference hiện có làm baseline; local hiện thêm 35 reference đã duyệt, tổng 45. Chưa seed online và chưa nạp cả 827 ảnh bảo vật làm reference.

Tiêu chí chọn:

1. Nhìn rõ bảo vật, đúng nhãn, đủ đặc trưng; tránh người che gần hết, rung/mờ nặng hoặc chỉ có biển tên.
2. Bao phủ chính diện, trái/phải, xa/gần, ánh sáng/phản chiếu vừa phải; vật 3D cần nhiều hướng khác nhau.
3. Bình phong phải bao phủ **cả hai mặt**, vẫn cùng `stamp-binh-phong`; không xem hai mặt là hai hiện vật riêng.
4. Mỗi nhóm ảnh gần trùng chỉ cần một đại diện tốt; không dùng nhiều ảnh chụp cùng giây để tăng số reference.
5. Không chọn reference dựa trên lỗi của bộ final. Chỉ được cải thiện theo tập phát triển/calibration, sau đó đóng băng cấu hình trước khi chạm final.

Kết quả mong đợi: khoảng **90 reference tổng cộng** (10 cũ + tối đa 80 mới), có thể ít hơn nếu đủ bao phủ hoặc nguồn không đủ nhóm độc lập.

### Bước E — Chia calibration và final theo nhóm

- Với ảnh **đã duyệt đúng 9 bảo vật**, sau reference và quarantine/ảnh thừa, chia số còn lại gần **50% calibration / 50% final**, phân tầng theo bảo vật, mặt/góc và tình huống.
- Trước loại trùng/chất lượng, con số tham khảo là 827 − 80 = **747 ảnh**, khoảng **370–380 ảnh mỗi tập**. Đây không phải chỉ tiêu bắt buộc nếu nhóm chụp không cho phép.
- Giữ các `capture_group` và `duplicate_group` không giao nhau. Ưu tiên một tập con final **độc lập thiết bị hoặc buổi chụp**, nếu metadata đủ điều kiện. Báo riêng slice thiết bị chưa có trong reference; không bắt buộc 50/50 nếu điều đó phá độc lập.
- Với EXIF thực tế hiện chỉ có **một ngày và hai thiết bị**, một phương án pilot chặt hơn là giữ **toàn bộ 189 JPG của `22041216G` làm ứng viên final cross-device**: có 183 ảnh bảo vật và chỉ 6 ảnh Khác, cần duyệt trước khi gán nhãn. Reference/calibration lấy từ iPhone theo nhóm chụp, final negative bổ sung theo nhóm vật/cảnh độc lập. Đổi lại, reference/calibration iPhone vẫn có nguy cơ tương quan cùng buổi; không gọi đây là đánh giá khác ngày. Không chọn reference `22041216G` nếu muốn giữ nguyên ý nghĩa cross-device này. Phương án này thay thế, không áp đồng thời với mục tiêu số lượng chia 50/50 nêu trên. Để đo đáng tin hơn, nên bổ sung một buổi chụp khác làm final độc lập thực sự.
- Tình huống test: `known_clean` (đủ rõ, ít nền), `known_clutter` (góc nghiêng/nền/che nhẹ/phản chiếu nhưng vẫn có một đáp án rõ). Độ khó không được trở thành lý do đưa tất cả ảnh khó sang calibration và chỉ giữ ảnh dễ cho final. Trong lần rà offline hiện tại, chỉ một allowlist rõ ràng được gán `known_clean`; các ảnh dương tính còn lại dùng fallback bảo thủ `known_clutter`. 15 ảnh đã có review-only `_low_quality`/`_ambiguous` không bị ép vào hai scenario.
- Hai thư mục `Khác` cần chia theo **vật/cảnh cụ thể**, không phải theo file. Ảnh cùng một vật ngoài danh mục hoặc cùng chuỗi toàn cảnh nằm trong cùng tập. Không mặc định lấy `Khác` làm calibration và `Khác 2` làm final nếu khác nhau về độ khó hoặc bị trùng cảnh.
- Sau duyệt, chia gần 50/50 nguồn negative (tối đa khoảng 400 ảnh/tập), gồm:
  - `_unknown`: không có 9 bảo vật; cả vật dễ phân biệt và vật tương tự dễ nhận nhầm.
  - `_ambiguous`: nhiều mục tiêu/không thể xác định một đáp án rõ.
  - `_low_quality`: ảnh quá kém, mong muốn từ chối; không gộp vào unknown chỉ vì khó nhìn.
- Không tự coi toàn bộ ảnh low quality phải từ chối nếu con người vẫn nhìn rõ vật; cần quy tắc nhãn nhất quán và duyệt thủ công.
- Ảnh không thể xác minh để ở quarantine/review, không xóa ảnh gốc và không đưa vào mẫu số đánh giá chính.
- Ghi `split-manifest-v1.json` với seed/quy tắc/group, hash và nhãn; khóa final, ghi rõ nếu cần thu thập thêm dữ liệu độc lập.

### Bước F — Đánh giá hai vòng, có kiểm soát chi phí

1. **Baseline trước khi thêm reference:** dùng 10 ảnh hiện tại để đo trên calibration. Có thể chạy cùng một cache query cho bước so sánh tiếp theo, không tạo embedding lặp chỉ để thay số reference.
2. Thêm reference đã duyệt, tối đa khoảng 80 ảnh; đo lại trên **cùng calibration**, đánh giá lợi ích thực tế so với chi phí.
3. Chọn threshold/margin bằng calibration, ưu tiên kiểm soát nhận nhầm negative. Không hứa một mức lỗi cụ thể trước khi đo; tiêu chí chấp nhận cần thống nhất với chủ dự án.
4. Sau khi chốt reference/ngưỡng, chạy final một lần; báo top-1/correct acceptance theo từng bảo vật, false acceptance của unknown/ambiguous/low_quality, rejection, số mẫu, độ trễ và các giới hạn cùng ngày/cùng thiết bị.
5. Báo cả kết quả macro theo 9 bảo vật và nhóm negative, không chỉ accuracy chung vì gần nửa dữ liệu là negative. Với nhóm chụp gần nhau, số mẫu độc lập thấp hơn số file; không coi hàng trăm burst-frame là hàng trăm thử nghiệm độc lập.
6. Chỉ đồng bộ reference được duyệt lên production sau khi có manifest và quyết định triển khai. Không upload bộ final như reference, kể cả sau khi thấy nó bị nhận sai. Nếu chỉnh hệ thống theo lỗi final thì cần một bộ final mới.

## 5. Ngân sách và thứ tự thực hiện

- **Tải, kiểm kê, contact sheet, chuẩn hóa, gán nhãn và chia tập:** không cần model/API trả phí.
- **80 reference mới:** thường khoảng 160 lượt model (80 mô tả + 80 embedding), chưa gồm query khác. Hạn mức production là 200 lượt/ngày; giữ nguyên và chừa ngân sách cho hoạt động khác, không tự tăng.
- **Đánh giá toàn bộ 1.632 ảnh chưa cache:** khoảng 3.264 lượt mô tả/embedding theo pipeline hiện tại, chưa gồm 10 baseline hoặc retry. Số thực tế sau loại trùng/quarantine có thể thấp hơn. Runner offline không chịu hạn mức Worker, cần chốt ngân sách trước khi chạy.
- Có thể bắt đầu pilot với một số nhóm calibration của mỗi bảo vật và negative để kiểm tra quy trình, nhưng final phải giữ nguyên, không dùng làm pilot.

**Điểm duyệt tiếp theo:** xác nhận quy tắc nhãn + nhóm chụp, làm contact sheet đầy đủ/duyệt ảnh, chốt danh sách khoảng 80 reference và manifest chia tập; sau đó mới chuyển đổi hàng loạt, tạo embedding hoặc thay danh mục online.

## 6. Công cụ tải lại/kiểm kê

Các dependency Python chỉ phục vụ công cụ local trong `scripts/requirements-dataset.txt`, không thêm vào Worker. Có thể cài vào virtualenv hoặc thư mục công cụ Git-ignored:

```powershell
python -m pip install --target reports/drive-tools -r scripts/requirements-dataset.txt
$env:PYTHONPATH = (Resolve-Path reports/drive-tools).Path
$env:PYTHONIOENCODING = 'utf-8'

# PowerShell 7: đặt stdout UTF-8; Windows PowerShell cũ có thể ghi UTF-16.
python -m gdown --folder 'https://drive.google.com/drive/folders/1jYzY5U3Yc6R_3CdUz7h0T8rYOBFGb7VH' --json --no-cookies |
  Set-Content -Encoding utf8 reports/drive-discovery.json

python scripts/download-drive.py reports/drive-discovery.json data/incoming/drive-1jYzY5U3Yc6R_3CdUz7h0T8rYOBFGb7VH --workers 4
python scripts/audit-incoming.py data/incoming/drive-1jYzY5U3Yc6R_3CdUz7h0T8rYOBFGb7VH --contact-sheets
python -m unittest discover -s tests -p '*_test.py' -v
```

Downloader dùng link public, không lấy cookie trình duyệt. Chạy lại chỉ bỏ qua file có completion record khớp kích thước/SHA-256; file lỗi hoặc tải dở được thử lại, không coi file tồn tại là đã tải xong. File `.part`/history cũ có thể còn sau lần tải gián đoạn; chỉ file trong danh sách và có trạng thái complete mới được tính.
