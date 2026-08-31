# Content Approval — Client Copy Deck

*Final strings for the client-facing Review & Approve screens (screens 1–9), rescued from the design canvas on 2026-08-30.*

- **Canvas:** https://claude.ai/code/artifact/5126b6c5-a061-4afc-917e-98e0c849477d
- **`$75` is a stand-in for `extra_round_price`, which is not yet set.** Every `$75` below renders from that config value.
- Dates, counts, names, and times are representative values — everything else is the final string.
- Voice: warm, plain, specific. Short sentences. No jargon, no exclamation marks, never "simply" or "just," never scolding.

---

## Navigation

| Element | String | Notes |
|---|---|---|
| Sidebar item | Review & Approve | |
| Top bar title | Review & Approve | |
| Route | `/client/review` | |

## Screen 1 — The queue

| Element | String | Notes |
|---|---|---|
| Eyebrow | October 2026 | |
| Page title | Your October content | |
| Instruction | Go through each post and approve it, or ask for changes. | |
| Deadline card, line 1 | Review by Friday, September 25 | |
| Deadline card, line 2 | Anything you haven't reviewed by then is approved automatically, so your month stays on schedule. | Same sentence reused verbatim in the release email |
| Count — fresh | 12 posts are ready for your review. | |
| Count — fresh, one post | 1 post is ready for your review. | Added 2026-08-30, not on the canvas |
| Count — partway | 8 posts still need your review. | Right-aligned meta: `4 of 12 reviewed` |
| Count — partway, one left | 1 post still needs your review. | Added 2026-08-30, not on the canvas |
| Count — all handled | Nothing needs you right now. | Meta: `12 of 12 reviewed` |
| All-handled banner title | That's everything for now | |
| All-handled banner body (changes requested) | You've reviewed all 12 posts. Kelsey is working on the changes you asked for — you'll get an email when the updates are ready to look at. | Only when at least one post has changes sent |
| All-handled banner body (changes requested, one post) | You've reviewed your post. Kelsey is working on the changes you asked for — you'll get an email when the update is ready to look at. | Added 2026-08-30, not on the canvas. Only when at least one post has changes sent |
| All-handled banner body (all approved, no changes) | You approved all 12 posts. Your October content is set — Kelsey will take it from here. | When every post was approved and no changes were requested |
| All-handled banner body (all approved, one post) | You approved your post. Your October content is set — Kelsey will take it from here. | Added 2026-08-30, not on the canvas. When every post was approved and no changes were requested |
| Table headers (desktop) | Post · Scheduled · Platform · Status | |
| Row action — needs review | Review | |
| Row action — otherwise | View | |

## Status pills

| Element | String | Notes |
|---|---|---|
| Needs the client | Needs your review | Mauve accent tone |
| Waiting on Kelsey | With Kelsey | Neutral tone |
| Done | Approved | Green success tone |
| Auto-approved row meta | Approved automatically · Sept 25 | Under the Approved pill |
| Declined request | Kept as planned | Neutral tone |
| Round marker | Round 2 | Forest chip, shown from round 2 on |

## Screen 2 — A single post

| Element | String | Notes |
|---|---|---|
| Back link | All posts | |
| Position | Post 5 of 12 | |
| Scheduled line | Scheduled for Saturday, October 10 · Instagram Reel | |
| Caption label | Caption | |
| Primary action | Approve | |
| Secondary action | Request changes | |
| Carousel counter | 2 of 5 | |
| Platform labels | Instagram Reel · Instagram Post · Instagram Carousel · Instagram Story · Facebook Post | "Instagram Story" added 2026-08-30, not on the canvas — the platform's own word for the format, the same way "Reel" is |

## Approve confirmation — light dialog

| Element | String | Notes |
|---|---|---|
| Title | Approve this post? | |
| Body | It goes out Saturday, October 10. Once you approve, changes can't be requested on this post. | |
| Cancel | Not yet | |
| Confirm | Approve post | Green |
| — | — | Deliberately lighter than the send dialog: no accent bar, DM Sans title, one-line body, compact buttons. The weight difference is the signal. |

## Screen 3 — Request changes

| Element | String | Notes |
|---|---|---|
| Panel title | Request changes | |
| Context line | Saturday, Oct 10 · Instagram Reel | |
| Helper | Pick what you'd like changed, then tell Kelsey what you have in mind. | |
| Category — Clips | Clips — The video footage | Label — hint |
| Category — Caption | Caption — The written text below the post | |
| Category — Music | Music — The song or sound | |
| Category — Pacing | Pacing — How fast or slow it moves | |
| Category — Text overlay | Text overlay — The words shown on screen | |
| Category — Cover | Cover — The image people see first | |
| Category — Schedule | Schedule — The date it goes out | |
| Category — Other | Other — Anything else | |
| Prompt — Clips | What should change about the clips? | |
| Prompt — Caption | What should change about the caption? | |
| Prompt — Music | What should change about the music? | |
| Prompt — Pacing | What should change about the pacing? | |
| Prompt — Text overlay | What should change about the on-screen text? | |
| Prompt — Cover | What should change about the cover? | |
| Prompt — Schedule | When should this go out instead? | |
| Prompt — Other | What else would you like changed? | |
| Field placeholder | Tell Kelsey what you'd like instead. | |
| Moments — heading | Notes on moments | **Video posts only** — the section does not render on photo or photo-carousel posts |
| Moments — helper | Optional. Pause the video where you want to point, then add your note. | |
| Moments — add button | Add a note at 0:12 | Timecode is live |
| Moments — no timecode yet | Play the video, then pause where you want to point. | Added 2026-08-31, not on the canvas. Helper text in place of the button. The button appears once the video has a position. Do not render a disabled "Add a note at 0:00". |
| Moments — placeholder | What about this moment? | |
| Footer helper (round 1) | One round of changes is included with your month. | |
| Send button | Send to Kelsey | |
| Disabled-send helper | Pick at least one thing above to get started. | |

## Screen 4 — Send confirmation (round 1)

| Element | String | Notes |
|---|---|---|
| Title | Send to Kelsey? | |
| Summary chips | Caption · Music · 2 notes on moments | Built from the form |
| Summary chips, one moment note | 1 note on moments | Added 2026-08-31, not on the canvas. Replaces only the moments chip; category chips are unchanged |
| Body, line 1 | Kelsey will get these notes and start on the changes. | |
| Body, line 2 | Once you send, nothing more can be added to this post — so take a moment to make sure it covers everything. | "Once you send, nothing more can be added to this post" is emphasized |
| Body, line 3 | This is part of your included round of changes. | |
| Cancel | Go back | |
| Confirm | Send to Kelsey | Mauve |

## Screen 5 — After the client acts

| Element | String | Notes |
|---|---|---|
| Approved — title | Approved | |
| Approved — body | You approved this post on Saturday, September 19. Kelsey will take it from here — it goes out October 10. | |
| Approved — actions | Next post · All posts | |
| With Kelsey — title | Your notes are with Kelsey | |
| With Kelsey — body | Sent Saturday, September 19. Kelsey is on it — the updated post will show up here, and you'll get an email when it's ready. | No message link here — see Screen 6, Working footer |
| Sent-notes heading | What you asked for | |
| Updated — title | Kelsey updated this post | With Round 2 chip |
| Updated — body | Have a look at the new version, then approve it or ask for more changes. | |
| Kelsey note label | A note from Kelsey | |
| Updated — small print | Your included round has been used. Another round of changes has a charge — you'll always see the amount before anything is sent. | |
| Declined — title | This one's staying as planned | |
| Declined — reason label | A note from Kelsey | **Required, not optional** — a deny always carries Kelsey's written reason (spec §4.7) and the client always sees it (§5.6). Body is Kelsey's own words; representative example: "I hear you on wanting more close-up shots. We didn't get usable close-up footage at this shoot, so I can't swap them in this month — but I've added extra close-ups to the plan for your October shoot." |
| Declined — body | The post goes out October 17 as planned. Want to talk it through? Send Kelsey a message | "Send Kelsey a message" is a link to Messages |
| Auto — title | Approved automatically | |
| Auto — body | Reviews for October ended on Friday, September 25, and this post hadn't been reviewed — so it was approved automatically, the way your content plan works. It goes out October 27 as planned. | |
| Auto — footer | Questions? Send Kelsey a message | "Send Kelsey a message" is a link to Messages |

## Screen 6 — Cycle states

| Element | String | Notes |
|---|---|---|
| Working — title | Kelsey is making your changes | |
| Working — body | You asked for changes on 3 posts. She's on it — you'll get an email when the updated posts are ready to review. You can still open any post to read it. | |
| Working — body, one post | You asked for changes on 1 post. She's on it — you'll get an email when the updated post is ready to review. You can still open any post to read it. | Added 2026-08-31, not on the canvas |
| Working — footer | Forgot something? Send Kelsey a message | Appears here only — locked posts don't repeat it |
| Deadline — title | Your October content is set | |
| Deadline — body | Reviews ended Friday, September 25. You approved 9 posts, and 3 you hadn't reviewed were approved automatically, the way your content plan works. Everything goes out on schedule. | |
| Closed early — title | Reviews are closed for October | |
| Closed early — body | Kelsey closed reviews so your month can be scheduled on time. Everything you approved or sent notes on is in. | |
| Closed early — action | Message Kelsey | |

## Screen 7 — No active cycle

| Element | String | Notes |
|---|---|---|
| Nothing yet — title | Nothing to review yet | |
| Nothing yet — body | When Kelsey has your month of posts ready, it will land here — and you'll get an email letting you know. There's nothing you need to do right now. | |
| Between months — title | October is all set | |
| Between months — body | Your October posts are approved and with Kelsey. When November is ready to review, it will show up here — and you'll get an email. | |
| Recap card | Last month / October 2026 / 12 posts · Reviews closed September 25 | Three lines: eyebrow, month, meta |
| Recap card meta, one post | 1 post · Reviews closed September 25 | Added 2026-08-30, not on the canvas. Replaces the meta line only; eyebrow and month are unchanged |

## Screen 8 — Release email

| Element | String | Notes |
|---|---|---|
| Subject | Your October posts are ready to review | |
| Preview text | 12 posts · reviews open through Friday, September 25 | Hidden preheader — the inbox snippet line |
| Preview text, one post | 1 post · reviews open through Friday, September 25 | Added 2026-08-30, not on the canvas |
| Header eyebrow | Client Portal | Existing shell |
| Heading | Your October content is ready | |
| Greeting | Hi Renee, | |
| Body, line 1 | Kelsey has 12 posts ready for your review — take a look when you have a few minutes, and approve each one or ask for changes. | |
| Body, line 1, one post | Kelsey has 1 post ready for your review — take a look when you have a minute, and approve it or ask for changes. | Added 2026-08-30, not on the canvas |
| Body, line 2 | Reviews are open through Friday, September 25. Anything you haven't reviewed by then is approved automatically, so your month stays on schedule. | Second sentence is verbatim the queue's deadline-card line 2 |
| Button (CTA) | Review your posts | `buildShell` hard-codes "Open Portal"; needs an optional label param |
| Footer | Digital Bloom Socials · Franklin, TN · digitalbloomsocials@gmail.com | Existing shell |

## Screen 9 — Round 2+ consent

| Element | String | Notes |
|---|---|---|
| Title | Send round 2 to Kelsey? | Round number is live |
| Summary chips | Caption · Music · 2 notes on moments | Built from the form |
| Body, line 1 | Kelsey will get these notes and start on the changes. | |
| Amount row | Round 2 of changes — $75 | `$75` = `extra_round_price` |
| Amount sub-line | Added to your next invoice — nothing is charged today. Your first round was included with your month. | |
| Finality line | Once you send, nothing more can be added to this post — so take a moment to make sure it covers everything. | Identical to round 1's finality line |
| Cancel | Go back | |
| Confirm | Send · $75 | Mauve; price repeats on the button so consent is unmissable |
| Form footer, round 2+ | This is round 2 — $75, added to your next invoice. | Replaces the included-round helper by the send button |

## Errors — client-facing failure text

*Added 2026-08-30, not on the canvas.* Every string here is written to be actionable without jargon: it says
what happened, what to do next, and that nothing was silently committed.

| Element | String | Notes |
|---|---|---|
| Approve failed | That didn't go through. Give it another try in a moment — nothing was approved. | Added 2026-08-30, not on the canvas |
| Send failed | That didn't go through. Give it another try in a moment — nothing was sent to Kelsey. | Added 2026-08-31, not on the canvas |
| Video won't play | This video isn't loading right now. Refresh the page to try again, or send Kelsey a message if it keeps happening. | Added 2026-08-30, not on the canvas. "send Kelsey a message" is a link to Messages, matching Screen 5's declined and auto-approved states |
| Photo won't load | This photo isn't loading right now. Refresh the page to try again, or send Kelsey a message if it keeps happening. | Added 2026-08-30, not on the canvas. "send Kelsey a message" is a link to Messages, matching Screen 5's declined and auto-approved states |

## Known gaps — copy that does not exist yet

Strings still to be written (tracked as open in `DBS_Content_Approval_Feature.md` §9). Do not improvise these at build time; bring them back through a copy pass first.

| Gap | What's needed |
|---|---|
| Per-round mode, repeat submission | In `per_round` billing, the second and later submissions within the same round of a cycle must **not** show a new charge. The consent dialog (or form footer) needs wording along the lines of "Already covered by round 2 — no additional charge." Not written or designed yet. |
| `extra_round_price = 0` | When the price is zero, billing is off for the cycle: unlimited rounds, the consent dialog is skipped entirely, and the round reads as included. The round-2+ form footer and any replacement helper text for this state are not written yet. |
