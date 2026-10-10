import { expect, test } from "vitest";
import { preserveTextLineEndings } from "@/lib/preserve-text-line-endings";

test("unmodified textarea values preserve all original newline kinds and raw surrounding spaces", () => {
  const raw = "  A\r\nB\rC\nD  ";
  expect(preserveTextLineEndings(raw, "  A\nB\nC\nD  ")).toBe(raw);
});
test("inserting or deleting text keeps CR and CRLF outside the changed range", () => {
  const raw = "앞\r\n가운데\r끝";
  expect(preserveTextLineEndings(raw, "앞!\n가운데\n끝")).toBe("앞!\r\n가운데\r끝");
  expect(preserveTextLineEndings(raw, "앞\n가운\n끝")).toBe("앞\r\n가운\r끝");
  expect(preserveTextLineEndings(raw, "앞\n가운데\n끝😀")).toBe("앞\r\n가운데\r끝😀");
});
test("intentional line-break edits replace only the affected range", () => {
  expect(preserveTextLineEndings("a\r\nb\rc", "ab\nc")).toBe("ab\rc");
  expect(preserveTextLineEndings("a\r\nb\rc", "a\n\nb\nc")).toBe("a\r\n\nb\rc");
  expect(preserveTextLineEndings("a\r\nb\rc", "replaced\ntext")).toBe("replaced\ntext");
});
test("LF-only and ordinary Unicode editing pass through without trimming or surrogate splitting", () => {
  expect(preserveTextLineEndings("😀\nA", "  😀\nB  ")).toBe("  😀\nB  ");
  expect(preserveTextLineEndings("😀\r\nA", "😁\nA")).toBe("😁\r\nA");
});
