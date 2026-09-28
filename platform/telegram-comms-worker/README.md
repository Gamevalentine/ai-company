# TrainingBot COMMS Telegram Inbound

Luồng: Telegram Bot API getUpdates -> hard safety gate -> Workers AI -> confidence gate -> reply cùng chat.

- Chỉ xử lý TELEGRAM_ALLOWED_CHAT_ID.
- Bỏ qua bot và tin không phải câu hỏi.
- Không auto-reply nội dung mật khẩu, token, tài khoản bị xâm nhập, thanh toán, hoàn tiền, pháp lý, dữ liệu cá nhân.
- Chỉ auto-reply khi confidence >= 0.90.
- Lần khởi tạo dùng update cuối để bỏ qua backlog cũ.
- Offset lưu trong SQLite-backed Durable Object để tránh reply trùng.
- Daily AI cap mặc định 40 lượt/ngày.
- Worker fail-closed nếu AI lỗi hoặc thiếu secret.

Secrets:
- TELEGRAM_BOT_TOKEN
- TELEGRAM_ALLOWED_CHAT_ID
- ADMIN_KEY
