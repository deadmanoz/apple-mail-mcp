/**
 * Tool exposure policy for local deployments.
 *
 * Upstream exposes every Apple Mail capability by default. A local fork can use
 * these environment variables to hide high-risk tools before the MCP client ever
 * sees them in tools/list.
 */
export declare const TOOL_PROFILE_ENV = "APPLE_MAIL_MCP_TOOL_PROFILE";
export declare const ALLOWED_TOOLS_ENV = "APPLE_MAIL_MCP_ALLOWED_TOOLS";
export declare const DISABLED_TOOLS_ENV = "APPLE_MAIL_MCP_DISABLED_TOOLS";
export declare const ORGANIZE_TOOL_PROFILE: readonly ["search-messages", "get-message", "get-thread", "list-messages", "mark-as-read", "mark-as-unread", "flag-message", "unflag-message", "move-message", "batch-move-messages", "batch-mark-as-read", "batch-mark-as-unread", "batch-flag-messages", "batch-unflag-messages", "list-attachments", "save-attachment", "fetch-attachment", "list-mailboxes", "list-accounts", "get-unread-count", "get-mail-stats", "get-sync-status", "health-check", "doctor"];
export type ToolProfile = "full" | "organize";
export interface ToolPolicy {
    profile: ToolProfile;
    allowedTools?: ReadonlySet<string>;
    disabledTools: ReadonlySet<string>;
}
export declare function parseToolList(raw: string | undefined): Set<string>;
export declare function resolveToolPolicy(env?: NodeJS.ProcessEnv): ToolPolicy;
export declare function isToolEnabled(name: string, policy: ToolPolicy): boolean;
export declare function toolPolicySummary(policy: ToolPolicy): string;
//# sourceMappingURL=toolPolicy.d.ts.map