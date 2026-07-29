/** Restricts a post-refresh redirect target to same-origin relative paths, so a
 * crafted `?next=` cannot bounce the user to an external site. */
export function sanitizeNextPath(input: string | null | undefined, fallback = "/dashboard"): string {
  if (!input) return fallback;
  return input.startsWith("/") && !input.startsWith("//") ? input : fallback;
}
