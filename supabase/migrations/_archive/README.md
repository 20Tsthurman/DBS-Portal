# Archived schema files

These files are **superseded** by `supabase/migrations/001_initial_schema.sql`
and are kept for history only. **Do not run them.**

| File | Original role |
|---|---|
| `schema.sql` | Base schema — `CREATE TABLE` blocks plus a bottom "alignment block" of idempotent `ALTER`s. |
| `001_phase4_suggestions.sql` | Added `dismissed_suggestions` and the suggestion origin columns. |
| `002_files_storage.sql` | Renamed `files.file_url` → `storage_path`; added `mime_type` / `size_bytes`. |
| `003_invoices.sql` | Added `invoices.invoice_number` / `income_type` / `memo` / `sent_at` and `income_payments.invoice_id`. |

The consolidated file folds all of the above into a single ordered, idempotent
migration and fixes the non-idempotent statements these files contained (the
`clients` add-column-then-rename dance and the bare `files` column rename).
The current schema's source of truth is `001_initial_schema.sql`.
