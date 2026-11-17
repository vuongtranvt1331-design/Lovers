# Pocket Space

Trang sinh hoạt chung cho PPA và TBV. Mở app và dùng nút hồ sơ ở đầu trang. Bất kỳ ai mở trang đều có thể đọc dữ liệu chung và thực hiện thao tác của cả hai hồ sơ.

Xem [hướng dẫn Firestore và GitHub Pages](./FIREBASE-SETUP.md). Chạy trên Windows bằng Mo-Pocket-Space.bat hoặc dùng Python.

    python -m http.server 8765 --bind 127.0.0.1

Bộ kiểm thử logic chạy với Node.js 22+.

    node --test tests/state.test.mjs

## Hoạt động và bonsai

- Chạm nhân vật của bạn để chọn **Hiện tại**, **+1h** hoặc **+2h**. Các mốc tương lai tính từ thời điểm mở một lịch mới, lưu cho từng hồ sơ và có thể sửa hoặc bỏ. Lịch đã lưu giữ nguyên giờ sau khi tải lại. Nếu ứng dụng đóng, lần mở có kết nối tiếp theo sẽ tính lại các phiên theo đúng giờ đã hẹn.
- Nhận nước xong, hoạt động vẫn tiếp tục. Thời gian ngắt quãng cộng dồn trong ngày; mỗi hoạt động chỉ nhận nước một lần/ngày. Ngủ nhận 5 hoặc 10 giọt ở lần thức dậy đủ điều kiện đầu tiên.
- Cây có **9 cấp**, mỗi cấp cần **10 ngày đủ nước**. Mốc khởi đầu lần lượt là **62, 72, 82, 92, 102, 112, 122, 132, 150** giọt. Cấp 1–8 tăng 1 giọt sau ngày đủ nước, tối đa 9 lần trong cấp. Cấp 9 giữ 150 giọt, bằng 85% mức tối đa 176 giọt của hai hồ sơ, làm tròn lên.
- Thiếu nước khi hết khiên làm mất tối đa 5 ngày tiến độ và giảm mục tiêu tương ứng. Ba ngày thiếu liên tiếp làm lùi một cấp. Ngày lên cấp có ánh sáng ấm phía sau cây.
- **PPA** có “Đi chơi Thái Lan”. **TBV** có “Học tiếng Pháp”, đủ 40 phút nhận 8 giọt một lần/ngày, có thưởng học cùng nhau và dùng chung giới hạn học 20 giọt.

Cập nhật **firestore.rules trước khi đưa mã mới lên Pages**, rồi tải lại trên cả hai thiết bị. Mục tiêu cũ còn đạt được giữ tới hết ngày nâng cấp; mốc cũ 186 giọt được điều chỉnh về 150. Nước đã có và nhật ký ngày cũ được giữ.
