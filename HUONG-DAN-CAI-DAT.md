# 🚀 Hướng dẫn cài đặt DocHub (bản chia sẻ cộng đồng)

DocHub là hệ thống quản lý, lưu trữ và phân quyền tài liệu đa người dùng:
**Supabase** (đăng nhập + PostgreSQL RLS) · **Google Drive** (lưu tệp) · **Vercel** (triển khai).
Giấy phép **MIT** — được dùng, sửa và thương mại hoá tự do (giữ lại thông báo bản quyền).

> Bản này đã được làm sạch: không chứa khoá bí mật, URL dự án, email hay dữ liệu thật của tác giả.
> Bạn cần tạo dự án Supabase và Google Cloud **của riêng mình**.

## 1. Yêu cầu
- Node.js 20+  ·  Tài khoản [Supabase](https://supabase.com)  ·  Google Cloud project  ·  (tuỳ chọn) [Vercel](https://vercel.com)

## 2. Cài đặt nhanh
```bash
npm install
cp .env.example .env        # Windows: copy .env.example .env
```
Điền các giá trị trong `.env` (Supabase URL/keys, mật khẩu DB, Google OAuth client).

## 3. Cấu hình phía trình duyệt
Sửa `src/config/client-config.js` (và giá trị dự phòng trong `src/integrations/supabase/cloud-bridge.js`):
```js
SUPABASE_URL: 'https://<project-ref>.supabase.co',
SUPABASE_ANON_KEY: '<publishable / anon key>',
```
Chỉ dùng **publishable/anon key** ở đây — tuyệt đối không đưa `SERVICE_ROLE_KEY` vào mã phía trình duyệt.

Thay `your-project.supabase.co` trong `scripts/build.js`, và `your-domain.com` / `your-app.vercel.app` trong
`src/server/organization-api.js`, `robots.txt`, `sitemap.xml`, `src/app/privacy.html`, `src/app/terms.html`.

## 4. Cơ sở dữ liệu
```bash
npm run db:migrate          # chạy database/migrations theo thứ tự
```
Trong Supabase → Authentication → Providers: bật **Google** với cùng Client ID/Secret.
Google Cloud: bật **Google Drive API**, thêm redirect URI của Supabase vào OAuth client.

## 5. Chạy & kiểm thử
```bash
npm run build && node server.js   # http://localhost:3000
npm run check                     # toàn bộ test + build (test cloud cần file .env đã điền)
```

## 6. Triển khai Vercel
Import repo vào Vercel, khai báo biến môi trường giống `.env` (Settings → Environment Variables). `vercel.json` đã cấu hình sẵn.

Chi tiết kiến trúc: `docs/architecture.md`, `docs/ORGANIZATION_BACKEND.md`, `CLAUDE.md`.

---
Nếu thấy hữu ích, hãy giữ credit tác giả **huungcs** và chia sẻ cho người khác nhé ❤️
