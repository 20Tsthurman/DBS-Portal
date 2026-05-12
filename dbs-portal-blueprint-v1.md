# DBS Portal — Product Blueprint
**Digital Bloom Socials | Internal + Client Portal**
*Version 1.0 — May 2026*

---

## 1. Purpose

A private, invite-only web portal that serves two audiences:

- **Kelsey (Owner)** — her operational command center. Replaces spreadsheets, scattered notes, and manual follow-ups with a single system that stays in sync automatically.
- **Clients** — a professional, branded space to view their project, download content and invoices, pay, book shoots, and message Kelsey.

The north star: **data enters once, everything downstream updates automatically.**

---

## 2. Design Direction

### Philosophy
The portal should feel like a premium SaaS dashboard — not a website. Think Linear, Notion, or Stripe Dashboard. Calm, confident, and data-forward. The marketing site is editorial and expressive; the portal is precise and functional.

### Color Palette
Carry the DBS brand into a more utilitarian context:

| Token | Hex | Usage |
|---|---|---|
| `--surface-base` | `#E8E4D8` | Page background, main content area |
| `--surface-raised` | `#F2EDE4` | Cards, panels, table rows on hover |
| `--sidebar-bg` | `#1B3827` | Sidebar, nav |
| `--sidebar-deep` | `#132A1C` | Sidebar hover states, footer |
| `--accent` | `#A8788A` | Primary buttons, active nav indicator, badges, links |
| `--text-primary` | `#1A2B1C` | Headings, table headers |
| `--text-body` | `#4B5C4E` | Body copy, labels |
| `--text-muted` | `#7A8B7C` | Placeholder text, secondary labels |
| `--border` | `#D8D4C8` | Hairline dividers, table borders |

**Status colors — tinted from existing palette, no new colors:**
- Success: `#2D6A4F` (deep green)
- Warning: `#8B6914` (amber via tinting)
- Danger: `#7A3040` (mauve darkened)
- Neutral: `#7A8B7C`

### Typography
- **Playfair Display** — page-level headings and section titles only
- **DM Sans** — all UI: nav labels, table text, buttons, inputs, body copy
- No Luxurious Script in the portal — save it for the marketing site

### Layout Rules
- Fixed sidebar: 240px wide, forest green, full height
- Top bar: 56px, cream, shows page title + user avatar
- Content area: cream background, max-width 1200px, padding 32px
- Sharp corners everywhere — no `border-radius` on cards or buttons
- No shadows — use borders and background contrast for depth
- No glassmorphism, no blur effects
- Tables: clean, borderless rows except bottom hairline, header row in `#1A2B1C` with cream text
- Buttons: solid fill, sharp corners — primary uses `#A8788A`, secondary uses `#1B3827`

---

## 3. Tech Stack

| Layer | Tool | Why |
|---|---|---|
| Framework | Next.js 15 (App Router) | What we know, server components, API routes |
| Auth | Clerk | Invite-only flow, role-based access, Google SSO |
| Database | Supabase (Postgres) | Free tier, file storage included, real-time capable |
| Payments | Stripe | Invoices, Checkout, webhooks, payouts to bank |
| Email | Resend | Invite emails, notifications, invoice delivery |
| File Storage | Supabase Storage | Client content uploads, contracts, receipts |
| Hosting | Vercel | Auto-deploy from GitHub, built for Next.js |

**Monthly cost at launch:** ~$0. All services have free tiers sufficient for 20–30 clients.

---

## 4. Access Model (Invite-Only)

No public sign-up. Every client account is created by Kelsey.

**Flow:**
1. Kelsey creates a new client in the system (name, email, package, type)
2. System sends a branded invite email via Resend with a magic link
3. Client clicks link → lands on portal → connects Google or sets password via Clerk
4. Their account is permanently tied to that client record in the database
5. Kelsey sets role = `client` in Clerk metadata; owner account has role = `owner`

**Role enforcement:** Clerk middleware protects all routes. `/owner/*` requires `role: owner`. `/client/*` requires `role: client`. Cross-access returns 403.

---

## 5. Data Model

```
clients
  id, name, email, clerk_user_id, type (brand|bride), status, created_at

packages
  id, name, tier (starter|growth|premium), monthly_hours, monthly_price, deliverables_list

projects
  id, client_id, package_id, start_date, current_phase, notes, status

shoots
  id, client_id, project_id, scheduled_at, location, duration_hours, status, notes

time_logs
  id, client_id, logged_by, date, hours, category (editing|planning|filming|admin|communication), notes

invoices
  id, client_id, amount, due_date, paid_at, status (draft|sent|paid|overdue), stripe_payment_link, line_items (json)

expenses
  id, category, description, amount, date, receipt_url, notes

messages
  id, client_id, sender_role (owner|client), body, sent_at, read_at

files
  id, client_id, name, file_url, file_type (content|contract|invoice), uploaded_at, uploaded_by

availability_blocks
  id, date, start_time, end_time, is_blocked, label (internal only, never shown to clients)
```

---

## 6. Owner Portal — Pages & Features

### 6.1 Dashboard (Smart Board)

The first thing Kelsey sees every day. Auto-populated from live data — nothing to manually update.

**Today panel:**
- Shoots scheduled today (client name, time, location)
- Suggested work blocks per client (calculated: weekly hour budget minus hours logged this week, gaps around shoot windows)
- Quick-start timer: dropdown to select client → Start → Stop → auto-logs to time_logs

**Flags / alerts:**
- Invoices overdue (client name, amount, days overdue)
- Shoots in next 48 hours
- Clients approaching or over package hour limit this month
- Unread messages
- New inquiry (once inquiry form is connected)

**Weekly overview:**
- Hours logged this week total + per client
- Revenue collected this month
- Upcoming shoots this week (mini calendar strip)

**Time budget logic (no AI needed — pure calculation):**
- Package tier → monthly hours included
- Divide by ~4 → weekly hours per client
- Subtract hours already logged this week
- Remaining hours → suggest as work blocks, distributed around today's shoots and existing blocks
- Color-coded: green (on track), amber (behind), red (over budget)

---

### 6.2 Clients

**Client list view:**
- Table: Name, Type (Brand/Bride), Package, Status, Start Date, Monthly Value, Hours This Month
- Filter by type and status
- Click row → Client detail

**Client detail view (the hub for each client):**
- Header: name, type badge, package, status pill
- Tabs: Overview / Time / Messages / Files / Invoices / Notes

- **Overview tab:** project phase tracker, next shoot, total hours this month vs. budget, quick stats
- **Time tab:** log of all time entries for this client, total by category, monthly chart
- **Messages tab:** full message thread with this client
- **Files tab:** all uploaded files — content deliverables, contract, invoices. Upload button (owner only)
- **Invoices tab:** invoice history for this client, create new invoice button
- **Notes tab:** internal notes (never visible to client)

---

### 6.3 Calendar

- Month grid view (built manually — no library)
- Shoot events shown on their dates (color-coded by client)
- Owner can add/edit/delete availability blocks (shown as blocked — clients see these as unavailable, no label shown)
- Click a date → slide-in panel to add shoot or block time
- Client booking requests appear here for approval

---

### 6.4 Time Tracker

- Active timer widget (persistent across pages — sits in top bar when running)
- Log entry form: client, date, hours, category, notes
- Weekly view: hours per client, total week hours
- Monthly summary: bar chart per client vs. their package budget
- Export to CSV

---

### 6.5 Financials

**Income:**
- Auto-logged when invoice marked paid (via Stripe webhook)
- Manual entry option for cash/Zelle payments
- Monthly MRR view, YTD total

**Expenses:**
- Manual entry: date, category, amount, description, receipt upload
- Categories: Equipment, Software, Travel, Marketing, Meals, Other
- Monthly summary, YTD total
- Receipt photo upload (stored in Supabase Storage)
- Phase 2: Plaid bank/card sync

**P&L Dashboard:**
- Income vs. expenses by month
- Net profit
- Tax set-aside tracker (25% of net, running total)
- Outstanding invoices total

**Invoices:**
- Create invoice: select client, add line items, set due date
- Send via Resend (email with PDF attachment + Stripe payment link)
- Status tracking: Draft → Sent → Paid / Overdue
- Stripe webhook auto-marks paid when client pays online
- PDF download

---

### 6.6 Messages

- Left panel: client list sorted by most recent message, unread count badge
- Right panel: threaded message view with that client
- New message sends email notification to client via Resend
- Simple polling (every 30s) for new messages in v1; real-time via Supabase in v2

---

### 6.7 Settings

- Business profile (name, email, logo)
- Package definitions (edit tiers, hours, prices)
- Notification preferences
- Stripe connect status
- Resend domain status

---

## 7. Client Portal — Pages & Features

### 7.1 Dashboard (My Project)

- Welcome header: "Hi [Name], here's where things stand."
- Project phase tracker: Onboarding → Strategy → Content Creation → Reporting (current phase highlighted)
- Next shoot: date, time, location
- Recent activity feed: last invoice, last file upload, last message

---

### 7.2 Messages

- Same threaded view as owner side, from client's perspective
- Reply field at bottom
- New message from client triggers email notification to Kelsey via Resend

---

### 7.3 Book a Shoot

- Calendar view showing Kelsey's available dates (green = available, gray = unavailable — no reason shown)
- Click available date → select time slot (Morning / Afternoon / Evening) → add note → Submit Request
- Kelsey approves/reschedules/denies → client receives automatic email with outcome

---

### 7.4 Files & Content

- Grid of uploaded files with thumbnail, name, date, file type badge
- Download button on each file
- Content deliverables, contracts, and any other files Kelsey uploads
- Clean, simple — no clutter

---

### 7.5 Invoices

- Table: Invoice #, Date, Amount, Status, Actions
- Download PDF button on each row
- "Pay Now" button on unpaid invoices → opens Stripe Checkout in new tab
- After payment, status updates automatically via webhook

---

## 8. Build Order

Build in this sequence — each phase is independently shippable:

**Phase 1 — Foundation**
- Supabase schema setup
- Clerk invite flow (Kelsey creates client → invite email → client sets up account)
- Role-based routing and middleware
- Owner sidebar + layout shell
- Client sidebar + layout shell

**Phase 2 — Core Owner Tools**
- Client list + client detail pages
- Time tracker (logger + weekly view)
- Owner calendar (availability blocks + shoot events)
- Dashboard smart board (pulls from real data)

**Phase 3 — Communication**
- Messaging (owner + client sides)
- Client booking request flow
- Resend notification emails

**Phase 4 — Financials**
- Invoice creation + PDF generation
- Stripe Checkout integration
- Stripe webhook → auto-mark paid
- Expense logging
- P&L dashboard

**Phase 5 — File Delivery**
- File upload (owner side, Supabase Storage)
- File download (client side, signed URLs)
- Contract storage and delivery

**Phase 6 — Polish**
- Mobile responsiveness
- Empty states
- Loading skeletons
- Notification preferences
- Settings page

---

## 9. Out of Scope for V1

- Real-time messaging (Phase 2 — use polling for now)
- Bride-specific client portal (foundation is built, feature-flagged off)
- Bank/card sync via Plaid
- Social analytics (Meta Graph API, TikTok Business API)
- E-signature (Dropbox Sign integration — Phase 2)
- Native mobile app
- Multi-user owner accounts (if Kelsey brings on staff)

---

## 10. Key Decisions Log

| Decision | Choice | Reason |
|---|---|---|
| Auth | Clerk invite-only | No public signups, clean role separation |
| Database | Supabase | Postgres + storage + free tier, integrates cleanly with Next.js |
| Hosting | Vercel | Native Next.js support, GitHub auto-deploy |
| Payments | Stripe | Professional, automatable, integrates with portal |
| Real-time messaging | Polling v1, Supabase Realtime v2 | Simpler to ship, upgrade path clear |
| File storage | Supabase Storage | Already in stack, signed URLs built in |
| AI/smart scheduling | Rules-based logic only | Calculation is sufficient, no AI overhead needed |
| Bride accounts | Deferred | Separate UX needs, add after brand client flow is stable |

---

*Blueprint complete. Use this document as the spec for all Claude Code prompts going forward.*