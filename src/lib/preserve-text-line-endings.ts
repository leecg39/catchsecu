/** Textareas expose LF-only values. Keep original line endings outside the edited range. */
export function preserveTextLineEndings(previous: string, next: string): string {
  const visible = previous.replace(/\r\n?/g, "\n");
  if (visible === next) return previous;
  if (!previous.includes("\r")) return next;
  const offsets = [0];
  for (let offset = 0; offset < previous.length;) {
    offset += previous[offset] === "\r" && previous[offset + 1] === "\n" ? 2 : 1;
    offsets.push(offset);
  }
  let start = 0;
  while (start < visible.length && start < next.length && visible[start] === next[start]) start++;
  let oldEnd = visible.length, newEnd = next.length;
  while (oldEnd > start && newEnd > start && visible[oldEnd - 1] === next[newEnd - 1]) { oldEnd--; newEnd--; }
  return previous.slice(0, offsets[start]) + next.slice(start, newEnd) + previous.slice(offsets[oldEnd]);
}
