import { apiFetch } from "./api-client";
import { assistantTaskPayload, type AssistantTaskInput } from "./assistant-task-payload";
export type { AssistantTaskInput } from "./assistant-task-payload";
import type { AiTaskDetail, TaskStatus } from "./tasks-api";

export type AssistantTask = {
  id: string;
  conversationId: string;
  title: string;
  description: string;
  agentId: string | null;
  agentName: string | null;
  status: TaskStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};
export type AssistantTaskDetail = Pick<
  AiTaskDetail,
  | "id"
  | "title"
  | "description"
  | "agentName"
  | "status"
  | "error"
  | "webResearchEnabled"
  | "result"
  | "createdAt"
  | "startedAt"
  | "completedAt"
  | "events"
  | "researchSources"
>;
export const assistantTasksApi = {
  list: (conversationId?: string) =>
    apiFetch<AssistantTask[]>(
      conversationId
        ? `/assistant/conversations/${encodeURIComponent(conversationId)}/tasks`
        : "/assistant/tasks",
    ),
  create: (conversationId: string, input: AssistantTaskInput) =>
    apiFetch<{ taskId: string; replay: boolean }>(
      `/assistant/conversations/${encodeURIComponent(conversationId)}/tasks`,
      { method: "POST", body: JSON.stringify(assistantTaskPayload(input)) },
    ),
  get: (id: string) =>
    apiFetch<AssistantTaskDetail>(`/assistant/tasks/${encodeURIComponent(id)}`),
  resumeResearch: (id: string) =>
    apiFetch<unknown>(`/assistant/tasks/${encodeURIComponent(id)}/resume-research`, { method: "POST" }),
  cancel: (id: string) =>
    apiFetch<{ cancelled: boolean }>(
      `/assistant/tasks/${encodeURIComponent(id)}/cancel`,
      { method: "POST" },
    ),
};
