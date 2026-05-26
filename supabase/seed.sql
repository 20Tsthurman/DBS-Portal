-- supabase/seed.sql
-- Run once in the Supabase SQL editor after the schema is applied.
-- Seeds the three Digital Bloom Socials package tiers.

insert into packages (name, tier, monthly_hours, monthly_price, deliverables_list) values
  ('Starter Bloom', 'starter', 10, 850, '{"1 platform", "8 posts/month", "Monthly reporting", "Content calendar", "Caption writing", "Keyword + hashtag research", "Social strategy", "Weekly stories"}'),
  ('Growth Bloom', 'growth', 16, 1500, '{"1 platform", "12 posts/month", "Bi-weekly reporting", "Content calendar", "Caption writing", "Keyword + hashtag research", "Social strategy", "Community engagement", "Weekly stories"}'),
  ('Premium Bloom', 'premium', 26, 2300, '{"2 platforms", "20 posts/month", "Weekly reporting", "Content calendar", "Caption writing", "Keyword + hashtag research", "Social strategy", "Community engagement", "Weekly stories"}');
