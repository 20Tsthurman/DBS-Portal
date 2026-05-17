import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type ClientType = "brand" | "bride";
export type ClientStatus = "active" | "onboarding" | "inactive" | "lead";
export type PackageTier = "starter" | "growth" | "premium";
export type ProjectPhase = "onboarding" | "strategy" | "content" | "reporting";
export type ProjectStatus = "active" | "paused" | "completed";
export type ShootStatus = "requested" | "confirmed" | "completed" | "cancelled";
export type ShootKind = "shoot" | "meeting";
export type MeetingType = "zoom" | "phone" | "in_person";
export type TimeLogCategory =
  | "editing"
  | "planning"
  | "filming"
  | "admin"
  | "communication";
export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue";
export type ExpenseCategory =
  | "platform_software"
  | "marketing_advertising"
  | "equipment_gear"
  | "travel_transportation"
  | "professional_services"
  | "business_operations";
export type IncomeType =
  | "brand_retainer"
  | "wedding_same_day"
  | "one_off_shoot"
  | "other";
export type IncomePaymentSource = "manual" | "suggested_retainer";
export type SuggestionType =
  | "income_retainer"
  | "mileage_shoot"
  | "expense_template";
export type FileType = "content" | "contract" | "invoice" | "other";
export type SenderRole = "owner" | "client";
export type TimeBlockCategory = "sonography" | "work_block" | "blocked";

export interface ClientRecord {
  id: string;
  name: string;
  email: string;
  clerk_user_id: string | null;
  type: ClientType;
  status: ClientStatus;
  created_at: string;
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
  file_url: string;
  file_type: FileType;
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
   * income suggestion.
   */
  source: IncomePaymentSource | null;
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
