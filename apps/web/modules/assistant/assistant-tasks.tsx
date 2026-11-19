"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ClipboardList, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { Textarea } from "@workspace/ui/components/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import {
  assistantTasksApi,
  type AssistantTask,
  type AssistantTaskDetail,
  type AssistantTaskInput,
} from "@/lib/assistant-tasks-api";
import { workforceApi, type AiAgent } from "@/lib/workforce-api";
import { MarkdownReport } from "@/modules/tasks/markdown-report";

export const taskLabels = {
  queued: "Đang chờ xử lý",
  running: "Đang thực hiện",
  completed: "Hoàn thành",
  failed: "Thất bại",
  cancelled: "Đã hủy",
};
const pending = (status: string) => status === "queued" || status === "running";
const message = (e: unknown) =>
  e instanceof Error ? e.message : "Không thể tải nhiệm vụ. Hãy thử làm mới.";
const date = (v: string | null) =>
  v ? new Date(v).toLocaleString("vi-VN") : "Chưa có";

export function AssistantRecentTasks({
  revision,
  onOpen,
}: {
  revision: number;
  onOpen: (id: string) => void;
}) {
  const [tasks, setTasks] = useState<AssistantTask[]>([]);
  const [error, setError] = useState("");
  const [refreshRevision, setRefreshRevision] = useState(0);
  const active = tasks.some((task) => pending(task.status));
  useEffect(() => {
    let alive = true;
    const load = () =>
      void assistantTasksApi
        .list()
        .then((items) => {
          if (alive) {
            setTasks(items);
            setError("");
          }
        })
        .catch((e: unknown) => {
          if (alive) setError(message(e));
        });
    load();
    const timer = active ? window.setInterval(load, 4000) : undefined;
    return () => {
      alive = false;
      if (timer) window.clearInterval(timer);
    };
  }, [revision, active, refreshRevision]);
  return (
    <section className="max-h-64 overflow-y-auto border-t p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-xs font-medium text-muted-foreground">
          Nhiệm vụ gần đây
        </h2>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          aria-label="Làm mới nhiệm vụ gần đây"
          onClick={() => setRefreshRevision((value) => value + 1)}
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">{error}</p>
      ) : !tasks.length ? (
        <p className="text-xs text-muted-foreground">
          Chưa giao nhiệm vụ từ Assistant.
        </p>
      ) : (
        tasks.slice(0, 12).map((task) => (
          <button
            key={task.id}
            type="button"
            onClick={() => onOpen(task.id)}
            className="block w-full rounded-lg p-2 text-left hover:bg-muted"
          >
            <span className="block truncate text-sm">{task.title}</span>
            <span className="text-xs text-muted-foreground">
              {taskLabels[task.status]}
            </span>
          </button>
        ))
      )}
    </section>
  );
}

export function AssistantTaskWorkspace({
  conversationId,
  ensureConversation,
  onCreated,
  onOpen,
  onBusyChange,
}: {
  conversationId?: string;
  ensureConversation: () => Promise<string>;
  onCreated: () => void;
  onOpen: (id: string) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [agents, setAgents] = useState<AiAgent[]>([]);
  const [agentId, setAgentId] = useState("");
  const [draft, setDraft] = useState("");
  const [tasks, setTasks] = useState<AssistantTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  // Keep request identity after a lost HTTP response; an explicit edit starts a new request.
  const request = useRef<{
    conversationId: string;
    input: AssistantTaskInput;
  } | null>(null);
  const active = tasks.some((task) => pending(task.status));
  const refresh = useCallback(async () => {
    if (!conversationId) {
      setTasks([]);
      return;
    }
    setTasks(await assistantTasksApi.list(conversationId));
  }, [conversationId]);
  useEffect(() => {
    let alive = true;
    void workforceApi
      .listAgents()
      .then((items) => {
        if (alive)
          setAgents(
            items.filter(
              (agent) =>
                agent.status === "active" &&
                agent.connectionId &&
                agent.modelId,
            ),
          );
      })
      .catch((e: unknown) => {
        if (alive) setError(message(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void (
        conversationId
          ? assistantTasksApi.list(conversationId)
          : Promise.resolve([])
      )
        .then((items) => {
          if (alive) setTasks(items);
        })
        .catch((e: unknown) => {
          if (alive) setError(message(e));
        });
    load();
    const timer = active ? window.setInterval(load, 4000) : undefined;
    return () => {
      alive = false;
      if (timer) window.clearInterval(timer);
    };
  }, [conversationId, active]);
  const submit = async () => {
    if (lock.current || !draft.trim() || !agentId) return;
    lock.current = true;
    setBusy(true);
    onBusyChange(true);
    setError("");
    try {
      const id =
        conversationId ??
        request.current?.conversationId ??
        (await ensureConversation());
      const existing = request.current;
      const input =
        existing?.conversationId === id &&
        existing.input.description === draft.trim() &&
        existing.input.agentId === agentId
          ? existing.input
          : {
              requestId: crypto.randomUUID(),
              title: draft.trim().slice(0, 160),
              description: draft.trim(),
              agentId,
            };
      request.current = { conversationId: id, input };
      const result = await assistantTasksApi.create(id, input);
      // A successful create must remain successful even if refreshing the
      // conversation task list fails (e.g. a temporary network outage).
      setDraft("");
      request.current = null;
      onCreated();
      onOpen(result.taskId);
      try {
        setTasks(await assistantTasksApi.list(id));
      } catch (refreshError) {
        // The task is already persisted; avoid suggesting that submission
        // failed, which could lead to duplicate tasks on another attempt.
        setError(
          `Đã giao nhiệm vụ thành công nhưng chưa tải lại được danh sách: ${message(refreshError)}`,
        );
      }
    } catch (e) {
      setError(message(e));
    } finally {
      lock.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  };
  return (
    <div className="flex min-h-96 min-w-0 flex-1 flex-col gap-6 overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div>
          <h2 className="font-semibold">Giao việc cho nhân viên AI</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Nhiệm vụ chạy nền và được lưu cùng hội thoại. Nhân viên tự quyết
            định nghiên cứu Internet theo quyền và công cụ đã được cấp.
          </p>
        </div>
        <label className="block text-sm">
          Nhân viên phụ trách
          <select
            aria-label="Nhân viên phụ trách"
            value={agentId}
            disabled={loading || busy}
            onChange={(e) => {
              setAgentId(e.target.value);
              request.current = null;
            }}
            className="mt-2 h-10 w-full min-w-0 rounded-md border bg-background px-3"
          >
            <option value="">Chọn nhân viên đang hoạt động</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name} · {agent.role}
              </option>
            ))}
          </select>
        </label>
        {!loading && !agents.length && (
          <p className="text-sm text-muted-foreground">
            Chưa có nhân viên hoạt động với cấu hình AI hợp lệ.{" "}
            <Link href="/workforce?tab=agents" className="underline">
              Cấu hình nhân viên AI
            </Link>
          </p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="space-y-3"
        >
          <label className="block text-sm">
            Yêu cầu công việc
            <Textarea
              className="mt-2 min-h-28"
              value={draft}
              maxLength={12000}
              disabled={busy}
              onChange={(e) => {
                setDraft(e.target.value);
                request.current = null;
              }}
              placeholder="Ví dụ: Nghiên cứu cơ hội kinh doanh AI chatbot cho doanh nghiệp nhỏ tại Việt Nam, kèm nguồn tham khảo."
            />
          </label>
          {error && (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 p-3 text-sm text-destructive"
            >
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Dùng mô hình đã cấu hình cho nhân viên, không dùng mô hình chat
              bên trên.
            </p>
            <Button disabled={busy || loading || !agentId || !draft.trim()}>
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ClipboardList className="size-4" />
              )}
              Giao nhiệm vụ
            </Button>
          </div>
        </form>
        <div className="flex items-center justify-between border-t pt-5">
          <h3 className="text-sm font-medium">Nhiệm vụ trong hội thoại</h3>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void refresh().catch((e: unknown) => setError(message(e)))
            }
          >
            <RefreshCw className="size-3" />
            Làm mới
          </Button>
        </div>
        {!tasks.length && (
          <p className="text-sm text-muted-foreground">
            Chưa có nhiệm vụ. Chat thông thường không tự tạo nhiệm vụ nền.
          </p>
        )}
        {tasks.map((task) => (
          <button
            key={task.id}
            onClick={() => onOpen(task.id)}
            className="block w-full min-w-0 space-y-3 rounded-xl border p-4 text-left hover:bg-muted/30"
          >
            <div className="flex flex-wrap justify-between gap-2">
              <h3 className="min-w-0 break-words font-medium">{task.title}</h3>
              <span className="text-xs">
                {pending(task.status) && (
                  <Loader2 className="mr-1 inline size-3 animate-spin" />
                )}
                {taskLabels[task.status]}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              {task.agentName} · {date(task.createdAt)}
            </p>
            {task.error && (
              <p className="text-sm text-destructive">{task.error}</p>
            )}
            <span className="inline-flex items-center gap-2 text-sm underline">
              Xem tiến độ và kết quả <ArrowRight className="size-3" />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function AssistantTaskDialog({
  id,
  onClose,
  onChanged,
}: {
  id: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [task, setTask] = useState<AssistantTaskDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const status = task?.status;
  const load = useCallback(async () => {
    if (id) {
      setTask(await assistantTasksApi.get(id));
      setError("");
    }
  }, [id]);
  useEffect(() => {
    setTask(null);
    setError("");
  }, [id]);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    const fetchTask = () =>
      void assistantTasksApi
        .get(id)
        .then((saved) => {
          if (alive) {
            setTask(saved);
            setError("");
          }
        })
        .catch((e: unknown) => {
          if (alive) setError(message(e));
        });
    fetchTask();
    const timer =
      !status || pending(status)
        ? window.setInterval(fetchTask, 4000)
        : undefined;
    return () => {
      alive = false;
      if (timer) window.clearInterval(timer);
    };
  }, [id, status]);
  const resume = async () => {
    if (!id || busy) return;
    setBusy(true);
    setError("");
    try {
      await assistantTasksApi.resumeResearch(id);
      await load();
      onChanged();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    if (!id || busy) return;
    setBusy(true);
    try {
      await assistantTasksApi.cancel(id);
      await load();
      onChanged();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={Boolean(id)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="break-words">
            {task?.title ?? "Chi tiết nhiệm vụ"}
          </DialogTitle>
          <DialogDescription>
            Trạng thái và dữ liệu thực tế từ hệ thống. Tự cập nhật mỗi 4 giây
            khi đang xử lý.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {!task ? (
          !error && <Loader2 className="size-5 animate-spin" />
        ) : (
          <div className="min-w-0 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm">
                {task.agentName} · <strong>{taskLabels[task.status]}</strong>
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void load().catch((e: unknown) => setError(message(e)))
                }
              >
                <RefreshCw className="size-3" />
                Làm mới
              </Button>
            </div>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {task.description}
            </p>
            <p className="text-xs text-muted-foreground">
              Tạo: {date(task.createdAt)} · Bắt đầu: {date(task.startedAt)} ·
              Kết thúc: {date(task.completedAt)}
            </p>
            {pending(task.status) && (
              <p role="status" className="rounded-lg border p-3 text-sm">
                <Loader2 className="mr-2 inline size-4 animate-spin" />
                {task.events.at(-1)?.message ?? taskLabels[task.status]}
              </p>
            )}
            {task.error && (
              <div
                role="alert"
                className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive"
              >
                {task.error}
                <p className="mt-2 text-muted-foreground">
                  Nếu hết quota, hãy chờ hạn mức được khôi phục và kiểm tra cấu
                  hình AI. Không gửi lại liên tục.
                </p>
              </div>
            )}
            {task.result && (
              <section className="min-w-0 overflow-hidden">
                <h3 className="mb-3 font-semibold">
                  {task.status === "completed"
                    ? "Kết quả"
                    : "Nội dung đã lưu (chưa hoàn tất)"}
                </h3>
                <MarkdownReport
                  content={task.result}
                  sources={task.researchSources}
                />
              </section>
            )}
            {task.researchSources.length > 0 && (
              <section>
                <h3 className="mb-3 font-semibold">Nguồn tham khảo</h3>
                <ol className="space-y-2">
                  {task.researchSources.map((source) => (
                    <li key={source.id}>
                      <a
                        href={
                          /^https?:\/\//i.test(source.displayUrl)
                            ? source.displayUrl
                            : undefined
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-words text-sm underline"
                      >
                        [{source.citationNumber ?? source.ordinal}]{" "}
                        {source.title}
                      </a>
                    </li>
                  ))}
                </ol>
              </section>
            )}
            <section>
              <h3 className="mb-3 font-semibold">Lịch sử thực hiện</h3>
              <ol className="space-y-3 border-l pl-4">
                {task.events.map((event) => (
                  <li key={event.id}>
                    <p className="text-sm">{event.message}</p>
                    <time className="text-xs text-muted-foreground">
                      {date(event.createdAt)}
                    </time>
                  </li>
                ))}
              </ol>
            </section>
            <div className="flex flex-wrap justify-between gap-3">
              {task.status === "failed" && task.webResearchEnabled && (
                <Button variant="outline" disabled={busy} onClick={() => void resume()}>
                  {busy ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                  Tiếp tục nghiên cứu
                </Button>
              )}
              {pending(task.status) && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void cancel()}
                >
                  {busy && <Loader2 className="size-3 animate-spin" />}Hủy nhiệm
                  vụ
                </Button>
              )}
              <Link href={`/tasks/${task.id}`} className="text-sm underline">
                Mở trang công việc
              </Link>
            </div>
            <p className="break-all text-xs text-muted-foreground">
              Mã nhiệm vụ: {task.id}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
