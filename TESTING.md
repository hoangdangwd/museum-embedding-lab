# Kiểm tra nhận diện

App và evaluator chạy bằng Node.js + Cloudflare Worker.

## Test code

```powershell
npm test
npm run build
```

## Đánh giá embedding

Chuẩn bị JPEG và `manifest.json` theo cấu trúc:

```text
data/evaluation/
  references/<artifact>/*.jpg
  calibration/<artifact>/*.jpg
  calibration/_unknown/*.jpg
  calibration/_ambiguous/*.jpg
  calibration/_low_quality/*.jpg
  final/<artifact>/*.jpg
  final/_unknown/*.jpg
  final/_ambiguous/*.jpg
  manifest.json
```

Manifest phải có `version: 1`, `model`, `dimensions`, `signature` và `entries`. Mỗi entry ghi `file`, `partition`, `expected`, `scenario` với query, và SHA-256 của JPEG. Ảnh reference không có `scenario`; query phải dùng một trong `known_clean`, `known_clutter`, `out_of_catalog`, `ambiguous`, `low_quality`.

```powershell
npm run eval:embed
npm run eval:calibrate
npm run eval:final
npm run eval:rescore
```

`eval:calibrate` so sánh `max` với `top2_mean` trên cùng embedding và quét threshold `0.50..0.95`, margin `0.00..0.20`. `eval:final` dùng cấu hình được chọn từ calibration nhưng không thay đổi `wrangler.jsonc`.

Không dùng lại ảnh reference trong calibration/final. Ảnh ngoài catalog và ảnh mơ hồ phải được giữ riêng để phát hiện false acceptance.
