# Feature Brief: `export-message-source` Tool for Apple Mail MCP

## Problem

The Apple Mail MCP server cannot export a message's raw MIME source (`.eml` file). Users who want to archive emails into other systems (e.g. DEVONthink, which natively imports `.eml` files as email records with full header/body/attachment preservation) must manually drag-and-drop from Mail.app. The MCP can already read bodies, list/save individual attachments, and mark messages, but cannot produce the complete message as a single file.

## Existing Capability

`AppleMailManager.getRawSource(id)` exists at `src/services/appleMailManager.ts:1201` and retrieves the raw MIME source via AppleScript (`source of msg`). It is currently only used internally for attachment fallback extraction and by the SMTP reply/forward paths (`src/index.ts:1082`, `src/index.ts:1115`).

The IMAP backend already fetches raw source: `imapGetMessage` at `src/services/imapClient.ts:959` issues `fetchOne(uid, { envelope: true, source: true })`, and `ImapMessage.source` is typed `Buffer | string` (`src/services/imapClient.ts:91`).

**The two backends do not have equal fidelity, and this is the central design constraint.**

## Fidelity: The Central Constraint

The goal is a byte-faithful `.eml`, "as if dragged from Mail.app". Only one backend delivers that.

**IMAP is byte-exact.** `msg.source` arrives as a `Buffer` straight off the wire.

**AppleScript is not.** `getRawSource` runs through `executeAppleScript`, which is `execSync(cmd, { encoding: "utf8" })` followed by `.trim()` (`src/utils/applescript.ts`). The bytes make this round trip:

1. Mail decodes the message into an AppleScript Unicode string
2. osascript re-encodes it as UTF-8 on stdout
3. Node decodes that back into a JS string
4. `.trim()` mutates the leading/trailing bytes

For a message with `Content-Transfer-Encoding: 8bit` and a non-UTF-8 charset (Windows-1252, ISO-8859-1, Shift-JIS), the emitted `.eml` declares one charset but carries UTF-8 bytes. Most modern mail is base64 or quoted-printable with ASCII headers and survives this intact, but the failure mode is silent and lands in the archive.

**This is not theoretical.** A probe imported into DEVONthink with `charset=iso-8859-1` + `8bit` + genuine Latin-1 bytes rendered correctly (`Café costs 5 GBP: naïve Zürich`), proving DT honours the declared charset. A charset/bytes mismatch introduced by the AppleScript round trip will therefore render as mojibake (`CafÃ©`) in DEVONthink.

### Measured: the AppleScript path normalises CRLF to LF

Exporting a real message (id 69952, 38170 bytes) produced a file with **zero CRLF pairs and 1030 bare LFs**. RFC 5322 mandates CRLF, so Mail's scripting bridge is rewriting line endings before we ever see the source — the tool itself never touches them (`Buffer.from(source, "utf8")`).

This settles the fidelity question more decisively than the charset case, and in a worse way: charset corruption needs a rare combination (non-UTF-8 charset *and* an 8-bit transfer encoding), whereas **every** AppleScript export loses CRLF. `backend: "applescript"` is a normalised text rendering of the message, not its bytes. Anything byte-sensitive (DKIM signature verification, checksums against the server copy) will fail on it.

**It does not, however, break the DEVONthink use case.** The same LF-only file imported as `kind: "Email Message"` with the filename-derived record name, the Date header parsed into `creationDate`, a reconstructed reply `mailto:`, and a fully parsed body (242 words). Python's `email` parser also read it without complaint. DEVONthink, Thunderbird, and Python are all lenient about line endings.

**Open decision:** whether to normalise LF back to CRLF on the AppleScript path before writing. It would make the `.eml` RFC 5322-compliant for strict consumers, and no legitimate email body contains a bare LF that isn't a line break (bodies are CRLF-terminated; base64/QP lines likewise), so the reconstruction is well-defined. Against: it is a fabrication rather than a restoration, it stacks a second transformation on the first, and the actual target (DEVONthink) demonstrably does not need it.

### Measured: real mail mostly dodges the charset risk anyway

The sampled message declared `charset=utf-8` with `Content-Transfer-Encoding: quoted-printable` on both its `text/plain` and `text/html` parts. QP and base64 are ASCII on the wire and therefore immune to the UTF-8 re-encoding. This is typical of modern mail, which is why the charset risk stays latent rather than routine — it needs old or non-Western mail using 8-bit bodies.

**Current deployment note:** `.mcp.json` sets only `APPLE_MAIL_MCP_TOOL_PROFILE=organize`, with no `APPLE_MAIL_MCP_IMAP_*` vars. The local server is AppleScript-only today, so the lossy path is the one that would actually run. See `docs/IMAP-SETUP.md`.

## DEVONthink Behaviour (measured, not assumed)

Probes were built as synthetic `.eml` files, imported via the DT MCP, and inspected.

| Question | Answer |
|----------|--------|
| Record type | `recordType: "email"`, `kind: "Email Message"`, stored under `Files.noindex/eml/`. Same as drag-and-drop. |
| Record name source | **The filename, not the Subject header.** A probe whose filename and Subject deliberately disagreed was named after the filename. |
| Date header | Parsed. `Tue, 15 Jul 2026 09:14:22 +1000` became `creationDate` correct to the second. |
| Reply URL | Reconstructed from headers: `mailto:<from>?subject=Re:%20<subject>&in-reply-to=<message-id>`. |
| Attachments | Preserved, rendered inline as U+FFFC in extracted text. |
| Charset | Declared charset is honoured. See above. |
| Dedup | **None.** Message-ID becomes the record UUID on first import; a re-import gets a fresh generated UUID and creates a duplicate record. |

**Consequence:** the default filename must be derived from the Subject. A `{message-id}.eml` default produces a DEVONthink record literally named `83465`.

**Consequence:** re-running an export duplicates records. Check `get_record_by_identifier` on the Message-ID before importing.

## Blocker: DT `import_file` Exposure

The DT MCP currently exposes only `import_from_data` (base64). `import_file`, `import_directory`, `import_with_options`, `index_path`, the plist readers, `create_from_url`, and `reveal_record` are all hidden. That hidden set is exactly `DEFAULT_UNSAFE_TOOLS` in `~/dev/devonthink-mcp-server/src/config.ts`, which is only applied when `remoteMode` is true.

This is unexplained: `~/.claude.json` has `env: {}` for the server, `REMOTE_MODE` is absent from the running processes' environments, and `import_file` is present in the built `dist/tools/importFile.js`. By the config logic it should be exposed.

Until this is resolved, an `.eml` on disk cannot reach DEVONthink by path, and the export workflow dead-ends. **Resolve this before implementing.**

(`import_from_data` also prefixes the record name with `devonthink-mcp-<uuid>-` from its temp file unless `customName` is passed.)

## Proposed Tool

**Name:** `export-message-source`

**Description:** Export a single message's raw MIME source to disk as an `.eml` file.

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | yes | Message ID (numeric AppleScript ID or `imap:…` token) |
| `savePath` | string | yes | Absolute directory path to write the `.eml` file to |
| `filename` | string | no | Custom filename. Default is derived from the message's Date and Subject. |

**No inline base64 path.** The file is the deliverable; nothing downstream reads raw MIME out of the model's context, and a single ordinary photo attachment would exceed the context window once base64-expanded 4:3.

**Output:** `{ ok, id, filePath, bytes, backend }`. `backend` is `"imap"` or `"applescript"` so a caller can distinguish a byte-exact export from a re-encoded one.

**Default filename:** `YYYY-MM-DD Sanitised Subject.eml`, from the message's own Date and Subject. Sanitise `/`, `\`, `:`, NUL and leading dots; truncate to ~200 chars leaving room for the extension; fall back to the message id when the subject is empty. The date is not needed for DEVONthink (it parses the header) but helps Finder sorting and disambiguates same-subject messages.

## Implementation Plan

### Step 0 (blocking): DT `import_file` exposure

Resolve why filesystem tools are filtered and restore `import_file`. Without it there is no loop to ship into.

### `src/services/appleMailManager.ts`

Add `getRawSourceResult(id): { ok, source?, error? }`. The existing `getRawSource` swallows every failure: its AppleScript ends `on error errMsg return ""`, and the wrapper collapses `!result.success || !output.trim()` into `null`. Message-not-found, Automation-denied, 120s timeout, and genuinely-empty all become the same `null`. Acceptable for an attachment fallback; not for a user-facing export tool.

Reimplement `getRawSource` as a thin wrapper over the new function so the four existing callers (`appleMailManager.ts:2270`, `:2339`, `index.ts:1082`, `:1115`) are untouched.

### `src/services/imapClient.ts`

Add `imapFetchMessageSource(id, deps): { success, source?: Buffer, subject?, date?, error? }` via `fetchOne(uid, { envelope: true, source: true })`. The envelope supplies Subject and Date for the filename without a second round trip. **Return the `Buffer`, not a string.**

### `src/index.ts`

Register `export-message-source` following the `save-attachment` shape (`src/index.ts:1664`), branching on `id.startsWith("imap:")` in the handler.

**Do not use `routeMessage`.** It is built for mutations returning short ack strings: `ImapOpResult.info` is a `string`, which is why `imapGetMessage` calls `msg.source.toString()`. Pushing a `Buffer` through it re-encodes the bytes and discards the one path that has real fidelity. `save-attachment` / `fetch-attachment` are the codebase's established pattern for byte-carrying tools.

Reuse save-attachment's filename validation (separators, `..`, NUL), resolve and check `isPathWithinAllowedRoots(savePath)` (`appleMailManager.ts:202`), write, return the structured result.

### `src/tools/toolPolicy.ts`

Add `export-message-source` to `ORGANIZE_TOOL_PROFILE`. Read-only, no send/mutate capability.

## Security Considerations

- **File write path:** same allowed-roots validation as `save-attachment`, via `isPathWithinAllowedRoots(resolve(savePath))`.
- **Filename injection:** the subject-derived default is attacker-controlled (the sender picks the subject). Sanitise separators, `..`, NUL, and leading dots before it reaches the filesystem, and re-check the joined path against allowed roots after `resolve`.
- **No content filtering:** the raw source includes all headers. Expected; the user is explicitly requesting the raw message.
- **No size cap needed** without the base64 path. Disk writes are bounded by the 64MB osascript buffer (`APPLE_MAIL_MCP_MAX_BUFFER`) on the AppleScript side.

## Testing

- Filename derivation and sanitisation, including hostile subjects (`../../etc/passwd`, NUL, 500 chars, empty).
- Allowed-roots rejection for `savePath`.
- IMAP path with a fake client, asserting the `Buffer` lands byte-for-byte (mirror the existing `imapFetchAttachment` test style).
- Distinct error reporting for not-found vs timeout vs permission-denied.
- `test/output-schema.test.ts` enumerates tools, so it picks the new one up automatically.
- **Charset test (decides the AppleScript path's fate):** export a message with a non-UTF-8 8-bit body via both backends, import both into DEVONthink, confirm accented characters render correctly rather than as mojibake. If AppleScript fails this, the options are to declare it lossy in the tool description, configure IMAP, or pursue `.emlx`.
- End-to-end: exported `.eml` imports into DEVONthink matching a drag-and-drop import of the same message.

## Rejected Alternative: `.emlx`

Mail's on-disk `.emlx` files are the original bytes (length line, raw RFC822, plist), so `.emlx` to `.eml` is trivial and byte-exact for AppleScript-backed accounts. Not pursued: `ls ~/Library/Mail` returns `Operation not permitted`, so it needs Full Disk Access granted to whatever runs the MCP server, and the AppleScript-id to emlx-path mapping is undocumented and version-fragile. Worth revisiting only if the charset test proves the AppleScript path unfit and IMAP is not an option.

## Scope

Fork-local. `toolPolicy.ts` is documented as fork-only, and the tool ships in the same commit as its profile entry.

The working tree is mid-flight on `feature/no-send-organize-profile` with uncommitted edits to `src/index.ts`, `appleMailManager.ts`, `test/output-schema.test.ts`, `CHANGELOG.md`, plus an unsquashed `fixup!` commit. Land that first. `build/` is tracked and needs rebuilding as part of the change.

## Priority

Low. The capability mostly exists internally, but "expose the existing function" undersells it: the AppleScript path's fidelity, `getRawSource`'s swallowed diagnostics, and the subject-derived filename are all real work.
