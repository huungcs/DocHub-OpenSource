# DocHub

Hệ thống quản lý, lưu trữ và phân quyền tài liệu đa người dùng, tích hợp Supabase và Google Drive.

## Chạy dự án

1. Sao chép `.env.example` thành `.env` và điền cấu hình cục bộ.
2. Tạo bản chạy từ mã nguồn: `npm run build`.
3. Khởi động máy chủ: `npm run dev`.
4. Mở `http://localhost:3000`.

Kiểm tra toàn bộ luồng hiện có bằng `npm run check`.

## Cấu trúc mã nguồn

```text
DocHub/
├── src/
│   ├── app/                         # Giao diện và logic ứng dụng
│   │   └── index.template.html      # Nguồn chính để chỉnh sửa
│   ├── config/                      # Cấu hình phía trình duyệt
│   └── integrations/                # Kết nối dịch vụ bên ngoài
│       ├── google-drive/
│       └── supabase/
├── database/
│   └── migrations/                  # Lịch sử thay đổi cơ sở dữ liệu
├── tests/
│   └── unit/                        # Kiểm thử đơn vị theo miền nghiệp vụ
├── scripts/                         # Build và tiện ích phát triển
├── docs/                            # Kiến trúc và tài liệu lịch sử
├── dist/                            # Sản phẩm build, không commit
│   ├── assets/
│   └── index.html
├── server.js                        # Máy chủ tĩnh cục bộ
└── package.json
```

## Quy ước phát triển

- Chỉ sửa giao diện trong `src/app/index.template.html`; `dist/index.html` được tạo lại bởi `npm run build`.
- Máy chủ chỉ phục vụ nội dung trong `dist`, không công khai `.env`, schema hoặc mã nguồn.
- Mọi tích hợp bên ngoài nằm trong `src/integrations/<service>`.
- Mỗi thay đổi schema mới là một migration mới; không sửa migration đã triển khai.
- Không commit `.env`, token OAuth hoặc khóa dịch vụ.
- Chạy `npm run check` trước khi bàn giao hoặc triển khai.

Chi tiết ranh giới module và lộ trình tách ứng dụng nằm trong `docs/architecture.md`.
