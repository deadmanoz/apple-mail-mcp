import { describe, expect, it } from "vitest";
import {
  ALLOWED_TOOLS_ENV,
  DISABLED_TOOLS_ENV,
  isToolEnabled,
  ORGANIZE_TOOL_PROFILE,
  parseToolList,
  resolveToolPolicy,
  TOOL_PROFILE_ENV,
} from "./toolPolicy.js";

describe("tool policy", () => {
  it("parses comma and whitespace separated tool lists", () => {
    expect([...parseToolList("search-messages, move-message\nsave-attachment")]).toEqual([
      "search-messages",
      "move-message",
      "save-attachment",
    ]);
  });

  it("defaults to full profile", () => {
    const policy = resolveToolPolicy({});
    expect(policy.profile).toBe("full");
    expect(policy.allowedTools).toBeUndefined();
    expect(isToolEnabled("send-email", policy)).toBe(true);
  });

  it("rejects unknown profiles", () => {
    expect(() => resolveToolPolicy({ [TOOL_PROFILE_ENV]: "organise" })).toThrow(
      /APPLE_MAIL_MCP_TOOL_PROFILE/
    );
  });

  it("organize profile allows move and attachment tools but blocks send surfaces", () => {
    const policy = resolveToolPolicy({ [TOOL_PROFILE_ENV]: "organize" });
    expect(policy.allowedTools).toBeDefined();
    expect(isToolEnabled("move-message", policy)).toBe(true);
    expect(isToolEnabled("batch-move-messages", policy)).toBe(true);
    expect(isToolEnabled("save-attachment", policy)).toBe(true);
    expect(isToolEnabled("fetch-attachment", policy)).toBe(true);
    expect(isToolEnabled("send-email", policy)).toBe(false);
    expect(isToolEnabled("reply-to-message", policy)).toBe(false);
    expect(isToolEnabled("create-draft", policy)).toBe(false);
    expect(isToolEnabled("delete-message", policy)).toBe(false);
  });

  it("explicit allowlist overrides profile allowlist", () => {
    const policy = resolveToolPolicy({
      [TOOL_PROFILE_ENV]: "organize",
      [ALLOWED_TOOLS_ENV]: "search-messages",
    });
    expect(isToolEnabled("search-messages", policy)).toBe(true);
    expect(isToolEnabled("move-message", policy)).toBe(false);
  });

  it("denylist wins over allowlist", () => {
    const policy = resolveToolPolicy({
      [ALLOWED_TOOLS_ENV]: "search-messages,move-message",
      [DISABLED_TOOLS_ENV]: "move-message",
    });
    expect(isToolEnabled("search-messages", policy)).toBe(true);
    expect(isToolEnabled("move-message", policy)).toBe(false);
  });

  it("keeps the organize profile free of send-capable tools", () => {
    const forbidden = [
      "send-email",
      "send-serial-email",
      "reply-to-message",
      "forward-message",
      "create-draft",
      "use-template",
      "list-rules",
      "list-templates",
      "get-template",
      "search-contacts",
    ];
    expect(ORGANIZE_TOOL_PROFILE.filter((name) => forbidden.includes(name))).toEqual([]);
  });
});
