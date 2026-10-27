# DocHub 2.2 — Giao diện tập trung vào nội dung

Bản cập nhật từ DocHub 2.1: thu gọn phần đầu thư mục trên cả máy tính và điện thoại.
Không thêm thư viện giao diện, CDN hay dịch vụ bên ngoài. Bản HTML độc lập chứa đầy đủ mã và tệp mẫu của phiên bản trước.

## Cập nhật bản đang dùng

Sao lưu bản cũ trước khi thay thế. Trong menu tài khoản có lệnh xuất bản sao lưu ZIP; kiểm tra thông báo về tệp bị thiếu nếu có. Bản sao lưu hiện chưa có luồng nhập lại một chạm.

Thay **DocHub.html** trong đúng thư mục cũ; nếu tệp tải về tên DocHub-v2.2.html, đổi lại thành DocHub.html. Giữ nguyên server.py, requirements.txt và thư mục data/ đang dùng. Mở lại cùng trình duyệt, cùng đường dẫn/địa chỉ máy chủ. Không xóa dữ liệu trình duyệt, không bấm Đặt lại dữ liệu mẫu.

Không đổi các khóa lưu trữ: `dochub.demo.v1`, IndexedDB `dochub.demo.assets.v1`, `dochub.mobile.ui.v2.1`. Không sửa cấu trúc trạng thái hoặc đặt lại dữ liệu.

Việc lưu bằng file:// phụ thuộc trình duyệt; không xem đó là cơ chế sao lưu. Bản này chưa kiểm thử lại di chuyển dữ liệu thật.

## Những gì đã thay đổi

**Máy tính:** tiêu đề, số đếm và các nút Tải lên / Tạo mới nằm trên cùng một hàng gọn. Đường dẫn chỉ hiện các thư mục cha, không lặp tên hiện tại. Bỏ mô tả và dòng hướng dẫn dài khỏi vùng đầu.

**Điện thoại:** tiêu đề hai dòng, nút quay về thư mục cha và menu ba chấm. Nút + Tạo mới ở thanh dưới gom tải tệp, tạo thư mục, tạo văn bản; hiện rõ thư mục đích. Bỏ hai nút lớn trên đầu. Chỉ có một nút đổi danh sách/lưới để dành chỗ cho ô lọc.

**Chọn nhiều:** bấm checkbox, nhấn giữ hoặc mở menu ba chấm ở tiêu đề. Hàng Chọn trang này / Xong chỉ xuất hiện trong chế độ chọn. Checkbox vẫn nền trắng, viền đen, dấu tích đen.

**Khi cuộn:** thanh tên thư mục gọn chỉ xuất hiện sau khi tiêu đề chính đã ra khỏi màn hình. Không thu/phóng chiều cao nội dung khi cuộn, tránh nhảy vị trí.

**Thông tin phụ:** menu ba chấm > Thông tin thư mục hiện mô tả đầy đủ, người tạo, ngày cập nhật, số liệu và đường dẫn. Mục Xem đường dẫn cho phép quay nhanh đến các thư mục cha.

**Số đếm:** tiêu đề và các tab đếm mục trực tiếp. Ví dụ Phòng hành chính có 4 thư mục con, 0 tài liệu đặt trực tiếp; tổng 8 tài liệu nằm trong các thư mục con. Tổng nhánh xem trong Thông tin. Cách hiển thị này tránh nhầm với bộ lọc đang xem.

Cài đặt vẫn chỉ mở qua ảnh đại diện / Tài khoản; không thêm vào menu cây.

## Mở bản này

Mở DocHub.html để xem nhanh. Để dùng máy chủ cục bộ cũ, chạy `python server.py` hoặc `py server.py`, rồi mở `http://127.0.0.1:8080/DocHub.html`.
Nếu cài lần đầu: Python 3.10+, `python -m pip install -r requirements.txt` (cần Internet để cài gói). Bản này giữ nguyên server.py và requirements.txt của 2.1.

## Chỉnh sửa mã nguồn

- `src/app.js`: hàm compactFolderHeading, showFolderMenu, openFolderInformation, openFolderPath và logic giao diện cũ.
- `src/content-first.css`: toàn bộ CSS nâng cấp phần đầu.
- `src/content-first.js`: thanh ngữ cảnh khi cuộn, ResizeObserver, không can thiệp dữ liệu.
- `src/mobile.js`: nút + dưới màn hình và chọn nhiều theo ngữ cảnh.
- `src/index.html`: cấu trúc giao diện và biểu tượng.

Sau khi sửa, chạy `python build.py`. Bản HTML một file được tạo lại từ src/. Không cần npm. patches/ lưu bản diff tham khảo so với 2.1; file thực sự dùng khi build nằm trong src/.

## Phạm vi

Đây là nâng cấp giao diện, không bổ sung đăng nhập, phân quyền thật hay trình biên tập Office/PDF đầy đủ. Các bộ xem/sửa tệp, dữ liệu mẫu và adapter máy chủ được giữ nguyên. Giới hạn định dạng và giấy phép vẫn như bản cũ; xem docs/FORMAT-LIMITS-v2.md và docs/REFERENCES.md.

Không mở máy chủ thử nghiệm ra Internet hoặc đưa tài liệu mật vào. Chi tiết kiểm thử và giới hạn: docs/TESTING.md.
