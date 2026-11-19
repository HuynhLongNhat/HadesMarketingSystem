import { describe, expect, it } from "vitest";
import { parseChatGptHandoff } from "./chatgpt-handoff";

describe("ChatGPT handoff", () => {
  it("accepts a validated draft", () => {
    expect(parseChatGptHandoff('{"title":"Research","description":"Find sources"}')).toEqual({title:"Research",description:"Find sources"});
  });
  it("accepts fenced JSON", () => {
    expect(parseChatGptHandoff('```json\n{"title":"A","description":"B"}\n```').title).toBe("A");
  });
  it("rejects non-JSON and invalid payloads", () => {
    expect(() => parseChatGptHandoff("do something")).toThrow();
    expect(() => parseChatGptHandoff('{"title":"","description":"B"}')).toThrow();
    expect(() => parseChatGptHandoff('{"title":"A","description":"B","agentId":"wrong"}')).toThrow();
  });
});
