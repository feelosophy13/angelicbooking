/** iCalendar (RFC 5545) text helpers for the calendar feed. Pure, so they are unit tested. */

/** RFC 5545 text: backslash, semicolon and comma escaped, line breaks as \n. */
export const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** RFC 5545 folding: no line longer than 75 octets; continuation lines start with a space. Never splits a UTF-8 character. */
export function fold(line: string): string {
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (bytes + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}
