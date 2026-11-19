/**
 * ChatGPT personal-account handoff format.
 * A pasted draft is untrusted input and NEVER triggers execution automatically.
 */
export type ChatGptHandoff = { title: string; description: string; agentId?: string };

export const CHATGPT_HANDOFF_PROMPT = `Hãy chuyển yêu cầu công việc chúng ta vừa thống nhất thành một bản giao việc cho Hades. Chỉ trả về một JSON object, không markdown, có title (tối đa 200 ký tự) và description (tối đa 12000 ký tự). Không thêm dữ liệu chưa xác minh; đưa URL nguồn vào description khi có. Không tự nhận đã tạo Task hoặc kết nối Hades.`;

export function parseChatGptHandoff(input: string): ChatGptHandoff {
  if (input.length > 20000) throw new Error("Nội dung vượt giới hạn 20.000 ký tự.");
  const trimmed = input.trim().replace(/^\`\`\`(?:json)?\s*/i, "").replace(/\s*\`\`\`$/, "");
  let value: unknown;
  try { value = JSON.parse(trimmed); }
  catch { throw new Error("Vui lòng dán JSON hợp lệ do ChatGPT tạo."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Dữ liệu phải là JSON object.");
  const data = value as Record<string, unknown>;
  if (typeof data.title !== "string" || !data.title.trim() || data.title.length > 200) throw new Error("Tiêu đề không hợp lệ (1–200 ký tự).");
  if (typeof data.description !== "string" || !data.description.trim() || data.description.length > 12000) throw new Error("Mô tả không hợp lệ (1–12.000 ký tự).");
  if (data.agentId !== undefined && (typeof data.agentId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.agentId))) throw new Error("agentId không hợp lệ.");
  return { title: data.title.trim(), description: data.description.trim(), ...(typeof data.agentId === "string" ? { agentId: data.agentId } : {}) };
}
