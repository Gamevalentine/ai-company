# AION Agent Platform — Bootstrap Pilot

Trạng thái: IN PROGRESS.

Tài liệu này hiện thực hóa Job Description của AION Platform Engineer cho pilot TrainingBot. Mục tiêu là tạo nền tảng thật để ATLAS điều hành theo tuyến:

OWNER → ATLAS → TB-01 → DEV-TB-01 / QA-TB-01

## Kiến trúc bootstrap

- Runtime: Node.js >= 20, không dependency ngoài.
- Task Store: JSON bền vững trên filesystem, ghi atomic bằng temp + rename.
- Audit: append-only JSONL.
- Memory: namespace theo agent_id, có private và shared.
- Inbox/Outbox: message store có from, to, task_id.
- Dispatch Queue: lưu delivery, attempt, failure và retry.
- Permission: enforce bằng code/backend, không chỉ bằng prompt.
- API: HTTP local, bắt buộc AION_PLATFORM_KEY cho mọi endpoint ngoài /health.
- Production: hard-block trong runtime cho operation production/main.

Đây là bootstrap architecture, không phải quyết định production architecture cuối cùng. Không có dịch vụ trả phí mới và không lưu secret trong repository.

## Agent pilot

agents.json khai báo identity, reports_to, project scope, quyền, công cụ và hành động bị cấm cho OWNER, ATLAS, TB-01, DEV-TB-01 và QA-TB-01.

ATLAS không thể giao thẳng cho DEV/QA trong luồng chuẩn. TB-01 là Manager duy nhất được tạo subtask cho DEV/QA.

## Chạy test

Vào thư mục platform và chạy: npm test

Bộ test hiện kiểm tra:
- identity độc lập;
- reporting chain;
- permission deny;
- persistence sau restart;
- memory isolation;
- inbox/outbox;
- queue failure/retry;
- sandbox executor request + production hard block;
- QA PASS/FAIL độc lập;
- FAIL → rework → retest;
- WAITING_OWNER_APPROVAL;
- audit timeline.

## Chạy API local

Vào thư mục platform và chạy với biến môi trường AION_PLATFORM_KEY, sau đó npm start.

Server mặc định bind 127.0.0.1:8787. Không mở public Internet mặc định.

API có khóa dùng header Authorization: Bearer <AION_PLATFORM_KEY>.

## Safe Executor

Runtime đã có contract requestExecution() và chỉ cho phép sandbox_build, sandbox_compare trên nhánh aion-sandbox.

Request production hoặc target main bị chặn bằng PRODUCTION_HARD_BLOCK.

GitHub App AION HQ Executor đã được cấu hình ở repository secret và bridge workflow đã dispatch thật sang TrainingBot Safe Executor.

Luồng đã chứng minh:
1. AION Executor Bridge tạo GitHub App token ngắn hạn;
2. dispatch workflow AION HQ Safe Executor trong trainingbot-cloudflare;
3. Safe Executor chạy safety gate + build aion-sandbox;
4. Safe Executor tạo machine-readable evidence artifact;
5. Bridge chờ run hoàn tất, thu run ID/conclusion/URL/head SHA và upload evidence artifact riêng;
6. runtime có Result Collector + completeExecution() để ghi PASS/FAIL vào Task Store và DEV inbox khi backend runtime được kết nối.

Bằng chứng live pilot:
- Bridge run: 36267386771 — success.
- TrainingBot Safe Executor run: 36267394730 — success.
- TrainingBot evidence artifact: aion-executor-result-36267394730.
- Bridge evidence artifact: aion-bridge-result-36267386771.

Production vẫn bị khóa; pilot chỉ chạy validate-sandbox.

## Acceptance status hiện tại

Có thể PASS bằng test tự động trong source:
- AC-01 Agent Independence
- AC-02 Reporting Structure
- AC-03 Role Permission Enforcement
- AC-04 Task Store Persistence
- AC-05 Memory Isolation
- AC-06 Inbox / Outbox
- AC-07 Dispatch Queue Reliability ở mức pilot
- AC-09 QA Independence ở mức runtime contract
- AC-10 Fail → Rework Loop
- AC-11 Production Hard Block
- AC-12 Owner Approval State
- AC-13 Auditability

Chưa được phép báo PASS hoàn toàn:
- AC-08 Safe Executor Connection: contract đã có nhưng chưa có evidence dispatch thật + result collector thật.
- AC-14 Scope Isolation: cần kiểm tra diff/QA khi kết thúc pilot.
- AC-15 No Unapproved Cost: hiện không thêm chi phí; tiếp tục phải duy trì.
- AC-16 Documentation: bootstrap docs có trong file này, nhưng runbook production và test report cuối chưa đủ.

## Known limitations

1. File store phù hợp pilot một máy/process; chưa phải database production.
2. Chưa có distributed lock cho nhiều process ghi đồng thời.
3. ATLAS trong ChatGPT Project chưa có API được kết nối với runtime này; hiện ATLAS vẫn là external controller.
4. Chưa có LLM brain adapter cho TB-01/DEV/QA. Runtime và identity đã tách, nhưng hành vi tự trị của từng Agent là bước kế tiếp.
5. GitHub Actions credential bridge và result collector đã có; chưa có backend runtime 24/7 để tự gọi collector và giữ Task Store live.
6. Chưa deploy runtime 24/7.

## Bước tiếp theo cần Chủ sở hữu quyết định

Không cần quyết định trả phí ở bước bootstrap này.

Để hoàn tất AC-08 và đưa pilot chạy end-to-end thật, cần chọn cách cấp credential an toàn cho backend executor. Không được đặt token vào index.html, localStorage, task payload hoặc repo. Sau đó mới kết nối Safe Executor và chạy pilot sandbox thật.
