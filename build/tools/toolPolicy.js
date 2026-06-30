/**
 * Tool exposure policy for local deployments.
 *
 * Upstream exposes every Apple Mail capability by default. A local fork can use
 * these environment variables to hide high-risk tools before the MCP client ever
 * sees them in tools/list.
 */
export const TOOL_PROFILE_ENV = "APPLE_MAIL_MCP_TOOL_PROFILE";
export const ALLOWED_TOOLS_ENV = "APPLE_MAIL_MCP_ALLOWED_TOOLS";
export const DISABLED_TOOLS_ENV = "APPLE_MAIL_MCP_DISABLED_TOOLS";
export const ORGANIZE_TOOL_PROFILE = [
    "search-messages",
    "get-message",
    "get-thread",
    "list-messages",
    "mark-as-read",
    "mark-as-unread",
    "flag-message",
    "unflag-message",
    "move-message",
    "batch-move-messages",
    "batch-mark-as-read",
    "batch-mark-as-unread",
    "batch-flag-messages",
    "batch-unflag-messages",
    "list-attachments",
    "save-attachment",
    "fetch-attachment",
    "list-mailboxes",
    "list-accounts",
    "get-unread-count",
    "get-mail-stats",
    "get-sync-status",
    "health-check",
    "doctor",
];
export function parseToolList(raw) {
    if (!raw)
        return new Set();
    return new Set(raw
        .split(/[,\s]+/)
        .map((name) => name.trim())
        .filter(Boolean));
}
export function resolveToolPolicy(env = process.env) {
    const rawProfile = (env[TOOL_PROFILE_ENV] ?? "full").trim().toLowerCase();
    const profile = rawProfile === "" ? "full" : rawProfile;
    let profileAllowed;
    if (profile === "organize") {
        profileAllowed = new Set(ORGANIZE_TOOL_PROFILE);
    }
    else if (profile !== "full") {
        throw new Error(`${TOOL_PROFILE_ENV} must be "full" or "organize" when set; got "${rawProfile}"`);
    }
    const explicitAllowed = parseToolList(env[ALLOWED_TOOLS_ENV]);
    const allowedTools = explicitAllowed.size > 0 ? explicitAllowed : profileAllowed;
    return {
        profile: profile,
        allowedTools,
        disabledTools: parseToolList(env[DISABLED_TOOLS_ENV]),
    };
}
export function isToolEnabled(name, policy) {
    if (policy.disabledTools.has(name))
        return false;
    if (policy.allowedTools && !policy.allowedTools.has(name))
        return false;
    return true;
}
export function toolPolicySummary(policy) {
    const allow = policy.allowedTools ? [...policy.allowedTools].sort().join(",") : "*";
    const deny = [...policy.disabledTools].sort().join(",");
    return `profile=${policy.profile} allow=${allow} deny=${deny || "-"}`;
}
