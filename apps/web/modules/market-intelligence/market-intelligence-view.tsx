"use client";

import { resumeMarketResearch, type ResearchCheckpointMetadata } from "@/lib/market-intelligence-api";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  Circle,
  Clock3,
  FileSearch,
  FileText,
  Globe2,
  Loader2,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Progress } from "@workspace/ui/components/progress";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs";
import { Textarea } from "@workspace/ui/components/textarea";
import { MarkdownReport } from "@/modules/tasks/markdown-report";
import { workforceApi, type AiAgent } from "@/lib/workforce-api";
import {
  marketIntelligenceApi,
  type CreateMarketIntelligenceProjectInput,
  type MarketIntelligenceDetail,
  type MarketIntelligenceProject,
} from "@/lib/market-intelligence-api";

type WorkspaceTab = "create" | "history";
type DetailTab = "report" | "sources" | "progress";
type ResearchDepth = "overview" | "detailed" | "comprehensive";
type ResearchForm = {
  title: string;
  industry: string;
  market: string;
  targetAudience: string;
  objective: string;
  researchDepth: ResearchDepth;
  researchProvider: "searxng" | "tavily";
  researchAgentId: string;
  keywords: string;
  sourceUrls: string;
};

const terminalStatuses = new Set(["completed", "failed", "cancelled"]);
const defaultForm = (): ResearchForm => ({
  title: "",
  industry: "",
  market: "",
  targetAudience: "",
  objective: "",
  researchDepth: "overview",
  researchProvider: "searxng",
  researchAgentId: "",
  keywords: "",
  sourceUrls: "",
});
const depthOptions: Array<{
  id: ResearchDepth;
  label: string;
  description: string;
  maxSources: number;
}> = [
  {
    id: "overview",
    label: "Cơ bản",
    description: "Tổng quan và insight chính",
    maxSources: 6,
  },
  {
    id: "detailed",
    label: "Chi tiết",
    description: "Phân tích sâu nhiều góc nhìn",
    maxSources: 12,
  },
  {
    id: "comprehensive",
    label: "Toàn diện",
    description: "Mở rộng đối thủ và cơ hội",
    maxSources: 20,
  },
];
const statusLabel: Record<string, string> = {
  queued: "Chờ xử lý",
  running: "Đang thực hiện",
  completed: "Hoàn thành",
  failed: "Thất bại",
  cancelled: "Đã hủy",
  pending: "Chưa bắt đầu",
  skipped: "Đã bỏ qua",
};
const stepLabel: Record<string, string> = {
  preparing: "Lập kế hoạch nghiên cứu",
  building_queries: "Tạo truy vấn nghiên cứu",
  searching_sources: "Tìm kiếm thông tin",
  collecting_evidence: "Đọc và trích xuất nội dung",
  analyzing_evidence: "Phân tích dữ liệu",
  saving_report: "Tạo báo cáo",
};

function formatTime(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("vi-VN", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";
}
function duration(start: string | null, end: string | null) {
  if (!start) return "Chưa bắt đầu";
  const seconds = Math.max(
    0,
    Math.round(
      ((end ? new Date(end) : new Date()).getTime() -
        new Date(start).getTime()) /
        1_000,
    ),
  );
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
function statusVariant(
  status: string,
): "default" | "secondary" | "outline" | "destructive" {
  return status === "failed"
    ? "destructive"
    : status === "completed"
      ? "default"
      : status === "running"
        ? "secondary"
        : "outline";
}
function StepIcon({ status }: { status: string }) {
  if (status === "completed")
    return (
      <CheckCircle2 className="size-5 text-emerald-500" aria-hidden="true" />
    );
  if (status === "running")
    return <Loader2 className="size-5 animate-spin" aria-hidden="true" />;
  if (status === "failed")
    return <XCircle className="size-5 text-destructive" aria-hidden="true" />;
  if (status === "skipped")
    return (
      <Circle className="size-5 text-muted-foreground" aria-hidden="true" />
    );
  return <Clock3 className="size-5 text-muted-foreground" aria-hidden="true" />;
}
function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof FileSearch;
}) {
  return (
    <Card className="min-w-0">
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-md border bg-muted/30 p-2">
          <Icon className="size-4" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="text-2xl font-semibold tabular-nums">{value}</p>
          <p className="truncate text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function ResearchFormCard({
  agents,
  form,
  saving,
  onChange,
  onSubmit,
}: {
  agents: AiAgent[];
  form: ResearchForm;
  saving: boolean;
  onChange: (patch: Partial<ResearchForm>) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const eligibleAgents = agents.filter(
    (agent) =>
      agent.status === "active" &&
      agent.toolConfig.enabledTools.includes("web_research"),
  );
  return (
    <Card className="border-border/80">
      <CardHeader className="pb-4">
        <CardTitle>Tạo nghiên cứu mới</CardTitle>
        <CardDescription>
          Nhập bối cảnh kinh doanh và câu hỏi. Nhân viên AI sẽ chỉ dùng nguồn
          công khai có thể kiểm chứng.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-5">
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <div className="min-w-0 space-y-2">
              <Label htmlFor="research-industry">
                Ngành nghề <span className="text-destructive">*</span>
              </Label>
              <Input
                id="research-industry"
                value={form.industry}
                onChange={(event) => onChange({ industry: event.target.value })}
                placeholder="Ví dụ: Thiết kế website"
                required
              />
            </div>
            <div className="min-w-0 space-y-2">
              <Label htmlFor="research-market">
                Khu vực <span className="text-destructive">*</span>
              </Label>
              <Input
                id="research-market"
                value={form.market}
                onChange={(event) => onChange({ market: event.target.value })}
                placeholder="Ví dụ: TP. Hồ Chí Minh"
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="research-audience">Khách hàng mục tiêu</Label>
            <Input
              id="research-audience"
              value={form.targetAudience}
              onChange={(event) =>
                onChange({ targetAudience: event.target.value })
              }
              placeholder="Ví dụ: Doanh nghiệp vừa và nhỏ (SME)"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="research-objective">
              Câu hỏi nghiên cứu <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="research-objective"
              value={form.objective}
              onChange={(event) => onChange({ objective: event.target.value })}
              rows={5}
              maxLength={6_000}
              placeholder="Ví dụ: Khách hàng đang gặp khó khăn gì khi thuê dịch vụ thiết kế website?"
              required
            />
            <p className="text-right text-xs text-muted-foreground">
              {form.objective.length}/6000
            </p>
          </div>
          <div className="space-y-2">
            <Label>Mức độ nghiên cứu</Label>
            <div className="grid min-w-0 gap-2 sm:grid-cols-3">
              {depthOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={form.researchDepth === option.id}
                  onClick={() => onChange({ researchDepth: option.id })}
                  className={`min-w-0 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 ${form.researchDepth === option.id ? "border-foreground bg-muted/40 ring-1 ring-foreground/10" : "border-border"}`}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <span
                      className={`size-3 rounded-full border ${form.researchDepth === option.id ? "border-foreground bg-foreground" : "border-muted-foreground"}`}
                    />
                    {option.label}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                    {option.description}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="research-agent">
              Nhân viên nghiên cứu <span className="text-destructive">*</span>
            </Label>
            <select
              id="research-agent"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={form.researchAgentId}
              onChange={(event) =>
                onChange({ researchAgentId: event.target.value })
              }
              required
            >
              <option value="">Chọn Research Agent</option>
              {eligibleAgents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name} · {agent.role}
                </option>
              ))}
            </select>
            {eligibleAgents.length === 0 && (
              <p className="text-xs text-destructive">
                Chưa có nhân viên đang hoạt động được cấp công cụ Nghiên cứu
                Internet.
              </p>
            )}
          </div>
          <details className="rounded-lg border bg-muted/20 px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium">
              Tùy chọn nâng cao
            </summary>
            <div className="mt-4 space-y-4">
              <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="research-title">Tên dự án</Label>
                  <Input
                    id="research-title"
                    value={form.title}
                    onChange={(event) =>
                      onChange({ title: event.target.value })
                    }
                    placeholder="Tự đặt để dễ tìm lại"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="research-provider">
                    Nguồn tìm kiếm ưu tiên
                  </Label>
                  <select
                    id="research-provider"
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={form.researchProvider}
                    onChange={(event) =>
                      onChange({
                        researchProvider: event.target
                          .value as ResearchForm["researchProvider"],
                      })
                    }
                  >
                    <option value="searxng">SearXNG nội bộ (mặc định)</option>
                    <option value="tavily">
                      Tavily (dùng kết nối đã cấu hình)
                    </option>
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="research-keywords">Từ khóa bổ sung</Label>
                <Input
                  id="research-keywords"
                  value={form.keywords}
                  onChange={(event) =>
                    onChange({ keywords: event.target.value })
                  }
                  placeholder="Ngăn cách bằng dấu phẩy"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="research-urls">URL nguồn cụ thể</Label>
                <Textarea
                  id="research-urls"
                  value={form.sourceUrls}
                  onChange={(event) =>
                    onChange({ sourceUrls: event.target.value })
                  }
                  rows={3}
                  placeholder="Mỗi dòng một URL, nếu bạn muốn AI ưu tiên kiểm tra nguồn này"
                />
              </div>
              {form.researchProvider === "tavily" && (
                <p className="text-xs text-muted-foreground">
                  Tavily chỉ chạy khi Organization đã cấu hình kết nối hợp lệ và
                  có thể tiêu thụ quota.
                </p>
              )}
            </div>
          </details>
          <Button
            className="w-full"
            size="lg"
            disabled={saving || eligibleAgents.length === 0}
          >
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Đang giao nghiên cứu…
              </>
            ) : (
              <>
                <Play className="size-4" />
                Bắt đầu nghiên cứu
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function ResearchHistory({
  items,
  loading,
  onOpen,
}: {
  items: Array<{
    project: MarketIntelligenceProject;
    taskStatus: string;
    taskError: string | null;
  }>;
  loading: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <Card className="border-border/80">
      <CardHeader>
        <CardTitle>Nghiên cứu gần đây</CardTitle>
        <CardDescription>
          Chọn một nghiên cứu để theo dõi tiến độ, bằng chứng và báo cáo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" />
            Đang tải nghiên cứu…
          </div>
        ) : items.length === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center text-center text-sm text-muted-foreground">
            <FileSearch className="mb-3 size-8" />
            <p>Chưa có nghiên cứu nào.</p>
            <p className="mt-1 text-xs">
              Tạo yêu cầu đầu tiên để thu thập dữ liệu thị trường có căn cứ.
            </p>
          </div>
        ) : (
          items.map(({ project, taskStatus, taskError }) => (
            <button
              type="button"
              onClick={() => onOpen(project.id)}
              key={project.id}
              className="group w-full rounded-lg border p-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium group-hover:underline">
                    {project.title}
                  </p>
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    {project.industry} · {project.market}
                  </p>
                </div>
                <Badge className="shrink-0" variant={statusVariant(taskStatus)}>
                  {statusLabel[taskStatus] ?? taskStatus}
                </Badge>
              </div>
              {!terminalStatuses.has(taskStatus) && (
                <div className="mt-3 space-y-2">
                  <div className="flex justify-between gap-3 text-xs text-muted-foreground">
                    <span className="truncate">
                      {project.currentStep
                        ? (stepLabel[project.currentStep] ??
                          project.currentStep)
                        : "Đang chờ Worker"}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {project.progressPercent}%
                    </span>
                  </div>
                  <Progress value={project.progressPercent} className="h-1.5" />
                  <p className="text-xs text-muted-foreground">
                    {project.completedSteps}/{project.totalSteps} bước ·{" "}
                    {project.lastHeartbeatAt
                      ? `Cập nhật ${formatTime(project.lastHeartbeatAt)}`
                      : "Chưa có tín hiệu Worker"}
                  </p>
                </div>
              )}
              {taskStatus === "completed" && (
                <p className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <FileText className="size-3" />
                  Báo cáo và bằng chứng đã sẵn sàng
                </p>
              )}
              {taskError && (
                <p className="mt-3 line-clamp-2 text-xs text-destructive">
                  {taskError}
                </p>
              )}
            </button>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function SourcesPanel({ detail }: { detail: MarketIntelligenceDetail }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const sources = detail.sources.filter((source) => {
    const needle = query.trim().toLocaleLowerCase("vi-VN");
    const matchesText =
      !needle ||
      `${source.title} ${source.domain} ${source.excerpt ?? ""}`
        .toLocaleLowerCase("vi-VN")
        .includes(needle);
    return (
      matchesText && (filter === "all" || source.extractionStatus === filter)
    );
  });
  return (
    <div className="space-y-4">
      <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
        <div className="relative min-w-0">
          <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-9"
            placeholder="Tìm theo tiêu đề, domain hoặc nội dung…"
            aria-label="Tìm nguồn bằng chứng"
          />
        </div>
        <select
          className="h-10 min-w-0 rounded-md border bg-background px-3 text-sm"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          aria-label="Lọc trạng thái trích xuất"
        >
          <option value="all">Tất cả trạng thái</option>
          <option value="retrieved">Đã trích xuất</option>
          <option value="blocked">Đã chặn</option>
          <option value="failed">Trích xuất lỗi</option>
        </select>
      </div>
      <p className="text-xs text-muted-foreground">
        Hiển thị {sources.length}/{detail.sources.length} nguồn đã lưu.
      </p>
      {sources.length ? (
        <div className="divide-y rounded-lg border">
          {sources.map((source) => (
            <details key={source.id} className="group p-4">
              <summary className="cursor-pointer list-none">
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{source.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {source.domain} · Thu thập{" "}
                      {formatTime(source.retrievedAt)}
                    </p>
                  </div>
                  <Badge
                    variant={
                      source.extractionStatus === "retrieved"
                        ? "default"
                        : source.extractionStatus === "failed"
                          ? "destructive"
                          : "outline"
                    }
                  >
                    {source.extractionStatus === "retrieved"
                      ? "Đã trích xuất"
                      : source.extractionStatus === "blocked"
                        ? "Đã chặn"
                        : "Trích xuất lỗi"}
                  </Badge>
                </div>
              </summary>
              <div className="mt-4 space-y-3 border-t pt-3 text-sm">
                <a
                  className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                  href={source.displayUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Mở URL gốc <ArrowUpRight className="size-3" />
                </a>
                {source.excerpt && (
                  <p className="leading-6 text-muted-foreground">
                    {source.excerpt}
                  </p>
                )}
                {source.extractionError && (
                  <p className="text-destructive">{source.extractionError}</p>
                )}
                {source.extractedContent && (
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs leading-5">
                    {source.extractedContent}
                  </pre>
                )}
              </div>
            </details>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Không có nguồn nào khớp bộ lọc.
        </div>
      )}
    </div>
  );
}

function ResearchDetail({
  detail,
  refreshing,
  onBack,
  onRefresh,
  onManage,
}: {
  detail: MarketIntelligenceDetail;
  refreshing: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onManage: (action: "cancel" | "retry", refreshAgentConfiguration?: boolean) => void;
}) {
  const [tab, setTab] = useState<DetailTab>(
    detail.report ? "report" : "progress",
  );
  const [refreshAgentConfiguration, setRefreshAgentConfiguration] = useState(true);
  const activeStatus = detail.task?.status ?? detail.status;
  const extracted = detail.sources.filter(
    (source) => source.extractionStatus === "retrieved",
  ).length;
  const sourceErrors = detail.sources.filter(
    (source) => source.extractionStatus === "failed",
  ).length;
  const isRunning = !terminalStatuses.has(activeStatus);
  const activeStep = detail.steps.find((step) => step.status === "running");
  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="size-4" />
            Danh sách nghiên cứu
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={refreshing}
          >
            {refreshing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Làm mới
          </Button>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">Web Research</p>
            <h1 className="mt-1 break-words text-2xl font-semibold tracking-tight sm:text-3xl">
              {detail.title}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {detail.industry} · {detail.market}
              {detail.targetAudience
                ? ` · Khách hàng: ${detail.targetAudience}`
                : ""}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Badge variant={statusVariant(activeStatus)}>
              {statusLabel[activeStatus] ?? activeStatus}
            </Badge>
            {isRunning && (
              <Button
                variant="outline"
                size="sm"
                disabled={refreshing}
                onClick={() => onManage("cancel")}
              >
                Hủy nghiên cứu
              </Button>
            )}
            {activeStatus === "failed" && (
              <Button
                size="sm"
                disabled={refreshing}
                onClick={() => onManage("retry", refreshAgentConfiguration)}
              >
                <RefreshCw className="size-4" />
                Tiếp tục từ bước thất bại
              </Button>
            )}
          </div>
        </div>
      </header>
      {(detail.task?.error || detail.lastError) && (
        <div className="flex gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Nghiên cứu chưa hoàn thành</p>
            <p className="mt-1">{detail.task?.error ?? detail.lastError}</p>
            <p className="mt-2 text-muted-foreground">Bằng chứng và lịch sử đã lưu được giữ lại. Các checkpoint còn hợp lệ sẽ được sử dụng lại, không gọi tìm kiếm hoặc AI cho bước đã hoàn thành. Dữ liệu checkpoint thiếu sẽ được khôi phục từ nguồn đã lưu nếu có.</p>
            <label className="mt-3 flex items-start gap-2 text-foreground">
              <input type="checkbox" checked={refreshAgentConfiguration} onChange={(event) => setRefreshAgentConfiguration(event.target.checked)} disabled={refreshing} className="mt-1" />
              Dùng cấu hình Agent hiện tại (chọn sau khi sửa mô hình/kết nối AI). Nếu không chọn, giữ cấu hình của lần chạy ban đầu.
            </label>
          </div>
        </div>
      )}
      {isRunning && (
        <Card className="border-border/80">
          <CardContent className="space-y-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium">Tiến trình nghiên cứu</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {activeStep
                    ? activeStep.title
                    : "Đang chờ Worker nhận nhiệm vụ"}
                </p>
              </div>
              <span className="text-sm font-medium tabular-nums">
                {detail.progressPercent}%
              </span>
            </div>
            <Progress value={detail.progressPercent} className="h-2" />
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
              <span>
                {detail.completedSteps}/{detail.totalSteps} bước hoàn thành
              </span>
              <span>Đã chạy {duration(detail.startedAt, null)}</span>
              {detail.lastHeartbeatAt && (
                <span>
                  Worker cập nhật {formatTime(detail.lastHeartbeatAt)}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as DetailTab)}
        className="gap-4"
      >
        <div className="overflow-x-auto pb-1">
          <TabsList aria-label="Chi tiết nghiên cứu">
            <TabsTrigger value="report">Báo cáo</TabsTrigger>
            <TabsTrigger value="sources">
              Nguồn ({detail.sources.length})
            </TabsTrigger>
            <TabsTrigger value="progress">Chi tiết tiến trình</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="report">
          <Card className="border-border/80">
            <CardHeader className="border-b">
              <CardTitle className="text-xl">
                Báo cáo nghiên cứu thị trường
              </CardTitle>
              <CardDescription>
                {detail.report
                  ? "Kết luận được tổng hợp từ bằng chứng đã lưu. Những phần thiếu dữ liệu cần được xem là giới hạn nghiên cứu."
                  : "Báo cáo chỉ được hiển thị sau khi Worker lưu thành công."}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-5 sm:p-7">
              {detail.report ? (
                <MarkdownReport
                  content={detail.report.content}
                  sources={detail.sources.map((source, index) => ({
                    ...source,
                    ordinal: index + 1,
                    citationNumber: index + 1,
                    status: "retrieved",
                    canonicalUrl: source.displayUrl,
                  }))}
                />
              ) : (
                <div className="flex min-h-56 flex-col items-center justify-center text-center text-sm text-muted-foreground">
                  <FileText className="mb-3 size-8" />
                  {activeStatus === "failed"
                    ? "Không có báo cáo vì nghiên cứu đã thất bại."
                    : activeStatus === "cancelled"
                      ? "Nghiên cứu đã bị hủy trước khi báo cáo được tạo."
                      : "Báo cáo sẽ xuất hiện khi bước tạo báo cáo hoàn tất."}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="sources">
          <Card className="border-border/80">
            <CardHeader>
              <CardTitle>Nguồn và bằng chứng</CardTitle>
              <CardDescription>
                Chỉ nguồn đã lưu mới được đưa vào báo cáo. Nội dung website được
                xem là dữ liệu không đáng tin cậy, không phải hướng dẫn cho AI.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SourcesPanel detail={detail} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="progress">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
            <Card className="border-border/80">
              <CardHeader>
                <CardTitle>Tiến trình thực hiện</CardTitle>
                <CardDescription>
                  Trạng thái được lấy từ các checkpoint Worker đã lưu, không
                  phải thanh tiến độ tự tăng.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="space-y-0">
                  {detail.steps.map((rawStep, index) => {
                    const step = rawStep as typeof rawStep & ResearchCheckpointMetadata;
                    return (
                    <li
                      key={step.id}
                      className="relative grid grid-cols-[24px_minmax(0,1fr)] gap-3 pb-5 last:pb-0"
                    >
                      <div className="relative flex justify-center">
                        {index < detail.steps.length - 1 && (
                          <span className="absolute top-6 h-[calc(100%+2px)] w-px bg-border" />
                        )}
                        <StepIcon status={step.status} />
                      </div>
                      <div
                        className={`min-w-0 rounded-lg border p-3 ${step.status === "running" ? "bg-muted/40" : ""}`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium">
                              {step.sequence}.{" "}
                              {step.title ||
                                stepLabel[step.stepKey] ||
                                step.stepKey}
                            </p>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {step.agentName
                                ? `Thực hiện bởi ${step.agentName}`
                                : "Worker hệ thống"}
                            </p>
                          </div>
                          <Badge variant={statusVariant(step.status)}>
                            {statusLabel[step.status] ?? step.status}
                          </Badge>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {step.startedAt
                            ? `${formatTime(step.startedAt)} · ${duration(step.startedAt, step.completedAt)}`
                            : "Chưa bắt đầu"}
                          {step.resultCount !== null
                            ? ` · ${step.resultCount} kết quả`
                            : ""}
                        </p>
                        {step.safeError && (
                          <p className="mt-2 text-sm text-destructive">
                            {step.safeError}
                          </p>
                        )}
                        <p className="mt-2 text-xs text-muted-foreground">Số lần thực thi: {step.attemptCount ?? 0}{(step.reusedCount ?? 0) > 0 ? ` · Đã dùng lại checkpoint ${step.reusedCount} lần` : ""}</p>
                        {step.status === "failed" && activeStatus === "failed" && (
                          <Button className="mt-3" size="sm" disabled={refreshing} onClick={() => onManage("retry", refreshAgentConfiguration)}>
                            {refreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                            Thử lại từ bước {step.sequence}
                          </Button>
                        )}
                      </div>
                    </li>
                  ); })}
                </ol>
              </CardContent>
            </Card>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              <StatCard
                label="Nguồn tìm được"
                value={detail.sources.length}
                icon={Globe2}
              />
              <StatCard
                label="Đã trích xuất"
                value={extracted}
                icon={ShieldCheck}
              />
              <StatCard
                label="Trích xuất lỗi"
                value={sourceErrors}
                icon={TriangleAlert}
              />
            </div>
          </div>
          <Card className="border-border/80">
            <CardHeader>
              <CardTitle>Nhật ký thực hiện</CardTitle>
            </CardHeader>
            <CardContent>
              {detail.events.length ? (
                <ol className="space-y-3">
                  {detail.events.map((event) => (
                    <li key={event.id} className="flex gap-3 text-sm">
                      <span className="mt-2 size-1.5 shrink-0 rounded-full bg-foreground" />
                      <div>
                        <p>{event.message}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatTime(event.createdAt)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Chưa có nhật ký thực hiện.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function MarketIntelligenceView() {
  const [items, setItems] = useState<
    Array<{
      project: MarketIntelligenceProject;
      taskStatus: string;
      taskError: string | null;
    }>
  >([]);
  const [agents, setAgents] = useState<AiAgent[]>([]);
  const [selected, setSelected] = useState<MarketIntelligenceDetail | null>(
    null,
  );
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("create");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<ResearchForm>(defaultForm);
  const selectedId = useRef<string | null>(null);
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      setItems(await marketIntelligenceApi.list());
    } catch {
      if (!silent) toast.error("Không thể tải danh sách nghiên cứu.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);
  const open = useCallback(async (id: string, silent = false) => {
    selectedId.current = id;
    try {
      const detail = await marketIntelligenceApi.get(id);
      if (selectedId.current === id) setSelected(detail);
    } catch {
      if (!silent) toast.error("Không thể tải chi tiết nghiên cứu.");
    }
  }, []);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      load(true),
      selectedId.current ? open(selectedId.current, true) : Promise.resolve(),
    ]);
    setRefreshing(false);
  }, [load, open]);
  const backToWorkspace = () => {
    selectedId.current = null;
    setSelected(null);
    setWorkspaceTab("history");
  };
  useEffect(() => {
    void load();
    void workforceApi
      .listAgents()
      .then(setAgents)
      .catch(() => toast.error("Không thể tải danh sách nhân viên."));
  }, [load]);
  const selectedTaskStatus = selected?.task?.status ?? selected?.status;
  useEffect(() => {
    if (!selectedTaskStatus || terminalStatuses.has(selectedTaskStatus)) return;
    const id = window.setInterval(() => {
      if (selectedId.current)
        void Promise.all([load(true), open(selectedId.current, true)]);
    }, 3_000);
    return () => window.clearInterval(id);
  }, [selectedTaskStatus, load, open]);
  const manageJob = async (action: "cancel" | "retry", refreshAgentConfiguration = true) => {
    if (!selected || refreshing) return;
    setRefreshing(true);
    try {
      if (action === "cancel") {
        await marketIntelligenceApi.cancel(selected.id);
        toast.success("Đã hủy nghiên cứu.");
        await load(true);
        await open(selected.id, true);
      } else {
        const project = await resumeMarketResearch(selected.id, refreshAgentConfiguration);
        toast.success("Đã đưa yêu cầu tiếp tục vào hàng đợi. Dữ liệu đã thu thập được giữ lại.");
        await load(true);
        await open(project.id, true);
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Không thể cập nhật nghiên cứu.",
      );
    } finally {
      setRefreshing(false);
    }
  };
  const changeForm = (patch: Partial<ResearchForm>) =>
    setForm((current) => ({ ...current, ...patch }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.researchAgentId)
      return toast.error("Hãy chọn nhân viên Research Agent.");
    const maxSources =
      depthOptions.find((option) => option.id === form.researchDepth)
        ?.maxSources ?? 6;
    setSaving(true);
    try {
      const input: CreateMarketIntelligenceProjectInput = {
        title:
          form.title.trim() ||
          `${form.industry.trim()} — ${form.market.trim()}`,
        industry: form.industry,
        market: form.market,
        targetAudience: form.targetAudience || undefined,
        objective: form.objective,
        maxSources,
        researchProvider: form.researchProvider,
        researchAgentId: form.researchAgentId,
        keywords: form.keywords
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        sourceUrls: form.sourceUrls
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean),
      };
      const project = await marketIntelligenceApi.create(input);
      toast.success("Đã tạo dự án và giao nghiên cứu.");
      setForm(defaultForm());
      await load(true);
      await open(project.id);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Không thể tạo dự án.",
      );
    } finally {
      setSaving(false);
    }
  };
  if (selected)
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <ResearchDetail
          key={selected.id}
          detail={selected}
          refreshing={refreshing}
          onBack={backToWorkspace}
          onRefresh={() => void refresh()}
          onManage={(action) => void manageJob(action)}
        />
      </div>
    );
  const running = items.filter(
    (item) => !terminalStatuses.has(item.taskStatus),
  ).length;
  const completed = items.filter(
    (item) => item.taskStatus === "completed",
  ).length;
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            Bộ phận Tình báo thị trường
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            Web Research
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Nghiên cứu thị trường, khách hàng, đối thủ và cơ hội marketing từ dữ
            liệu Internet công khai có thể kiểm chứng.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => void refresh()}
          disabled={refreshing}
        >
          {refreshing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Làm mới
        </Button>
      </header>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Nghiên cứu" value={items.length} icon={FileSearch} />
        <StatCard label="Đang chạy" value={running} icon={Loader2} />
        <StatCard label="Hoàn thành" value={completed} icon={CheckCircle2} />
        <StatCard
          label="Thất bại"
          value={items.filter((item) => item.taskStatus === "failed").length}
          icon={TriangleAlert}
        />
      </div>
      <Tabs
        value={workspaceTab}
        onValueChange={(value) => setWorkspaceTab(value as WorkspaceTab)}
        className="gap-5"
      >
        <div className="overflow-x-auto pb-1">
          <TabsList aria-label="Web Research">
            <TabsTrigger value="create">
              <Sparkles className="size-4" />
              Tạo nghiên cứu
            </TabsTrigger>
            <TabsTrigger value="history">Lịch sử nghiên cứu</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="create">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(340px,.72fr)]">
            <ResearchFormCard
              agents={agents}
              form={form}
              saving={saving}
              onChange={changeForm}
              onSubmit={submit}
            />
            <ResearchHistory
              items={items.slice(0, 5)}
              loading={loading}
              onOpen={(id) => void open(id)}
            />
          </div>
        </TabsContent>
        <TabsContent value="history">
          <ResearchHistory
            items={items}
            loading={loading}
            onOpen={(id) => void open(id)}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
