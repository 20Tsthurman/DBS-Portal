-- Run this once in the Supabase SQL editor AFTER schema.sql has been applied.
-- Backfills Kelsey's Q1–Q2 2026 financial data from the working spreadsheet.
-- NOT idempotent — re-running will insert duplicates. Run once.
--
-- Client lookups use `(select id from clients where lower(name) = lower(...))`.
-- If a lookup returns NULL (client not yet in the system), the row still
-- inserts correctly: `client_id` is nullable and `client_name_snapshot`
-- preserves the name on `income_payments`. `mileage_logs` rows survive a
-- NULL client_id the same way.

-- ---------------------------------------------------------------------------
-- Recurring expense templates (monthly subscriptions)
-- ---------------------------------------------------------------------------
insert into recurring_expense_templates (name, category, amount, day_of_month, notes, active) values
  ('Pic-Time',        'platform_software', 10.00, 1, 'Content delivery / gallery platform', true),
  ('Canva',           'platform_software', 15.00, 1, 'Design tool', true),
  ('iCloud Storage',  'platform_software',  2.99, 1, 'Storage', true),
  ('Lightroom',       'platform_software',  6.99, 1, 'Photo editing', true);

-- ---------------------------------------------------------------------------
-- Income payments (from monthly Individual Payment Logs)
-- ---------------------------------------------------------------------------
insert into income_payments (client_id, client_name_snapshot, payment_date, amount, income_type, payment_method, notes, logged_by) values
  (
    (select id from clients where lower(name) = lower('The Glam House Nashville') limit 1),
    'The Glam House Nashville',
    '2026-03-31', 1500.00, 'brand_retainer', 'Zelle', 'First discount month', 'Kelsey'
  ),
  (
    (select id from clients where lower(name) = lower('Harper James Salon') limit 1),
    'Harper James Salon',
    '2026-04-22',  175.00, 'one_off_shoot', 'Zelle', NULL, 'Kelsey'
  ),
  (
    (select id from clients where lower(name) = lower('The Glam House Nashville') limit 1),
    'The Glam House Nashville',
    '2026-04-30', 1500.00, 'brand_retainer', 'Zelle', '2nd discount month', 'Kelsey'
  );

-- ---------------------------------------------------------------------------
-- Mileage logs (from Mileage Log sheet; all originating from "Home (Franklin)")
-- ---------------------------------------------------------------------------
insert into mileage_logs (trip_date, from_address, to_address, start_odometer, end_odometer, miles, rate_per_mile, client_id, notes, logged_by) values
  ('2026-04-07', 'Home (Franklin)', 'The Glam House Nashville', 37012, 37056, 44, 0.70,
    (select id from clients where lower(name) = lower('The Glam House Nashville') limit 1),
    NULL, 'Kelsey'),
  ('2026-04-08', 'Home (Franklin)', 'The Glam House Nashville', 37089, 37133, 44, 0.70,
    (select id from clients where lower(name) = lower('The Glam House Nashville') limit 1),
    NULL, 'Kelsey'),
  ('2026-04-22', 'Home (Franklin)', 'Harper James Salon',        37401, 37429, 28, 0.70,
    (select id from clients where lower(name) = lower('Harper James Salon') limit 1),
    NULL, 'Kelsey'),
  ('2026-04-28', 'Home (Franklin)', 'The Glam House Nashville', 37429, 37473, 44, 0.70,
    (select id from clients where lower(name) = lower('The Glam House Nashville') limit 1),
    NULL, 'Kelsey'),
  ('2026-04-29', 'Home (Franklin)', 'Re::Creative',              37473, 37509, 36, 0.70,
    NULL, NULL, 'Kelsey'),
  ('2026-05-06', 'Home (Franklin)', 'The Glam House Nashville', 37509, 37553, 44, 0.70,
    (select id from clients where lower(name) = lower('The Glam House Nashville') limit 1),
    NULL, 'Kelsey');

-- ---------------------------------------------------------------------------
-- Expenses (from monthly sheets — NOT including mileage; that lives in
-- mileage_logs above and is composed into the totals at read time).
-- Subscription dates default to the 1st of each month; the LLC fee uses an
-- estimated date Kelsey can adjust if she has more precise records.
-- ---------------------------------------------------------------------------
insert into expenses (category, description, amount, date, receipt_url, notes) values
  -- March
  ('platform_software',     'Pic-Time',                       10.00, '2026-03-01', NULL, NULL),
  ('platform_software',     'Canva',                          15.00, '2026-03-01', NULL, NULL),
  ('platform_software',     'iCloud Storage',                  2.99, '2026-03-01', NULL, NULL),
  ('platform_software',     'Lightroom',                       6.99, '2026-03-01', NULL, NULL),
  ('business_operations', 'LLC / State Fees', 307.00, '2026-03-31', NULL, 'TN LLC formation — Control #002099923'),
  -- April
  ('platform_software',     'Pic-Time',                       10.00, '2026-04-01', NULL, NULL),
  ('platform_software',     'Canva',                          15.00, '2026-04-01', NULL, NULL),
  ('platform_software',     'iCloud Storage',                  2.99, '2026-04-01', NULL, NULL),
  ('platform_software',     'Lightroom',                       6.99, '2026-04-01', NULL, NULL),
  -- May (partial month)
  ('marketing_advertising', 'Squarespace (annual website hosting)', 38.00, '2026-05-01', NULL, 'Annual renewal — not recurring monthly');

  -- Home address (used as default origin for mileage trips).
  update app_settings
  set home_address = '427 Nichol Mill Lane, Franklin, TN 37067',
      updated_at = now()
  where singleton = true;