/**
 * /owner/settings — admin surface for app-wide configuration plus the
 * Phase-4 recurring expense templates. The page is structured as two
 * stacked sections inside a single client board:
 *
 *   1. Business Settings — home_address, mileage_rate_per_mile,
 *      tax_set_aside_percent. These flow into financials calculations.
 *   2. Recurring Expense Templates — the producer/admin UI for the
 *      table that drives monthly expense suggestions on /owner/financials.
 *
 * Page auth: relies on the owner-only guard in app/owner/layout.tsx;
 * matches the rest of the owner routes.
 */

import { SettingsBoard } from "./_components/SettingsBoard";
import {
  fetchAllTemplates,
  fetchAppSettings,
  fetchGoogleCalendarChoices,
  fetchGoogleCalendarStatus,
  fetchPackages,
} from "./_lib/queries";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function OwnerSettingsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const googleNotice =
    typeof params.google === "string" ? params.google : null;

  const [settings, templates, packages, googleStatus, googleCalendars] =
    await Promise.all([
      fetchAppSettings(),
      fetchAllTemplates(),
      fetchPackages(),
      fetchGoogleCalendarStatus(),
      fetchGoogleCalendarChoices(),
    ]);

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      <h1
        style={{
          fontFamily: "var(--font-playfair), serif",
          fontSize: 32,
          fontWeight: 500,
          color: "var(--text-primary)",
          letterSpacing: "-0.01em",
          marginBottom: 24,
        }}
      >
        Settings
      </h1>
      <SettingsBoard
        initialSettings={settings}
        initialTemplates={templates}
        initialPackages={packages}
        initialGoogleStatus={googleStatus}
        initialGoogleCalendars={googleCalendars}
        googleNotice={googleNotice}
      />
    </div>
  );
}
