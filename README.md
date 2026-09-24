# AI Lens Lab - Nhận diện đối tượng qua Vector Embedding

Demo React/Vite chạy trên Cloudflare Workers. Guest mở camera và chụp ảnh; quản trị viên mở `/admin` để tạo vật thể, upload/chụp ảnh tham chiếu và kiểm tra nhận diện.

## Stack

- React + Vite + `@cloudflare/vite-plugin`
- Cloudflare Worker API + Workers Static Assets
- D1: metadata vật thể và trạng thái ảnh
- R2: ảnh tham chiếu JPEG
- Vectorize: tìm kiếm cosine vector 1536 chiều
- OpenRouter: `google/gemini-embedding-2`, output `1536`

## Local

```powershell
npm install
npm run dev:setup   # Chạy một lần sau khi clone hoặc đổi migration
npm run dev         # Chạy mỗi lần cần mở app
```

Mở URL được in ra terminal. Dev dùng D1 local và Vectorize index riêng, không ghi vào production.

Để gọi OpenRouter local, đặt key trong `.dev.vars`:

```powershell
OPENROUTER_API_KEY=...
ALLOW_ADMIN_LOCAL=true
```

App và công cụ đánh giá đều chạy bằng Node.js. Sau khi cấu hình Cloudflare lần đầu:

Các lệnh thường dùng:

```powershell
npm run dev      # Chạy local
npm run build    # Kiểm tra build
npm test         # Chạy test
npm run deploy   # Build → migrate D1 remote → deploy production
```

Đánh giá embedding local dùng JPEG và manifest tại `data/evaluation/`:

```powershell
npm run eval:embed
npm run eval:calibrate
npm run eval:final
npm run eval:rescore
```

`eval:calibrate` so sánh `max` với `top2_mean` và quét threshold/margin. Không dùng ảnh calibration để kết luận cuối; chỉ chọn cấu hình sau khi chạy tập `final` độc lập.

## Cloudflare resources

Chỉ tạo resource và secret **một lần** khi thiết lập tài khoản; các lần deploy sau chỉ cần `npm run deploy`:

```powershell
npx wrangler r2 bucket create museum-embedding-images
npx wrangler vectorize create museum-embedding-1536 --dimensions=1536 --metric=cosine
npx wrangler vectorize create-metadata-index museum-embedding-1536 --propertyName=artifact_id --type=string
npx wrangler secret put OPENROUTER_API_KEY
```

Đặt `ACCESS_TEAM_DOMAIN` và `ACCESS_AUD` trong Worker environment sau khi tạo Cloudflare Access application bảo vệ `/admin` và `/api/admin/*`. Production nên dùng custom domain thay vì mở `workers.dev`.

## Tests

```powershell
npm test
npm run build
```

Ảnh tham chiếu cũ 3072 chiều không tương thích với index mới; import lại qua `/admin` để tạo vector 1536 chiều.
