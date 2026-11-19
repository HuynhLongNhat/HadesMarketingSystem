# NOVA-UAT-001 — Nova Assistant

## Bàn giao

Đã triển khai chat cá nhân tại `/assistant`: chọn kết nối/model đã cấu hình,
streaming, ngữ cảnh hội thoại, lịch sử sau F5, đổi tên, xóa có xác nhận,
dừng phản hồi và thử lại trên cùng request ID. Có phân quyền `assistant:use`,
kiểm tra cả user và Organization, bảo vệ Origin cho request ghi dữ liệu,
lease và trạng thái lỗi khi tiến trình bị gián đoạn.

Tái sử dụng Better Auth, provider registry, AES-GCM credential encryption,
quota/reservation, usage recorder, Markdown/GFM renderer và shadcn/ui.
Schema CSKH/Guest không thay đổi. Không tự gọi Web Research hoặc giao Task.

Migration `0054` **chưa áp dụng** vào database ứng dụng. Kiểm tra thực tế thấy
hai bảng Assistant chưa tồn tại trong DB development. Integration tests chạy
DDL trong schema fixture riêng, rollback toàn bộ, và xác nhận schema đã bị
rollback. Authentication context và AI được mock trong integration; chưa phải
nghiệm thu đăng nhập/model thật trên giao diện.

### File mới

```text
apps/api/src/assistant/assistant.controller.ts
apps/api/src/assistant/assistant.dto.ts
apps/api/src/assistant/assistant.module.ts
apps/api/src/assistant/assistant.service.ts
apps/api/src/assistant/assistant.spec.ts
apps/api/src/assistant/assistant.integration.spec.ts
apps/api/src/ai-providers/assistant-chat-runtime.service.ts
apps/web/app/(dashboard)/assistant/page.tsx
apps/web/modules/assistant/assistant-view.tsx
apps/web/modules/assistant/assistant-message.tsx
apps/web/lib/assistant-api.ts
packages/db/src/assistant-schema.ts
packages/db/drizzle/0054_personal_assistant.sql
docs/uat/NOVA-UAT-001-assistant.md
```

### File cập nhật

```text
apps/api/package.json
apps/api/src/app.module.ts
apps/api/src/common/permissions/permissions.ts
apps/web/lib/api-client.ts
apps/web/modules/dashboard/ui/components/dashboard-sidebar.tsx
packages/db/src/index.ts
packages/db/drizzle/meta/_journal.json
```

Sửa thêm lỗi TypeScript có sẵn để quality gates chạy được, không đổi luồng
nghiệp vụ: `apps/api/src/jobs/ai-task-backoff.ts` và
`apps/api/src/tasks/task-ai-execution.service.ts`.

### Kiểm thử đã chạy

- DB build/typecheck: PASS.
- API và Web typecheck/build: PASS.
- API/Web lint: exit 0, có warnings. Focused lint frontend mới: không warnings;
  focused backend có 2 warnings `WEB_URL` chưa khai báo trong Turbo.
- `pnpm --filter @workspace/api test:assistant`: 15/15 PASS.
- `pnpm --filter @workspace/api test:assistant:integration`: 14/14 PASS
  (bao gồm suite cha và 13 kiểm tra PostgreSQL/HTTP).
- `pnpm --filter @workspace/api test:chat`: 42/42 PASS.
- Node focused suite Assistant + Task prompts/state + Widget guards: 45/45 PASS.
- UAT đăng nhập, AI thật, responsive trên trình duyệt: NOT VERIFIED.

### Nghiệm thu nhanh bằng tiếng Việt

1. Xác minh `.env.local` là DB development, chạy hai lệnh DB bên dưới, rồi
   `pnpm dev:all`.
2. Đăng nhập, mở **Nova Assistant** trên sidebar hoặc `/assistant`.
3. Chọn kết nối/model đã cấu hình. Gửi “Xin chào, tôi tên An. Bạn có thể giúp
   gì cho tôi?”. Kiểm tra văn bản streaming và trạng thái hoàn tất.
4. Hỏi tiếp “Tôi vừa nói tôi tên gì?”. Bấm F5, kiểm tra hai lượt vẫn còn.
5. Tạo Chat mới, mở lại chat cũ; đổi tên và F5 kiểm tra tên.
6. Yêu cầu phản hồi dài, bấm Dừng sau khi phản hồi bắt đầu. F5 phải còn trạng
   thái đã dừng; có thể Thử lại, tối đa 3 lần trên cùng lượt.
7. Với kết nối test đang hết quota, kiểm tra lỗi rõ ràng và retry không nhân
   đôi tin nhắn người dùng.
8. Đăng nhập bằng user khác/cùng Organization rồi Organization khác: không
   thấy hoặc truy cập được hội thoại riêng này.
9. Thử viewport 375px: mở lịch sử, chọn model, gửi, dừng. Xóa chat test qua
   hộp xác nhận; không ảnh hưởng chat khác hoặc inbox CSKH.

Giới hạn MVP: ngữ cảnh tối đa 20 lượt gần nhất và 32.000 ký tự; mỗi yêu cầu
tối đa 8.000 ký tự, output 4.000 token, timeout 90 giây. Danh sách tải 100
hội thoại gần nhất và tối đa 200 lượt mỗi hội thoại. Không có Web Search,
Knowledge/Memory tự động hoặc thực thi công việc trong phần này.

Các mục bên dưới bổ sung chi tiết kỹ thuật và lệnh chạy lại.

## Local setup

Only after confirming that `.env.local` points to the intended development database:

```powershell
pnpm --filter @workspace/db build
pnpm --filter @workspace/db db:migrate
pnpm dev:all
```

Migration `0054_personal_assistant` adds two private-chat tables. It does not
change customer-support conversations. No migration is run automatically by
the Assistant or the local launcher.

Configure an enabled AI connection and save at least one model in AI settings
or an active employee profile. Assistant offers those configured models, never
credentials. The selected model is used for each new message; retry keeps the
failed turn's model. The context contains the latest 20 completed turns within
a 32,000-character budget, plus the current message. There is no automatic
Web Research, knowledge retrieval, task execution or long-term memory.

## Manual acceptance

1. Sign in and open `/assistant` (also in the workspace sidebar).
2. Select a configured connection/model and send: “Xin chào, tôi tên An.
   Bạn có thể giúp gì cho tôi?” Text should stream and finish without an error.
3. Ask “Tôi vừa nói tôi tên gì?” Confirm that the persisted prior context is used.
4. Press F5. Conversation title, both messages and responses remain. Open
   “Chat mới”; the previous chat remains in the personal history.
5. Rename the previous conversation. Reload and confirm the new title.
6. Ask for a longer response, press Stop, and reload. It remains cancelled,
   without later becoming completed. Retry is explicit, maximum three attempts.
7. With a test connection whose provider returns a quota error, confirm the
   failed state, helpful error and Retry. Retry reuses the original request/turn,
   without appending another copy of the user message.
8. Log in as another user in the same organization, then another organization.
   Neither should list, read, rename, delete or send into this private chat.
9. At 375px viewport, open/close History, change the model, send and stop.
   There should be no page-wide horizontal overflow.
10. Delete a disposable conversation using the confirmation dialog. Other
    conversations and the customer-support inbox remain unchanged.

Token counts are shown only when returned by the provider. Failed/cancelled
requests may still consume provider quota. Unknown usage keeps the existing
Organization quota reservation until the period ends. Assistant never retries
automatically or switches provider.

## Automated checks

```powershell
pnpm --filter @workspace/api test:assistant
pnpm --filter @workspace/api test:assistant:integration
pnpm --filter @workspace/api test:chat
pnpm --filter @workspace/api test:widget-security
pnpm --filter @workspace/api check-types
pnpm --filter web check-types
pnpm --filter @workspace/api build
pnpm --filter web build
```

The integration suite verifies the database environment, applies the exact
migration inside an isolated schema in a transaction, exercises real HTTP and
PostgreSQL, and rolls all fixtures and DDL back. It uses a fixture authentication
context and mocked AI responses; this is not live login/provider UAT. It does
not require migration 0054 to have been applied to application tables.
