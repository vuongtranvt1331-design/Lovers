# Pocket Space

Trang sinh hoạt chung cho PPA và TBV. Mở app và dùng nút hồ sơ ở đầu trang. Bất kỳ ai mở trang đều có thể đọc dữ liệu chung và thực hiện thao tác của cả hai hồ sơ.

Xem [hướng dẫn Firestore và GitHub Pages](./FIREBASE-SETUP.md). Chạy trên Windows bằng Mo-Pocket-Space.bat hoặc dùng Python.

    python -m http.server 8765 --bind 127.0.0.1

Bộ kiểm thử logic chạy với Node.js 22+.

    node --test

## Cài lên Màn hình chính iPhone

Sau khi đưa bản này lên Pages, mở [Pocket Space](https://vuongtranvt1331-design.github.io/Lovers/) bằng Safari. Chọn **Chia sẻ → Thêm vào Màn hình chính**, bật **Mở dưới dạng ứng dụng web** nếu có, rồi bấm **Thêm**. App có biểu tượng pixel riêng và mở ở chế độ standalone. Trong menu hồ sơ có nút **Cài lên màn hình chính** để xem lại hướng dẫn.

Mở app từ biểu tượng một lần khi có mạng và chọn đúng PPA/TBV. iOS có thể dùng vùng lưu trữ riêng cho bản cài; dữ liệu chung sẽ được tải từ Firestore, còn hồ sơ mặc định cần chọn lại trên thiết bị đó. Không cần App Store hay tài khoản đăng nhập.

Service worker lưu giao diện, các module Firebase cố định và hình đã xem để mở lại khi mất mạng. Firestore giữ dữ liệu đã tải trong bộ nhớ riêng; thao tác thay đổi vẫn cần kết nối và chỉ báo thành công sau khi máy chủ xác nhận. Hình chưa tải sẽ dùng đồ họa pixel dự phòng. iOS vẫn có thể thu hồi bộ nhớ trang khi thiếu dung lượng; đây không phải bản sao lưu dữ liệu máy chủ.

Khi có phiên bản mới, app hiện **Tải lại**. Hoàn tất phần đang nhập rồi bấm nút để chuyển sang bộ mã mới. Khi phát hành, phải đổi `VERSION` trong `sw.js`, đổi token import CSS/JS đồng bộ, và đưa toàn bộ tệp lên cùng lần. Service worker dùng đường dẫn tương đối nên hỗ trợ cả thư mục `/Lovers/` trên Pages và localhost. Cài thực tế trên iPhone dùng đường dẫn HTTPS; `file://` không có bộ nhớ service worker.

## Hoạt động và bonsai

- Chạm nhân vật của bạn để chọn **Hiện tại**, **+1h** hoặc **+2h**. Các mốc tương lai tính từ thời điểm mở một lịch mới, lưu cho từng hồ sơ và có thể sửa hoặc bỏ. Lịch đã lưu giữ nguyên giờ sau khi tải lại. Nếu ứng dụng đóng, lần mở có kết nối tiếp theo sẽ tính lại các phiên theo đúng giờ đã hẹn.
- Nhận nước xong, hoạt động vẫn tiếp tục. Thời gian ngắt quãng cộng dồn trong ngày; mỗi hoạt động chỉ nhận nước một lần/ngày. Ngủ nhận 5 hoặc 10 giọt ở lần thức dậy đủ điều kiện đầu tiên.
- Cây có **9 cấp**, mỗi cấp cần **10 ngày đủ nước**. Mốc khởi đầu lần lượt là **62, 72, 82, 92, 102, 112, 122, 132, 198** giọt. Cấp 1–8 tăng 1 giọt sau ngày đủ nước, tối đa 9 lần trong cấp. Cấp 9 dùng 85% của 232 giọt từ hoạt động thường và nhiệm vụ, làm tròn lên. Phần thưởng Thái Lan tính riêng. Mốc cấp 9 đang dùng được giữ đến hết ngày cập nhật.
- Thiếu nước khi hết khiên làm mất tối đa 5 ngày tiến độ và giảm mục tiêu tương ứng. Ba ngày thiếu liên tiếp làm lùi một cấp. Ngày lên cấp có ánh sáng ấm phía sau cây.
- **PPA** có “Đi chơi Thái Lan”. **TBV** có “Học tiếng Pháp”, đủ 40 phút nhận 8 giọt một lần/ngày, có thưởng học cùng nhau và dùng chung giới hạn học 20 giọt.
- PPA đi chơi Thái Lan đủ 5 tiếng nhận một nửa mục tiêu tưới của ngày đạt mốc, làm tròn lên, một lần/ngày. Các phiên trong cùng ngày được cộng dồn như hoạt động khác. Giọt thưởng được đưa vào kho để tưới.
- Vệ sinh 10 phút, chợp mắt 20 phút, chăm Cofi 15 phút và dùng bữa 15 phút nhận 2 giọt mỗi hoạt động. Đi bộ 25 phút nhận 4 giọt. Đi học và họp áp dụng mốc của nhóm học và nhóm làm việc. Việc đi lại nhận 2 giọt mỗi hoạt động, tối đa 4 giọt trong nhóm. Gặp gỡ và về quê nhận 3 giọt mỗi hoạt động, tối đa 6 giọt trong nhóm. Mở **?** trong app để xem các mốc.

Cập nhật **firestore.rules trước khi đưa mã mới lên Pages**, rồi tải lại trên cả hai thiết bị. Mục tiêu cũ còn đạt được giữ tới hết ngày nâng cấp, cùng với nước đã có và lịch sử tưới.

## Giao diện hằng ngày

- Hai thẻ luôn cạnh nhau: tên lớn ở bên trái, hoạt động bên phải; thời gian làm tròn xuống phút và huy hiệu nước nằm cùng dòng phía dưới. Dấu × là chưa nhận, dấu ✓ kèm số giọt là lượng thực nhận. Tin nhắn nhận và gửi xuất hiện trên thẻ tương ứng.
- Khung ngay dưới hai nhân vật hiển thị tối đa 3 việc chưa xong trong sổ hôm nay của hồ sơ đang chọn. Mỗi dòng có ô hoàn thành riêng; tích xong sẽ tự bổ sung việc tiếp theo. Nếu còn hơn 3 việc, nút xoay chuyển dần sang các việc khác; thứ tự vẫn lấy từ Notes.
- Trong Notes, kéo nút ba chấm hoặc mở menu Lên/Xuống để đổi thứ tự. Menu chỉ có hai nút Lên và Xuống; nút Xóa vẫn nằm cạnh mỗi ghi chú. Thứ tự và số việc hoàn thành đồng bộ giữa các thiết bị. Nếu hôm nay đầy, việc dư được giữ chờ; sổ người còn lại vẫn chuyển bình thường.
- Ô nhập Notes nhận chạm và cho gõ trước trong lúc đang tải hoặc mất kết nối; nút Thêm chỉ bật khi có thể lưu lên máy chủ. Chỉ thông báo thành công sau khi dữ liệu được xác nhận.
- Quest **Hoàn thành 5 ghi chú** tự cộng **2 giọt chưa tưới** cho chủ sổ hôm nay, một lần/ngày. Tiến độ hiển thị 0/5–5/5, không có nút nhận thủ công. Bỏ tích, tích lại, tải lại hoặc mở hai tab không tạo thêm thưởng; ghi chú ngày khác không tính vào hôm nay.
- Huy hiệu ngày ở đầu trang mở bộ sưu tập bonsai; nút ? cạnh đó mở hướng dẫn. Thanh nước chỉ hiển thị nước đã tưới: bên trái của đối phương là hồng pastel, bên phải của hồ sơ đang chọn là xanh biển. Bộ đếm nước chưa tưới của hồ sơ hiện tại nằm trong khung cây ở góc trên bên phải, đối xứng với huy hiệu ngày bên trái. Kho người còn lại không hiển thị.

Bản cập nhật khôi phục chính xác lượt thưởng từ nhật ký cũ. Nếu dữ liệu ngày chuyển đổi thiếu, ngày đó được miễn phạt khi chưa đạt mục tiêu; tưới đủ vẫn được tiến độ bình thường. Các quy tắc chống giả giờ và tự tạo nước không thay đổi trong bản này.
