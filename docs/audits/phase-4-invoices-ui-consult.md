# Phase 4 — Invoices: UI placement consult

Read-only recommendation on two open UI placement questions, grounded in
the existing portal layout. The audit at
`docs/audits/phase-4-invoices-audit.md` is the prerequisite read.

---

## Question 1 — Owner-side invoice surface

**Recommendation: Option A — new top-level `/owner/invoices` route, plus a
filtered list inside the per-client `Invoices` tab.**

### Reasoning

- The financials page is already a dense two-column grid at desktop
  width. `FinancialsBoard.tsx:823-871` lays out three `DashboardCard`s
  (Income, Expenses, Mileage) inside `.financials-main-grid`, plus a
  `.financials-insights-pair` (Breakdown + Insights) as the fourth grid
  cell:

  ```tsx
  <div className="financials-main-grid">
    <DashboardCard eyebrow="INCOME" title="Payments received">...</DashboardCard>
    <DashboardCard eyebrow="EXPENSES" title="Expenses logged">...</DashboardCard>
    <DashboardCard eyebrow="MILEAGE" title="Trips logged">...</DashboardCard>

    <div className="financials-insights-pair">
      <BreakdownPanel summary={summary} />
      <InsightsPanel ... />
    </div>
  </div>
  ```

  ```tsx
  .financials-main-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
  }
  @media (max-width: 1280px) {
    .financials-main-grid { grid-template-columns: 1fr; }
  }
  ```

  The grid is a 2×2 today (three editable tables + the insights pair).
  Adding a fourth `DashboardCard` for INVOICES displaces the
  `.financials-insights-pair` into a fifth cell, breaking the visual
  symmetry — either Insights gets pushed onto its own row or invoices
  do. Either way the page becomes a 2×3 wall of tables on a screen that
  collapses to one column below 1280px. That's "crowded" by the
  prompt's own criterion.

- Toolbar collision. `FinancialsToolbar` (`FinancialsToolbar.tsx:30-104`)
  is a month/YTD scrubber and applies to all three existing tables
  uniformly. Invoices have a different scoping primitive — status
  (`draft | sent | paid | overdue`) and "outstanding now" cuts across
  months. Cramming both axes into the same toolbar (or hanging a
  per-card filter off only the invoices card) is awkward; the existing
  invariant "every table on this page is filtered by the same month
  range" stops holding.

- The "what's outstanding across all clients?" scan that the prompt
  calls out as a real recurring need is a **status-led, time-agnostic**
  list. That's not what `/owner/financials` is shaped to surface — it's
  a month/YTD ledger. A dedicated route can default to `?status=open`
  (sent + overdue) and skip the month picker entirely.

- Owner nav (`app/owner/layout.tsx:7-16`) already runs eight items:

  ```ts
  const ownerNav: SidebarNavItem[] = [
    { label: "Dashboard", href: "/owner/dashboard" },
    { label: "Clients", href: "/owner/clients" },
    { label: "Shoots", href: "/owner/shoots" },
    { label: "Calendar", href: "/owner/calendar" },
    { label: "Time Tracker", href: "/owner/time" },
    { label: "Financials", href: "/owner/financials" },
    { label: "Messages", href: "/owner/messages" },
    { label: "Settings", href: "/owner/settings" },
  ];
  ```

  Nine items is fine — the sidebar isn't space-constrained — and
  Invoices is a discoverable, top-level concept (a paid service tool,
  not a sub-card of bookkeeping).

- The per-client `Invoices` tab already exists as a placeholder
  (`app/owner/clients/[id]/page.tsx:100-104`):

  ```tsx
  {
    key: "invoices",
    label: "Invoices",
    content: <PlaceholderPanel message="Invoices coming in Phase 4." />,
  }
  ```

  Filling it with a filtered embed of the same list component used by
  `/owner/invoices` is cheap (pass `clientId` as a filter prop) and
  matches the precedent of `FilesPanel` being reused both inside the
  per-client tab and standing on its own.

- Option C (per-client tab only) fails the "scan outstanding across all
  clients" requirement and forces a click-through-the-client wall every
  time Kelsey wants to chase a payment. Reject.

- Option B (fourth card in financials) sacrifices both visual rhythm
  and the page's coherent "month ledger" mental model to save one
  sidebar entry. Wrong trade.

### Unintended consequences

- Two list surfaces means two render paths to keep consistent (global
  + per-client). Mitigated by making the per-client tab render the
  same list component with a `clientId` filter; the component owns
  empty/loading/error states once.
- `revalidatePath` calls in `_actions.ts` need to hit both
  `/owner/invoices` and `/owner/clients/[id]` when mutating an invoice
  attached to a client, otherwise the per-client embed goes stale. Cheap
  but easy to forget — call this out in the action helpers.
- A future "P&L on financials" view will want invoice totals (sent vs.
  paid this month). That's a read-only roll-up the financials page can
  fetch directly without owning the editing UI — no conflict with the
  recommendation, but worth noting now so the data layer is shaped to
  serve both surfaces from one query module.
- The dashboard's existing `BudgetStatusWidget`
  (`app/owner/dashboard/page.tsx:11`) is the natural home for an
  "outstanding invoices" stat tile later; this recommendation doesn't
  preclude that.

---

## Question 2 — Invoice creation UI shape

**Recommendation: Option B — slide-in panel, reusing the existing
`SlidePanel` component.**

### Reasoning

- `SlidePanel` is the established form pattern across the portal. Grep
  for `SlidePanel` finds it used in **six** form surfaces:

  ```
  app\owner\clients\_components\ClientFormPanel.tsx
  app\owner\shoots\_components\ShootFormPanel.tsx
  app\owner\calendar\_components\TimeBlockFormPanel.tsx
  app\client\book\_components\RequestShootFormPanel.tsx
  app\owner\clients\[id]\_components\TimeTab.tsx
  app\owner\clients\_components\SlidePanel.tsx
  ```

  Client create/edit, shoot create/edit, calendar time-block edit,
  client-side shoot-request, and the per-row time-log editor all use
  it. The inline form in `FilesPanel.tsx` is the outlier, not the
  precedent.

- The panel is built for forms of exactly this shape. `SlidePanel.tsx:42-56`:

  ```tsx
  <aside ... style={{
    position: "fixed", top: 0, right: 0, bottom: 0,
    width: "400px",
    maxWidth: "100%",
    ...
    transform: open ? "translateX(0)" : "translateX(100%)",
    transition: "transform 200ms ease-out",
    ...
  }}>
    ...
    <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
  ```

  Fixed 400px, full viewport height, body scrolls. A 1–10-row line-item
  editor fits without dancing around the page's main content; the
  invoice list behind the panel stays where the user left it so
  dismissing the panel returns them to context.

- Invoice form complexity matches the shoot form, not the files form.
  Invoice fields are: client picker, due date, send-now toggle, optional
  memo, plus a **variable-length** line-items section with add/remove
  controls. That's significantly more form than `FilesPanel`'s inline
  expansion (`FilesPanel.tsx:340-441` — three controls: file input,
  display name, type) and roughly on par with `ShootFormPanel`
  (`ShootFormPanel.tsx:289-396` already renders kind/meetingType/client/
  datetime/location/duration/status/notes in a slide panel with
  validation). The slide panel demonstrably handles this density today.

- Inline (Option A) breaks down on the variable-length line-items
  section. Expanding to ten line-item rows above the invoices list
  shoves the list out of view, and the page begins scrolling at a
  height that depends on form state — the "scroll jank" the prompt
  flags. The FilesPanel inline pattern works specifically because the
  form is fixed-height and short.

- Inline also forces a choice between "edit happens in-place inside the
  row" (rejected — fields are too wide for a table row) and "edit
  happens in the same expanded form above the list" (works, but is
  exactly the same UX as the slide panel except worse at scroll
  containment).

- Dedicated routes (Option C) introduce a navigation step per action.
  Every other form-bearing surface in the portal is one click to open,
  Escape to close (`SlidePanel.tsx:14-20`); adding a route transition
  to create or edit an invoice is gratuitous overhead. It also doubles
  the surface area to wire up `revalidatePath` and back-navigation
  states for.

- `EditShootPanel` (`EditShootPanel.tsx:33-55`) already shows the
  URL-driven adaptation if a deep-link to "open the editor for invoice
  X" is ever needed — the panel can be rendered always-open with a
  `closeHref` and `router.push` on close. Recommendation: don't add
  URL-driven open initially; add it the first time a deep link is
  needed.

- Edit and create reuse the same panel — `ShootFormPanel` does this via
  the optional `shoot?` prop (`ShootFormPanel.tsx:24-33, 104-119`)
  switching the form between "create" and "edit" modes. Same pattern
  here: `invoice?: InvoiceRecord` prop.

### Unintended consequences

- 400px panel width is the floor for the line-items section. A row that
  shows description + amount + remove-button fits, but the description
  input is going to be narrow. If line-item descriptions are expected
  to be long ("4-month brand strategy retainer — March 2026, deliverables
  per package"), consider widening this specific panel to 480–560px
  instead of inheriting 400px — `SlidePanel` hard-codes 400px today.
  Easy to parameterize.
- Existing slide panels mount once per row (see the `useId` comment at
  `ShootFormPanel.tsx:96-99`). The invoice editor should follow that:
  one `<InvoiceFormPanel>` per row in the list, plus one for create, so
  ids don't collide and `htmlFor` resolves correctly.
- The "send immediately" toggle has irreversible side effects (PDF
  generation, email, status transition). The slide-panel pattern has
  no built-in two-step confirmation; either wire a `ConfirmDialog`
  before submit when the toggle is on, or accept that the toggle being
  off-by-default is the only safety net. Flag for build.
- Edit-after-send is locked once paid; the panel needs a read-only
  rendering mode for paid invoices (the panel is still useful as a
  detail-view) or a separate detail surface. Decide which during build.

---

## Summary

- **Q1:** Option A — new top-level `/owner/invoices` route, plus a
  filtered embed in the per-client `Invoices` tab.
- **Q2:** Option B — slide-in panel via the existing `SlidePanel`,
  taking an optional `invoice?` prop for edit mode, mirroring
  `ShootFormPanel`.
