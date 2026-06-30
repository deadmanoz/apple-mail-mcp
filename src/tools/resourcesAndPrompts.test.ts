import { describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppleMailManager } from "@/services/appleMailManager.js";
import { registerResourcesAndPrompts } from "./resourcesAndPrompts.js";

function createFakeServer() {
  const resources: string[] = [];
  const prompts: string[] = [];
  const server = {
    registerResource(name: string) {
      resources.push(name);
    },
    registerPrompt(name: string) {
      prompts.push(name);
    },
  } as unknown as McpServer;

  return { server, resources, prompts };
}

const fakeMailManager = {
  listAccounts: () => [],
  listTemplates: () => [],
  listMailboxes: () => [],
} as unknown as AppleMailManager;

describe("registerResourcesAndPrompts", () => {
  it("registers templates and compose/triage prompts by default", () => {
    const { server, resources, prompts } = createFakeServer();

    registerResourcesAndPrompts(server, fakeMailManager);

    expect(resources).toContain("accounts");
    expect(resources).toContain("templates");
    expect(resources).toContain("mailboxes");
    expect(prompts).toContain("triage-inbox");
    expect(prompts).toContain("compose-reply");
    expect(prompts).toContain("weekly-summary");
  });

  it("hides resources and prompts when their backing tools are disabled", () => {
    const { server, resources, prompts } = createFakeServer();

    registerResourcesAndPrompts(server, fakeMailManager, {
      enableTemplatesResource: false,
      enableTriageInboxPrompt: false,
      enableComposeReplyPrompt: false,
    });

    expect(resources).toContain("accounts");
    expect(resources).not.toContain("templates");
    expect(resources).toContain("mailboxes");
    expect(prompts).not.toContain("triage-inbox");
    expect(prompts).not.toContain("compose-reply");
    expect(prompts).toContain("weekly-summary");
  });
});
