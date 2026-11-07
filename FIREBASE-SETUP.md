# Pocket Space · đồng bộ công khai

Ứng dụng mở trực tiếp. Chọn PPA hoặc TBV ở đầu trang để dùng hồ sơ tương ứng. Ai mở trang cũng có thể đọc dữ liệu chung và thực hiện thao tác của cả hai hồ sơ. Hoạt động, nước, tin nhắn và ghi chú dùng chung qua Firestore.

## 1. Cấu hình Firestore

Dự án [lovvers-95674](https://console.firebase.google.com/project/lovvers-95674/overview) dùng [firestore.rules](./firestore.rules). Bộ quy tắc giới hạn quyền công khai vào các tài liệu Pocket Space, tương tác và nhật ký của app. Các thao tác được kiểm tra theo cấu trúc dữ liệu và ngày nước đã chốt. Firebase Authentication không cần bật cho app.

Từ thư mục bản Git Lovers, người quản trị Firebase có thể công bố quy tắc bằng lệnh sau.

    firebase deploy --only firestore:rules --project lovvers-95674

Nếu dự án có thêm ứng dụng khác, kiểm tra và hợp nhất quy tắc của các ứng dụng trước khi công bố.

Công bố bộ quy tắc này trước khi đưa Sổ ghi chú đôi lên Pages. Bộ quy tắc cấp quyền cho cả hai hồ sơ sử dụng sổ của nhau và bảo vệ dữ liệu các ngày đã chốt. Tải lại Pocket Space trên cả hai thiết bị sau khi cập nhật.

## 2. Đưa mã lên GitHub Pages

Nhánh pocket-space-sync dựa trên main của Lovers và giữ bai-31.json hiện có. Quyền GitHub dùng để đưa mã lên repository.

    gh auth login --hostname github.com --git-protocol https --web
    gh auth setup-git
    git push -u origin pocket-space-sync

Mở pull request về main và hợp nhất. Trong **Settings → Pages**, dùng **Deploy from a branch → main → /(root)**. Khi triển khai xong, mở [Pocket Space trên Lovers](https://vuongtranvt1331-design.github.io/Lovers/) trên hai máy. Chọn hồ sơ rồi thử đổi hoạt động ở một máy để kiểm tra máy kia thấy cập nhật.

## Chạy và kiểm thử local

Mở Mo-Pocket-Space.bat hoặc chạy lệnh sau.

    python -m http.server 8765 --bind 127.0.0.1

Để thử với dữ liệu mô phỏng, chạy Firebase CLI với Java tương thích.

    firebase emulators:start --only firestore --project demo-pocket-space

Mở http://127.0.0.1:8765/?emulator=1. Có thể chạy kiểm thử logic với Node.js 22+.

    node --test tests/state.test.mjs

## Dữ liệu

- pocket_space/plant_state chứa trạng thái chung và bản sao hai hồ sơ để đồng bộ trong cùng một snapshot.
- Giọt nước từ hoạt động và nhiệm vụ nằm trong kho riêng của mỗi hồ sơ. Một lần tưới dùng hết kho của hồ sơ đó. Chỉ số đã tưới tính vào mục tiêu và lịch sử. Kho và tiến độ tưới của ngày đặt lại lúc 00:00 giờ Việt Nam.
- Phút của các phiên ngắn được cộng theo từng hoạt động trong ngày. Khi đủ mốc, lượt thưởng và số giọt được ghi trong cùng một giao dịch.
- pocket_space/live_interactions/events lưu tương tác. Quest đôi được xác nhận và cộng thưởng trong cùng một giao dịch.
- pocket_space/activity_history/logs lưu nhật ký theo dateStr. Phiên qua ngày được tách theo 00:00 giờ Việt Nam.
- pocket_space/notes_state/days lưu danh sách ghi chú theo hồ sơ và ngày. Việc còn dở được chuyển vào ngày hiện tại khi mở lại sổ. Danh sách của ngày trước giữ kết quả đã chốt.
- Firestore giữ dữ liệu đã đọc khi mất mạng. Thay đổi chỉ báo thành công sau khi máy chủ xác nhận. Lịch sử IndexedDB của bản cũ vẫn ở trình duyệt gốc.
