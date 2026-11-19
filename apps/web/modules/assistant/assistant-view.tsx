"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowUp,
  Bot,
  History,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Textarea } from "@workspace/ui/components/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { authClient } from "@/lib/auth-client";
import {
  assistantApi,
  streamAssistant,
  type AssistantConversation,
  type AssistantDetail,
  type AssistantInput,
  type AssistantOption,
  type AssistantTurn,
} from "@/lib/assistant-api";
import { AssistantMessage } from "./assistant-message";
import {
  AssistantRecentTasks,
  AssistantTaskDialog,
  AssistantTaskWorkspace,
} from "./assistant-tasks";

export function AssistantView() {
  const { data: organization, isPending } = authClient.useActiveOrganization();
  if (isPending || !organization)
    return (
      <div className="p-6 text-muted-foreground">
        Đang tải không gian trợ lý…
      </div>
    );
  return <AssistantWorkspace key={organization.id} />;
}

function AssistantWorkspace() {
  const search = useSearchParams();
  const initialId = useRef(search.get("chat"));
  const [conversations, setConversations] = useState<AssistantConversation[]>(
    [],
  );
  const [detail, setDetail] = useState<AssistantDetail | null>(null);
  const [options, setOptions] = useState<AssistantOption[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const [modelId, setModelId] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [dialog, setDialog] = useState<"rename" | "delete" | null>(null);
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<"chat" | "task">("chat");
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [taskRevision, setTaskRevision] = useState(0);
  const [taskBusy, setTaskBusy] = useState(false);
  const active = useRef<{
    conversationId: string;
    input: AssistantInput;
    abort: AbortController;
  } | null>(null);
  const sendLock = useRef(false);
  const failedInput = useRef<{
    conversationId: string;
    input: AssistantInput;
  } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const selectedConnection = options.find(
    (option) => option.id === connectionId,
  );
  const runningTurn = detail?.turns.find((turn) => turn.status === "running");
  const currentConversationId = detail?.id;
  const runningTurnId = runningTurn?.id;
  const running = sending || Boolean(runningTurn);

  const showConversation = useCallback((conversation: AssistantDetail) => {
    setDetail(conversation);
    window.history.replaceState(
      null,
      "",
      `/assistant?chat=${encodeURIComponent(conversation.id)}`,
    );
  }, []);
  useEffect(() => {
    let alive = true;
    void Promise.all([assistantApi.list(), assistantApi.options()])
      .then(async ([list, settings]) => {
        if (!alive) return;
        setConversations(list);
        setOptions(settings);
        const available = settings.find((option) => option.models.length);
        if (available) {
          setConnectionId(available.id);
          setModelId(available.models[0]!);
        }
        if (initialId.current) {
          const saved = await assistantApi.get(initialId.current);
          if (alive) showConversation(saved);
        }
      })
      .catch((e: unknown) => {
        if (alive)
          setError(e instanceof Error ? e.message : "Không thể tải trợ lý.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      active.current?.abort.abort();
    };
  }, [showConversation]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [detail?.turns]);
  useEffect(() => {
    if (!currentConversationId || !runningTurnId || sending) return;
    const id = currentConversationId;
    const timer = window.setInterval(() => {
      void assistantApi
        .get(id)
        .then((saved) =>
          setDetail((current) => (current?.id === id ? saved : current)),
        )
        .catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [currentConversationId, runningTurnId, sending]);
  const refresh = async () => {
    setBusy(true);
    setError(null);
    try {
      setConversations(await assistantApi.list());
      if (detail) showConversation(await assistantApi.get(detail.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể tải lại.");
    } finally {
      setBusy(false);
    }
  };
  const newChat = async () => {
    if (running || busy || taskBusy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await assistantApi.create();
      setConversations((list) => [created, ...list]);
      showConversation({ ...created, turns: [] });
      setDraft("");
      failedInput.current = null;
      setHistoryOpen(false);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Không thể tạo cuộc trò chuyện.",
      );
    } finally {
      setBusy(false);
    }
  };
  const open = async (id: string) => {
    if (running || busy || taskBusy) return;
    setBusy(true);
    setError(null);
    try {
      showConversation(await assistantApi.get(id));
      failedInput.current = null;
      setHistoryOpen(false);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Không thể mở cuộc trò chuyện.",
      );
    } finally {
      setBusy(false);
    }
  };
  const send = async (retry?: AssistantTurn) => {
    if (
      sendLock.current ||
      active.current ||
      running ||
      (!retry && (!connectionId || !modelId || !draft.trim()))
    )
      return;
    sendLock.current = true;
    setSending(true);
    setError(null);
    let conversationId = detail?.id;
    let input: AssistantInput | undefined;
    try {
      if (!conversationId) {
        const created = await assistantApi.create();
        conversationId = created.id;
        setConversations((list) => [created, ...list]);
        showConversation({ ...created, turns: [] });
      }
      const uncertain =
        failedInput.current?.conversationId === conversationId &&
        failedInput.current.input.content === draft.trim()
          ? failedInput.current.input
          : null;
      input = retry
        ? {
            requestId: retry.requestId,
            content: retry.userContent,
            connectionId: retry.connectionId,
            modelId: retry.modelId,
            retry: true,
          }
        : uncertain
          ? { ...uncertain, retry: true }
          : {
              requestId: crypto.randomUUID(),
              content: draft.trim(),
              connectionId,
              modelId,
            };
      const abort = new AbortController();
      active.current = { conversationId, input, abort };
      let currentTurnId: string | null = null;
      await streamAssistant(conversationId, input, abort.signal, (event) => {
        if (event.type === "turn" || event.type === "done") {
          currentTurnId = event.turn.id;
          setDetail((current) =>
            current && current.id === conversationId
              ? {
                  ...current,
                  turns: [
                    ...current.turns.filter(
                      (turn) => turn.id !== event.turn.id,
                    ),
                    event.turn,
                  ].sort((a, b) => a.sequence - b.sequence),
                }
              : current,
          );
          setDraft("");
          if (event.type === "done" && event.turn.status === "failed")
            setError(event.turn.safeError);
        } else if (event.type === "delta") {
          setDetail((current) =>
            current && current.id === conversationId
              ? {
                  ...current,
                  turns: current.turns.map((turn) =>
                    turn.id === currentTurnId
                      ? {
                          ...turn,
                          assistantContent: turn.assistantContent + event.text,
                        }
                      : turn,
                  ),
                }
              : current,
          );
        }
      });
      failedInput.current = null;
    } catch (e) {
      if (e instanceof Error && e.name !== "AbortError") setError(e.message);
      if (conversationId && input)
        failedInput.current = { conversationId, input };
    } finally {
      if (conversationId)
        await assistantApi
          .get(conversationId)
          .then(showConversation)
          .catch(() => undefined);
      await assistantApi
        .list()
        .then(setConversations)
        .catch(() => undefined);
      active.current = null;
      sendLock.current = false;
      setSending(false);
      setStopping(false);
    }
  };
  const stop = async () => {
    const conversationId = active.current?.conversationId ?? detail?.id;
    const requestId = active.current?.input.requestId ?? runningTurn?.requestId;
    if (!conversationId || !requestId) return;
    setStopping(true);
    try {
      const saved = await assistantApi.cancel(conversationId, requestId);
      active.current?.abort.abort();
      showConversation(saved);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Không thể dừng phản hồi. Hãy thử lại.",
      );
    } finally {
      setStopping(false);
    }
  };
  const manage = async () => {
    if (!detail || busy || taskBusy) return;
    setBusy(true);
    try {
      if (dialog === "rename") {
        const saved = await assistantApi.rename(detail.id, title);
        setDetail({ ...detail, ...saved });
      } else {
        await assistantApi.remove(detail.id);
        setDetail(null);
        window.history.replaceState(null, "", "/assistant");
      }
      setConversations(await assistantApi.list());
      setDialog(null);
      toast.success(
        dialog === "rename"
          ? "Đã đổi tên cuộc trò chuyện."
          : "Đã xóa cuộc trò chuyện.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Không thể cập nhật.");
    } finally {
      setBusy(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void send();
  };
  const last = detail?.turns.at(-1);
  const ensureTaskConversation = async () => {
    if (detail) return detail.id;
    const created = await assistantApi.create();
    setConversations((list) => [created, ...list]);
    showConversation({ ...created, turns: [] });
    return created.id;
  };

  return (
    <div className="flex min-h-[calc(100dvh-4rem)] min-w-0 flex-col p-3 sm:p-5">
      <div className="flex min-h-[calc(100dvh-7rem)] min-w-0 flex-1 overflow-hidden rounded-2xl border bg-background">
        <aside
          className={`${historyOpen ? "flex" : "hidden"} w-64 shrink-0 flex-col border-r bg-muted/15 md:flex`}
        >
          <div className="flex items-center gap-2 border-b p-3">
            <Button
              className="flex-1"
              onClick={() => void newChat()}
              disabled={busy || running || taskBusy}
            >
              <Plus className="size-4" />
              Chat mới
            </Button>
            <Button
              className="md:hidden"
              size="icon"
              variant="ghost"
              aria-label="Đóng lịch sử"
              onClick={() => setHistoryOpen(false)}
            >
              <X className="size-4" />
            </Button>
          </div>
          <div className="flex items-center justify-between px-4 py-3 text-xs font-medium text-muted-foreground">
            <span>LỊCH SỬ CÁ NHÂN</span>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              onClick={() => void refresh()}
              disabled={busy || sending}
              aria-label="Làm mới lịch sử"
            >
              <RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} />
            </Button>
          </div>
          <nav
            aria-label="Lịch sử hội thoại"
            className="max-h-[65dvh] flex-1 space-y-1 overflow-y-auto px-2 pb-3"
          >
            {loading ? (
              <p className="p-3 text-sm text-muted-foreground">Đang tải…</p>
            ) : conversations.length ? (
              conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  disabled={busy || running || taskBusy}
                  onClick={() => void open(conversation.id)}
                  className={`flex w-full min-w-0 items-start gap-2 rounded-lg px-3 py-3 text-left text-sm hover:bg-muted disabled:opacity-50 ${detail?.id === conversation.id ? "bg-muted" : ""}`}
                >
                  <MessageSquare className="mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0">
                    <span className="block truncate">{conversation.title}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {new Date(conversation.updatedAt).toLocaleDateString(
                        "vi-VN",
                      )}
                    </span>
                  </span>
                </button>
              ))
            ) : (
              <p className="p-3 text-sm text-muted-foreground">
                Chưa có hội thoại. Bắt đầu bằng một câu hỏi.
              </p>
            )}
          </nav>
          <AssistantRecentTasks
            revision={taskRevision}
            onOpen={(id) => {
              setSelectedTask(id);
              setHistoryOpen(false);
            }}
          />
          <p className="border-t p-4 text-xs leading-5 text-muted-foreground">
            Hội thoại riêng của bạn trong tổ chức hiện tại.
          </p>
        </aside>
        <section
          className={`${historyOpen ? "hidden md:flex" : "flex"} min-w-0 flex-1 flex-col`}
        >
          <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <Button
                size="icon"
                variant="ghost"
                className="md:hidden"
                aria-label="Mở lịch sử"
                onClick={() => setHistoryOpen(true)}
              >
                <History className="size-4" />
              </Button>
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border">
                <Bot className="size-5" />
              </div>
              <div className="min-w-0">
                <h1 className="font-semibold">Nova Assistant</h1>
                <p className="max-w-64 truncate text-xs text-muted-foreground">
                  {detail?.title ?? "Trợ lý cá nhân · Không gian làm việc"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Cuộc trò chuyện mới"
                disabled={busy || running || taskBusy}
                onClick={() => void newChat()}
              >
                <Plus className="size-4" />
              </Button>
              {detail && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Đổi tên cuộc trò chuyện"
                    disabled={busy || running || taskBusy}
                    onClick={() => {
                      setTitle(detail.title);
                      setDialog("rename");
                    }}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Xóa cuộc trò chuyện"
                    disabled={busy || running || taskBusy}
                    onClick={() => setDialog("delete")}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </>
              )}
            </div>
            <div className="flex w-full gap-2" aria-label="Loại yêu cầu">
              <Button
                variant={mode === "chat" ? "default" : "outline"}
                disabled={running || taskBusy}
                onClick={() => setMode("chat")}
              >
                Trò chuyện
              </Button>
              <Button
                variant={mode === "task" ? "default" : "outline"}
                disabled={running || taskBusy}
                onClick={() => setMode("task")}
              >
                Giao nhiệm vụ
              </Button>
            </div>
            <div
              className={`${mode === "task" ? "hidden" : "grid"} w-full min-w-0 gap-2 sm:grid-cols-2`}
            >
              <label className="min-w-0 text-xs text-muted-foreground">
                Kết nối AI
                <select
                  aria-label="Kết nối AI"
                  className="mt-1 h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm text-foreground"
                  disabled={running || loading}
                  value={connectionId}
                  onChange={(event) => {
                    const option = options.find(
                      (item) => item.id === event.target.value,
                    );
                    setConnectionId(event.target.value);
                    setModelId(option?.models[0] ?? "");
                  }}
                >
                  <option value="">Chọn kết nối đã cấu hình</option>
                  {options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name} · {option.provider}
                    </option>
                  ))}
                </select>
              </label>
              <label className="min-w-0 text-xs text-muted-foreground">
                Mô hình AI
                <select
                  aria-label="Mô hình AI"
                  className="mt-1 h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm text-foreground"
                  disabled={running || !connectionId}
                  value={modelId}
                  onChange={(event) => setModelId(event.target.value)}
                >
                  <option value="">Chọn mô hình đã cấu hình</option>
                  {selectedConnection?.models.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p
              className={`${mode === "task" ? "hidden" : ""} text-xs text-muted-foreground`}
              role="status"
            >
              {running
                ? "Nova đang phản hồi…"
                : modelId
                  ? "Sẵn sàng gửi · Kết nối được kiểm tra khi gửi"
                  : "Chưa có mô hình khả dụng"}
            </p>
          </header>
          <div
            className={
              mode === "task" ? "flex min-w-0 flex-1 flex-col" : "hidden"
            }
          >
            <AssistantTaskWorkspace
              conversationId={detail?.id}
              ensureConversation={ensureTaskConversation}
              onCreated={() => {
                setTaskRevision((value) => value + 1);
                void refresh();
              }}
              onOpen={setSelectedTask}
              onBusyChange={setTaskBusy}
            />
          </div>
          <div
            className={`${mode === "task" ? "hidden" : ""} max-h-[60dvh] min-h-72 flex-1 overflow-y-auto px-4 py-6 sm:px-8`}
            aria-live="polite"
            aria-busy={running}
          >
            {!detail?.turns.length ? (
              <div className="mx-auto flex min-h-64 max-w-xl flex-col items-center justify-center text-center">
                <Bot className="mb-5 size-8" />
                <h2 className="text-xl font-semibold">
                  Hôm nay mình giúp gì cho bạn?
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Hỏi đáp, phát triển ý tưởng và nhận tư vấn cho công việc của
                  bạn.
                </p>
                <p className="mt-5 text-xs text-muted-foreground">
                  Ví dụ: Giúp tôi viết lời giới thiệu ngắn cho doanh nghiệp.
                </p>
              </div>
            ) : (
              <div className="mx-auto max-w-3xl space-y-8">
                {detail.turns.map((turn) => (
                  <AssistantMessage
                    key={turn.id}
                    turn={turn}
                    canRetry={turn.id === last?.id}
                    busy={running}
                    onRetry={() => void send(turn)}
                  />
                ))}
              </div>
            )}
            <div ref={bottom} />
          </div>
          <div
            className={`${mode === "task" ? "hidden" : ""} border-t p-4 sm:px-6`}
          >
            {error && (
              <div
                role="alert"
                className="mb-3 flex items-start justify-between gap-2 rounded-lg border border-destructive/40 p-3 text-sm text-destructive"
              >
                <span>{error}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 shrink-0"
                  onClick={() => setError(null)}
                  aria-label="Đóng thông báo"
                >
                  <X className="size-3" />
                </Button>
              </div>
            )}
            {!loading && !modelId && (
              <p className="mb-3 text-sm text-muted-foreground">
                Chọn kết nối có mô hình đã lưu trong cấu hình AI hoặc hồ sơ nhân
                viên.{" "}
                <Link href="/settings/ai-providers" className="underline">
                  Mở cấu hình AI
                </Link>
              </p>
            )}
            <form
              onSubmit={submit}
              className="mx-auto flex max-w-3xl items-end gap-2 rounded-xl border bg-muted/10 p-2"
            >
              <Textarea
                aria-label="Tin nhắn cho Nova"
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  failedInput.current = null;
                }}
                placeholder="Nhắn Nova…"
                maxLength={8000}
                rows={2}
                disabled={running || loading}
                className="min-h-14 flex-1 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    void send();
                  }
                }}
              />
              {running ? (
                <Button
                  type="button"
                  size="icon"
                  onClick={() => void stop()}
                  disabled={stopping || !runningTurn}
                  aria-label="Dừng phản hồi"
                >
                  {stopping ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Square className="size-4" />
                  )}
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="icon"
                  disabled={
                    !draft.trim() ||
                    !modelId ||
                    !connectionId ||
                    loading ||
                    busy
                  }
                  aria-label="Gửi tin nhắn"
                >
                  <ArrowUp className="size-4" />
                </Button>
              )}
            </form>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              Enter để gửi · Shift+Enter xuống dòng · Nova có thể mắc lỗi, hãy
              kiểm chứng thông tin quan trọng.
            </p>
          </div>
        </section>
      </div>
      <AssistantTaskDialog
        id={selectedTask}
        onClose={() => setSelectedTask(null)}
        onChanged={() => setTaskRevision((value) => value + 1)}
      />
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setDialog(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog === "rename"
                ? "Đổi tên cuộc trò chuyện"
                : "Xóa cuộc trò chuyện?"}
            </DialogTitle>
            <DialogDescription>
              {dialog === "rename"
                ? "Đặt tên để dễ tìm lại trong lịch sử."
                : "Tin nhắn và liên kết nhiệm vụ sẽ bị xóa. Các công việc vẫn được giữ trong trang Công việc và không tự hủy. Không thể khôi phục hội thoại."}
            </DialogDescription>
          </DialogHeader>
          {dialog === "rename" && (
            <Input
              aria-label="Tên cuộc trò chuyện"
              maxLength={160}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setDialog(null)}
            >
              Hủy
            </Button>
            <Button
              variant={dialog === "delete" ? "destructive" : "default"}
              disabled={busy || (dialog === "rename" && !title.trim())}
              onClick={() => void manage()}
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              {dialog === "rename" ? "Lưu tên" : "Xóa cuộc trò chuyện"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
