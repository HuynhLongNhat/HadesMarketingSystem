# Nova AI Solutions

## Chạy local trên Windows 10 (PowerShell)

Yêu cầu: Node.js 20+, pnpm 10, Docker Desktop (chỉ cần khi dùng Redis Docker) và một file `.env.local` hợp lệ. Giữ nguyên các port đã cấu hình: Web `3000`, Widget `3001`, Embed `3002`, API `3002`, Redis `6379`.

```powershell
pnpm install
Copy-Item .env.example .env.local # Chỉ khi bạn chưa có .env.local
```

Điền các biến bắt buộc trong `.env.local` (đặc biệt database, Better Auth và provider credentials). Không commit file này.

### Khởi động một terminal

```powershell
pnpm dev
```

Lệnh này chạy Web và Widget qua Turborepo, đồng thời chạy API cùng BullMQ Worker ở watch mode. Redis phải đang sẵn sàng theo `REDIS_HOST`/`REDIS_PORT` trong `.env.local`.

```powershell
pnpm dev:all
```

Lệnh này kiểm tra Redis và Research Service trước. Nếu Redis local tại `127.0.0.1:6379` đã chạy, nó tái sử dụng service đó; nếu Research Service chưa sẵn sàng, Docker chỉ khởi động các service còn thiếu. Nó chỉ chạy ứng dụng sau khi Redis và Research Service đều health-check thành công. Không tạo database, không chạy migration và không thay đổi môi trường của bạn.

Nhấn `Ctrl+C` trong terminal đó để dừng Web, Widget, API và Worker cùng nhau. `pnpm dev:all` không tự dừng Redis Docker để dữ liệu development không bị mất giữa các lần chạy.

`embed` không nằm trong `pnpm dev`: cấu hình hiện tại của nó dùng port `3002`, cũng là port API development hiện có. Để không tự thay đổi port, hãy chạy riêng `pnpm dev:embed` chỉ khi API không chiếm port đó hoặc sau khi bạn chủ động cấu hình port khác cho Embed.

### Chỉ quản lý hạ tầng Redis

```powershell
pnpm infra:up
pnpm infra:down
```

`infra:up` không khởi động Redis Docker nếu đã có Redis đáp ứng tại địa chỉ local đã cấu hình. Ngoài Redis, nó chạy SearXNG và Research Service nội bộ tại `127.0.0.1:8010`; SearXNG không được publish public. `infra:down` chỉ dừng Docker Compose development của Nova; không xóa volume Redis.

Market Intelligence ưu tiên Research Service (`SearXNG` + `Trafilatura`). Tavily chỉ là fallback khi bạn chủ động cấu hình `MARKET_RESEARCH_ALLOW_TAVILY_FALLBACK=true`; mặc định không tự tiêu thụ Tavily credit.

### Migration database

Migration là thao tác chủ động, không nằm trong `dev` hay `dev:all`:

```powershell
pnpm --filter @workspace/db build
pnpm --filter @workspace/db db:migrate
```

Chỉ chạy sau khi kiểm tra `DATABASE_URL` trong `.env.local` là database development mong muốn.

## Lệnh riêng lẻ

```powershell
pnpm dev:web
pnpm dev:api
pnpm dev:worker
pnpm dev:widget
pnpm dev:embed
```

Research Service độc lập nằm ở `services/research-service`; nó chỉ tìm kiếm/trích xuất nguồn công khai. API Worker vẫn là nơi điều phối công việc, lưu evidence và gọi AI tổng hợp.
