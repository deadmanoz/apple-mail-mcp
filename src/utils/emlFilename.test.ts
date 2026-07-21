import { describe, it, expect } from "vitest";
import {
  deriveEmlFilename,
  sanitiseFilenameComponent,
  truncateToBytes,
} from "@/utils/emlFilename.js";

describe("sanitiseFilenameComponent", () => {
  it("replaces path separators and colons", () => {
    expect(sanitiseFilenameComponent("a/b\\c:d")).toBe("a-b-c-d");
  });

  it("strips control characters including NUL", () => {
    expect(sanitiseFilenameComponent("in\x00v\x1foi\x7fce")).toBe("invoice");
  });

  it("collapses whitespace runs", () => {
    expect(sanitiseFilenameComponent("Re:   the    standup")).toBe("Re- the standup");
  });

  it("strips leading dots so the name can't be relative or hidden", () => {
    expect(sanitiseFilenameComponent("...hidden")).toBe("hidden");
    expect(sanitiseFilenameComponent("..")).toBe("");
    expect(sanitiseFilenameComponent(".")).toBe("");
  });

  it("leaves an interior ellipsis alone", () => {
    expect(sanitiseFilenameComponent("Re: Foo... Bar")).toBe("Re- Foo... Bar");
  });

  it("defuses traversal by removing separators, leaving no path components", () => {
    const out = sanitiseFilenameComponent("../../etc/passwd");
    expect(out).not.toMatch(/[/\\]/);
    expect(out).toBe("-..-etc-passwd");
  });
});

describe("truncateToBytes", () => {
  it("returns the input untouched when it fits", () => {
    expect(truncateToBytes("hello", 10)).toBe("hello");
  });

  it("truncates to the byte budget", () => {
    expect(truncateToBytes("abcdefghij", 4)).toBe("abcd");
  });

  it("never splits a multi-byte code point", () => {
    // Each "é" is 2 bytes in UTF-8; a 3-byte budget must yield one "é".
    const out = truncateToBytes("éé", 3);
    expect(out).toBe("é");
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(3);
  });

  it("keeps surrogate pairs intact", () => {
    // "😀" is 4 bytes; a 5-byte budget fits exactly one.
    const out = truncateToBytes("😀😀", 5);
    expect(out).toBe("😀");
  });

  it("trims trailing whitespace left by the cut", () => {
    expect(truncateToBytes("ab cdef", 3)).toBe("ab");
  });
});

describe("deriveEmlFilename", () => {
  it("builds 'YYYY-MM-DD Subject.eml' from a Date header", () => {
    expect(
      deriveEmlFilename({
        id: "83465",
        subject: "Invoice from Acme",
        date: "Tue, 15 Jul 2026 09:14:22 +1000",
      })
    ).toBe("2026-07-15 Invoice from Acme.eml");
  });

  it("accepts a Date object", () => {
    expect(deriveEmlFilename({ id: "1", subject: "Hi", date: new Date(2026, 0, 5) })).toBe(
      "2026-01-05 Hi.eml"
    );
  });

  it("decodes an RFC 2047 subject rather than naming the record after the encoding", () => {
    expect(deriveEmlFilename({ id: "1", subject: "=?UTF-8?B?Q2Fmw6k=?=" })).toBe("Café.eml");
  });

  it("omits the date when absent", () => {
    expect(deriveEmlFilename({ id: "1", subject: "No date here" })).toBe("No date here.eml");
  });

  it("omits the date when unparseable", () => {
    expect(deriveEmlFilename({ id: "1", subject: "Bad date", date: "not a date" })).toBe(
      "Bad date.eml"
    );
  });

  it("falls back to the id when the subject is missing", () => {
    expect(deriveEmlFilename({ id: "83465" })).toBe("message-83465.eml");
  });

  it("falls back to the id when the subject sanitises away to nothing", () => {
    expect(deriveEmlFilename({ id: "83465", subject: "..." })).toBe("message-83465.eml");
  });

  it("sanitises the id in the fallback stem (imap: ids carry a colon)", () => {
    expect(deriveEmlFilename({ id: "imap:aGVsbG8" })).toBe("message-imap-aGVsbG8.eml");
  });

  it("produces a name with no path separators from a hostile subject", () => {
    const name = deriveEmlFilename({ id: "1", subject: "../../etc/passwd" });
    expect(name).not.toMatch(/[/\\]/);
    expect(name.endsWith(".eml")).toBe(true);
  });

  it("keeps the filename within the macOS 255-byte limit for a long subject", () => {
    const name = deriveEmlFilename({ id: "1", subject: "A".repeat(500) });
    expect(Buffer.byteLength(name, "utf8")).toBeLessThanOrEqual(255);
    expect(name.endsWith(".eml")).toBe(true);
  });

  it("keeps a long multi-byte subject within the byte limit without splitting a code point", () => {
    const name = deriveEmlFilename({ id: "1", subject: "é".repeat(500) });
    expect(Buffer.byteLength(name, "utf8")).toBeLessThanOrEqual(255);
    expect(name).not.toContain("�");
  });

  it("always yields a usable stem, never a bare extension", () => {
    expect(deriveEmlFilename({ id: "", subject: "" })).toBe("message.eml");
  });
});
