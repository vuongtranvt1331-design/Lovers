# Pocket Space · Focus & Together

Trang sinh hoạt chung cho PPA và TBV. Mở app và dùng nút hồ sơ ở đầu trang. Bất kỳ ai mở trang đều có thể đọc dữ liệu chung và thực hiện thao tác của cả hai hồ sơ.

Xem [hướng dẫn Firestore và GitHub Pages](./FIREBASE-SETUP.md). Chạy trên Windows bằng Mo-Pocket-Space.bat hoặc dùng Python.

    python -m http.server 8765 --bind 127.0.0.1

Bộ kiểm thử logic chạy với Node.js 22+.

    node --test tests/state.test.mjs
