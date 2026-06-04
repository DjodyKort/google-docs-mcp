# Thiết kế: Click-through anchoring cho Google Sheets comment

> Ngày: 2026-06-04
> Branch: feat/sheets-cell-notes-comments
> Phạm vi: chỉ `src/tools/sheets/comments/createSheetsComment.ts`

## 1. Mục tiêu

Người dùng muốn: **click vào comment có thể tới được dòng/ô mà comment đó nói tới.**

## 2. Ràng buộc nền tảng (đã chứng minh thực nghiệm — xem `COMMENT_ANCHORING_ANALYSIS.md`)

- **Native anchoring qua Drive API: KHÔNG làm được.** `comments.create` lưu chuỗi
  `anchor` như metadata thụ động nhưng không tạo được "anchored-range object" phía
  editor (Ritz). Đã test cả anchor THẬT của Google copy nguyên văn → vẫn fail, UI hiện
  "Original content deleted". Google Issue Tracker 36763384 (mở 2016, chưa fix).
- Hệ quả: anchor JSON giả mà code đang gửi (`{r:'head', a:[{sht:...}]}`) **không tạo ra
  khả năng di chuyển nào**, chỉ làm UI hiển thị "Original content deleted".
- **Cơ chế di chuyển khả thi DUY NHẤT đã verify:** deep-link `#gid=<sheetId>&range=<A1>`
  chèn vào _nội dung_ comment. Click link → Sheets chọn đúng ô. Cơ chế này độc lập hoàn
  toàn với field `anchor`.

## 3. Thay đổi (chỉ `createSheetsComment.ts`)

### 3.1 Bỏ anchor JSON giả

- Xóa khối tạo `anchor = JSON.stringify({ r: 'head', a: [...] })`.
- Không gửi field `anchor` lên `drive.comments.create`.
- `fields` bỏ `anchor` → `id,quotedFileContent,createdTime`.
- **Giữ lại:** parse `cell`/`range` → resolve `sheetId` → build URL → đọc
  `quotedFileContent` (quoted text hiển thị nội dung ô, không gây lỗi). `locationLabel`
  giữ để dùng cho wording link.

### 3.2 `includeCellLink` mặc định `true`

- `.default(false)` → `.default(true)`.
- Cập nhật description: link click-through tự bật khi có `cell`/`range`.
- Khi không có `cell`/`range`: không có URL → bỏ qua an toàn (giữ hành vi hiện tại).

### 3.3 Wording deep-link

- Đổi `\n\nCell link: {url}` → `\n\n→ {locationLabel}: {url}`.
- `locationLabel` = `Sheet1!B3` (đã tính sẵn). URL để trần để Drive comment render thành
  link click được. Nhãn vị trí giúp người đọc biết ô đích trước khi click.

### 3.4 Message trả về

- Bỏ câu "Google Sheets UI may still show ... as unanchored" (gây hiểu lầm; không còn
  gửi anchor nữa).
- Nội dung mới: xác nhận comment đã tạo + đã kèm link click-through tới ô (nếu có).

## 4. KHÔNG thay đổi

- Logic parse A1, resolve sheetId, quote sheet name, đọc range text — giữ nguyên.
- Các tool comment khác, `createSheetsCellNote` — không đụng.
- Docs `addComment` — ngoài phạm vi (xử lý sau).

## 5. Verify

- **Build:** `npm run build` (tsc sạch).
- **Thủ công:** tạo comment có `cell` trên spreadsheet thật → mở UI → click link trong
  comment → Sheets nhảy/chọn đúng ô. Xác nhận không còn "Original content deleted".

## 6. Rủi ro còn lại (giới hạn Google, không khắc phục được)

- Comment vẫn nằm ở "All comments", không neo trực quan vào ô. Click _vào comment_ không
  tự nhảy; chỉ click _vào link trong comment_ mới nhảy. Đây là tốt nhất API cho phép.
