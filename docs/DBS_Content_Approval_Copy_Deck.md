# Content Approval — Client Copy Deck

*Final strings for the client-facing Review & Approve screens (screens 1–9), rescued from the design canvas on 2026-08-30. Screen 10 (the re-release email) was added 2026-09-02 and is not on the canvas.*

- **Canvas:** https://claude.ai/code/artifact/5126b6c5-a061-4afc-917e-98e0c849477d
- **`$75` is a stand-in for `extra_round_price`, which is not yet set.** Every `$75` below renders from that config value.
- **Amounts render as `$75`, with cents only when present** (`$62.50`, never `$75.00`). Confirmed as a deck rule 2026-09-04.
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
| All-handled banner body (all denied) | You've reviewed everything, and Kelsey is keeping these posts as planned. Your October content is set. | Added 2026-08-31, not on the canvas. Shown when nothing is in flight and at least one request was denied — also covers a mix of approvals and denials, where the all-approved wording ("You approved all 12 posts") would be wrong |
| Table headers (desktop) | Post · Scheduled · Platform · Status | |
| Row action — needs review | Review | |
| Row action — otherwise | View | |

*Counting rule (added 2026-08-31): a denied request counts as neither
changes-in-flight nor approved. The changes-requested banner and Screen 6's
Working state count only items whose latest submitted round is still open or
addressed — the Working state does not render when every request was denied,
because nothing is coming.*

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
| Footer helper (round 1) | One round of changes is included with your month. | Round 1 only. On round 2+ before Phase 8, NOTHING rendered in its place (decided 2026-09-02): the sentence is about the included round, and no pre-consent round-2 string existed. From Phase 8 the slot is filled by exactly one of: Screen 9's round-2+ footer (a charge), the covered row below, or the included row below |
| Footer helper (round 2+, included) | This round of changes is included. | Added 2026-09-04, not on the canvas. A round beyond round 1 that carries no charge: `extra_round_price` is 0 or unset, or the round number is within `included_rounds`. No consent dialog is shown for it |
| Footer helper (round 2+, per-round covered) | Already covered by round 2 — no additional charge for this post. | Added 2026-09-04, not on the canvas. Round number is live. `per_round` billing only: another post already opened this round's charge, so this post sends free. Replaces Screen 9's footer in that state |
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
| Body, line 3 | This is part of your included round of changes. | Round 1 only. Not rendered on round 2+ before Phase 8 (decided 2026-09-02) — the dialog ended at the finality line. From Phase 8 a round-2+ dialog is Screen 9 (a charge or the covered state), or this dialog with the included line below |
| Body, line 3 (round 2+, included) | This round is included — there's no charge for it. | Added 2026-09-04, not on the canvas. The same state as Screen 3's included footer: a round beyond round 1 with no charge. Title, chips, lines 1 and 2, and both buttons are unchanged |
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
| With Kelsey — actions | Next post · All posts | Added 2026-09-02, not on the canvas. The same pair the approved and declined states have: a sent post is closed, and the client's next move is the rest of the queue. Still no message link |
| Sent-notes heading | What you asked for | |
| Updated — title | Kelsey updated this post | With Round 2 chip (the round number is live — "Round 3" after a second re-release). Shown when a post comes back to the client after re-release: the post is open for review again, and its previous request was accepted. No "What you asked for" readback on this state (decided 2026-09-02) — the new version is what the client is here to look at |
| Updated — body | Have a look at the new version, then approve it or ask for more changes. | Followed by the same Approve / Request changes pair as Screen 2 |
| Kelsey note label | A note from Kelsey | Optional on an accept — renders only when Kelsey wrote one |
| Updated — small print | Your included round has been used. Another round of changes has a charge — you'll always see the amount before anything is sent. | Held from 2026-09-02 through Phase 7; **turned on in Phase 8 (2026-09-04), as written.** Renders only when the round the client would open from this post carries a charge (the state that shows Screen 9). When `extra_round_price` is 0 or unset, or the round is within `included_rounds`, NOTHING renders here, as in Phase 6 |
| Updated — small print, per-round covered | Your included round has been used. This round of changes is already on your next invoice. | Added 2026-09-04, not on the canvas. `per_round` billing only: another post already opened this round's charge, so this post would send free and the held row's promise of an amount would be false. Same placement as the held row |
| Declined — title | This one's staying as planned | |
| Declined — reason label | A note from Kelsey | **Required, not optional** — a deny always carries Kelsey's written reason (spec §4.7) and the client always sees it (§5.6). Body is Kelsey's own words; representative example: "I hear you on wanting more close-up shots. We didn't get usable close-up footage at this shoot, so I can't swap them in this month — but I've added extra close-ups to the plan for your October shoot." |
| Declined — body | The post goes out October 17 as planned. Want to talk it through? Send Kelsey a message | "Send Kelsey a message" is a link to Messages |
| Declined — actions | Next post · All posts | Added 2026-08-31, not on the canvas. Same pair as the approved state, alongside the body's "Send Kelsey a message" link — a declined post is settled, and the client's next move is the rest of the queue |
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
| Deadline — body, one approved + one auto | Reviews ended Friday, September 25. You approved 1 post, and 1 you hadn't reviewed was approved automatically, the way your content plan works. Everything goes out on schedule. | Added 2026-09-02, not on the canvas. Singular and plural forms of the mixed variant follow the same mechanical inflection as the rows added 2026-08-30 |
| Deadline — body, none auto | Reviews ended Friday, September 25. You approved all 12 posts, and everything goes out on schedule. | Added 2026-09-02, not on the canvas. The client finished before the deadline; the sweep only locked |
| Deadline — body, none approved | Reviews ended Friday, September 25. The 12 posts you hadn't reviewed were approved automatically, the way your content plan works. Everything goes out on schedule. | Added 2026-09-02, not on the canvas. The client never opened the month |
| Deadline — body, none approved, one post | Reviews ended Friday, September 25. The post you hadn't reviewed was approved automatically, the way your content plan works. It goes out as planned. | Added 2026-09-02, not on the canvas |
| Deadline — body, one approved, none auto | Reviews ended Friday, September 25. You approved your post, and it goes out as planned. | Added 2026-09-04, not on the canvas. Inflected the way the deck inflects its own singulars ("You approved your post", Screen 1; "It goes out as planned", the one-post row above) — "You approved all 1 posts" is broken software to this audience |
| Deadline — body, none counted | Reviews ended Friday, September 25. Everything goes out on schedule. | Added 2026-09-04, not on the canvas. Every post still With Kelsey or kept as planned at the close — nothing for either count, so the two deck sentences that need none |
| Closed early — title | Reviews are closed for October | |
| Closed early — body | Kelsey closed reviews so your month can be scheduled on time. Everything you approved or sent notes on is in. | |
| Closed early — action | Message Kelsey | |

*Deadline body rule (added 2026-09-02): the canvas body and the four variants
above are one sentence shape with two counts as inputs — build them from one
function, not five hardcoded strings. "Approved" counts the posts the client
approved; "hadn't reviewed" counts the posts the deadline approved
automatically. Posts still With Kelsey at the deadline are counted by neither:
the sentence is about what the client did and what the deadline did, and a
post Kelsey still owes work on is neither. "Reviews ended" is the day reviews
actually closed, which for a deadline close is the deadline day.*

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
| Amount sub-line | Added to your next invoice — nothing is charged today. Your first round was included with your month. | When `included_rounds` is 1 |
| Amount sub-line, `included_rounds` > 1 | Added to your next invoice — nothing is charged today. Your first 2 rounds were included with your month. | Added 2026-09-04, not on the canvas. Number is live |
| Finality line | Once you send, nothing more can be added to this post — so take a moment to make sure it covers everything. | Identical to round 1's finality line |
| Cancel | Go back | |
| Confirm | Send · $75 | Mauve; price repeats on the button so consent is unmissable |
| Form footer, round 2+ | This is round 2 — $75, added to your next invoice. | Replaces the included-round helper by the send button |

*Per-round covered state (added 2026-09-04, not on the canvas). In `per_round`
billing, the second and later posts the client sends within one round of a
cycle carry no charge — the round's charge was opened by the first post. The
dialog for those posts is Screen 9 with the money removed: the title keeps the
round number, the chips and line 1 are unchanged, there is NO amount row, the
sub-line is replaced by the row below, the finality line is unchanged, and the
confirm button is Screen 4's "Send to Kelsey" with no price on it.*

| Element | String | Notes |
|---|---|---|
| Title (per-round covered) | Send round 2 to Kelsey? | Same as the charge title; round number is live |
| Sub-line (per-round covered) | Round 2 is already on your next invoice — there's no additional charge for this post. | Added 2026-09-04, not on the canvas. Round number is live. Takes the amount row's and sub-line's place |
| Confirm (per-round covered) | Send to Kelsey | Mauve; Screen 4's label — no price, because there is none |

## Screen 10 — Re-release email

*Added 2026-09-02, not on the canvas.* Sent when Kelsey re-releases a month
(spec §4.8): the posts whose requests she accepted go back to the client for
another look, and this is the email that says so. Same shell and shape as
Screen 8. **No charge language anywhere in it** — held with Screen 5's Updated
small print until Phase 8, and **confirmed charge-free in Phase 8 (2026-09-04)**:
consent is captured in the Screen 9 dialog, and the email is not the place
for it. `lib/contentEmails.test.ts` asserts the absence and stays. No
denied-request line either: by decision
(2026-08-31) the client discovers a deny on the post itself, and a month where
every request was denied never re-releases, so this email never has to cover
that case.

| Element | String | Notes |
|---|---|---|
| Subject | Your October updates are ready to review | Mirrors Screen 8's subject shape |
| Subject, one post | Your October update is ready to review | |
| Preview text | 3 updated posts · reviews open through Friday, September 25 | Hidden preheader — the inbox snippet line |
| Preview text, one post | 1 updated post · reviews open through Friday, September 25 | |
| Header eyebrow | Client Portal | Existing shell |
| Heading | Kelsey updated your October posts | Echoes Screen 5's "Kelsey updated this post" |
| Heading, one post | Kelsey updated one of your October posts | |
| Greeting | Hi Renee, | Existing shell |
| Body, line 1 | Kelsey made the changes you asked for on 3 posts — have a look at the new versions when you have a few minutes, and approve each one or ask for more changes. | The count is the posts sent back in THIS re-release, not everything awaiting review — the queue may still hold posts the client never reached |
| Body, line 1, one post | Kelsey made the changes you asked for on 1 post — have a look at the new version when you have a minute, and approve it or ask for more changes. | |
| Body, line 2 | Reviews are open through Friday, September 25. Anything you haven't reviewed by then is approved automatically, so your month stays on schedule. | Verbatim Screen 8's line 2; the second sentence is the queue's deadline-card line 2, rendered from the same exported constant |
| Button (CTA) | Review the updates | |
| Footer | Digital Bloom Socials · Franklin, TN · digitalbloomsocials@gmail.com | Existing shell |

## Invoice line items — client-facing on the PDF

*Added 2026-09-04, not on the canvas.* When Kelsey adds an accrued revision
charge to an invoice, its line-item description lands on the invoice PDF, the
receipt PDF, and the client's invoice list — so it is client-facing text and
belongs here. The amount is the round's snapshotted price and follows the
amount rule at the top of this deck.

| Element | String | Notes |
|---|---|---|
| Description, per round | Content revisions · Round 2 · October 2026 | `per_round` billing: one line per round per cycle. Round number and month are live |
| Description, per post | Content revisions · Round 2 · Instagram Reel, Oct 10 | `per_item` billing: one line per post revised. Round number, platform label (Screen 2's), and the post's scheduled date are live |

## Errors — client-facing failure text

*Added 2026-08-30, not on the canvas.* Every string here is written to be actionable without jargon: it says
what happened, what to do next, and that nothing was silently committed.

| Element | String | Notes |
|---|---|---|
| Approve failed | That didn't go through. Give it another try in a moment — nothing was approved. | Added 2026-08-30, not on the canvas |
| Send failed | That didn't go through. Give it another try in a moment — nothing was sent to Kelsey. | Added 2026-08-31, not on the canvas |
| Send failed, terms changed | Kelsey updated this month's revision terms while you were writing. Refresh the page and you'll see the current terms before you send. | Added 2026-09-04, not on the canvas. The consent dialog's outcome travels with the send, and the server writes a charge only when it matches what was shown exactly; when Kelsey edited the price, the included rounds, or the billing mode in between, the send is refused with nothing written. The plain send-failed line would be wrong here — a retry under the same stale page fails the same way — so this one says why and what to do |
| Video won't play | This video isn't loading right now. Refresh the page to try again, or send Kelsey a message if it keeps happening. | Added 2026-08-30, not on the canvas. "send Kelsey a message" is a link to Messages, matching Screen 5's declined and auto-approved states |
| Photo won't load | This photo isn't loading right now. Refresh the page to try again, or send Kelsey a message if it keeps happening. | Added 2026-08-30, not on the canvas. "send Kelsey a message" is a link to Messages, matching Screen 5's declined and auto-approved states |

## Known gaps — copy that does not exist yet

Strings still to be written (tracked as open in `DBS_Content_Approval_Feature.md` §9). Do not improvise these at build time; bring them back through a copy pass first.

| Gap | What's needed |
|---|---|
| ~~Per-round mode, repeat submission~~ | **Resolved 2026-09-04.** Screen 3's "Footer helper (round 2+, per-round covered)", Screen 9's per-round covered table, and Screen 5's "Updated — small print, per-round covered". |
| ~~`extra_round_price = 0`~~ | **Resolved 2026-09-04.** Screen 3's "Footer helper (round 2+, included)" and Screen 4's "Body, line 3 (round 2+, included)"; Screen 5's small print renders nothing in this state. |
| `included_rounds = 0` | The cycle editor accepts 0 included rounds, which makes round 1 billable. Screen 9's sub-line then has no true second sentence ("Your first round was included" would be false). Until a row exists, the build renders only the first sentence ("Added to your next invoice — nothing is charged today.") in that state — an omission, not an improvisation. |
| Screen 5 small print, `included_rounds` > 1 | "Your included round has been used." is singular. With two or more included rounds the held row renders as written (approved 2026-09-04); a plural variant does not exist. |
