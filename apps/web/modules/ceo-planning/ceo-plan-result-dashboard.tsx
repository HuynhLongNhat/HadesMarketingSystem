"use client";

import {
  AlertTriangle,
  BarChart3,
  BriefcaseBusiness,
  CheckCircle2,
  CircleDot,
  ClipboardList,
  Target,
} from "lucide-react";

import { Badge } from "@workspace/ui/components/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";

export type StructuredPlanRecord = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function records(value: unknown): StructuredPlanRecord[] {
  return array(value).filter(isRecord);
}

function value(value: unknown, fallback = "Chưa có thông tin"): string {
  if (value === null || value === undefined || value === "") return fallback;
  if (Array.isArray(value)) return value.length ? value.map((item) => valueText(item)).join(", ") : fallback;
  return String(value);
}

function valueText(input: unknown): string {
  return input === null || input === undefined || input === "" ? "Chưa có thông tin" : String(input);
}

function priorityLabel(priority: unknown) {
  switch (priority) {
    case "high": return "Cao";
    case "medium": return "Trung bình";
    case "low": return "Thấp";
    default: return "Chưa xác định";
  }
}

function responsibleLabel(task: StructuredPlanRecord) {
  const type = task.responsibleType;
  if (type === "EXISTING_AGENT") return value(task.agentRef, "Nhân viên AI hiện có");
  if (type === "PROPOSED_AGENT") return "Đề xuất nhân viên AI";
  return "Con người phụ trách";
}

function ListSection({ title, items, empty = "Chưa có thông tin." }: { title: string; items: unknown[]; empty?: string }) {
  return (
    <section className="min-w-0 rounded-lg border bg-card p-4">
      <h3 className="font-medium">{title}</h3>
      {items.length > 0 ? (
        <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
          {items.map((item, index) => (
            <li key={index} className="flex gap-2">
              <CircleDot className="mt-1 size-3.5 shrink-0 text-foreground" />
              <span>{valueText(item)}</span>
            </li>
          ))}
        </ul>
      ) : <p className="mt-3 text-sm text-muted-foreground">{empty}</p>}
    </section>
  );
}

/** Parses JSON-only CEO output retained in task.result for plans created before persistence succeeded. */
export function parseStructuredPlanFromTaskResult(raw: string | null | undefined): StructuredPlanRecord | null {
  if (!raw?.trim()) return null;
  const trimmed = raw.trim()
    .replace(/^```json\s*/i, "")
    .replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end < start) return null;

  try {
    const parsed: unknown = JSON.parse(trimmed.slice(start, end + 1));
    return isRecord(parsed) && (typeof parsed.objective === "string" || Array.isArray(parsed.tasks))
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/** Mirrors the V3.1 approval contract in the client so invalid JSON never gets an Approve button. */
export function isStructuredPlanValidForApproval(input: unknown): input is StructuredPlanRecord {
  if (!isRecord(input) || input.version !== "v3.1" || typeof input.objective !== "string" || !input.objective.trim()) return false;
  const textList = (item: unknown, required = false) => Array.isArray(item) && (!required || item.length > 0) && item.every((entry) => typeof entry === "string" && Boolean(entry.trim()));
  if (!textList(input.businessAnalysis, true) || !textList(input.strategy, true) || !textList(input.assumptions) || !textList(input.risks) || !textList(input.feasibilityWarnings)) return false;
  const resources = input.resourceAllocation;
  if (!isRecord(resources) || typeof resources.summary !== "string" || !resources.summary.trim() || !(resources.humanHoursAssumption === null || typeof resources.humanHoursAssumption === "number") || !textList(resources.aiSupportNotes)) return false;
  const validPhases = records(input.phases).length > 0 && records(input.phases).every((phase) => [phase.name, phase.milestone, phase.timeframe].every((field) => typeof field === "string" && Boolean(field.trim())));
  const validTasks = records(input.tasks).length > 0 && records(input.tasks).every((task) => typeof task.id === "string" && /^TASK-\d{2,}$/i.test(task.id) && [task.title, task.description, task.deliverable, task.acceptanceCriteria].every((field) => typeof field === "string" && Boolean(field.trim())) && ["high", "medium", "low"].includes(String(task.priority)) && typeof task.estimatedHours === "number" && task.estimatedHours > 0 && Array.isArray(task.dependencies) && task.dependencies.every((dependency) => typeof dependency === "string" && /^TASK-\d{2,}$/i.test(dependency)) && ["HUMAN", "EXISTING_AGENT", "PROPOSED_AGENT"].includes(String(task.responsibleType)));
  const validKpis = records(input.kpis).length > 0 && records(input.kpis).every((kpi) => [kpi.metric, kpi.target, kpi.deadline, kpi.measurementMethod, kpi.relatedObjective].every((field) => typeof field === "string" && Boolean(field.trim())));
  const validAgents = Array.isArray(input.agentRecommendations) && records(input.agentRecommendations).length === input.agentRecommendations.length && records(input.agentRecommendations).every((agent) => typeof agent.name === "string" && Boolean(agent.name.trim()) && typeof agent.rationale === "string" && Boolean(agent.rationale.trim()) && ["EXISTING_AGENT", "PROPOSED_AGENT", "HUMAN"].includes(String(agent.status)) && textList(agent.verifiedCapabilities));
  return validPhases && validTasks && validKpis && validAgents;
}

export function CeoPlanResultDashboard({
  plan,
  planStatus,
}: {
  plan: StructuredPlanRecord;
  planStatus: string;
}) {
  const tasks = records(plan.tasks);
  const kpis = records(plan.kpis);
  const phases = records(plan.phases);
  const agents = records(plan.agentRecommendations);
  const resources = isRecord(plan.resourceAllocation) ? plan.resourceAllocation : {};
  const warnings = array(plan.feasibilityWarnings);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border bg-muted/20 p-4 sm:p-5">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Mục tiêu chiến lược</p>
            <h3 className="mt-2 text-lg font-semibold leading-7 sm:text-xl">{value(plan.objective)}</h3>
          </div>
          <Badge variant={planStatus === "Đã phê duyệt" ? "default" : planStatus === "Thất bại" ? "destructive" : "outline"}>
            {planStatus}
          </Badge>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <Stat label="Giai đoạn" value={String(phases.length)} icon={<ClipboardList className="size-4" />} />
          <Stat label="Công việc đề xuất" value={String(tasks.length)} icon={<BriefcaseBusiness className="size-4" />} />
          <Stat label="KPI theo dõi" value={String(kpis.length)} icon={<BarChart3 className="size-4" />} />
        </div>
      </div>

      <Tabs defaultValue="overview" className="min-w-0">
        <div className="overflow-x-auto pb-1">
          <TabsList className="h-auto min-w-max justify-start">
            <TabsTrigger value="overview">Tổng quan</TabsTrigger>
            <TabsTrigger value="analysis">Phân tích</TabsTrigger>
            <TabsTrigger value="strategy">Chiến lược</TabsTrigger>
            <TabsTrigger value="roadmap">Lộ trình</TabsTrigger>
            <TabsTrigger value="tasks">Công việc</TabsTrigger>
            <TabsTrigger value="kpis">KPI</TabsTrigger>
            <TabsTrigger value="agents">Nhân viên AI</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="mt-4 space-y-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.6fr)]">
            <ListSection title="Điểm chính trong chiến lược" items={array(plan.strategy)} />
            <section className="rounded-lg border bg-card p-4">
              <h3 className="font-medium">Phân bổ nguồn lực</h3>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{value(resources.summary)}</p>
              <div className="mt-4 rounded-md border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">Giả định giờ nhân sự</p>
                <p className="mt-1 text-lg font-semibold">{value(resources.humanHoursAssumption)}</p>
              </div>
            </section>
          </div>
          {warnings.length > 0 && (
            <section className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
              <div className="flex items-center gap-2 font-medium"><AlertTriangle className="size-4" />Cảnh báo tính khả thi</div>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                {warnings.map((warning, index) => <li className="flex gap-2" key={index}><span>•</span><span>{valueText(warning)}</span></li>)}
              </ul>
            </section>
          )}
          <KpiPreview kpis={kpis} />
        </TabsContent>

        <TabsContent value="analysis" className="mt-4 grid gap-4 lg:grid-cols-2">
          <ListSection title="Phân tích doanh nghiệp" items={array(plan.businessAnalysis)} />
          <ListSection title="Giả định" items={array(plan.assumptions)} />
          <ListSection title="Rủi ro" items={array(plan.risks)} />
          <ListSection title="Ghi chú hỗ trợ AI" items={array(resources.aiSupportNotes)} />
        </TabsContent>

        <TabsContent value="strategy" className="mt-4 grid gap-4 lg:grid-cols-2">
          <ListSection title="Chiến lược đề xuất" items={array(plan.strategy)} />
          <ListSection title="Cảnh báo khả thi" items={warnings} empty="CEO không ghi nhận cảnh báo khả thi." />
        </TabsContent>

        <TabsContent value="roadmap" className="mt-4">
          <section className="rounded-lg border bg-card p-4 sm:p-5">
            <h3 className="font-medium">Lộ trình triển khai</h3>
            {phases.length > 0 ? <ol className="mt-5 space-y-0">
              {phases.map((phase, index) => (
                <li key={`${value(phase.name)}-${index}`} className="relative grid grid-cols-[28px_minmax(0,1fr)] pb-6 last:pb-0">
                  {index < phases.length - 1 && <span className="absolute left-[9px] top-5 h-[calc(100%-8px)] w-px bg-border" />}
                  <span className="mt-1 flex size-5 items-center justify-center rounded-full border bg-background text-[10px] font-semibold">{index + 1}</span>
                  <div className="min-w-0 pl-3"><div className="flex flex-wrap items-center gap-2"><h4 className="font-medium">{value(phase.name)}</h4><Badge variant="outline">{value(phase.timeframe)}</Badge></div><p className="mt-1 text-sm leading-6 text-muted-foreground">{value(phase.milestone)}</p></div>
                </li>
              ))}
            </ol> : <p className="mt-3 text-sm text-muted-foreground">Chưa có lộ trình được lưu.</p>}
          </section>
        </TabsContent>

        <TabsContent value="tasks" className="mt-4">
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="p-3 font-medium">Ưu tiên</th><th className="p-3 font-medium">Công việc & kết quả</th><th className="p-3 font-medium">Phụ trách</th><th className="p-3 font-medium">Thời gian</th><th className="p-3 font-medium">Trạng thái</th></tr></thead>
              <tbody>{tasks.length ? tasks.map((task, index) => <tr className="border-t align-top" key={value(task.id, String(index))}><td className="p-3"><Badge variant={task.priority === "high" ? "destructive" : "outline"}>{priorityLabel(task.priority)}</Badge></td><td className="max-w-md p-3"><p className="font-medium">{value(task.title)}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{value(task.description)}</p><p className="mt-2 text-xs"><span className="text-muted-foreground">Kết quả: </span>{value(task.deliverable)}</p><p className="mt-1 text-xs"><span className="text-muted-foreground">Tiêu chí: </span>{value(task.acceptanceCriteria)}</p></td><td className="p-3 text-muted-foreground">{responsibleLabel(task)}</td><td className="p-3"><p>{value(task.estimatedHours)} giờ</p>{array(task.dependencies).length > 0 && <p className="mt-1 text-xs text-muted-foreground">Phụ thuộc: {value(task.dependencies)}</p>}</td><td className="p-3"><Badge variant="outline">Đề xuất</Badge></td></tr>) : <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Chưa có công việc được đề xuất.</td></tr>}</tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="kpis" className="mt-4"><KpiGrid kpis={kpis} /></TabsContent>

        <TabsContent value="agents" className="mt-4">
          <div className="grid gap-4 md:grid-cols-2">
            {agents.length ? agents.map((agent, index) => <Card key={`${value(agent.name)}-${index}`}><CardHeader className="pb-3"><div className="flex items-start justify-between gap-3"><CardTitle className="text-base">{value(agent.name)}</CardTitle><Badge variant="outline">{agent.status === "EXISTING_AGENT" ? "Đang có" : agent.status === "HUMAN" ? "Con người" : "Đề xuất"}</Badge></div></CardHeader><CardContent className="space-y-3 text-sm"><p className="leading-6 text-muted-foreground">{value(agent.rationale)}</p><div><p className="text-xs text-muted-foreground">Năng lực đã xác minh</p><div className="mt-2 flex flex-wrap gap-1.5">{array(agent.verifiedCapabilities).length ? array(agent.verifiedCapabilities).map((capability, capabilityIndex) => <Badge key={capabilityIndex} variant="secondary">{valueText(capability)}</Badge>) : <span className="text-sm text-muted-foreground">Chưa có dữ liệu.</span>}</div></div></CardContent></Card>) : <p className="rounded-lg border p-5 text-sm text-muted-foreground">Chưa có đề xuất nhân sự AI.</p>}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return <div className="rounded-lg border bg-background p-3"><div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div><p className="mt-2 text-xl font-semibold">{value}</p></div>;
}

function KpiPreview({ kpis }: { kpis: StructuredPlanRecord[] }) {
  return <section><div className="mb-3 flex items-center gap-2"><Target className="size-4" /><h3 className="font-medium">KPI trọng tâm</h3></div><div className="grid gap-3 md:grid-cols-3">{kpis.slice(0, 3).map((kpi, index) => <KpiCard key={`${value(kpi.metric)}-${index}`} kpi={kpi} />)}{kpis.length === 0 && <p className="rounded-lg border p-4 text-sm text-muted-foreground">Chưa có KPI được lưu.</p>}</div></section>;
}

function KpiGrid({ kpis }: { kpis: StructuredPlanRecord[] }) {
  return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{kpis.length ? kpis.map((kpi, index) => <KpiCard key={`${value(kpi.metric)}-${index}`} kpi={kpi} />) : <p className="rounded-lg border p-5 text-sm text-muted-foreground">Chưa có KPI được lưu.</p>}</div>;
}

function KpiCard({ kpi }: { kpi: StructuredPlanRecord }) {
  return <Card><CardContent className="p-4"><div className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0" /><div className="min-w-0"><p className="font-medium">{value(kpi.metric)}</p><p className="mt-2 text-lg font-semibold">{value(kpi.target)}</p></div></div><div className="mt-4 space-y-1 text-xs text-muted-foreground"><p>Hạn: {value(kpi.deadline)}</p><p className="leading-5">Đo lường: {value(kpi.measurementMethod)}</p><p className="leading-5">Liên quan: {value(kpi.relatedObjective)}</p></div></CardContent></Card>;
}
