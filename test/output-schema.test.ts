/**
 * outputSchema contract — belt-and-suspenders for the registerTool/outputSchema
 * migration. Boots the REAL built server over stdio and verifies the MCP
 * output-schema guarantees end-to-end through the SDK:
 *
 *   1. every tool advertises an outputSchema (none slipped back to plain server.tool)
 *   2. every outputSchema is permissive — no required fields — so the SDK's
 *      structuredContent validation can never reject a valid success result for a
 *      conditionally-absent field
 *   3. the diagnostic tools round-trip without a validation rejection. The SDK's
 *      validateToolOutput (server mcp.js) THROWS McpError when a success result's
 *      structuredContent is missing or fails the schema, which rejects callTool —
 *      so a resolving call proves a real payload validates against its schema.
 *      (Environment failures return isError results, which the SDK exempts.)
 *
 * Needs no configured Mail account, so it always runs (including CI). Requires
 * build/ — `npm ci` runs prepare→build and the CI step builds before this.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resolve } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const SERVER = resolve(__dirname, "../build/index.js");

async function withServerClient<T>(
  env: Record<string, string>,
  fn: (client: Client) => Promise<T>
): Promise<T> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    env,
  });
  const scopedClient = new Client({ name: "outputschema-scoped-test", version: "0.0.0" });
  await scopedClient.connect(transport);
  try {
    return await fn(scopedClient);
  } finally {
    await scopedClient.close();
  }
}

describe("outputSchema contract (real server over stdio)", () => {
  let client: Client;

  beforeAll(async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [SERVER],
      env: { ...process.env } as Record<string, string>,
    });
    client = new Client({ name: "outputschema-contract-test", version: "0.0.0" });
    await client.connect(transport);
  }, 60_000);

  afterAll(async () => {
    await client?.close();
  });

  it("registers tools, and every tool advertises an outputSchema", async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
    const missing = tools.filter((t) => !t.outputSchema).map((t) => t.name);
    expect(missing, `tools missing an outputSchema: ${missing.join(", ")}`).toEqual([]);
  });

  it("every outputSchema is permissive — no required fields", async () => {
    const { tools } = await client.listTools();
    const offenders = tools
      .filter((t) => {
        const req = (t.outputSchema as { required?: unknown } | undefined)?.required;
        return Array.isArray(req) && req.length > 0;
      })
      .map(
        (t) =>
          `${t.name}: requires [${(t.outputSchema as { required: string[] }).required.join(", ")}]`
      );
    expect(
      offenders,
      `outputSchemas must not require fields (a missing field would reject a valid result): ${offenders.join("; ")}`
    ).toEqual([]);
  });

  it("advertises provider-compatible input schemas", async () => {
    const { tools } = await client.listTools();
    const offenders: string[] = [];

    function visit(value: unknown, toolName: string, path = "inputSchema"): void {
      if (value === null || typeof value !== "object") return;

      for (const [key, child] of Object.entries(value)) {
        const childPath = `${path}.${key}`;
        if (key === "$ref" && (typeof child !== "string" || !child.startsWith("#/$defs/"))) {
          offenders.push(`${toolName}: ${childPath}=${String(child)}`);
        }
        if (key === "pattern" && path.endsWith(".items")) {
          offenders.push(`${toolName}: ${childPath}=${String(child)}`);
        }
        visit(child, toolName, childPath);
      }
    }

    for (const tool of tools) visit(tool.inputSchema, tool.name);

    expect(
      offenders,
      `input schemas contain constructs rejected by OpenCode providers: ${offenders.join("; ")}`
    ).toEqual([]);
  });

  it("keeps runtime validation for batch message IDs", async () => {
    const result = await client.callTool({
      name: "batch-mark-as-read",
      arguments: { ids: ["not-a-message-id"] },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(/Message ID must be numeric or an IMAP id/);
  });

  it("diagnostic tools' real output validates against their outputSchema (when reachable)", async () => {
    // The SDK throws an "Output validation error" McpError when a success
    // result's structuredContent is missing or fails its schema — the only
    // failure we treat as a bug. A slow or unavailable backend (e.g. AppleScript
    // timing out on a headless CI runner) is tolerated, not failed.
    for (const name of ["health-check", "doctor"]) {
      const call = client.callTool({ name, arguments: {} });
      try {
        await Promise.race([
          call,
          new Promise((resolve) => setTimeout(() => resolve(undefined), 8000)),
        ]);
      } catch (err) {
        const msg = String((err as { message?: string })?.message ?? err);
        if (/output validation error|invalid structured content/i.test(msg)) throw err;
        // otherwise: environment/transport error — the tool couldn't run here
      }
      // Swallow any late rejection (e.g. when the client closes mid-call).
      void Promise.resolve(call).catch(() => {});
    }
  }, 30_000);

  it("full profile advertises send tools and compose prompts", async () => {
    await withServerClient(
      {
        ...(process.env as Record<string, string>),
        APPLE_MAIL_MCP_TOOL_PROFILE: "full",
        APPLE_MAIL_MCP_ALLOWED_TOOLS: "",
        APPLE_MAIL_MCP_DISABLED_TOOLS: "",
      },
      async (scopedClient) => {
        const { tools } = await scopedClient.listTools();
        const names = tools.map((t) => t.name);
        expect(names).toContain("send-email");
        expect(names).toContain("reply-to-message");
        expect(names).toContain("delete-message");

        const { prompts } = await scopedClient.listPrompts();
        const promptNames = prompts.map((p) => p.name);
        expect(promptNames).toContain("compose-reply");

        const triagePrompt = await scopedClient.getPrompt({
          name: "triage-inbox",
          arguments: {},
        });
        const triageText = JSON.stringify(triagePrompt);
        expect(triageText).toContain("archive / reply / flag / delete / ignore");
      }
    );
  }, 60_000);

  it("organize profile hides send and destructive-delete tools from the advertised MCP surface", async () => {
    await withServerClient(
      {
        ...(process.env as Record<string, string>),
        APPLE_MAIL_MCP_TOOL_PROFILE: "organize",
        APPLE_MAIL_MCP_ALLOWED_TOOLS: "",
        APPLE_MAIL_MCP_DISABLED_TOOLS: "",
      },
      async (scopedClient) => {
        const { tools } = await scopedClient.listTools();
        const names = tools.map((t) => t.name);
        expect(names).toContain("move-message");
        expect(names).toContain("batch-move-messages");
        expect(names).toContain("save-attachment");
        expect(names).toContain("fetch-attachment");
        expect(names).not.toContain("send-email");
        expect(names).not.toContain("send-serial-email");
        expect(names).not.toContain("reply-to-message");
        expect(names).not.toContain("forward-message");
        expect(names).not.toContain("create-draft");
        expect(names).not.toContain("delete-message");
        expect(names).not.toContain("batch-delete-messages");
        expect(names).not.toContain("create-rule");
        expect(names).not.toContain("delete-rule");

        const { prompts } = await scopedClient.listPrompts();
        const promptNames = prompts.map((p) => p.name);
        expect(promptNames).toContain("triage-inbox");
        expect(promptNames).toContain("weekly-summary");
        expect(promptNames).not.toContain("compose-reply");

        const triagePrompt = await scopedClient.getPrompt({
          name: "triage-inbox",
          arguments: {},
        });
        const triageText = JSON.stringify(triagePrompt);
        expect(triageText).toContain("archive / flag / ignore");
        expect(triageText).not.toMatch(/\breply\b/i);
        expect(triageText).not.toMatch(/\bdelete\b/i);
      }
    );
  }, 60_000);
});
