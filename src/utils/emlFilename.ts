/**
 * Filename derivation for `export-message-source`.
 *
 * DEVONthink names an imported record after the **filename**, not the Subject
 * header (measured, not assumed — see docs/FEATURE-BRIEF-EXPORT-MSG-SOURCE.md).
 * So a `{message-id}.eml` default would produce a record literally named
 * "83465". The default here is `YYYY-MM-DD Subject.eml` instead.
 *
 * The date is redundant for DEVONthink (it parses the Date header into
 * creationDate), but it sorts usefully in Finder and disambiguates the many
 * messages that share a subject ("Re: standup").
 *
 * @module utils/emlFilename
 */

import { decodeEncodedWords } from "@/utils/mimeParse.js";

/** Stem byte budget. macOS caps a filename at 255 bytes; ".eml" takes 4, and
 *  the rest is headroom so a long subject stays readable rather than maximal. */
const MAX_STEM_BYTES = 200;

export interface EmlFilenameInput {
  /** Message id, used only for the fallback stem when there's no usable subject. */
  id: string;
  /** Raw Subject header value; may be RFC 2047 encoded. */
  subject?: string;
  /** Date header value (string) or a parsed Date. */
  date?: Date | string;
}

/**
 * Strip everything that makes a string unsafe or unpleasant as a filename.
 *
 * Path separators and NUL are replaced, which is what actually closes the
 * traversal vector: with no separators, a resolved `dir/<name>` cannot escape
 * `dir`, so a literal ".." *inside* a name is inert and we leave it alone
 * rather than mangling every ellipsis ("Re: Foo... Bar"). Leading dots are
 * stripped so a subject of "..." or "." cannot produce a relative path
 * component or a hidden file.
 */
export function sanitiseFilenameComponent(value: string): string {
  return (
    value
      // Path separators, and ":" which Finder still renders as "/".
      .replace(/[/\\:]/g, "-")
      // NUL and other control characters.
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1f\x7f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^\.+/, "")
      .trim()
  );
}

/** Truncate to a UTF-8 byte budget without splitting a code point. */
export function truncateToBytes(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  let out = "";
  let used = 0;
  for (const ch of value) {
    const size = Buffer.byteLength(ch, "utf8");
    if (used + size > maxBytes) break;
    out += ch;
    used += size;
  }
  return out.trimEnd();
}

/** `YYYY-MM-DD` in local time, or undefined when the date is absent/unparseable. */
function formatDateStem(date: Date | string | undefined): string | undefined {
  if (date === undefined) return undefined;
  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.getTime())) return undefined;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
}

/**
 * Build the default `.eml` filename for a message.
 *
 * Falls back to `message-<id>` when the subject is missing or sanitises away to
 * nothing, so the result is always a usable name.
 */
export function deriveEmlFilename({ id, subject, date }: EmlFilenameInput): string {
  const decodedSubject = subject ? decodeEncodedWords(subject) : "";
  const subjectStem = sanitiseFilenameComponent(decodedSubject);
  const sanitisedId = sanitiseFilenameComponent(id);
  const fallbackStem = sanitisedId ? `message-${sanitisedId}` : "message";

  const datePart = formatDateStem(date);
  const namePart = subjectStem || fallbackStem;

  const stem = truncateToBytes(datePart ? `${datePart} ${namePart}` : namePart, MAX_STEM_BYTES);

  // Truncation can strip the name back to just the date (or to nothing) when
  // the subject's first characters are wide; never emit a bare or empty stem.
  return `${stem || fallbackStem}.eml`;
}
