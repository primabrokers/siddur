/** Tiny classname joiner — no dependency, no merge magic. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
