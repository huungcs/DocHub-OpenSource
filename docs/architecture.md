# Kiến trúc DocHub

## Mục tiêu

Cấu trúc này tách mã nguồn có chủ đích theo trách nhiệm, đồng thời giữ quy trình chạy hiện tại đơn giản. Thư mục `dist` là sản phẩm build để máy chủ tĩnh phục vụ, không phải mã nguồn chỉnh sửa.

## Ranh giới module

- `src/app`: giao diện, trạng thái và nghiệp vụ phía trình duyệt.
- `src/config`: cấu hình công khai được nạp ở trình duyệt. Không đặt secret tại đây.
- `src/integrations/google-drive`: lớp giao tiếp Google Drive.
- `src/integrations/supabase`: xác thực, phiên đăng nhập và đồng bộ Supabase.
- `database/migrations`: lịch sử schema có thứ tự, có thể kiểm toán.
- `tests/unit`: kiểm thử nhanh, độc lập với trình duyệt và dịch vụ thật.
- `scripts`: các lệnh phục vụ phát triển và đóng gói.
- `docs/legacy`: tài liệu lịch sử, không đại diện cho kiến trúc hiện hành.
- `dist`: đầu ra tự sinh duy nhất được máy chủ công khai; thư mục này bị loại khỏi Git.

## Luồng build

```text
src/app/index.template.html
        + src/config
        + src/integrations
                │
                ▼
         scripts/build.js
                │
                ▼
       dist/index.html + assets
```

## Quy tắc phụ thuộc

1. `app` sử dụng API công khai của `integrations`, không truy cập trực tiếp SDK dịch vụ.
2. Một integration không phụ thuộc ngược vào giao diện.
3. Cấu hình chỉ mô tả môi trường; không chứa logic nghiệp vụ.
4. Test phản chiếu đường dẫn module và tập trung vào hành vi công khai.
5. Build phải tái tạo được toàn bộ `dist` chỉ từ mã nguồn đã commit.

## Lộ trình tiếp theo

`src/app/index.template.html` vẫn là ứng dụng nguyên khối để không làm gián đoạn sản phẩm hiện tại. Khi bổ sung bundler, nên tách dần thành `features`, `components`, `state` và `shared`; mỗi lần tách phải kèm kiểm thử hành vi, không tạo thư mục rỗng chỉ để trang trí kiến trúc.
