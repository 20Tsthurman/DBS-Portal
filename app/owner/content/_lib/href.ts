/**
 * Canonical link builder for the content surface. Both filters live in the
 * URL (month + client), so every filter control has to preserve the other
 * one — building the query string in one place keeps them from drifting.
 */
export function contentHref(params: {
  monthKey: string;
  clientId?: string | null;
}): string {
  const search = new URLSearchParams();
  search.set("month", params.monthKey);
  if (params.clientId) search.set("clientId", params.clientId);
  return `/owner/content?${search.toString()}`;
}
