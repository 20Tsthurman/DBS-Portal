-- Run this once in the Supabase SQL editor after schema.sql.
-- Seeds the three Digital Bloom Socials package tiers.

insert into packages (name, tier, monthly_hours, monthly_price, deliverables_list) values
  ('Starter', 'starter', 8, 750, '{"4 posts/month", "Basic captions", "1 shoot/month"}'),
  ('Growth', 'growth', 16, 1200, '{"12 posts/month", "Full captions + hashtags", "2 shoots/month", "Monthly report"}'),
  ('Premium', 'premium', 24, 2000, '{"20 posts/month", "Full captions + hashtags + strategy", "4 shoots/month", "Weekly reports", "Story content"}');
