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
- Cây có **9 cấp**, mỗi cấp cần **10 ngày đủ nước**. Mốc khởi đầu lần lượt là **62, 72, 82, 92, 102, 112, 122, 132, 150** giọt. Cấp 1–8 tăng 1 giọt sau ngày đủ nước, tối đa 9 lần trong cấp. Cấp 9 giữ 150 giọt, bằng 85% mức tối đa 176 giọt của hai hồ sơ, làm tròn lên.
- Thiếu nước khi hết khiên làm mất tối đa 5 ngày tiến độ và giảm mục tiêu tương ứng. Ba ngày thiếu liên tiếp làm lùi một cấp. Ngày lên cấp có ánh sáng ấm phía sau cây.
- **PPA** có “Đi chơi Thái Lan”. **TBV** có “Học tiếng Pháp”, đủ 40 phút nhận 8 giọt một lần/ngày, có thưởng học cùng nhau và dùng chung giới hạn học 20 giọt.

Cập nhật **firestore.rules trước khi đưa mã mới lên Pages**, rồi tải lại trên cả hai thiết bị. Mục tiêu cũ còn đạt được giữ tới hết ngày nâng cấp; mốc cũ 186 giọt được điều chỉnh về 150. Nước đã có và nhật ký ngày cũ được giữ.

## Giao diện hằng ngày

- Hai thẻ luôn cạnh nhau: tên lớn ở bên trái, hoạt động bên phải; thời gian làm tròn xuống phút và huy hiệu nước nằm cùng dòng phía dưới. Dấu × là chưa nhận, dấu ✓ kèm số giọt là lượng thực nhận. Tin nhắn nhận và gửi xuất hiện trên thẻ tương ứng.
- Dòng ngay dưới hai nhân vật nhắc việc hôm nay của hồ sơ đang chọn. Mặc định là việc chưa xong đầu danh sách; nút xoay chọn và ghim việc khác. Hoàn thành sẽ chuyển sang việc chưa xong tiếp theo.
- Trong Notes, kéo nút ba chấm hoặc mở menu Lên/Xuống để đổi thứ tự; chọn Ghim để ưu tiên. Thứ tự, ghim và số việc hoàn thành đồng bộ giữa các thiết bị. Nếu hôm nay đầy, việc dư được giữ chờ; sổ người còn lại vẫn chuyển bình thường.
- Huy hiệu ngày ở đầu trang mở bộ sưu tập bonsai; nút ? cạnh đó mở hướng dẫn. Thanh nước chỉ hiển thị nước đã tưới: bên trái của đối phương là hồng pastel, bên phải của hồ sơ đang chọn là xanh biển. Bộ đếm nước chưa tưới của hồ sơ hiện tại nằm trong khung cây ở góc trên bên phải, đối xứng với huy hiệu ngày bên trái. Kho người còn lại không hiển thị.

Bản cập nhật khôi phục chính xác lượt thưởng từ nhật ký cũ. Nếu dữ liệu ngày chuyển đổi thiếu, ngày đó được miễn phạt khi chưa đạt mục tiêu; tưới đủ vẫn được tiến độ bình thường. Các quy tắc chống giả giờ và tự tạo nước không thay đổi trong bản này.
