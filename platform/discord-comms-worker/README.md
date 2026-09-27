# TrainingBot COMMS Discord Inbound

Worker này nhận các câu hỏi mới trong kênh cộng đồng Discord TrainingBot và chỉ tự động trả lời trường hợp rủi ro thấp.

## Luồng

Discord channel -> poll mỗi phút -> hard safety gate -> Workers AI -> confidence gate -> reply đúng message/channel.

## An toàn

- Bỏ qua bot và webhook để chống vòng lặp.
- Không tự trả lời nội dung nhạy cảm như mật khẩu, token, tài khoản bị xâm nhập, thanh toán, hoàn tiền, pháp lý hoặc dữ liệu cá nhân.
- Chỉ auto-reply khi classification đúng nhóm hỗ trợ và confidence >= 0.90.
- Không dùng @everyone hoặc @here.
- Lần chạy đầu chỉ đặt cursor, không trả lời lịch sử cũ.
- Cursor và nhật ký message được lưu trong SQLite-backed Durable Object để tránh reply trùng.
- Daily AI cap mặc định 40 lượt/ngày; nếu hết quota hoặc AI lỗi thì fail-closed và không gửi.
- Không có chức năng quảng cáo trả phí, chi tiền hay thay đổi credential.

## Kênh mặc định

- chung
- beta-pubg-mobile
- pubg-mobile-flash
- nhóm-chat-cộng-đồng

## Secret của Worker

- DISCORD_BOT_TOKEN
- DISCORD_GUILD_ID
- ADMIN_KEY

## Endpoint

- GET /health
- /run yêu cầu Authorization: Bearer <ADMIN_KEY>
