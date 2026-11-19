export type AssistantTaskInput = {
  requestId: string;
  title: string;
  description: string;
  agentId: string;
};

// Keep request identity on transport retry and send only DTO-supported fields.
export function assistantTaskPayload(input: AssistantTaskInput): AssistantTaskInput {
  return { requestId: input.requestId, title: input.title.trim(), description: input.description.trim(), agentId: input.agentId };
}
