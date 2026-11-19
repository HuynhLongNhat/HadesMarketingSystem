"use client";

import { useState } from "react";
import { Bot, Check, Copy, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@workspace/ui/components/button";
import { MarkdownReport } from "@/modules/tasks/markdown-report";
import type { AssistantTurn } from "@/lib/assistant-api";

export function AssistantMessage({
  turn,
  canRetry,
  busy,
  onRetry,
}: {
  turn: AssistantTurn;
  canRetry: boolean;
  busy: boolean;
  onRetry: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(turn.assistantContent);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Không thể sao chép.");
    }
  };
  return (
    <div className="space-y-4">
      <div className="ml-auto max-w-[90%] whitespace-pre-wrap break-words rounded-2xl bg-muted px-4 py-3 text-sm leading-7">
        {turn.userContent}
      </div>
      <div className="flex min-w-0 gap-3">
        <Bot className="mt-2 size-5 shrink-0" />
        <div className="min-w-0 flex-1 break-words">
          {turn.assistantContent ? (
            <MarkdownReport content={turn.assistantContent} sources={[]} />
          ) : turn.status === "running" ? (
            <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Đang suy nghĩ…
            </p>
          ) : null}
          {turn.status !== "completed" && turn.status !== "running" && (
            <p className="mt-3 rounded-lg border p-3 text-sm" role="alert">
              {turn.safeError ?? "Phản hồi chưa hoàn tất."}
              {turn.assistantContent &&
                " Nội dung trên là bản trả lời chưa hoàn chỉnh."}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {turn.assistantContent && (
              <Button
                size="sm"
                variant="ghost"
                aria-label="Sao chép phản hồi"
                onClick={() => void copy()}
              >
                {copied ? (
                  <Check className="size-3.5" />
                ) : (
                  <Copy className="size-3.5" />
                )}
              </Button>
            )}
            <span className="break-all">{turn.modelId}</span>
            {turn.totalTokens !== null && (
              <span>· {turn.totalTokens.toLocaleString("vi-VN")} token</span>
            )}
            {canRetry &&
              ["failed", "cancelled"].includes(turn.status) &&
              turn.attemptCount < 3 && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={onRetry}
                >
                  <RefreshCw className="size-3.5" />
                  Thử lại ({turn.attemptCount}/3)
                </Button>
              )}
          </div>
        </div>
      </div>
    </div>
  );
}
