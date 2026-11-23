# Pocket Space · đồng bộ công khai

Ứng dụng mở trực tiếp. Chọn PPA hoặc TBV ở đầu trang để dùng hồ sơ tương ứng. Ai mở trang cũng có thể đọc dữ liệu chung và thực hiện thao tác của cả hai hồ sơ. Hoạt động, nước, tin nhắn và ghi chú dùng chung qua Firestore.

## 1. Cấu hình Firestore

Dự án [lovvers-95674](https://console.firebase.google.com/project/lovvers-95674/overview) dùng [firestore.rules](./firestore.rules). Bộ quy tắc giới hạn quyền công khai vào các tài liệu Pocket Space, tương tác và nhật ký của app. Các thao tác được kiểm tra theo cấu trúc dữ liệu và ngày nước đã chốt. Firebase Authentication không cần bật cho app.

Từ thư mục bản Git Lovers, người quản trị Firebase có thể công bố quy tắc bằng lệnh sau.

    firebase deploy --only firestore:rules --project lovvers-95674

Nếu dự án có thêm ứng dụng khác, kiểm tra và hợp nhất quy tắc của các ứng dụng trước khi công bố.

Công bố bộ quy tắc này trước khi đưa bản việc ưu tiên và thanh nước mới lên Pages. Quy tắc kiểm tra hoạt động trong lịch hẹn, hỗ trợ phục hồi lịch cũ, liên kết log với bộ đếm và cho phép Notes lưu thứ tự/ghim/chuyển việc còn chờ. Tải lại Pocket Space trên cả hai thiết bị sau khi cập nhật để tránh tab cũ ghi đè cấu trúc mới.

## 2. Đưa mã lên GitHub Pages

Nhánh pocket-space-sync dựa trên main của Lovers và giữ bai-31.json hiện có. Quyền GitHub dùng để đưa mã lên repository.

    gh auth login --hostname github.com --git-protocol https --web
    gh auth setup-git
    git push -u origin pocket-space-sync

Mở pull request về main và hợp nhất. Trong **Settings → Pages**, dùng **Deploy from a branch → main → /(root)**. Khi triển khai xong, mở [Pocket Space trên Lovers](https://vuongtranvt1331-design.github.io/Lovers/) trên hai máy. Chọn hồ sơ rồi thử đổi hoạt động ở một máy để kiểm tra máy kia thấy cập nhật.

## Cài trên iPhone

Bản Pages có HTTPS, manifest, Apple Touch Icon và service worker. Trong Safari chọn **Chia sẻ → Thêm vào Màn hình chính → Thêm**; bật **Mở dưới dạng ứng dụng web** nếu iOS hiện tùy chọn này. Hướng dẫn cũng nằm trong menu chọn hồ sơ của app. Xem thêm [hướng dẫn chính thức của Apple](https://support.apple.com/vi-vn/guide/iphone/iphea86e5236/ios).

Phát hành cả `manifest.webmanifest`, `sw.js`, `css/pwa.css`, `js/pwa.js` và `assets/icons/` cùng mã ứng dụng. Bản cài cần mở lần đầu khi có mạng để lấy dữ liệu; không cần đổi quyền Firebase chỉ để cài trên iOS. App giữ nguyên cách chọn PPA/TBV công khai.

## Chạy và kiểm thử local

Mở Mo-Pocket-Space.bat hoặc chạy lệnh sau.

    python -m http.server 8765 --bind 127.0.0.1

Để thử với dữ liệu mô phỏng, chạy Firebase CLI với Java tương thích.

    firebase emulators:start --only firestore --project demo-pocket-space

Mở http://127.0.0.1:8765/?emulator=1. Có thể chạy kiểm thử logic với Node.js 22+.

    node --test

## Dữ liệu

- pocket_space/plant_state chứa trạng thái chung và bản sao hai hồ sơ để đồng bộ trong cùng một snapshot.
- Giọt nước từ hoạt động và nhiệm vụ nằm trong kho riêng của mỗi hồ sơ. Một lần tưới dùng hết kho của hồ sơ đó. Chỉ số đã tưới tính vào mục tiêu và lịch sử. Kho và tiến độ tưới của ngày đặt lại lúc 00:00 giờ Việt Nam.
- Phút của các phiên ngắn được cộng theo từng hoạt động trong ngày. Khi đủ mốc, lượt thưởng và số giọt được ghi trong cùng một giao dịch. activityRewardClaims chặn nhận trùng khi làm lại cùng hoạt động trong ngày.
- activitySchedule, scheduleAnchorAt và scheduleVersion trong mỗi hồ sơ lưu hai mốc tương lai. nextRewardAt là mốc nhận nước riêng, không kết thúc hoạt động. historyLoggedThrough giữ lịch sử đầy đủ khi hoạt động kéo dài nhiều ngày.
- Bonsai balanceVersion 2 có 9 cấp, mỗi cấp 10 ngày. activityScheduleVersion chặn phiên bản cũ làm mất lịch. stageEvolutionAt ghi nhận ngày tiến hóa để hiển thị nền sáng.
- rewardReceiptVersion 1 giữ các trường activityRewardAmounts và migrationGraceDate khi đã nâng cấp. Lượt thưởng cũ đọc từ query đúng ngày với cùng revision; nếu thiếu bằng chứng, ngày chuyển đổi được miễn phạt khi chưa đủ nước.
- pocket_space/live_interactions/events lưu tương tác. Quest đôi được xác nhận và cộng thưởng trong cùng một giao dịch.
- pocket_space/activity_history/logs lưu nhật ký theo dateStr. Phiên qua ngày được tách theo 00:00 giờ Việt Nam.
- pocket_space/notes_state/days lưu danh sách ghi chú theo hồ sơ và ngày. Việc còn dở được chuyển vào ngày hiện tại khi mở lại sổ. Danh sách của ngày trước giữ kết quả đã chốt.
- Quest complete_5_notes kiểm tra tối thiểu 5 ID đã xong còn tồn tại trong sổ hôm nay, đọc cùng giao dịch với plant_state. Mỗi chủ sổ nhận 2 giọt vào kho riêng mỗi ngày.
- activityRewardRulesVersion 1 giữ các khoản thưởng từ bảng mới. Mốc cấp 9 chuyển sang 198 ở ngày kế tiếp. Thưởng Thái Lan dựa trên mục tiêu của ngày đạt 300 phút. Tải lại các thiết bị sau khi phát hành để đồng bộ bảng thưởng.
- autoQuestVersion 1 chặn phiên bản app cũ xóa mất lượt quest tự động. Sau khi phát hành quy tắc và mã mới, tải lại cả hai thiết bị để mọi máy dùng cùng phiên bản.
- Notes notesVersion 2 lưu taskOrder và pinnedId. carriedIds/carriedTo trên nguồn cũ giữ tiến độ chuyển từng phần khi hôm nay đủ 300 mục, tránh phục hồi lại mục đã chủ động xóa. Bộ đếm trong khung cây chỉ hiển thị kho chưa tưới của hồ sơ hiện tại; thanh nước chỉ tính lượng đã tưới, hồng bên trái và xanh biển bên phải.
- Firestore giữ dữ liệu đã đọc khi mất mạng. Thay đổi chỉ báo thành công sau khi máy chủ xác nhận. Lịch sử IndexedDB của bản cũ vẫn ở trình duyệt gốc.
