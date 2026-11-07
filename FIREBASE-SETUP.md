# Pocket Space · thiết lập đồng bộ

## 1. Bật Firebase một lần

1. Mở dự án [lovvers-95674 trong Firebase Console](https://console.firebase.google.com/project/lovvers-95674/overview). Tạo Cloud Firestore nếu dự án chưa có.
2. Vào **Authentication → Sign-in method**, bật **Anonymous**. Nếu dự án có tùy chọn tự xóa tài khoản ẩn danh sau 30 ngày, để tùy chọn đó tắt để mã thiết bị tiếp tục dùng được.
3. Vào **Firestore Database → Rules**, công bố [firestore.rules](./firestore.rules). Nếu dự án có ứng dụng khác, hợp nhất phần Pocket Space vào rules hiện có trước khi công bố. Có thể chạy lệnh sau với quyền quản trị dự án:

       firebase deploy --only firestore:rules --project lovvers-95674

## 2. Đưa mã nguồn lên Lovers

Bản chuẩn bị nằm trên nhánh pocket-space-sync, dựa trên main của Lovers. Giữ nguyên bai-31.json đang có trong repo. Thực hiện từ thư mục bản Git Lovers.

    gh auth login --hostname github.com --git-protocol https --web
    gh auth setup-git
    git push -u origin pocket-space-sync

Trên GitHub, mở pull request về main và hợp nhất. Nếu cần cấu hình nguồn Pages, vào **Settings → Pages → Deploy from a branch → main → /(root)**. Sau khi Pages triển khai, mở [Pocket Space trên Lovers](https://vuongtranvt1331-design.github.io/Lovers/).

## 3. Ghép hai trình duyệt

1. Mở đúng địa chỉ Pages trên trình duyệt PPA và trình duyệt TBV. Chọn **Sao chép mã thiết bị** trên mỗi trình duyệt.
2. Trong **Firestore Database → Data**, tạo hoặc sửa document **pocket_space/access**. Thêm hai trường kiểu string:
   - **ppa** là mã hiển thị trên trình duyệt PPA.
   - **tbv** là mã hiển thị trên trình duyệt TBV.
3. Trên hai trình duyệt, chọn **Kiểm tra lại**. Chọn PPA hoặc TBV ở đầu trang để đổi góc nhìn. Mỗi trình duyệt gửi hoạt động và góp nước cho hồ sơ đã được gán. Đổi một hoạt động trên máy PPA và kiểm tra máy TBV thấy cập nhật.
4. Trình duyệt ghi nhớ mã ở lần mở sau. Nếu đổi trình duyệt hoặc xóa dữ liệu trang, dùng mã mới để thay trường tương ứng trong access.

Chỉ hai mã đã gán được đọc phòng. GitHub lưu mã nguồn và ảnh. Firestore lưu hoạt động, nước, tiến độ cây và tin nhắn. Dữ liệu của bản IndexedDB cũ vẫn ở trình duyệt và địa chỉ gốc. Bản Firebase chưa nhập lịch sử cũ.

## Chạy và kiểm thử local

Mở Mo-Pocket-Space.bat hoặc chạy lệnh sau từ thư mục dự án.

    python -m http.server 8765 --bind 127.0.0.1

Mở http://127.0.0.1:8765/. Địa chỉ local và GitHub Pages có mã trình duyệt riêng. Ghép trình duyệt tại địa chỉ dùng lâu dài.

Để thử với dữ liệu mô phỏng, chạy Firebase CLI với Java tương thích.

    firebase emulators:start --only auth,firestore --project demo-pocket-space

Mở http://127.0.0.1:8765/?emulator=1. Tạo document access trong Firestore Emulator bằng hai mã hiển thị trên hai trình duyệt. Sau đó có thể chạy các kiểm thử logic với Node.js 22+.

    node --test tests/state.test.mjs

## Ghi chú dữ liệu

- pocket_space/plant_state chứa trạng thái chung và bản sao hai hồ sơ để cập nhật trong cùng một lần nhận dữ liệu. Các giao dịch ghi cập nhật đồng thời document người dùng và bản trạng thái chung.
- pocket_space/live_interactions/events lưu tương tác. Khi đối phương chấp nhận nhiệm vụ đôi, hai hồ sơ nhận thưởng trong cùng một giao dịch.
- activity_logs được tra theo dateStr. Phiên qua nửa đêm được chia theo 00:00 giờ Việt Nam. Phiên bản và số bản ghi của ngày đảm bảo lịch sử khớp với trạng thái người dùng.
- Firestore giữ dữ liệu đã đọc khi mất mạng. Các thao tác thay đổi chỉ báo thành công sau khi máy chủ xác nhận. Khi cả hai máy đều đóng trang, app chốt phiên đến hạn và ngày cũ ở lần kết nối sau.
