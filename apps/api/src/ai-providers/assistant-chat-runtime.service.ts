import { Injectable, Logger } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { aiProviderConnections, db } from "@workspace/db/node";
import { decryptCredential } from "../ai-credentials/credential-crypto.js";
import { PROVIDER_REGISTRY } from "./provider-registry.js";
import {
  classifyProviderError,
  readProviderError,
} from "../tasks/provider-error-diagnostics.js";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};
export type ChatUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};
export class AssistantProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function count(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 2_147_483_647
    ? value
    : null;
}

/** Reads SSE frames incrementally, including CRLF and multi-line data fields. */
export async function* streamJson(response: Response): AsyncGenerator<unknown> {
  if (!response.body)
    throw new AssistantProviderError(
      "EMPTY_RESPONSE",
      "Nhà cung cấp không trả dữ liệu.",
    );
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "",
    data: string[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      if (done && pending) pending += "\n\n";
      if (pending.length > 1_000_000)
        throw new AssistantProviderError(
          "INVALID_RESPONSE",
          "Phản hồi AI vượt giới hạn xử lý.",
        );
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, newline).replace(/\r$/, "");
        pending = pending.slice(newline + 1);
        if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
        else if (!line && data.length) {
          const raw = data.join("\n");
          data = [];
          if (raw === "[DONE]") return;
          try {
            yield JSON.parse(raw) as unknown;
          } catch (error) {
            if (error instanceof SyntaxError)
              throw new AssistantProviderError(
                "INVALID_RESPONSE",
                "Không đọc được định dạng phản hồi AI.",
              );
            throw error;
          }
        }
      }
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

@Injectable()
export class AssistantChatRuntimeService {
  private readonly logger = new Logger(AssistantChatRuntimeService.name);

  async connection(organizationId: string, connectionId: string) {
    const [connection] = await db
      .select()
      .from(aiProviderConnections)
      .where(
        and(
          eq(aiProviderConnections.organizationId, organizationId),
          eq(aiProviderConnections.id, connectionId),
          eq(aiProviderConnections.enabled, true),
        ),
      )
      .limit(1);
    const definition = connection
      ? PROVIDER_REGISTRY[connection.provider]
      : null;
    if (
      !connection ||
      !definition?.baseUrl ||
      definition.runtimeProtocol === "ollama"
    )
      throw new AssistantProviderError(
        "NOT_CONFIGURED",
        "Kết nối AI không khả dụng. Hãy chọn kết nối đang bật trong tổ chức.",
      );
    return { connection, definition };
  }

  async generate(input: {
    organizationId: string;
    connectionId: string;
    modelId: string;
    messages: ChatMessage[];
    signal: AbortSignal;
    onDelta: (text: string) => Promise<void>;
  }): Promise<ChatUsage> {
    const { connection, definition } = await this.connection(
      input.organizationId,
      input.connectionId,
    );
    let key: string;
    try {
      key = decryptCredential(
        {
          encryptedApiKey: connection.encryptedApiKey,
          keyIv: connection.keyIv,
          keyAuthTag: connection.keyAuthTag,
          keyVersion: "v1",
        },
        {
          organizationId: input.organizationId,
          connectionId: connection.id,
          provider: connection.provider,
        },
      );
    } catch {
      throw new AssistantProviderError(
        "CREDENTIAL_ERROR",
        "Không thể mở khóa kết nối AI. Hãy liên hệ quản trị viên.",
      );
    }
    const model = input.modelId.replace(/^models\//, "");
    if (definition.runtimeProtocol === "google" && !/^[\w.:-]+$/.test(model))
      throw new AssistantProviderError(
        "INVALID_MODEL",
        "Model ID Google không hợp lệ. Hãy chọn ID mô hình thay vì tên hiển thị.",
      );
    const base = definition.baseUrl!.replace(/\/$/, "");
    let url: string, body: unknown, headers: Record<string, string>;
    const system = input.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n");
    if (definition.runtimeProtocol === "google") {
      url = `${base}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
      headers = { "Content-Type": "application/json", "x-goog-api-key": key };
      body = {
        systemInstruction: { parts: [{ text: system }] },
        contents: input.messages
          .filter((m) => m.role !== "system")
          .map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
          })),
        generationConfig: { maxOutputTokens: 4000 },
      };
    } else if (definition.runtimeProtocol === "anthropic") {
      url = `${base}/messages`;
      headers = {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      };
      body = {
        model,
        system,
        messages: input.messages.filter((m) => m.role !== "system"),
        max_tokens: 4000,
        stream: true,
      };
    } else {
      url = `${base}/chat/completions`;
      headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      };
      body = {
        model,
        messages: input.messages,
        max_completion_tokens: 4000,
        stream: true,
        ...(["openai", "openrouter", "groq"].includes(connection.provider)
          ? { stream_options: { include_usage: true } }
          : {}),
      };
    }
    const started = Date.now();
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(90_000)]);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
        redirect: "error",
      });
      if (!response.ok) {
        const diagnostic = classifyProviderError(
          response.status,
          await readProviderError(response),
        );
        this.logger.warn(
          JSON.stringify({
            event: "assistant.provider_error",
            provider: connection.provider,
            status: response.status,
            category: diagnostic.category,
            durationMs: Date.now() - started,
          }),
        );
        if (response.status === 429)
          throw new AssistantProviderError(
            "RATE_LIMITED",
            "Nhà cung cấp đang giới hạn lượt gọi hoặc hết hạn mức. Hãy chờ rồi nhấn Thử lại.",
          );
        if (response.status === 402)
          throw new AssistantProviderError(
            "PROVIDER_QUOTA",
            "Kết nối AI đã hết tín dụng. Hãy kiểm tra tài khoản nhà cung cấp.",
          );
        throw new AssistantProviderError(
          `PROVIDER_HTTP_${response.status}`,
          `AI trả HTTP ${response.status}. ${diagnostic.guidance}`,
        );
      }
      let finished = false,
        length = 0;
      const usage: ChatUsage = {
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
      };
      for await (const raw of streamJson(response)) {
        const item = object(raw);
        if (item.error || item.type === "error")
          throw new AssistantProviderError(
            "PROVIDER_ERROR",
            "Nhà cung cấp ngắt phản hồi. Hãy thử lại sau.",
          );
        let delta = "",
          reason: unknown;
        if (definition.runtimeProtocol === "google") {
          const candidate = object(
            Array.isArray(item.candidates) ? item.candidates[0] : null,
          );
          const parts = object(candidate.content).parts;
          delta = Array.isArray(parts)
            ? parts
                .map((p) => {
                  const part = object(p);
                  return part.thought === true
                    ? ""
                    : typeof part.text === "string"
                      ? part.text
                      : "";
                })
                .join("")
            : "";
          reason = candidate.finishReason;
          const info = object(item.usageMetadata);
          usage.inputTokens = count(info.promptTokenCount) ?? usage.inputTokens;
          usage.outputTokens =
            count(info.candidatesTokenCount) ?? usage.outputTokens;
          usage.totalTokens = count(info.totalTokenCount) ?? usage.totalTokens;
        } else if (definition.runtimeProtocol === "anthropic") {
          const change = object(item.delta);
          delta = typeof change.text === "string" ? change.text : "";
          reason = change.stop_reason;
          const info = object(item.usage ?? object(item.message).usage);
          usage.inputTokens = count(info.input_tokens) ?? usage.inputTokens;
          usage.outputTokens = count(info.output_tokens) ?? usage.outputTokens;
        } else {
          const choice = object(
            Array.isArray(item.choices) ? item.choices[0] : null,
          );
          const change = object(choice.delta);
          delta = typeof change.content === "string" ? change.content : "";
          reason = choice.finish_reason;
          const info = object(item.usage);
          usage.inputTokens = count(info.prompt_tokens) ?? usage.inputTokens;
          usage.outputTokens =
            count(info.completion_tokens) ?? usage.outputTokens;
          usage.totalTokens = count(info.total_tokens) ?? usage.totalTokens;
        }
        if (typeof reason === "string" && reason) {
          if (!["stop", "STOP", "end_turn", "stop_sequence"].includes(reason))
            throw new AssistantProviderError(
              "INCOMPLETE_OUTPUT",
              "Phản hồi bị dừng trước khi hoàn tất (giới hạn output hoặc chính sách model). Hãy rút gọn yêu cầu rồi thử lại.",
            );
          finished = true;
        }
        if (delta) {
          length += delta.length;
          if (length > 120_000)
            throw new AssistantProviderError(
              "OUTPUT_LIMIT",
              "Phản hồi quá dài. Hãy chia nhỏ yêu cầu.",
            );
          await input.onDelta(delta);
        }
      }
      if (!finished || !length)
        throw new AssistantProviderError(
          "INCOMPLETE_OUTPUT",
          "Phản hồi bị ngắt hoặc rỗng. Bạn có thể thử lại yêu cầu này.",
        );
      usage.totalTokens ??=
        usage.inputTokens !== null && usage.outputTokens !== null
          ? usage.inputTokens + usage.outputTokens
          : null;
      return usage;
    } catch (error) {
      if (error instanceof AssistantProviderError) throw error;
      if (input.signal.aborted)
        throw new AssistantProviderError("CANCELLED", "Đã dừng phản hồi.");
      const name = error instanceof Error ? error.name : "unknown";
      const timedOut =
        signal.aborted || name === "TimeoutError" || name === "AbortError";
      this.logger.warn(
        JSON.stringify({
          event: "assistant.provider_error",
          provider: connection.provider,
          category: timedOut ? "timeout" : "network",
          exception: name,
          durationMs: Date.now() - started,
        }),
      );
      throw new AssistantProviderError(
        timedOut ? "TIMEOUT" : "NETWORK_ERROR",
        timedOut
          ? "AI phản hồi quá 90 giây. Hãy thử lại hoặc rút gọn yêu cầu."
          : "Kết nối AI bị gián đoạn. Hãy thử lại.",
      );
    }
  }
}
