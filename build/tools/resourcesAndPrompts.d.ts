/**
 * MCP resources & prompts (D2).
 *
 * Resources expose read-only mail context the client can attach without a tool
 * round-trip (accounts, templates, per-account mailboxes). Prompts package
 * common multi-step workflows (triage, reply, weekly summary) so users can
 * invoke them by name. Both are additive and complement the existing tools.
 *
 * @module tools/resourcesAndPrompts
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppleMailManager } from "../services/appleMailManager.js";
interface ResourcesAndPromptsOptions {
    enableComposeReplyPrompt?: boolean;
    enableTemplatesResource?: boolean;
    enableTriageInboxPrompt?: boolean;
    triageActions?: readonly string[];
}
export declare function registerResourcesAndPrompts(server: McpServer, mailManager: AppleMailManager, options?: ResourcesAndPromptsOptions): void;
export {};
//# sourceMappingURL=resourcesAndPrompts.d.ts.map