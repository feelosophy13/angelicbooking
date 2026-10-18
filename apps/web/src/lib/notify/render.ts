/** Fill {placeholders} in text-message wording. Pure, so the browser (the Inbox composer) can use it too. */
export function renderSms(template: string, vars: Record<string, string>): string {
  return template
    .replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] == null ? m : vars[k]))
    .replace(/[ \t]+/g, " ")
    .trim();
}
