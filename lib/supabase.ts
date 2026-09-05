import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { TourKey, TourOutcome } from "@/lib/tours";

export type ClientType = "brand" | "bride";
export type ClientStatus = "active" | "onboarding" | "inactive" | "lead";
export type PackageTier = "starter" | "growth" | "premium";
export type ProjectPhase = "onboarding" | "strategy" | "content" | "reporting";
export type ProjectStatus = "active" | "paused" | "completed";
/**
 * `'declined'` = Kelsey turned down a client's request; `'cancelled'` = the
 * shoot was called off some other way (the client withdrew their own pending
 * request, or a confirmed shoot was cancelled). The split exists so the
 * client's booking page can explain a decline instead of silently dropping
 * the row — see migration 020.
 */
export type ShootStatus =
  | "requested"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "declined";
export type ShootKind = "shoot" | "meeting";
export type MeetingType = "zoom" | "phone" | "in_person";
export type TimeLogCategory =
  | "editing"
  | "planning"
  | "filming"
  | "admin"
  | "communication";
/**
 * `'overdue'` and `'inactive'` are *derived* — no invoice row ever stores
 * them. `'overdue'` is computed from a sent invoice with a past due date;
 * `'inactive'` is computed from a non-NULL `inactive_at`. Both surface
 * through `InvoiceWithClient.effective_status`.
 */
export type InvoiceStatus =
  | "draft"
  | "sent"
  | "paid"
  | "overdue"
  | "inactive";
export type ExpenseCategory =
  | "platform_software"
  | "marketing_advertising"
  | "equipment_gear"
  | "travel_transportation"
  | "professional_services"
  | "business_operations";
/**
 * Cash-vs-tax classification (migration 013). Drives the two-pool
 * financials split: cash pool = both + cash_only, tax pool = both +
 * tax_only. 'tax_only' = deductible but no current-year cash (prior-year
 * equipment); 'cash_only' = cash out but not separately deductible
 * (actual gas under the standard-mileage election).
 */
export type CashTaxClass = "both" | "tax_only" | "cash_only";
export type IncomeType =
  | "brand_retainer"
  | "wedding_same_day"
  | "one_off_shoot"
  | "other";
export type IncomePaymentSource = "manual" | "suggested_retainer" | "invoice";
export type SuggestionType =
  | "income_retainer"
  | "mileage_shoot"
  | "expense_template";
export type FileType = "content" | "contract" | "invoice" | "other";
export type SenderRole = "owner" | "client";
export type TimeBlockCategory = "sonography" | "work_block" | "blocked";
export type ExternalEventStatus = "confirmed" | "cancelled";
/**
 * Content & Approval unions (migration 015). Each mirrors a text + CHECK
 * constraint in `supabase/migrations/015_content_approval.sql` — keep the
 * two in sync by hand, there is no codegen.
 */
export type ContentCycleStatus = "drafting" | "in_review" | "locked";
/**
 * Who closed a month: the deadline sweep or Kelsey's Lock now. Mirrors
 * `content_cycles_locked_by_check`. Added in migration 018.
 */
export type ContentCycleLockedBy = "auto" | "owner";
/**
 * How a billable revision round is charged for one cycle. Mirrors
 * `content_cycles_billing_mode_check`. 'per_round' (the default) is one charge
 * per round per cycle however many posts the client sends back; 'per_item' is
 * one charge per post revised. Added in migration 019.
 */
export type ContentBillingMode = "per_round" | "per_item";
/**
 * The literal the lock writes as `content_items.approved_by` and
 * `content_cycles.locked_by` — one word for one actor across both tables.
 * Compare against this, never against a retyped 'auto'.
 */
export const CONTENT_AUTO_ACTOR = "auto";
export type ContentItemStatus =
  | "draft"
  | "in_review"
  | "changes_requested"
  | "approved"
  | "published";
export type Platform =
  | "instagram"
  | "tiktok"
  | "facebook"
  | "youtube"
  | "pinterest";
export type PostFormat = "reel" | "feed" | "story" | "carousel";
/**
 * Where an asset physically lives. `'stream'` = Cloudflare Stream (video),
 * `'supabase'` = the private `content-assets` Storage bucket (stills).
 */
export type AssetProvider = "stream" | "supabase";
export type RevisionCategory =
  | "clips"
  | "caption"
  | "music"
  | "pacing"
  | "text_overlay"
  | "cover"
  | "schedule"
  | "other";

export interface ClientRecord {
  id: string;
  name: string;
  /**
   * Nullable since migration 004 — a client can be created with a phone
   * number instead of an email. At least one of email/phone is required,
   * enforced at the application layer (Add Client action + clients PATCH).
   */
  email: string | null;
  /** Bare 10-digit string, e.g. "5125551234". NULL when no phone on file. */
  phone: string | null;
  clerk_user_id: string | null;
  type: ClientType;
  status: ClientStatus;
  /** Owner-pinned to the top of the clients roster. Added in migration 005. */
  pinned: boolean;
  created_at: string;
  invited_at: string | null;
  owner_last_new_msg_email_at: string | null;
  client_last_new_msg_email_at: string | null;
  owner_last_reminder_email_at: string | null;
  client_last_reminder_email_at: string | null;
}

export interface PackageRecord {
  id: string;
  name: string;
  tier: PackageTier;
  monthly_hours: number;
  monthly_price: number;
  deliverables_list: string[];
  created_at: string;
}

export interface ProjectRecord {
  id: string;
  client_id: string;
  package_id: string | null;
  start_date: string | null;
  current_phase: ProjectPhase;
  notes: string | null;
  status: ProjectStatus;
  created_at: string;
  monthly_price_override: number | null;
  monthly_hours_override: number | null;
}

export interface ShootRecord {
  id: string;
  client_id: string;
  project_id: string | null;
  scheduled_at: string;
  location: string | null;
  duration_hours: number | null;
  status: ShootStatus;
  notes: string | null;
  kind: ShootKind;
  meeting_type: MeetingType | null;
  created_at: string;
  /** Kelsey's optional note to the client. Non-null only when status = 'declined'. */
  decline_reason: string | null;
  /** When the request was declined. Non-null only when status = 'declined'. */
  declined_at: string | null;
  /** Google event id after a Stage 3 push; NULL = not (yet) in Google. */
  google_event_id: string | null;
  /** Which Google calendar the event was pushed to (patch/delete target). */
  google_calendar_id: string | null;
  /** True = last push failed or hasn't run; swept by retryPendingGooglePushes. */
  google_sync_pending: boolean;
}

export interface TimeLogRecord {
  id: string;
  client_id: string;
  logged_by: string;
  date: string;
  hours: number;
  category: TimeLogCategory;
  notes: string | null;
  created_at: string;
}

export interface InvoiceRecord {
  id: string;
  client_id: string;
  amount: number;
  due_date: string | null;
  paid_at: string | null;
  status: InvoiceStatus;
  stripe_payment_link: string | null;
  line_items: Array<{ description: string; amount: number }>;
  created_at: string;
  /**
   * Human-readable identifier in the form INV-YYYY-NNNN. Assigned at
   * create time, so even drafts have a stable number. NULL only for
   * legacy rows that predate migration 003 (none exist in practice).
   */
  invoice_number: string | null;
  income_type: IncomeType;
  /**
   * Free-form note rendered on the generated PDF and surfaced in the
   * payment email. NULL = no memo block on the PDF.
   */
  memo: string | null;
  /**
   * Timestamp when the invoice transitioned from draft -> sent. NULL
   * while in draft. The "issued date" rendered on the PDF and shown
   * in lists is derived from this column (date portion), not from
   * created_at. created_at remains for audit/row-creation purposes.
   */
  sent_at: string | null;
  /**
   * Soft-retire marker. NULL = live invoice. Non-NULL = the invoice was
   * marked Inactive at this timestamp: kept for history but hidden from
   * default owner lists and from the client portal, and no longer
   * editable / sendable / payable. Clearing it reactivates the invoice
   * back into whatever `status` it held when retired.
   */
  inactive_at: string | null;
}

export interface ExpenseRecord {
  id: string;
  category: ExpenseCategory;
  description: string | null;
  amount: number;
  date: string;
  receipt_url: string | null;
  notes: string | null;
  created_at: string;
  /**
   * FK to recurring_expense_templates(id). NULL = manually entered;
   * non-NULL = created from accepting a Phase 4 expense suggestion.
   */
  source_template_id: string | null;
  cash_tax_class: CashTaxClass;
}

export interface MessageRecord {
  id: string;
  client_id: string;
  sender_role: SenderRole;
  body: string;
  sent_at: string;
  read_at: string | null;
}

export interface FileRecord {
  id: string;
  client_id: string;
  name: string;
  /** Canonical storage key in the `client-files` bucket (see lib/storage.ts). */
  storage_path: string;
  file_type: FileType;
  /** MIME type read back from the verified upload at finalize time. */
  mime_type: string;
  /** Object size in bytes, read back from the verified upload at finalize time. */
  size_bytes: number;
  uploaded_at: string;
  uploaded_by: string;
}

export interface TimeBlockRecord {
  id: string;
  /** YYYY-MM-DD — wall-clock date in PORTAL_TIMEZONE (America/Chicago). */
  date: string;
  /** HH:MM:SS — wall-clock start time in PORTAL_TIMEZONE. */
  start_time: string;
  /** HH:MM:SS — wall-clock end time in PORTAL_TIMEZONE. */
  end_time: string;
  category: TimeBlockCategory;
  /** Only meaningful (and only allowed) when category === "work_block". */
  client_id: string | null;
  label: string | null;
  notes: string | null;
  created_at: string;
}

export interface AppSettingsRecord {
  id: string;
  singleton: boolean;
  home_address: string;
  mileage_rate_per_mile: number;
  tax_set_aside_percent: number;
  updated_at: string;
}

export interface IncomePaymentRecord {
  id: string;
  client_id: string | null;
  client_name_snapshot: string;
  /** YYYY-MM-DD */
  payment_date: string;
  amount: number;
  income_type: IncomeType;
  payment_method: string | null;
  notes: string | null;
  logged_by: string;
  created_at: string;
  /**
   * NULL = manually entered (existing rows + manual ghost-row inserts);
   * 'suggested_retainer' = created from accepting a Phase 4 brand-retainer
   * income suggestion;
   * 'invoice' = created automatically when an invoice was paid (Stripe
   * webhook or manual mark-as-paid). Pair with `invoice_id` to find
   * the source invoice.
   */
  source: IncomePaymentSource | null;
  /**
   * FK to invoices(id). NULL unless this row was created by the invoice
   * flow (source='invoice'). On invoice delete the FK nulls out so the
   * historical income record survives.
   */
  invoice_id: string | null;
}

export interface MileageLogRecord {
  id: string;
  /** YYYY-MM-DD */
  trip_date: string;
  from_address: string;
  to_address: string;
  start_odometer: number | null;
  end_odometer: number | null;
  miles: number;
  /** Snapshot of app_settings.mileage_rate_per_mile at write time. */
  rate_per_mile: number;
  client_id: string | null;
  notes: string | null;
  logged_by: string;
  created_at: string;
  /**
   * FK to shoots(id). NULL = manually entered; non-NULL = created from
   * accepting a Phase 4 mileage suggestion for that shoot.
   */
  source_shoot_id: string | null;
}

export interface RecurringExpenseTemplateRecord {
  id: string;
  name: string;
  category: ExpenseCategory;
  amount: number;
  day_of_month: number;
  notes: string | null;
  active: boolean;
  created_at: string;
}

export interface DismissedSuggestionRecord {
  id: string;
  type: SuggestionType;
  /** Source-record id: client_id, shoot_id, or template_id depending on `type`. */
  reference_id: string;
  /** Wall-clock month key in PORTAL_TIMEZONE, e.g. '2026-05'. */
  period_yyyymm: string;
  dismissed_at: string;
}


export interface GoogleCalendarConnectionRecord {
  id: string;
  singleton: boolean;
  /** Long-lived OAuth credential. Never leaves the server. */
  refresh_token: string;
  /** Cache of the most recent short-lived access token (may be stale). */
  access_token: string | null;
  token_expiry: string | null;
  /** DEAD since migration 009 — per-calendar state lives in google_synced_calendars. */
  calendar_id: string;
  /** DEAD since migration 009 — per-calendar state lives in google_synced_calendars. */
  sync_token: string | null;
  /** Stage 3 (push notifications) — unused in Stage 1, all nullable. */
  watch_channel_id: string | null;
  watch_resource_id: string | null;
  watch_expiration: string | null;
  last_synced_at: string | null;
  /**
   * Space-separated OAuth scopes from the token response. NULL (pre-Stage-3
   * grant) or missing the calendar write scope → connection is read-only and
   * settings prompts a reconnect. Checked via hasWriteScope() (exact token).
   */
  granted_scopes: string | null;
  /** Resolved push target ("digital bloom" by summary, else primary). Cached on first push. */
  push_calendar_id: string | null;
  push_calendar_summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface GoogleSyncedCalendarRecord {
  id: string;
  /**
   * Google calendarList id. The primary calendar is stored under the alias
   * 'primary' (accepted by every Google API call), not its email-shaped id.
   */
  calendar_id: string;
  /** Display-name snapshot for the settings checkboxes. */
  summary: string | null;
  /** Google backgroundColor snapshot (checkbox swatch). */
  color: string | null;
  /** Per-calendar events.list nextSyncToken. NULL = next sync is a full fetch. */
  sync_token: string | null;
  last_synced_at: string | null;
  created_at: string;
}

export interface ExternalEventRecord {
  id: string;
  /** Which google_synced_calendars.calendar_id this event came from. */
  calendar_id: string;
  /** Google's event id (per-instance once expanded). Unique per (calendar_id, google_event_id). */
  google_event_id: string;
  title: string | null;
  starts_at: string;
  /** Exclusive. For all-day events this is the PORTAL_TIMEZONE midnight after the last day. */
  ends_at: string;
  all_day: boolean;
  /**
   * Google's busy/free signal: transparency != 'transparent'. Drives
   * checkBookingConflicts — busy events block client bookings, free ones
   * (birthdays, reminders) don't. Added in migration 008.
   */
  busy: boolean;
  /** 'cancelled' rows are tombstones — hidden from the calendar and conflicts. */
  status: ExternalEventStatus;
  html_link: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * One client, one month — the unit that gets released, deadlined, and
 * locked. Added in migration 015.
 */
export interface ContentCycleRecord {
  id: string;
  client_id: string;
  /** YYYY-MM-DD — always the FIRST of the month. A `date`, not a timestamp. */
  month: string;
  /** NULL until Release; a cycle in 'drafting' has no deadline yet. */
  revision_deadline: string | null;
  included_rounds: number;
  /**
   * The price of a round beyond `included_rounds`, read at the instant the
   * client sends one and snapshotted onto that round row. NULL or 0 = billing
   * off for this cycle: no consent dialog, no accrual, no charge.
   */
  extra_round_price: number | null;
  /**
   * How a billable round is charged: one charge per round per cycle
   * ('per_round', the default) or one per post revised ('per_item'). Read at
   * the client's commit, where it decides whether a round row is flagged, and
   * at Kelsey's read, where it decides how flagged rows group into charges.
   * Added in migration 019.
   */
  billing_mode: ContentBillingMode;
  status: ContentCycleStatus;
  /**
   * The instant reviews closed to the client. NULL until the cycle locks, and
   * never cleared — there is no unlock. For the deadline sweep this is the
   * `revision_deadline` instant, not the run time (the client copy dates the
   * close to the deadline day); for Lock now it is the moment Kelsey
   * confirmed. Written in the same UPDATE that flips `status` to 'locked';
   * `content_cycles_locked_record_check` refuses a locked row without it.
   * Added in migration 018.
   */
  locked_at: string | null;
  /**
   * How the cycle locked — chooses the client's Screen 6 banner (Deadline vs
   * Closed early). NULL until the cycle locks. 'auto' is the same literal the
   * sweep writes to `content_items.approved_by`. Added in migration 018.
   */
  locked_by: ContentCycleLockedBy | null;
  created_at: string;
}

/**
 * One scheduled post. `client_id` is denormalized alongside `cycle_id` so
 * ownership checks stay single-table. Added in migration 015.
 */
export interface ContentItemRecord {
  id: string;
  client_id: string;
  cycle_id: string;
  /** PORTAL_TIMEZONE wall-clock instant — build via combineDateAndTimeInTimezone. */
  scheduled_for: string;
  platform: Platform;
  format: PostFormat;
  caption: string | null;
  status: ContentItemStatus;
  /** Round 1 is included; 2+ is billable. */
  current_round: number;
  approved_at: string | null;
  /** Free text, not a FK — the deadline sweep writes the literal 'auto'. */
  approved_by: string | null;
  sort_order: number;
  created_at: string;
}

/**
 * One video or image on an item; carousels have several, ordered by
 * `position`. Added in migration 015.
 */
export interface ContentAssetRecord {
  id: string;
  content_item_id: string;
  /** 0-based ordering within a carousel. Single-asset items are 0. */
  position: number;
  kind: "video" | "image";
  provider: AssetProvider;
  /** Cloudflare Stream UID when provider='stream', storage key when 'supabase'. */
  external_id: string;
  /**
   * Async-transcoding state (spec §3.5b). Defaults to 'ready' — only Stream
   * video inserts as 'processing'; a Supabase still is playable on arrival.
   * Release is blocked while any asset in the cycle is not 'ready'.
   */
  status: "processing" | "ready" | "failed";
  /**
   * Plain-language explanation of an encoding failure — already mapped out of
   * Cloudflare's vendor codes by `describeStreamError` in lib/stream.ts, so it
   * renders as-is. Non-NULL only while status is 'failed'; the
   * `content_assets_error_reason_check` constraint enforces that, and every
   * transition back to 'ready' or 'processing' clears it.
   * Added in migration 016.
   */
  error_reason: string | null;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  /** Soft version history: non-NULL = superseded by a revision. NULL = current. */
  replaced_at: string | null;
  /**
   * Non-NULL = this row is a STAGED replacement for the asset it points at,
   * uploaded but not yet swapped in by an accept. Staged rows are born with
   * `replaced_at` set (the `content_assets_staged_not_live_check` constraint
   * requires it) so every live-asset read skips them; the accept commit clears
   * BOTH columns in one UPDATE to activate the row. Always NULL on a live row
   * and on genuine version history. Added in migration 017.
   */
  replaces_asset_id: string | null;
  created_at: string;
}

/**
 * One batch of change requests on one item — the atomic billing unit.
 * Added in migration 015.
 */
export interface RevisionRoundRecord {
  id: string;
  content_item_id: string;
  round_number: number;
  is_billable: boolean;
  /** Snapshot of content_cycles.extra_round_price at submission. */
  price: number | null;
  /** NULL while the client is still assembling the round. */
  submitted_at: string | null;
  submitted_by: string | null;
  /**
   * 'open' until Kelsey resolves the round; 'addressed' = accepted, 'denied' =
   * refused with a written reason. 'denied' widened in migration 017 — it is a
   * status rather than a flag so denied rounds fall out of Phase 8's billable
   * pool (`status='addressed'`) by their own value.
   */
  status: "open" | "addressed" | "denied";
  resolved_at: string | null;
  /**
   * Kelsey's words on the resolution, rendered to the client as "A note from
   * Kelsey" (copy deck Screen 5). Required on a deny (the
   * `revision_rounds_denied_reason_check` constraint enforces it), optional on
   * an accept, and never present on an open round. Added in migration 017.
   */
  resolution_note: string | null;
  /** Set when the round is added to an invoice as a line item. */
  invoice_id: string | null;
  created_at: string;
}

/**
 * One piece of feedback inside a round. Added in migration 015.
 */
export interface RevisionNoteRecord {
  id: string;
  round_id: string;
  category: RevisionCategory;
  /** Nullable; only meaningful as a scrubber position on a video asset. */
  timestamp_seconds: number | null;
  body: string;
  created_at: string;
}

/**
 * One person's completion of one build of one guided tour. Added in
 * migration 021. The row's EXISTENCE is the completion — nothing is ever
 * updated, and the gate never reads `outcome`.
 *
 * Keyed on the Clerk user id rather than clients.id so owner-side tours can
 * reuse the table (Kelsey has no clients row). There is deliberately no
 * foreign key; see the migration for why.
 */
export interface TourCompletionRecord {
  id: string;
  clerk_user_id: string;
  tour_key: TourKey;
  version: number;
  outcome: TourOutcome;
  /** Named for the end of the tour, not for one of its two outcomes. */
  ended_at: string;
}

type Relationships = readonly {
  foreignKeyName: string;
  columns: string[];
  isOneToOne?: boolean;
  referencedRelation: string;
  referencedColumns: string[];
}[];

type TableShape<TRow extends Record<string, unknown>> = {
  Row: TRow;
  Insert: Partial<TRow>;
  Update: Partial<TRow>;
  Relationships: Relationships;
};

export type Database = {
  public: {
    Tables: {
      clients: TableShape<ClientRecord & Record<string, unknown>>;
      packages: TableShape<PackageRecord & Record<string, unknown>>;
      projects: TableShape<ProjectRecord & Record<string, unknown>>;
      shoots: TableShape<ShootRecord & Record<string, unknown>>;
      time_logs: TableShape<TimeLogRecord & Record<string, unknown>>;
      invoices: TableShape<InvoiceRecord & Record<string, unknown>>;
      expenses: TableShape<ExpenseRecord & Record<string, unknown>>;
      messages: TableShape<MessageRecord & Record<string, unknown>>;
      files: TableShape<FileRecord & Record<string, unknown>>;
      time_blocks: TableShape<TimeBlockRecord & Record<string, unknown>>;
      app_settings: TableShape<AppSettingsRecord & Record<string, unknown>>;
      income_payments: TableShape<IncomePaymentRecord & Record<string, unknown>>;
      mileage_logs: TableShape<MileageLogRecord & Record<string, unknown>>;
      recurring_expense_templates: TableShape<
        RecurringExpenseTemplateRecord & Record<string, unknown>
      >;
      dismissed_suggestions: TableShape<
        DismissedSuggestionRecord & Record<string, unknown>
      >;
      google_calendar_connection: TableShape<
        GoogleCalendarConnectionRecord & Record<string, unknown>
      >;
      google_synced_calendars: TableShape<
        GoogleSyncedCalendarRecord & Record<string, unknown>
      >;
      external_events: TableShape<ExternalEventRecord & Record<string, unknown>>;
      content_cycles: TableShape<ContentCycleRecord & Record<string, unknown>>;
      content_items: TableShape<ContentItemRecord & Record<string, unknown>>;
      content_assets: TableShape<ContentAssetRecord & Record<string, unknown>>;
      revision_rounds: TableShape<
        RevisionRoundRecord & Record<string, unknown>
      >;
      revision_notes: TableShape<RevisionNoteRecord & Record<string, unknown>>;
      tour_completions: TableShape<
        TourCompletionRecord & Record<string, unknown>
      >;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

let browserClient: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (browserClient) return browserClient;
  browserClient = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
  );
  return browserClient;
}

export function getSupabaseServiceClient(): SupabaseClient {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
