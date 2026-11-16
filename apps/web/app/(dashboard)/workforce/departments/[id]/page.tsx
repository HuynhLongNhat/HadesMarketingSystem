"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { ChevronRight, CircleCheck, CircleX, Clock3, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@workspace/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Input } from "@workspace/ui/components/input";
import { Textarea } from "@workspace/ui/components/textarea";
import { MarkdownReport } from "@/modules/tasks/markdown-report";
import { workforceApi, type AiAgent, type Department } from "@/lib/workforce-api";

type Run = Awaited<ReturnType<typeof workforceApi.getDepartmentRun>>;
type Detail = Department & {
  members: AiAgent[];
  runs: Array<{ id: string; title: string; status: string; updatedAt: string }>;
};

const terminalStatuses = new Set(["completed", "failed", "cancelled"]);
const statusLabels: Record<string, string> = {
  queued: "Chờ xử lý", running: "Đang thực hiện", completed: "Hoàn thành", failed: "Thất bại", cancelled: "Đã hủy",
};

function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(value))
    : "—";
}

function durationSince(value: string | null) {
  if (!value) return null;
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1_000));
  return seconds < 60 ? `${seconds} giây` : `${Math.floor(seconds / 60)} phút`;
}

function stepProgress(step: Run["steps"][number]) {
  if (step.status === "running") return `AI đang xử lý · ${durationSince(step.startedAt) ?? "vừa bắt đầu"}`;
  if (step.status === "queued" && step.lastEvent?.type === "retrying") return "Đang chờ thử lại sau lỗi Provider/quota.";
  if (step.status === "queued") return step.sequence === 1 ? "Đang chờ Worker nhận việc." : "Đang chờ bước trước hoàn thành.";
  return step.lastEvent?.message ?? null;
}

export default function DepartmentWorkspacePage() {
  const params = useParams<{ id: string }>();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [title, setTitle] = useState("");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [savingLead, setSavingLead] = useState(false);

  const load = useCallback(async () => {
    try { setDetail(await workforceApi.getDepartment(params.id)); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Không thể tải phòng ban."); }
    finally { setLoading(false); }
  }, [params.id]);

  const openRun = useCallback(async (runId: string) => {
    try { setSelectedRun(await workforceApi.getDepartmentRun(params.id, runId)); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Không thể tải workflow."); }
  }, [params.id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!selectedRun || terminalStatuses.has(selectedRun.status)) return;
    const timer = setInterval(() => { void openRun(selectedRun.id); void load(); }, 4_000);
    return () => clearInterval(timer);
  }, [selectedRun, openRun, load]);

  const activeMembers = useMemo(() => detail?.members.filter((agent) => agent.status === "active") ?? [], [detail]);

  async function changeLead(leadAgentId: string) {
    if (!detail || !leadAgentId || leadAgentId === detail.leadAgentId) return;
    setSavingLead(true);
    try {
      const updated = await workforceApi.updateDepartment(detail.id, { leadAgentId });
      setDetail((current) => current ? { ...current, leadAgentId: updated.leadAgentId } : current);
      toast.success("Đã cập nhật Trưởng phòng.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể cập nhật Trưởng phòng.");
    } finally { setSavingLead(false); }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || !input.trim()) { toast.error("Hãy nhập tên và yêu cầu nhiệm vụ."); return; }
    setCreating(true);
    try {
      const created = await workforceApi.createDepartmentRun(params.id, { title, input });
      toast.success("Đã giao nhiệm vụ cho phòng ban.");
      setTitle(""); setInput("");
      await load(); await openRun(created.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể giao nhiệm vụ.");
    } finally { setCreating(false); }
  }

  if (loading) return <div className="p-8 text-sm text-muted-foreground">Đang tải…</div>;
  if (!detail) return null;

  return <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
    <header><p className="text-sm text-muted-foreground">Không gian phòng ban</p><h1 className="text-2xl font-semibold">{detail.name}</h1></header>
    <div className="grid gap-6 lg:grid-cols-2">
      <Card><CardHeader><CardTitle>Giao nhiệm vụ cho phòng ban</CardTitle></CardHeader><CardContent><form onSubmit={submit} className="space-y-3">
        <Input placeholder="Tên nhiệm vụ" value={title} onChange={(event) => setTitle(event.target.value)} />
        <Textarea rows={7} placeholder="Yêu cầu, bối cảnh và đầu ra mong muốn" value={input} onChange={(event) => setInput(event.target.value)} />
        <Button disabled={creating}>{creating && <Loader2 className="size-4 animate-spin" />}{creating ? "Đang tạo workflow…" : "Bắt đầu workflow"}</Button>
      </form></CardContent></Card>
      <Card><CardHeader><CardTitle>Nhân sự & Trưởng phòng</CardTitle></CardHeader><CardContent className="space-y-4">
        <div className="space-y-2"><label htmlFor="department-lead" className="text-sm font-medium">Trưởng phòng</label>
          <select id="department-lead" value={detail.leadAgentId ?? ""} disabled={savingLead || activeMembers.length === 0} onChange={(event) => void changeLead(event.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50">
            <option value="" disabled>{activeMembers.length ? "Chọn Trưởng phòng" : "Chưa có nhân sự đang hoạt động"}</option>
            {activeMembers.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} — {agent.role}</option>)}
          </select>
          <p className="text-xs text-muted-foreground">Trưởng phòng điều phối workflow và tổng hợp kết quả.</p>
        </div>
        <div className="space-y-2">{detail.members.map((agent) => <div className="flex items-center justify-between gap-3 rounded border p-3" key={agent.id}>
          <span className="min-w-0"><span className="font-medium">{agent.name}</span><small className="ml-2 text-muted-foreground">{agent.role}</small>{agent.id === detail.leadAgentId && <small className="ml-2 rounded border px-1.5 py-0.5 text-xs">Trưởng phòng</small>}</span>
          <span className="shrink-0 text-sm text-muted-foreground">{agent.status}</span>
        </div>)}</div>
      </CardContent></Card>
    </div>
    <Card><CardHeader><CardTitle>Lịch sử thực thi</CardTitle></CardHeader><CardContent className="space-y-2">{detail.runs.length ? detail.runs.map((run) => <button key={run.id} type="button" onClick={() => void openRun(run.id)} className="flex w-full items-center justify-between rounded border p-3 text-left hover:bg-muted/40"><span>{run.title}<small className="ml-2 text-muted-foreground">{formatDate(run.updatedAt)}</small></span><span className="flex items-center gap-2 text-sm">{statusLabels[run.status] ?? run.status}<ChevronRight className="size-4" /></span></button>) : <p className="text-sm text-muted-foreground">Chưa có nhiệm vụ.</p>}</CardContent></Card>
    {selectedRun && <Card><CardHeader><CardTitle>{selectedRun.title}</CardTitle><p className="text-sm text-muted-foreground">{statusLabels[selectedRun.status] ?? selectedRun.status}</p></CardHeader><CardContent className="space-y-4">{selectedRun.steps.map((step) => <div className="rounded-lg border p-4" key={step.id}><div className="flex justify-between gap-3"><div><b>Bước {step.sequence}: {step.role}</b><p className="text-sm text-muted-foreground">{step.agentName ?? "Chưa gán Agent"}</p></div><span className="flex items-center gap-1 text-sm">{step.status === "completed" ? <CircleCheck className="size-4" /> : step.status === "failed" ? <CircleX className="size-4 text-destructive" /> : <Clock3 className="size-4" />}{statusLabels[step.status]}</span></div><p className="mt-2 text-xs text-muted-foreground">Bắt đầu: {formatDate(step.startedAt)} · Kết thúc: {formatDate(step.taskCompletedAt)}</p>{stepProgress(step) && <p className="mt-2 text-sm text-muted-foreground">{stepProgress(step)}</p>}{step.attemptCount > 1 && <p className="mt-1 text-xs text-muted-foreground">Lần thực thi: {step.attemptCount}</p>}{step.error && <p className="mt-3 rounded border border-destructive/40 p-3 text-sm text-destructive">{step.error}</p>}{step.output && <details className="mt-3"><summary className="cursor-pointer text-sm font-medium">Xem kết quả bước</summary><article className="mt-3"><MarkdownReport content={step.output} sources={[]} /></article></details>}</div>)}{selectedRun.finalReport && <section className="border-t pt-5"><h2 className="text-lg font-semibold">Báo cáo cuối cùng</h2><article className="mt-3"><MarkdownReport content={selectedRun.finalReport} sources={[]} /></article></section>}</CardContent></Card>}
  </div>;
}
