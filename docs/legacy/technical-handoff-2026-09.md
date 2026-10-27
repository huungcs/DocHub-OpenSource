# BÁO CÁO HANDOFF KỸ THUẬT TOÀN DIỆN: HỆ THỐNG DOCHUB

---

## 1. TỔNG QUAN HỆ THỐNG

- **Tên dự án:** DocHub (Kế thừa từ DocHub Studio v2.0 / DocHub UI v2.2)
- **Phiên bản hiện tại:** `v2.2.0` (Được đánh dấu tại `window.DocHubDemo.version = '2.2.0'` trong `index.html:3102` và `package.json:3`).
- **Mục tiêu chính:** Cung cấp giải pháp quản lý, lưu trữ, điều hướng và phân quyền tài liệu đa người dùng (Multi-tenant) dựa trên cây thư mục phân cấp nội bộ, hỗ trợ mô hình **Bring Your Own Storage (BYOS)** qua Google Drive cá nhân của từng khách hàng và bảo mật dữ liệu cấp cơ sở dữ liệu qua Supabase PostgreSQL (Row Level Security).
- **Các chức năng đã triển khai (Implemented):**
  - Giao diện cây thư mục phân cấp cha/con linh hoạt, hỗ trợ thu gọn/mở rộng, kéo thả điều hướng.
  - Bộ xem trước và biên tập nhẹ đa định dạng tại trình duyệt: Image (Canvas crop, saturation), Video/Audio (HTML5 media), Văn bản (UTF-8 text), Bảng tính Excel `.xlsx` và Word `.docx` (Office Lite OOXML patcher), PDF (Canvas mark / viewer).
  - Xuất dữ liệu sao lưu toàn bộ không gian làm việc dưới dạng ZIP client-side qua `JSZip v3.10.1`.
  - Bộ điều khiển giao diện phản hồi responsive độc lập: Máy tính để bàn và Điện thoại thông minh (`#dochub-phone-controller`, `#dochub-content-first-controller`).
  - Lớp tích hợp đám mây (`src/dochub-cloud-bridge.js`): Cầu nối Supabase Auth, Supabase Database và Google Drive v3 REST API.
  - Script Database Schema & RLS Policies (`supabase_schema.sql`).
- **Các chức năng đang mô phỏng / demo (Demo Only):**
  - Phân quyền người dùng & nhóm (ACL): Quyền `viewer`, `contributor`, `editor`, `manager`, `owner` hiện **hoàn toàn là logic tính toán trên Client-side** thông qua hàm `effectivePermissions(userId, resourceId)` trong `index.html:1958`.
  - Dữ liệu mẫu ban đầu: 25 thư mục và 13 tài liệu mẫu được sinh động qua `createSeed()` (`index.html:1758`).
  - Trạng thái người dùng chuyển đổi: Người dùng hiện tại trên giao diện ban đầu mặc định gán cứng là `u1` (Vũ Ngọc Lan) trừ khi đăng nhập qua Supabase.
- **Các chức năng đã sẵn sàng production (Production-Ready):**
  - Giao diện UI/UX standalone, CSS Tokens, Responsive Layout không phụ thuộc bên ngoài.
  - Script bảo mật dữ liệu Row Level Security (RLS) trên Supabase (`auth.uid() = user_id`).
- **Các chức năng chưa production-ready (Not Production-Ready):**
  - Backend API kiểm tra quyền thực tế (Server-side ACL enforcement).
  - Xử lý đồng bộ xung đột đa người dùng theo thời gian thực (Realtime Collaborative Editing / Conflict Resolution).
  - Trình biên tập Office đầy đủ (hiện tại chỉ là patch OOXML cấp thấp, không hỗ trợ công thức phức tạp hoặc macro).
  - Quét mã độc (Antivirus), kiểm tra MIME type sâu (Magic bytes) khi upload.

### Mô hình kiến trúc hiện tại:
```
Frontend (HTML5 / Vanilla JS / CSS Custom Properties / JSZip)
    ↓
State / Application Layer (In-memory `state` + Local IndexedDB Cache `dochub_cloud_cache_v1`)
    ↓
API Bridge Layer (`src/dochub-cloud-bridge.js` & `src/google-drive.js`)
    ↓
Backend (Hiện chỉ có Static File Server `server.js`. Chưa có Backend App Server trung gian)
    ↓
Database & File Storage:
    - Database: Supabase PostgreSQL (Quản lý User Workspaces qua REST API có RLS)
    - File Binary Storage: Google Drive v3 REST API (Drive cá nhân của từng khách hàng)
```

---

## 2. TECH STACK

### Frontend:
- **Ngôn ngữ & Kiến trúc:** Vanilla HTML5, Vanilla CSS3 (Custom Properties / Design Tokens), Vanilla JavaScript (ES2022+), kiến trúc Single-Page không sử dụng framework (No React, No Vue).
- **UI Library:** Tự xây dựng 100% bằng CSS Tokens thuần (không dùng Tailwind, Bootstrap hay UI kit).
- **Icon Library:** Inline SVG Sprite tích hợp sẵn trong HTML (hơn 40 biểu tượng quản lý tài liệu tại `index.html:1052-1361`).
- **Các thư viện nhúng (Embedded Dependencies):**
  - `JSZip v3.10.1` (Nhúng trực tiếp vào `index.html:1406-1419`) để đọc/ghi file zip client-side.
  - `@supabase/supabase-js@2` (Nạp qua CDN unpkg/jsdelivr) để xác thực và gọi Supabase Database.

### Backend:
- **Ngôn ngữ:** Node.js (`v24.19.0`).
- **Framework:** Zero-dependency HTTP Server viết bằng module gốc `http`, `fs`, `path` (`server.js`).
- **Thư viện xử lý tài liệu:**
  - PDF: Client-side Canvas Annotation engine nhúng trong `index.html:1604-1650`.
  - Excel/Word: Tự triển khai qua module nhúng `DocHubOffice` (`index.html:1447-1551`) đọc và vá trực tiếp XML trong gói OOXML (`xl/worksheets/sheet1.xml`, `word/document.xml`).
  - Image/Video: Canvas 2D API và HTML5 Media Elements.

### Database:
- **Hệ quản trị:** PostgreSQL (Lưu trữ và vận hành trên nền tảng Supabase).
- **Schema hiện tại:** Đã định nghĩa tại `supabase_schema.sql`:
  - `public.user_profiles`: Quản lý hồ sơ người dùng liên kết với `auth.users`.
  - `public.user_workspaces`: Lưu JSON state của cây thư mục theo từng `user_id`.
  - `public.documents_index`: Chỉ mục metadata tài liệu và `google_drive_file_id`.
- **Migration system:** CHƯA CÓ (Hiện tại triển khai trực tiếp qua Supabase SQL Editor).

### Storage:
- **File nhị phân (Binary):** Google Drive cá nhân của khách hàng thông qua Google Drive API v3 (Thư mục tự tạo: `DocHub - Dữ liệu cá nhân`).
- **Bộ đệm cục bộ (Cache):** Trình duyệt `IndexedDB` (`DB_NAME = 'dochub_cloud_cache_v1'` tại `src/dochub-cloud-bridge.js:33`).
- **Tách biệt dữ liệu:** Metadata tài liệu (ID, tên, dung lượng, người tạo, thư mục cha) được lưu trong `state.documents` trên Database; file nhị phân nguyên bản (Blob) được đẩy lên Google Drive.

### Authentication:
- **Cơ chế:** Supabase Auth kết hợp Google OAuth 2.0.
- **Loại Token:** JWT (`access_token`) quản lý phiên Supabase; `provider_token` để gọi trực tiếp Google Drive API.
- **Xác định danh tính:** `supabase.auth.getUser()` lấy `auth.uid()`.

### Authorization:
- **Client-side:** Mô hình RBAC/ACL phân cấp trên bộ nhớ (xem chi tiết mục 9).
- **Backend enforcement:** Đã được bảo vệ ở tầng Database thông qua **Supabase Row Level Security (RLS)** với điều kiện `auth.uid() = user_id`. Khách hàng A không thể query hay mutate dữ liệu của khách hàng B. Tuy nhiên, việc kiểm tra xem User có quyền sửa một sub-folder cụ thể hay không hiện **chưa có backend enforcement** mà phụ thuộc hoàn toàn vào UI.

---

## 3. CẤU TRÚC SOURCE CODE

```
c:\Users\ASUS\Desktop\DocHub\
├── .env                          # Biến môi trường thực tế (Supabase Keys, URL) - Bị Git ignore
├── .env.example                  # Template biến môi trường mẫu
├── .gitignore                    # Chặn lộ credentials lên Git
├── DocHub-v2.2.html              # Bản gốc HTML standalone của DocHub v2.2
├── DocHub-v2.2-README.md         # Tài liệu kỹ thuật gốc của phiên bản v2.2
├── index.html                    # Giao diện chính hoàn chỉnh tích hợp Supabase & Google Drive (~1.27 MB)
├── package.json                  # Cấu hình dự án Node.js & NPM scripts
├── README.md                     # Tổng quan dự án DocHub
├── server.js                     # Máy chủ tĩnh Node.js cục bộ (Port 3000)
├── supabase_schema.sql           # Toàn bộ mã DDL khởi tạo bảng và RLS policies cho Supabase
├── scripts/
│   └── build.js                  # Script Node.js tự động cập nhật index.html từ template gốc
└── src/
    ├── config.js                 # Cấu hình Supabase URL, Anon Key & Scope Google Drive
    ├── google-drive.js           # Client thao tác Google Drive v3 REST API (CRUD file & folder)
    └── dochub-cloud-bridge.js    # Cầu nối tích hợp window.DocHubAPI thay thế mock server
```

### Chi tiết các phân vùng logic trong `index.html`:
- **Dòng 10–1050:** Toàn bộ CSS Design System, Responsive Breakpoints, Layout rules, Dialog styles.
- **Dòng 1052–1361:** Thư viện biểu tượng SVG inline `<svg id="dochub-icons">`.
- **Dòng 1362–1420:** Bộ khung HTML Layout (`aside.sidebar`, `header.topbar`, `main#workspace`, `<dialog>` modals).
- **Dòng 1421–1435:** Thư viện nhúng `JSZip v3.10.1`.
- **Dòng 1436–1446:** Cầu nối nạp các script ngoài (`src/config.js`, `src/google-drive.js`, `src/dochub-cloud-bridge.js`).
- **Dòng 1447–1551:** Module `DocHubOffice` (Trình đọc/vá bảng tính Excel `.xlsx` và văn bản Word `.docx`).
- **Dòng 1553–1711:** Module `DocHubMedia` (Bộ xem trước và biên tập Media Studio: Image, Audio, Video, PDF).
- **Dòng 1712–3120:** Lõi ứng dụng chính (DocHub Core Application): State store, cây thư mục, thuật toán phân quyền ACL, bộ điều khiển tìm kiếm, renderers, event listeners.
- **Dòng 3123–3371:** Script `#dochub-phone-controller`: Tối ưu hóa trải nghiệm điều hướng dành riêng cho điện thoại.
- **Dòng 3372–3398:** Script `#dochub-content-first-controller`: Quản lý header cuộn thu gọn và breadcrumbs.

---

## 4. KIẾN TRÚC FRONTEND

### Luồng tương tác:
```
User Action (Click/Input/Drop)
    ↓
Event Listener (Ủy quyền sự kiện tại document level: `document.addEventListener('click', ...)`)
    ↓
Action Dispatcher (switch(action) tại `index.html:2800-2886`)
    ↓
State Mutation (Trực tiếp biến đổi biến toàn cục `state`)
    ↓
Commit (`commit(action, resourceId, detail, symbol)` tại `index.html:1943`)
    ↓
Render (`renderAll()` hoặc `renderWorkspace()`)
    ↓
Persistence (`saveState()` → `window.DocHubAPI.scheduleState(state)` → Supabase DB)
```

### Cấu trúc State chính (`index.html:1840`):
```javascript
state = {
  version: 1,
  folders: [ /* danh sách Folder objects */ ],
  documents: [ /* danh sách Document objects */ ],
  users: [ /* danh sách User objects */ ],
  groups: [ /* danh sách Group objects */ ],
  acl: [ /* danh sách Access Control Rules */ ],
  logs: [ /* lịch sử thao tác gần nhất, tối đa 500 mục */ ],
  preferences: {
    theme: 'light', // 'light' | 'dark' | 'system'
    density: 'comfortable',
    view: 'grid', // 'grid' | 'list'
    sort: 'updated',
    lastFolder: 'training',
    expanded: ['hr', 'admin'],
    workspaceName: 'Không gian doanh nghiệp'
  },
  createdAt: "2026-09-15T..."
}
```

### Đặc điểm kiến trúc State & Render:
- **Vị trí State:** Toàn bộ dữ liệu nằm trong biến closure toàn cục `let state` (`index.html:1886`) và biến trạng thái giao diện `const ui` (`index.html:1903`).
- **Cơ chế Mutate:** State được mutate trực tiếp (In-place mutation, e.g., `state.documents.push(...)`, `item.name = newName`).
- **Cơ chế Render:** Không có Virtual DOM. Hàm `renderWorkspace()` (`index.html:2120`) tạo chuỗi HTML bằng Template Literals và ghi đè thẳng vào DOM qua `element.innerHTML = markup`.
- **Rủi ro hiệu năng tiềm ẩn:** Việc gọi `renderWorkspace()` sẽ hủy và tạo lại toàn bộ DOM của danh sách tài liệu hiện tại. Nếu thư mục có hàng trăm phần tử và người dùng thao tác checkbox, toàn bộ bảng/lưới bị vẽ lại.

---

## 5. CÂY THƯ MỤC (FOLDER MODEL)

### Data Model:
```typescript
interface Folder {
  id: string;            // Định danh duy nhất (ví dụ: 'all', 'salary', 'hr')
  parentId: string|null; // ID thư mục cha (Root folder 'all' có parentId: null)
  name: string;          // Tên hiển thị của thư mục
  description: string;   // Mô tả mục đích sử dụng
  kind: 'folder';        // Luôn là 'folder'
  inherit: boolean;      // Kế thừa quyền từ thư mục cha (true/false)
  ownerId: string;       // ID người tạo ('u1')
  starred: boolean;      // Đánh dấu ưu tiên
  createdAt: string;     // ISO timestamp
  updatedAt: string;     // ISO timestamp
  deletedAt: string|null;// ISO timestamp nếu nằm trong thùng rác, null nếu active
}
```

### Cơ chế hoạt động:
- **Thư mục gốc:** Thư mục ID `'all'` có `parentId === null`. Mọi thư mục khác đều là con cháu của `'all'`.
- **Xác định phả hệ:**
  - `ancestorIds(id)` (`index.html:1918`): Duyệt ngược qua `parentId` lên đến root.
  - `descendantIds(id, includeSelf)` (`index.html:1925`): Duyệt BFS tìm toàn bộ cây con.
- **Hành vi khi click folder:**
  1. Gọi `navigate(id, push=true)` (`index.html:2255`).
  2. Cập nhật `ui.folder = id`, reset `ui.page = 1`, reset search query.
  3. Mở rộng toàn bộ thư mục tổ tiên: `ancestorIds(id).forEach(a => ui.expanded.add(a))`.
  4. Đẩy hash vào URL: `history.pushState({folder: id}, '', '#folder=' + id)`.
  5. Gọi `saveState()`, `renderAll()`, cập nhật `document.title`.
- **Lưu trữ Expand/Collapse:** Danh sách ID thư mục đang mở được lưu trong `state.preferences.expanded` (mảng string).
- **Tìm kiếm thư mục:** Ô tìm kiếm cây thư mục `#treeSearch` lọc thời gian thực qua hàm `renderTree()` (`index.html:2054`) sử dụng hàm chuẩn hóa tiếng Việt không dấu `normalize()`.
- **Khả năng chịu tải:** Cây thư mục hiện được render đệ quy toàn bộ các node active vào DOM trong `renderTree()`. Nếu có > 1.000 folder, DOM tree sẽ bị phình to và giật lag vì chưa có kỹ thuật Virtual Tree Scrolling.

---

## 6. DOCUMENT / FILE MODEL

### Schema đầy đủ:
```typescript
interface Document {
  id: string;            // ID duy nhất (ví dụ: 'd1', hoặc 'doc-xyz')
  parentId: string;      // ID thư mục chứa tài liệu
  name: string;          // Tên tài liệu không bao gồm phần mở rộng
  ext: string;           // Phần mở rộng viết thường (pdf, docx, xlsx, png, txt,...)
  bytes: number;         // Kích thước file tính bằng byte
  mime?: string;         // MIME type (application/pdf,...)
  ownerId: string;       // ID người sở hữu ('u1')
  description: string;   // Ghi chú hoặc mô tả tài liệu
  starred: boolean;      // Đánh dấu yêu thích
  kind: 'file';          // Định danh đối tượng
  sample: boolean;       // true nếu là file mẫu có sẵn, false nếu file tải lên thật
  source: string;        // 'sample' | 'bundled' | 'upload' | 'inline'
  assetStorage?: string; // 'indexeddb' | 'session' | 'drive'
  createdAt: string;     // ISO timestamp
  updatedAt: string;     // ISO timestamp
  deletedAt: string|null;// ISO timestamp nếu đã xóa tạm vào thùng rác
}
```

### Các luồng thao tác và hàm phụ trách:
- **Tải lên (Upload):** `handleUpload(fileList)` (`index.html:2607`) → gọi `saveAsset(id, file)` → `window.DocHubAPI.putAsset(id, blob)` → đẩy lên Google Drive và IndexedDB.
- **Tải xuống (Download):** `downloadDocument(id)` (`index.html:2595`) → lấy blob qua `getAsset(id)` → kích hoạt `downloadBlob()`.
- **Xem trước (Preview):** `openPreview(id)` (`index.html:2638`) → chuyển tiếp sang `window.DocHubMedia.open(id)` (`index.html:1574`).
- **Đổi tên (Rename):** `openRename(id)` (`index.html:2460`) → form submit gọi `commit()`.
- **Di chuyển (Move):** `openMove(ids)` (`index.html:2474`) → chọn thư mục đích → cập nhật `item.parentId = targetFolderId`.
- **Xóa (Delete):** `requestDelete(ids)` (`index.html:2486`) → Soft delete bằng cách gán `item.deletedAt = new Date().toISOString()`.
- **Khôi phục (Restore):** `restoreItem(id)` trong cài đặt Thùng rác → gán `item.deletedAt = null`.
- **Phiên bản hóa (Versioning):** **CHƯA CÓ**. Việc chỉnh sửa file trong Media Studio tạo ra một file mới với hậu tố `-ban-sua` chứ không ghi đè file gốc.

---

## 7. FILE VIEWER & EDITOR

| Định dạng | Xem được? | Chỉnh sửa được? | Cơ chế lưu | Thư viện xử lý | Xử lý ở đâu | Giới hạn hiện tại | Rủi ro mất format |
|---|---|---|---|---|---|---|---|
| **PDF** | CÓ | CÓ (Vẽ ghi chú / highlight) | Tạo bản sao mới kèm layer vẽ | HTML5 Canvas / Blob URL | Frontend | Giới hạn canvas tối đa 5000px chiều cao | KHÔNG (Tệp gốc giữ nguyên) |
| **DOCX** | CÓ | CÓ (Sửa text từng đoạn) | Vá file zip XML | `DocHubOffice.WordDoc` (Custom XML parser) | Frontend | Chỉ đọc các thẻ `<w:p>`, `<w:t>`, không hiển thị bảng phức tạp | TRUNG BÌNH (Mất style nâng cao nếu lưu) |
| **XLSX** | CÓ | CÓ (Sửa ô tính) | Vá file zip XML | `DocHubOffice.Book` (Custom XML parser) | Frontend | Hỗ trợ tối đa 10.000 ô; không chạy công thức | THẤP (Vá trực tiếp `sheet1.xml`) |
| **CSV** | CÓ | CÓ | Bản sao | Text parsing thuần | Frontend | Xử lý theo bảng phân cách dấu phẩy | KHÔNG |
| **TXT / MD / JSON**| CÓ | CÓ (Textarea) | Bản sao | Native TextDecoder | Frontend | Giới hạn tối đa 2 MB | KHÔNG |
| **PNG / JPG / WEBP**| CÓ | CÓ (Cắt, chỉnh bão hòa)| Bản sao | HTML5 Canvas 2D | Frontend | Tối đa 32 Megapixel | KHÔNG (Xuất PNG mới) |
| **Video (MP4, WEBM)**| CÓ | CÓ (Cắt đoạn ngắn) | Xuất đoạn clip | HTML5 `<video>` | Frontend | Phụ thuộc codec trình duyệt | KHÔNG |
| **Audio (MP3, WAV)** | CÓ | CÓ (Cắt đoạn ngắn) | Xuất đoạn clip | HTML5 `<audio>` | Frontend | Phụ thuộc codec trình duyệt | KHÔNG |

### Kiến trúc Editor hiện tại:
Editor hoạt động dưới dạng Modal toàn màn hình `#studioDialog` quản lý bởi closure `DocHubMedia`. Nguyên tắc thiết kế cốt lõi: **"Không bao giờ ghi đè lên file gốc"** (`index.html:1555`). Khi bấm Lưu, file đã sửa được xuất ra dưới dạng blob mới và tạo một Document mới trong danh sách.

---

## 8. UPLOAD & STORAGE FLOW

```
User chọn file (hoặc kéo thả vào vùng làm việc)
    ↓
handleUpload(fileList) [index.html:2607]
    ↓
Kiểm tra số lượng: tối đa 100 tệp / lần
    ↓
Kiểm tra dung lượng: MAX_FILE_SIZE = 250 MB / tệp (index.html:1723)
    ↓
Làm sạch tên file: loại bỏ ký tự điều khiển [\\/\u0000-\u001f], cắt tối đa 90 ký tự
    ↓
Xử lý trùng tên: uniqueName(name, parentId) tự động thêm số thứ tự (1), (2)
    ↓
saveAsset(id, file) [index.html:1998]
    ↓
window.DocHubAPI.putAsset(id, blob) [src/dochub-cloud-bridge.js:192]
    ↓
1. Lưu cache IndexedDB: store 'assets'
2. Gọi DocHubDrive.uploadFile(token, folderId, blob) (Multipart Upload)
    ↓
Lưu metadata vào Supabase Database: table `documents_index`
    ↓
Thêm document vào `state.documents` & gọi `commit('Tải lên...', parentId)`
    ↓
Render lại UI danh sách tài liệu
```

### Bảng trạng thái các tính năng Upload:
- Kích thước tối đa: **250 MB**
- MIME validation: **PARTIAL** (Chỉ kiểm tra extension qua `file.name.split('.').pop()`, chưa kiểm tra header bytes)
- Extension validation: **IMPLEMENTED** (Cắt tối đa 24 ký tự)
- Duplicate handling: **IMPLEMENTED** (Tự sinh tên độc nhất qua `uniqueName`)
- Overwrite behavior: **NOT IMPLEMENTED** (Luôn tạo mới, không ghi đè)
- Upload progress bar: **NOT IMPLEMENTED** (Hiện chỉ hiển thị trạng thái cờ `ui.uploading`)
- Retry mechanism: **NOT IMPLEMENTED**
- Chunk / Resumable upload: **NOT IMPLEMENTED** (Đang dùng Multipart đơn)
- Antivirus scanning: **NOT IMPLEMENTED**
- Checksum / Deduplication: **NOT IMPLEMENTED**

---

## 9. PHÂN QUYỀN (AUTHORIZATION & ACL)

### Data Structure:
- **Danh sách quyền cơ bản (`ACTIONS` tại `index.html:1717`):**
  - `read` (Xem), `download` (Tải xuống), `create` (Tạo mới), `edit` (Chỉnh sửa), `move` (Di chuyển), `delete` (Xóa), `share` (Chia sẻ), `manage` (Phân quyền).
- **Các vai trò định sẵn (`ROLES` tại `index.html:1721`):**
  - `viewer`: `['read', 'download']`
  - `contributor`: `['read', 'download', 'create']`
  - `editor`: `['read', 'download', 'create', 'edit']`
  - `manager`: `['read', 'download', 'create', 'edit', 'move', 'delete', 'share']`
  - `owner`: Đầy đủ toàn bộ quyền trong `ACTIONS`.
- **Cấu trúc Rule ACL (`rule()` tại `index.html:1825`):**
  ```typescript
  interface ACLRule {
    id: string;                     // 'acl-...'
    resourceId: string;             // ID thư mục được áp dụng
    principalId: string;            // ID của User ('u1') hoặc Group ('g-admin')
    principalType: 'user'|'group';  // Loại đối tượng nhận quyền
    role: 'viewer'|'contributor'|'editor'|'manager'|'owner';
  }
  ```

### Thuật toán tính quyền hiệu lực (Effective Permissions):
Hàm `effectivePermissions(userId, resourceId)` (`index.html:1958`):
1. Lấy thông tin người dùng: Nếu user không tồn tại hoặc `!user.active`, trả về `permissions: []`.
2. Truy vết cây thừa kế qua `inheritedRules(resourceId)` (`index.html:1948`):
   - Bắt đầu từ thư mục hiện tại, lấy toàn bộ rules trong `state.acl` gán cho thư mục này.
   - Nếu thư mục có cờ `inherit === true`, tiếp tục nhảy lên `parentId` để thu thập rules từ các thư mục cha.
   - Nếu gặp thư mục có `inherit === false` (Break inheritance), dừng vòng lặp ngay lập tức.
3. Lọc rule hợp lệ:
   - Match trực tiếp `rule.principalType === 'user' && rule.principalId === userId`.
   - Hoặc match nhóm: `rule.principalType === 'group' && user.groupIds.includes(rule.principalId)`.
4. Gộp quyền: `[...new Set(sources.flatMap(rule => ROLES[rule.role].permissions))]`.

> ⚠️ **LƯU Ý CỐT LÕI VỀ BẢO MẬT:**  
> Thuật toán ACL này **CHỈ ĐANG CHẠY TRÊN CLIENT-SIDE (FRONTEND)** để ẩn/hiện các nút bấm trong Cài đặt và Menu thao tác. Backend chưa có bất kỳ middleware nào kiểm tra effective permissions này khi thực hiện các yêu cầu tải file.

---

## 10. USER / GROUP / ROLE

### Cấu trúc dữ liệu (`index.html:1810-1824`):
```typescript
interface User {
  id: string;           // 'u1', 'u2',...
  name: string;         // 'Vũ Ngọc Lan'
  email: string;        // 'lan.vu@example.com'
  department: string;   // 'Phòng hành chính'
  groupIds: string[];   // ['g-system', 'g-admin'] -> Quan hệ 1 User - Nhiều Group
  active: boolean;      // true/false
}

interface Group {
  id: string;           // 'g-system', 'g-admin',...
  name: string;         // 'Quản trị hệ thống'
  description: string;  // Mô tả nhóm
}
```

- **Mối quan hệ:** 1 User có thể thuộc nhiều Group (`user.groupIds`).
- **Nested Groups:** **CHƯA CÓ** (Groups là danh sách phẳng, không có cha/con).
- **Phạm vi Role:** Role không gán toàn cục cố định mà được gán **theo từng Resource (Folder)** thông qua bảng `acl`.
- **Xử trị viên (Admin):** Nhóm `g-system` được gán quyền `owner` tại thư mục gốc `'all'`.

---

## 11. API HIỆN TẠI

### 1. Phía Static Server cục bộ (`server.js`):
- `GET /*`
  - **Purpose:** Phục vụ file tĩnh (HTML, CSS, JS, SVG, Fonts).
  - **Auth:** None (Công khai trên localhost).

### 2. Phía Supabase REST API (Gọi từ `src/dochub-cloud-bridge.js`):
- `GET /rest/v1/user_workspaces?select=state,revision&user_id=eq.{uid}`
  - **Purpose:** Đọc toàn bộ cây thư mục và state của khách hàng.
  - **Authorization:** `Bearer {supabase_jwt}` + RLS policy `auth.uid() = user_id`.
- `POST/PUT /rest/v1/user_workspaces`
  - **Purpose:** Lưu và đồng bộ state mới nhất.
  - **Payload:** `{ user_id, state: JSON, revision: number, updated_at: timestamp }`.
  - **Authorization:** `Bearer {supabase_jwt}` + RLS policy.
- `POST/DELETE /rest/v1/documents_index`
  - **Purpose:** Đăng ký hoặc xóa metadata tệp Google Drive.
  - **Authorization:** `Bearer {supabase_jwt}` + RLS policy.

### 3. Phía Google Drive API v3 (Gọi từ `src/google-drive.js`):
- `GET https://www.googleapis.com/drive/v3/files?q=...`
  - **Purpose:** Tìm kiếm thư mục ứng dụng trên Drive khách hàng.
  - **Authorization:** `Bearer {provider_token}` (Scope: `drive.file`).
- `POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`
  - **Purpose:** Upload file nhị phân vào thư mục riêng của khách hàng.
- `GET https://www.googleapis.com/drive/v3/files/{id}?alt=media`
  - **Purpose:** Tải stream dữ liệu nhị phân về trình duyệt để xem trước.
- `DELETE https://www.googleapis.com/drive/v3/files/{id}`
  - **Purpose:** Xóa file trên Google Drive.

---

## 12. DATABASE / PERSISTENCE

### Phân bố dữ liệu:
| Vị trí | Dữ liệu được lưu |
|---|---|
| **Trình duyệt (Browser Memory)** | Toàn bộ đối tượng `state` đang hoạt động, danh sách URL previews tạm thời |
| **Trình duyệt (IndexedDB)** | Binary Blobs của file xem gần đây (`dochub_cloud_cache_v1`), state demo dự phòng (`dochub.demo.v1`) |
| **Trình duyệt (LocalStorage)** | Tùy chọn giao diện (Theme, Density, View mode) |
| **Server RAM (`server.js`)** | Không lưu state nào (Stateless) |
| **Filesystem máy chủ** | Chỉ lưu mã nguồn tĩnh và file cấu hình `.env` |
| **Database (Supabase PostgreSQL)**| Dữ liệu người dùng, Workspace state JSONB, Document Index |
| **Cloud Storage (Google Drive)** | Toàn bộ các file tài liệu nhị phân thực tế |

- **Hành vi khi restart server:** Không ảnh hưởng gì đến dữ liệu người dùng, vì máy chủ Node.js chỉ làm nhiệm vụ static web server. Toàn bộ dữ liệu nằm ở Supabase và Google Drive.

---

## 13. RESPONSIVE / MOBILE ARCHITECTURE

### Breakpoints định nghĩa trong CSS (`index.html:12-14`):
- `> 1280px`: Desktop tiêu chuẩn (Mở rộng sidebar và bảng điều khiển chi tiết).
- `1000px – 1280px`: Compact Desktop.
- `700px – 1000px`: Tablet (Sidebar chuyển thành drawer dạng modal `#navDialog`).
- `< 700px`: Mobile Documents layout.
- `< 480px`: Small Phones (Tối ưu nút bấm cảm ứng lớn tối thiểu 44px).

### Cơ chế chuyển đổi Desktop ↔ Mobile:
- **Cây thư mục (`syncNavigation()` tại `index.html:3014`):**
  - Trên Desktop: Node `#sidebar` nằm trực tiếp trong `#app`.
  - Trên Mobile (<1000px): Hàm `syncNavigation()` tự động di chuyển DOM `#sidebar` vào bên trong `<dialog id="navDialog">`.
- **Thanh điều hướng dưới đáy (Mobile Bottom Navigation):**
  - Script `#dochub-phone-controller` (`index.html:3142`) tự động gắn `#mDock` vào DOM khi mở trên điện thoại, bao gồm các nút: *Thư mục, Tìm kiếm, + Tạo mới, Tài khoản*.
- **Vùng dễ xung đột / Regression:**
  - Logic di chuyển DOM của `#sidebar` khi resize màn hình qua lại giữa desktop và mobile có thể làm mất focus hoặc đứt sự kiện nếu thêm các component động.

---

## 14. UI/UX HIỆN TẠI

### Cấu trúc Layout:
- **Desktop:**
  - `Sidebar` cố định bên trái (286px): Logo DocHub, Workspace Selector, Cây thư mục có cuộn độc lập, Trạng thái hệ thống dưới đáy.
  - `Topbar`: Global search (`Ctrl + K`), Nút Đăng nhập Google/Drive, Nút thông báo hoạt động, Nút Profile & Settings.
  - `Workspace Area`: Header thư mục thu gọn, Breadcrumb chỉ hiện thư mục cha, Bộ lọc nhanh (Tất cả, Tài liệu, Đã gắn sao), Chế độ xem Lưới/Danh sách, Phân trang (12 mục/trang).
- **Mobile:**
  - Header thu gọn 2 dòng, nút quay lại thư mục cha nhanh.
  - Nút `+ Tạo mới` nổi bật ở dock điều hướng phía dưới gom cụm: *Tải tệp lên, Tạo thư mục mới, Tạo văn bản*.
  - Hàng chọn nhiều (Multi-select bar `#selectionBar`) chỉ xuất hiện khi có ít nhất 1 mục được chọn.

---

## 15. DESIGN SYSTEM

### Tokens cốt lõi (`index.html:14-31`):
- **Màu sắc nền & bề mặt:**
  - Light mode: `--bg: #f7f9fc`, `--surface: #fff`, `--surface-soft: #f9fafc`, `--surface-hover: #f4f7fb`
  - Dark mode: `--bg: #101722`, `--surface: #172130`, `--surface-soft: #1b2738`
- **Màu chữ & Viền:**
  - `--ink: #17243c`, `--text: #34435d`, `--muted: #66758d`, `--line: #e7ecf3`, `--line-strong: #d8e0eb`
- **Màu thương hiệu & Trạng thái:**
  - `--brand: #3269ed`, `--brand-hover: #2154cd`, `--brand-soft: #edf3ff`
  - `--green: #227358`, `--red: #ba4455`, `--amber: #98691a`
- **Kích thước & Bán kính:**
  - `--radius: 14px`, `--row-height: 78px`, `--sidebar-width: 286px`
  - `--font: "Inter", "Segoe UI", -apple-system, sans-serif`
- **Điểm chưa chuẩn hóa:** Một số style trong các modal editor (`#studioDialog`) đang dùng hardcoded pixel thay vì biến CSS Token.

---

## 16. SEARCH / FILTER / SORT

- **Vị trí xử lý:** Toàn bộ tìm kiếm, lọc và sắp xếp đang xử lý **100% ở Frontend** trong hàm `visibleItems()` (`index.html:2087`).
- **Thuật toán chuẩn hóa:** Hàm `normalize(value)` (`index.html:1749`) loại bỏ dấu tiếng Việt bằng Regex Unicode NFD (`replace(/[\u0300-\u036f]/g, '')`).
- **Khả năng chịu tải với 100.000 tài liệu:** **SẼ BỊ TREO TRÌNH DUYỆT (CRASH).** Do duyệt mảng `Array.filter()` trên toàn bộ tập dữ liệu trong RAM mỗi khi gõ phím. Cần chuyển sang tìm kiếm phía Backend (PostgreSQL Full-Text Search hoặc pg_trgm).

---

## 17. PERFORMANCE (ĐÁNH GIÁ HIỆN TRẠNG)

- **Số folder/document lớn:** Đang xử lý mượt mà ở mức < 1.000 mục. Trên 5.000 mục bắt đầu có độ trễ rõ rệt khi render DOM.
- **Render Cost:** Hàm `renderWorkspace()` tạo lại chuỗi HTML và gán vào `.innerHTML` gây tốn chi phí Reflow và Garbage Collection.
- **Excel & PDF lớn:**
  - Excel > 10.000 ô bị chặn cố ý để tránh đơ tab (`index.html:1705`).
  - PDF được render qua Canvas. Nếu file PDF có hàng chục trang dung lượng cao, bộ nhớ RAM trình duyệt sẽ tăng vọt nếu không giải phóng `URL.revokeObjectURL()`.

---

## 18. SECURITY ASSESSMENT

| Danh mục kiểm tra | Trạng thái | Ghi chú kỹ thuật |
|---|---|---|
| **Authentication** | **PARTIAL** | Đã có Supabase Google OAuth, nhưng cần hoàn tất cấu hình Client ID thật trên Google Cloud Console |
| **Row Level Security** | **IMPLEMENTED** | Schema PostgreSQL đã thiết lập RLS `auth.uid() = user_id` cho mọi bảng |
| **Authorization (ACL)** | **NOT IMPLEMENTED (Backend)** | ACL chỉ kiểm tra ở giao diện; Backend chưa chặn endpoint theo quyền thư mục con |
| **XSS Prevention** | **PARTIAL** | Có hàm escape HTML `e()` tại `index.html:1746`, nhưng nhiều chỗ chèn innerHTML cần audit kỹ |
| **CSRF** | **IMPLEMENTED** | Do sử dụng mô hình Bearer Token trong header thay vì Cookie-based session |
| **Path Traversal** | **IMPLEMENTED** | `server.js` đã kiểm tra `filePath.startsWith(ROOT)` ngăn chặn `../` |
| **MIME Validation** | **NOT IMPLEMENTED** | Chỉ dựa vào đuôi mở rộng của file |
| **Malware Scanning** | **NOT IMPLEMENTED** | Chưa có antivirus engine quét file tải lên |
| **Dangerous SVG/HTML**| **PARTIAL** | File HTML/SVG tải lên chưa được khử khuẩn (Sanitize) qua DOMPurify |
| **Audit Logging** | **IMPLEMENTED (Client)** | Có bảng ghi nhật ký `state.logs` lưu trữ 500 hành động gần nhất |

---

## 19. TESTING

- **Framework kiểm thử:** **CHƯA CÓ** (Chưa cấu hình Jest, Vitest, Playwright hay Cypress).
- **Unit test:** CHƯA CÓ.
- **Integration test:** CHƯA CÓ.
- **Kiểm tra thủ công (Manual smoke test):** Đã chạy script Node.js kiểm tra cú pháp, kiểm tra HTTP 200 response từ `server.js`, và kiểm tra kết nối API Supabase qua `curl.exe`.

---

## 20. NHỮNG THAY ĐỔI GẦN ĐÂY

1. **Commit `947738f`:** Khởi tạo repository Git DocHub, tạo `.env.example`, `.gitignore`, và `README.md`.
2. **Commit `e325003`:**
   - Tích hợp giao diện standalone DocHub v2.2 vào dự án.
   - Viết module `src/config.js` lưu trữ endpoint Supabase và Google Drive.
   - Viết client `src/google-drive.js` xử lý Multipart Upload và CRUD file trên Google Drive v3 REST API.
   - Viết adapter `src/dochub-cloud-bridge.js` kết nối Supabase Auth, Supabase DB và Google Drive.
   - Xây dựng file `supabase_schema.sql` gồm bảng `user_profiles`, `user_workspaces`, `documents_index` và các chính sách RLS.
   - Viết máy chủ tĩnh `server.js` và script đóng gói `scripts/build.js`.
   - Sinh ra tệp production `index.html` tích hợp thanh đăng nhập Google Auth và hiển thị trạng thái kết nối Cloud.

---

## 21. TECHNICAL DEBT

### 🔴 CRITICAL:
1. **Phân quyền chưa có Backend Enforcement:** Người dùng có thể chỉnh sửa mã JavaScript trên trình duyệt để vượt qua hàm `can()` hoặc `effectivePermissions()`. Cần chuyển logic ACL vào PostgreSQL Functions hoặc API Middleware.
2. **Toàn bộ State lưu thành 1 cột JSONB:** Bảng `user_workspaces` lưu toàn bộ cây thư mục và danh sách file trong một trường `state JSONB`. Khi số lượng tài liệu lên hàng nghìn, việc đọc/ghi cả cụm JSON mỗi lần thay đổi 1 tên file sẽ gây nghẽn I/O nghiêm trọng. Cần chuẩn hóa thành các bảng quan hệ (`folders`, `documents`, `acl_rules`).

### 🟠 HIGH:
3. **Cơ chế re-render toàn bộ DOM:** `renderWorkspace()` phá hủy toàn bộ DOM con của danh mục tài liệu.
4. **Không có phân trang Backend:** Mọi tìm kiếm và phân trang hiện đang diễn ra trong RAM trình duyệt.

### 🟡 MEDIUM:
5. **Chưa có Resumable Upload:** Tải file dung lượng lớn (>100MB) lên Google Drive bằng multipart đơn dễ thất bại nếu mạng chập chờn.
6. **CSS còn một số thuộc tính ghi đè chưa đồng nhất:** Giữa `#dochub-phone-controller` và CSS gốc.

---

## 22. NHỮNG QUYẾT ĐỊNH KIẾN TRÚC ĐÃ CHỐT (DO-NOT-CHANGE)

1. **Menu chính là cây thư mục:** Cây thư mục phân cấp bên trái là trái tim điều hướng của DocHub; không được thay thế bằng menu ngang hay thanh danh mục phẳng.
2. **Mô hình tổ chức:** Các phòng ban (Phòng hành chính, Kế toán, Nhân sự,...) được biểu diễn trực tiếp dưới dạng các nhánh thư mục bên dưới Root `'all'`.
3. **Vị trí Cài đặt:** Nút Cài đặt chỉ được mở thông qua menu Tài khoản (Avatar); không đưa Cài đặt vào cây thư mục tài liệu.
4. **Phân quyền thuộc Cài đặt:** Giao diện quản trị ACL nằm bên trong modal Cài đặt (Tab Phân quyền).
5. **Mobile ưu tiên "Content-First":** Header thư mục trên điện thoại phải thu gọn, dành tối đa không gian cho danh sách tài liệu.
6. **Kiểu dáng Checkbox:** Checkbox chọn tài liệu bắt buộc giữ nguyên thiết kế: Nền trắng, viền đen, dấu tích đen để đảm bảo độ tương phản cao.
7. **Bảo toàn tệp gốc:** Mọi thao tác chỉnh sửa văn bản, bảng tính hay media phải sinh ra bản sao mới, không bao giờ tự động ghi đè hủy hoại tệp gốc của khách hàng.

---

## 23. CÁC ĐIỂM CẦN AGENT KHÁC HỖ TRỢ REVIEW

1. **Chuẩn hóa Database Schema:** Chuyển đổi từ cấu trúc `state JSONB` sang các bảng PostgreSQL chuẩn hóa (`folders`, `documents`, `acls`).
2. **Server-side Permission Engine:** Thiết kế PostgreSQL Stored Procedures hoặc Edge Functions để kiểm tra quyền thừa kế cây thư mục trực tiếp trong câu lệnh SQL.
3. **Tối ưu hóa Upload Google Drive:** Cải tiến `src/google-drive.js` sang luồng Google Resumable Upload API để hỗ trợ chunking và hiển thị thanh % tiến trình.
4. **Virtual DOM / DOM Diffing:** Tư vấn giải pháp giảm chi phí vẽ lại của `renderWorkspace()` mà vẫn giữ nguyên tiêu chí không dùng framework nặng.
5. **Bảo mật File Upload:** Thiết kế cơ chế kiểm tra Magic Bytes tại client trước khi đẩy file lên cloud.

---

## 24. ĐỀ XUẤT ROADMAP PHÁT TRIỂN

### Phase 1 — Ổn định & Chạy thử nghiệm thực tế (Stabilize):
- **Mục tiêu:** Chạy thử nghiệm luồng đăng nhập Google Auth và đẩy file thật lên Google Drive với 5–10 tài khoản thử nghiệm.
- **Module ảnh hưởng:** `src/config.js`, Google Cloud Console OAuth setup.
- **Risk:** Google OAuth Consent Screen hiện cảnh báo "Unverified App" nếu chưa xác minh tên miền.

### Phase 2 — Chuẩn hóa Backend & Database (Production Backend):
- **Mục tiêu:** Chuẩn hóa bảng dữ liệu Supabase, chuyển logic lưu trữ từ 1 blob JSON sang các bảng quan hệ `folders`, `documents`.
- **Module ảnh hưởng:** `supabase_schema.sql`, `src/dochub-cloud-bridge.js`.
- **Dependency:** Supabase PostgreSQL Migration.

### Phase 3 — Hoàn thiện Phân quyền Server-side (Enterprise Permissions):
- **Mục tiêu:** Enforce ACL tại tầng Database bằng PostgreSQL Functions và RLS nâng cao.
- **Module ảnh hưởng:** PostgreSQL Policies, UI Error Handlers.

### Phase 4 — Nâng cấp Bộ biên tập & Xem trước (Advanced Document Editing):
- **Mục tiêu:** Tích hợp bộ xem trước PDF nhanh (PDF.js) và bộ xem Office trung thực hơn.
- **Module ảnh hưởng:** `DocHubMedia`, `DocHubOffice`.

### Phase 5 — Mở rộng quy mô & Giám sát (Scale & Observability):
- **Mục tiêu:** Tìm kiếm Full-Text Search phía server, hỗ trợ thư mục > 50.000 files, giám sát log qua Sentry.

---

## 25. HANDOFF SUMMARY

```yaml
AI HANDOFF CONTEXT:
  Current architecture: Vanilla HTML/JS/CSS Frontend -> Cloud Bridge Adapter -> Supabase PostgreSQL (DB/RLS) & Google Drive v3 REST API (Storage).
  Current version: 2.2.0
  Frontend: Single-page application, Zero-dependency Vanilla JS/CSS, Inline SVG Sprite, JSZip v3.10.1, Canvas annotation editor.
  Backend: Node.js (v24) static HTTP server (server.js). Backend application logic is currently serverless via Supabase and Google APIs.
  Storage: Dual-layer -> Local IndexedDB cache (dochub_cloud_cache_v1) + Google Drive personal storage (BYOS) via OAuth token.
  Folder model: Hierarchical tree with single root ('all', parentId: null). Recursive ancestor and descendant traversal. Expand/collapse stored in state.preferences.expanded.
  Document model: Stored as metadata items (id, parentId, name, ext, bytes, mime, sample, deletedAt) linked to Google Drive file IDs.
  Permission model: Role-based Access Control (viewer, contributor, editor, manager, owner) with folder inheritance and break-inheritance support. CAUTION: Currently enforced purely on Client-side.
  Mobile architecture: Responsive layout with breakpoints at 1280px, 1000px, 700px, 480px. Dynamic DOM relocation of sidebar into #navDialog modal. Custom bottom dock (#mDock) via #dochub-phone-controller.
  Important files:
    - index.html: Main production UI and application core (~1.27 MB, 3400+ lines).
    - src/dochub-cloud-bridge.js: Cloud bridge replacing legacy local mock server.
    - src/google-drive.js: Google Drive v3 REST client for multipart upload/download.
    - supabase_schema.sql: DDL schema and Row Level Security policies.
    - server.js: Local development server.
    - scripts/build.js: Build script regenerating index.html from source.
  Current limitations: Entire workspace state stored as single JSONB blob; no chunked file upload; client-only ACL checks; full DOM re-rendering on workspace state changes.
  Do-not-change decisions:
    1. Navigation core MUST remain the hierarchical folder tree.
    2. Departments are modeled as folders under root 'all'.
    3. Settings and ACL access MUST remain exclusive to the Account Avatar menu.
    4. Mobile UI must follow content-first compact headers.
    5. Document edits MUST create new copies; never overwrite original source files.
    6. Checkbox styling must retain white background, black border, black checkmark.
  Top technical risks: In-memory array filtering crashes at 10k+ items; unauthorized client-side state manipulation without backend ACL verification.
  Next recommended work: Run supabase_schema.sql on Supabase project, configure Google OAuth Client ID, and normalize JSONB state into relational tables.
```
