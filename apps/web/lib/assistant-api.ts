import { apiFetch, ApiError } from "./api-client";

export type AssistantConversation = {
  id: string;
  title: string;
  updatedAt: string;
};
export type AssistantTurn = {
  id: string;
  requestId: string;
  conversationId: string;
  sequence: number;
  userContent: string;
  assistantContent: string;
  connectionId: string;
  modelId: string;
  provider: string;
  status: "running" | "completed" | "failed" | "cancelled";
  safeError: string | null;
  errorCode: string | null;
  attemptCount: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};
export type AssistantDetail = AssistantConversation & {
  turns: AssistantTurn[];
};
export type AssistantOption = {
  id: string;
  name: string;
  provider: string;
  models: string[];
};
export type AssistantInput = {
  requestId: string;
  content: string;
  connectionId: string;
  modelId: string;
  retry?: boolean;
};
export type AssistantStreamEvent =
  | { type: "turn" | "done"; turn: AssistantTurn }
  | { type: "delta"; text: string }
  | { type: "error"; message: string };
const path = (id: string) =>
  `/assistant/conversations/${encodeURIComponent(id)}`;
export const assistantApi = {
  options: () => apiFetch<AssistantOption[]>("/assistant/options"),
  list: () => apiFetch<AssistantConversation[]>("/assistant/conversations"),
  create: () =>
    apiFetch<AssistantConversation>("/assistant/conversations", {
      method: "POST",
    }),
  get: (id: string) => apiFetch<AssistantDetail>(path(id)),
  rename: (id: string, title: string) =>
    apiFetch<AssistantConversation>(path(id), {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),
  remove: (id: string) =>
    apiFetch<{ deleted: boolean }>(path(id), { method: "DELETE" }),
  cancel: (id: string, requestId: string) =>
    apiFetch<AssistantDetail>(
      `${path(id)}/messages/${encodeURIComponent(requestId)}/cancel`,
      { method: "POST" },
    ),
};

export async function streamAssistant(
  id: string,
  input: AssistantInput,
  signal: AbortSignal,
  onEvent: (event: AssistantStreamEvent) => void,
) {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002"}/v1${path(id)}/messages`,
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal,
    },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
      message?: string;
    } | null;
    throw new ApiError(
      response.status,
      body?.error?.message ??
        body?.message ??
        `Không thể gửi yêu cầu (HTTP ${response.status}).`,
    );
  }
  if (!response.body) throw new Error("Kết nối không trả về dữ liệu.");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let pending = "",
    doneEvent = false;
  try {
    while (true) {
      const chunk = await reader.read();
      pending += decoder
        .decode(chunk.value, { stream: !chunk.done })
        .replace(/\r\n/g, "\n");
      let boundary: number;
      while ((boundary = pending.indexOf("\n\n")) >= 0) {
        const frame = pending.slice(0, boundary);
        pending = pending.slice(boundary + 2);
        const raw = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");
        if (!raw) continue;
        const event = JSON.parse(raw) as AssistantStreamEvent;
        if (event.type === "error") throw new Error(event.message);
        if (event.type === "done") doneEvent = true;
        onEvent(event);
      }
      if (chunk.done) break;
    }
    if (!doneEvent)
      throw new Error(
        "Kết nối phản hồi bị ngắt. Đang tải lại trạng thái đã lưu.",
      );
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
