import { inflateSync } from "node:zlib";

/** Reads the PDFKit-generated Flate streams and PDF literal strings, without applying a reader's
 * visual bidi heuristics. ActualText is the PDF replacement-text contract, not a font glyph map. */
export function pdfActualText(bytes: Uint8Array): string[] {
  const binary = Buffer.from(bytes).toString("latin1"), values: string[] = [];
  // PDFKit emits LF before endstream. Do not consume a preceding CR byte: it may be the
  // final byte of the compressed checksum rather than an extra newline.
  for (const match of binary.matchAll(/stream\r?\n([\s\S]*?)\nendstream/g)) {
    let content: string;
    try { content = inflateSync(Buffer.from(match[1], "latin1")).toString("latin1"); } catch { continue; }
    for (const literal of content.matchAll(/\/ActualText\s*\(((?:\\[\s\S]|[^\\)])*)\)/g)) {
      const encoded: number[] = [], value = literal[1];
      for (let i = 0; i < value.length; i++) {
        if (value[i] !== "\\") { encoded.push(value.charCodeAt(i)); continue; }
        const char = value[++i], escape = { n: 10, r: 13, t: 9, b: 8, f: 12 }[char];
        if (escape !== undefined) encoded.push(escape);
        else if (/[0-7]/.test(char)) { let octal = char; while (octal.length < 3 && /[0-7]/.test(value[i + 1] ?? "")) octal += value[++i]; encoded.push(parseInt(octal, 8)); }
        else if (char === "\r" || char === "\n") { if (char === "\r" && value[i + 1] === "\n") i++; }
        else encoded.push(char.charCodeAt(0));
      }
      const buffer = Buffer.from(encoded);
      if (buffer[0] === 0xfe && buffer[1] === 0xff) values.push(buffer.subarray(2).swap16().toString("utf16le"));
      else values.push(buffer.toString("latin1"));
    }
  }
  return values;
}
