"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Input } from "@workspace/ui/components/input";
import { Progress } from "@workspace/ui/components/progress";
import { Textarea } from "@workspace/ui/components/textarea";
import { MarkdownReport } from "@/modules/tasks/markdown-report";
import { workforceApi, type AiAgent } from "@/lib/workforce-api";
import { marketIntelligenceApi, type MarketIntelligenceDetail, type MarketIntelligenceProject } from "@/lib/market-intelligence-api";

const terminalStatuses = new Set(["completed", "failed", "cancelled"]);
const statusLabel: Record<string, string> = { queued: "Chờ xử lý", running: "Đang thực hiện", completed: "Hoàn thành", failed: "Thất bại", cancelled: "Đã hủy", pending: "Chưa bắt đầu", skipped: "Đã bỏ qua" };
const stepLabel: Record<string, string> = { preparing: "Chuẩn bị nhiệm vụ", building_queries: "Tạo truy vấn nghiên cứu", searching_sources: "Tìm kiếm nguồn", collecting_evidence: "Thu thập bằng chứng", analyzing_evidence: "Phân tích dữ liệu", saving_report: "Tạo và lưu báo cáo" };
function formatTime(value: string | null) { return value ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value)) : "—"; }
function duration(start: string | null, end: string | null) { if (!start) return "Chưa bắt đầu"; const seconds = Math.max(0, Math.round(((end ? new Date(end) : new Date()).getTime() - new Date(start).getTime()) / 1000)); return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`; }
function statusVariant(status: string): "default" | "secondary" | "outline" | "destructive" { return status === "failed" ? "destructive" : status === "completed" ? "default" : status === "running" ? "secondary" : "outline"; }

export function MarketIntelligenceView() {
  const [items, setItems] = useState<Array<{ project: MarketIntelligenceProject; taskStatus: string; taskError: string | null }>>([]);
  const [agents, setAgents] = useState<AiAgent[]>([]);
  const [selected, setSelected] = useState<MarketIntelligenceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const selectedId = useRef<string | null>(null);
  const [form, setForm] = useState({ title: "", industry: "", market: "", targetAudience: "", objective: "", maxSources: "8", researchProvider: "searxng" as "searxng" | "tavily", researchAgentId: "", keywords: "", sourceUrls: "" });
  const [sourceQuery, setSourceQuery] = useState("");
  const [sourceStatus, setSourceStatus] = useState("all");

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try { setItems(await marketIntelligenceApi.list()); }
    catch { if (!silent) toast.error("Không thể tải dự án."); }
    finally { if (!silent) setLoading(false); }
  }, []);
  const open = useCallback(async (id: string, silent = false) => {
    selectedId.current = id;
    try { const detail = await marketIntelligenceApi.get(id); if (selectedId.current === id) setSelected(detail); }
    catch { if (!silent) toast.error("Không thể tải chi tiết dự án."); }
  }, []);
  const refresh = useCallback(async () => { setRefreshing(true); await Promise.all([load(true), selectedId.current ? open(selectedId.current, true) : Promise.resolve()]); setRefreshing(false); }, [load, open]);
  const manageJob = async (action: "cancel" | "retry") => {
    if (!selected) return; setRefreshing(true);
    try { if (action === "cancel") { await marketIntelligenceApi.cancel(selected.id); toast.success("Đã hủy nghiên cứu."); await load(true); await open(selected.id, true); } else { const project = await marketIntelligenceApi.retry(selected.id); toast.success("Đã tạo lần nghiên cứu mới."); await load(true); await open(project.id, true); } }
    catch (error) { toast.error(error instanceof Error ? error.message : "Không thể cập nhật nghiên cứu."); }
    finally { setRefreshing(false); }
  };

  useEffect(() => { void load(); void workforceApi.listAgents().then(setAgents).catch(() => toast.error("Không thể tải danh sách nhân viên.")); }, [load]);
  const selectedTaskStatus = selected?.task?.status ?? selected?.status;
  useEffect(() => {
    if (!selectedTaskStatus || terminalStatuses.has(selectedTaskStatus)) return;
    const id = window.setInterval(() => { if (selectedId.current) void Promise.all([load(true), open(selectedId.current, true)]); }, 3_000);
    return () => window.clearInterval(id);
  }, [selectedTaskStatus, load, open]);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!form.researchAgentId) return toast.error("Hãy chọn nhân viên Research Agent."); setSaving(true);
    try { const maxSources = Number(form.maxSources); if (!Number.isInteger(maxSources) || maxSources < 1 || maxSources > 20) return toast.error("Số nguồn tối đa phải từ 1 đến 20."); const project = await marketIntelligenceApi.create({ ...form, maxSources, keywords: form.keywords.split(",").map((item) => item.trim()).filter(Boolean), sourceUrls: form.sourceUrls.split("\n").map((item) => item.trim()).filter(Boolean) }); toast.success("Đã tạo dự án và giao nghiên cứu."); setForm({ title: "", industry: "", market: "", targetAudience: "", objective: "", maxSources: "8", researchProvider: "searxng", researchAgentId: "", keywords: "", sourceUrls: "" }); await load(true); await open(project.id); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Không thể tạo dự án."); }
    finally { setSaving(false); }
  };
  const activeStatus = selectedTaskStatus;
  const visibleSources = (selected?.sources ?? []).filter((source) => {
    const needle = sourceQuery.trim().toLocaleLowerCase("vi-VN");
    const matchesText = !needle || `${source.title} ${source.domain} ${source.excerpt ?? ""}`.toLocaleLowerCase("vi-VN").includes(needle);
    return matchesText && (sourceStatus === "all" || source.extractionStatus === sourceStatus);
  });
  return <div className="w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm text-muted-foreground">Bộ phận Tình báo thị trường</p><h1 className="text-2xl font-semibold">Tình báo thị trường</h1><p className="mt-1 text-sm text-muted-foreground">Thu thập nguồn công khai có thể kiểm chứng và tổng hợp bằng chứng cho doanh nghiệp.</p></div><Button variant="outline" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? "Đang làm mới…" : "Làm mới"}</Button></header>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[["Tổng nhiệm vụ", items.length], ["Đang chạy", items.filter((item) => !terminalStatuses.has(item.taskStatus)).length], ["Hoàn thành", items.filter((item) => item.taskStatus === "completed").length], ["Thất bại", items.filter((item) => item.taskStatus === "failed").length]].map(([label, value]) => <Card key={String(label)}><CardContent className="p-4"><p className="text-2xl font-semibold">{value}</p><p className="text-sm text-muted-foreground">{label}</p></CardContent></Card>)}</div>
    <div className="grid gap-6 lg:grid-cols-[minmax(320px,.8fr)_minmax(420px,1.2fr)]">
      <Card><CardHeader><CardTitle>Dự án nghiên cứu mới</CardTitle><CardDescription>Ưu tiên SearXNG/Trafilatura; Facebook chỉ được ghi nhận khi có phương thức truy cập chính thức hợp lệ.</CardDescription></CardHeader><CardContent><form onSubmit={submit} className="space-y-3"><Input placeholder="Chủ đề nghiên cứu" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required /><div className="grid gap-3 sm:grid-cols-2"><Input placeholder="Ngành hàng" value={form.industry} onChange={(event) => setForm({ ...form, industry: event.target.value })} required /><Input placeholder="Thị trường / khu vực" value={form.market} onChange={(event) => setForm({ ...form, market: event.target.value })} required /></div><Input placeholder="Đối tượng khách hàng (tuỳ chọn)" value={form.targetAudience} onChange={(event) => setForm({ ...form, targetAudience: event.target.value })} /><Textarea rows={4} placeholder="Mục tiêu nghiên cứu" value={form.objective} onChange={(event) => setForm({ ...form, objective: event.target.value })} required /><div className="grid gap-3 sm:grid-cols-2"><Input placeholder="Từ khóa, ngăn cách dấu phẩy" value={form.keywords} onChange={(event) => setForm({ ...form, keywords: event.target.value })} /><Input type="number" min="1" max="20" aria-label="Số nguồn tối đa" value={form.maxSources} onChange={(event) => setForm({ ...form, maxSources: event.target.value })} /></div><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.researchProvider} onChange={(event) => setForm({ ...form, researchProvider: event.target.value as "searxng" | "tavily" })} aria-label="Nguồn nghiên cứu"><option value="searxng">SearXNG (miễn phí, mặc định)</option><option value="tavily">Tavily (dùng kết nối đã cấu hình)</option></select>{form.researchProvider === "tavily" && <p className="text-xs text-muted-foreground">Tavily chỉ chạy khi Organization đã cấu hình kết nối hợp lệ; có thể tiêu thụ quota của bạn.</p>}<select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.researchAgentId} onChange={(event) => setForm({ ...form, researchAgentId: event.target.value })}><option value="">Chọn Research Agent</option>{agents.filter((agent) => agent.status === "active" && agent.toolConfig.enabledTools.includes("web_research")).map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.role}</option>)}</select><Textarea rows={3} placeholder="URL nguồn cụ thể, mỗi dòng một URL (tuỳ chọn)" value={form.sourceUrls} onChange={(event) => setForm({ ...form, sourceUrls: event.target.value })} /><Button className="w-full" disabled={saving}>{saving ? "Đang giao nghiên cứu…" : "Bắt đầu nghiên cứu"}</Button></form></CardContent></Card>
      <Card><CardHeader><CardTitle>Dự án gần đây</CardTitle><CardDescription>Bấm vào một dự án để xem timeline, kết quả và lỗi từng bước.</CardDescription></CardHeader><CardContent className="space-y-3">{loading ? <p className="text-sm text-muted-foreground">Đang tải…</p> : items.length ? items.map(({ project, taskStatus, taskError }) => <button type="button" onClick={() => void open(project.id)} key={project.id} className="w-full rounded-md border p-3 text-left hover:bg-muted/50"><div className="flex justify-between gap-3"><b className="truncate">{project.title}</b><Badge variant={statusVariant(taskStatus)}>{statusLabel[taskStatus] ?? taskStatus}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{project.industry} · {project.market}</p>{!terminalStatuses.has(taskStatus) && <div className="mt-2 space-y-1 text-xs text-muted-foreground"><p>{project.progressPercent}% · {project.completedSteps}/{project.totalSteps} bước · {project.currentStep ? `Đang: ${stepLabel[project.currentStep] ?? project.currentStep}` : "Đang chờ Worker"}</p><p>{project.lastHeartbeatAt ? `Worker cập nhật: ${formatTime(project.lastHeartbeatAt)}` : "Chưa có tín hiệu từ Worker"}</p></div>}{taskError && <p className="mt-1 text-xs text-destructive">{taskError}</p>}</button>) : <p className="text-sm text-muted-foreground">Chưa có dự án nghiên cứu nào.</p>}</CardContent></Card>
    </div>
    {selected && <Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle>{selected.title}</CardTitle><CardDescription>{statusLabel[activeStatus ?? ""] ?? activeStatus}</CardDescription></div><div className="flex items-center gap-2"><Badge variant={statusVariant(activeStatus ?? "queued")}>{statusLabel[activeStatus ?? ""] ?? activeStatus}</Badge>{(activeStatus === "queued" || activeStatus === "running") && <Button variant="outline" size="sm" disabled={refreshing} onClick={() => void manageJob("cancel")}>Hủy</Button>}{activeStatus === "failed" && <Button size="sm" disabled={refreshing} onClick={() => void manageJob("retry")}>Thử lại</Button>}</div></div></CardHeader><CardContent className="space-y-6">
      <section className="space-y-2 rounded-md border p-4"><div className="flex justify-between text-sm"><span className="font-medium">Tiến độ thực tế</span><span>{selected.progressPercent}%</span></div><Progress value={selected.progressPercent} /><p className="text-sm text-muted-foreground">{selected.currentStep ? `Đang ở bước: ${stepLabel[selected.currentStep] ?? selected.currentStep}` : "Đang chờ Worker claim nhiệm vụ."} · Hoàn thành {selected.completedSteps}/{selected.totalSteps} bước</p>{selected.lastHeartbeatAt && !terminalStatuses.has(activeStatus ?? "") && <p className="text-xs text-muted-foreground">Cập nhật Worker gần nhất: {formatTime(selected.lastHeartbeatAt)} · Lần thử {selected.attemptCount}/{selected.maxAttempts}</p>}</section>
      {(selected.task?.error || selected.lastError) && <p className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{selected.task?.error ?? selected.lastError}</p>}
      <section><h2 className="mb-3 font-medium">Các bước thực hiện</h2><ol className="space-y-3 border-l pl-4">{selected.steps.map((step) => <li key={step.id} className="relative"><span className="absolute -left-[22px] top-1.5 h-3 w-3 rounded-full border bg-background" /><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{step.sequence}. {step.title}</p><Badge variant={statusVariant(step.status)}>{statusLabel[step.status] ?? step.status}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{step.agentName ? `Thực hiện bởi ${step.agentName}` : "Worker hệ thống"} · {duration(step.startedAt, step.completedAt)}{step.resultCount !== null ? ` · ${step.resultCount} kết quả` : ""}</p>{step.safeError && <p className="mt-1 text-sm text-destructive">{step.safeError}</p>}</li>)}</ol></section>
      {selected.report ? <section className="space-y-3"><h2 className="font-medium">Báo cáo nghiên cứu</h2><MarkdownReport content={selected.report.content} sources={selected.sources.map((source, index) => ({ ...source, ordinal: index + 1, citationNumber: index + 1, status: "retrieved", canonicalUrl: source.displayUrl, retrievedAt: null }))} /></section> : <p className="text-sm text-muted-foreground">Báo cáo sẽ xuất hiện sau khi bước “Tạo và lưu báo cáo” hoàn tất.</p>}
      <section className="space-y-3"><div><h2 className="font-medium">Evidence Explorer</h2><p className="text-sm text-muted-foreground">Nguồn, trạng thái trích xuất và nội dung bằng chứng đã lưu.</p></div>{selected.sources.length ? <><div className="grid gap-2 sm:grid-cols-[1fr_180px]"><Input value={sourceQuery} onChange={(event) => setSourceQuery(event.target.value)} placeholder="Tìm theo tiêu đề, domain hoặc nội dung…" aria-label="Tìm nguồn bằng chứng" /><select className="h-10 min-w-0 rounded-md border bg-background px-3 text-sm" value={sourceStatus} onChange={(event) => setSourceStatus(event.target.value)} aria-label="Lọc trạng thái trích xuất"><option value="all">Tất cả trạng thái</option><option value="retrieved">Đã trích xuất</option><option value="blocked">Đã chặn</option><option value="failed">Trích xuất lỗi</option></select></div><p className="text-xs text-muted-foreground">Hiển thị {visibleSources.length}/{selected.sources.length} nguồn.</p>{visibleSources.length ? visibleSources.map((source) => <details key={source.id} className="rounded-md border p-3"><summary className="cursor-pointer list-none"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{source.title}</span><Badge variant={source.extractionStatus === "retrieved" ? "default" : source.extractionStatus === "failed" ? "destructive" : "outline"}>{source.extractionStatus === "retrieved" ? "Đã trích xuất" : source.extractionStatus === "blocked" ? "Đã chặn" : "Trích xuất lỗi"}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{source.domain} · {formatTime(source.retrievedAt)}</p></summary><div className="mt-3 space-y-2 border-t pt-3 text-sm"><a className="text-primary underline" href={source.displayUrl} target="_blank" rel="noreferrer">Mở URL gốc</a>{source.excerpt && <p className="text-muted-foreground">{source.excerpt}</p>}{source.extractionError && <p className="text-destructive">{source.extractionError}</p>}{source.extractedContent && <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs">{source.extractedContent}</pre>}</div></details>) : <p className="text-sm text-muted-foreground">Không có nguồn nào khớp bộ lọc.</p>}</> : <p className="text-sm text-muted-foreground">Chưa có nguồn nào được lưu.</p>}</section>
      {selected.configuredSources.filter((source) => source.kind === "facebook").map((source) => <p key={source.id} className="text-sm text-muted-foreground">Facebook: {source.url} — {source.status === "permission_required" ? "Cần quyền Graph API hợp lệ; chưa thu thập dữ liệu." : source.status}</p>)}
    </CardContent></Card>}
  </div>;
}
