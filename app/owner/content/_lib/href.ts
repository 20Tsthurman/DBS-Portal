/** The two ways to look at a month of content. Calendar is the default. */
export type ContentView = "calendar" | "list";

/**
 * Canonical link builder for the content surface. All three filters live in
 * the URL (month + client + view), so every filter control has to preserve
 * the other two — building the query string in one place keeps them from
 * drifting.
 *
 * `view=calendar` is the default and is deliberately omitted from URLs, so
 * pre-Phase-3 links (and the nav entry) land on the calendar without a
 * redirect.
 */
export function contentHref(params: {
  monthKey: string;
  clientId?: string | null;
  view?: ContentView;
}): string {
  const search = new URLSearchParams();
  search.set("month", params.monthKey);
  if (params.clientId) search.set("clientId", params.clientId);
  if (params.view === "list") search.set("view", "list");
  return `/owner/content?${search.toString()}`;
}
