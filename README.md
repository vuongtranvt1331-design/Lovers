# Pocket Space · Focus & Together

Trang sinh hoạt chung cho PPA và TBV. Mở app và chọn góc nhìn bằng nút hồ sơ ở đầu trang. Trình duyệt được ghép với Firebase một lần theo [hướng dẫn thiết lập đồng bộ và GitHub Pages](./FIREBASE-SETUP.md).

Chạy trên Windows bằng Mo-Pocket-Space.bat hoặc dùng Python.

    python -m http.server 8765 --bind 127.0.0.1

Bộ kiểm thử logic chạy với Node.js 22+.

    node --test tests/state.test.mjs
