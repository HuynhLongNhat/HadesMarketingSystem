export function classifyProviderError(status: number, body: unknown): { category: string; guidance: string } {
  const error = body && typeof body === "object" ? (body as { error?: unknown }).error : null;
  const detail = error && typeof error === "object" ? error as { message?: unknown; code?: unknown; status?: unknown } : {};
  // Read provider text only in memory for classification; never return/log it.
  const text = [detail.message, detail.code, detail.status].filter((v) => typeof v === "string").join(" ").toLowerCase();
  if (status === 401 || status === 403) return { category: "authentication", guidance: "Kiểm tra API key và quyền của kết nối AI." };
  if (/context.{0,25}(length|window)|too many tokens|input.{0,20}(too long|token)/.test(text)) return { category: "context_length", guidance: "Nội dung vượt giới hạn model. Hãy giảm số nguồn hoặc dùng model có context phù hợp." };
  if (/model.{0,60}(not found|not exist|not supported|invalid)|invalid.{0,15}model|model name/.test(text)) return { category: "invalid_model", guidance: "Kiểm tra Model ID của nhân viên AI; dùng ID từ catalog, không dùng tên hiển thị." };
  if (/unsupported.{0,25}(parameter|argument)|unknown.{0,15}(field|parameter)/.test(text)) return { category: "unsupported_parameter", guidance: "Model không hỗ trợ một tham số trong request. Kiểm tra cấu hình provider/model." };
  return { category: status === 400 ? "invalid_request" : "http_error", guidance: status === 400 ? "Kiểm tra Model ID, giới hạn context và cấu hình AI trước khi thử lại. Dữ liệu nguồn vẫn được giữ." : "Kiểm tra trạng thái AI Provider trước khi thử lại." };
}

/** Bound diagnostics reads; no raw body is persisted or emitted. */
export async function readProviderError(response: Response): Promise<unknown> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > 16_384) return null;
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch { return null; }
  finally { await reader.cancel().catch(() => undefined); }
}
