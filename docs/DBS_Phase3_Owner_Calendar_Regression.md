# Phase 3 — Owner Calendar Manual Regression Checklist

*Written 2026-08-29, after slice 3.1 (MonthView parameterization). Run against
a local dev build (`npm run dev`) before deploying.*

## What changed, and therefore what can break

`MonthView.tsx` was split: the layout moved to a new generic `MonthGrid.tsx`,
and `MonthView` became a wrapper that injects the owner day links and the
`MonthEventPill` rendering. **`MonthEventPill.tsx`, `eventColors.ts`,
`types.ts`, and `queries.ts` were not touched.** So the only owner-calendar
code that can regress is the MONTH view's structure: cell layout, day
numbers, the today outline, day-cell links, pill placement, and the "+N more"
overflow. Pill *colors and content* come from untouched code — if a pill
renders at all, its color logic is the old code — but check them anyway,
because they now render through the new composition path.

Week and Agenda views share no changed component, but `page.tsx` imports
`MonthView` unconditionally, so a broken module would take down all three.
They get a load check only.

## The baseline trick

Production (portal.digitalbloomsocials.com) still runs the pre-change code.
Open the same month in prod and localhost side by side — every check below is
"do these two render identically", which is faster and stricter than judging
from memory.

## Setup

- A month with real data. Ideally it contains: a confirmed shoot, a
  requested shoot, a completed shoot, a meeting, at least one time block of
  any category, at least one Google-imported event, and one day with **4 or
  more** events. If no single month has all of these, run the affected checks
  in whichever months do.
- Do the desktop pass in a normal browser window, the mobile pass at a
  ~390px-wide viewport (devtools device mode) or on your phone against the
  dev server.

---

## 1. Grid chrome

Open `/owner/calendar?view=month`.

- [ ] Weekday header reads SUN–SAT, uppercase, small muted type, with a
      vertical border between each column.
- [ ] The grid is 6 rows × 7 columns; internal borders between all cells;
      no doubled border at the right edge or bottom edge.
- [ ] Days outside the displayed month: dimmed day number, slightly
      different (raised) background than in-month cells.
- [ ] Today's cell has a 2px mauve outline inset on the cell, and the day
      number sits in a solid mauve square with white text. **No border
      radius** on that square.
- [ ] Step month back and forward with the toolbar. The grid re-renders
      correctly for a 5-week-shaped month and for a month starting on Sunday.

## 2. Day-cell click (empty area)

- [ ] Click the empty part of any in-month day cell (not a pill). The
      DayPanel opens for that day.
- [ ] URL becomes `/owner/calendar?view=month&month=YYYY-MM&date=YYYY-MM-DD`
      with the clicked day's date.
- [ ] Close the DayPanel. You are back on the same month, same scroll.
- [ ] Repeat on a cell from the *previous* month rendered in the leading
      week (dimmed cell) — panel opens for that actual date.

## 3. Shoot pills

Find (or create in a throwaway month) shoots in each status.

- [ ] **Confirmed**: mauve-tinted pill, 3px mauve left border, time prefix
      then client name, no strikethrough.
- [ ] **Requested**: same mauve family but with a diagonal-stripe texture,
      and an italic "(pending)" suffix after the client name. Tooltip ends
      with "(pending)".
- [ ] **Completed**: muted color, text struck through, muted left border.
- [ ] **Cancelled**: same struck-through muted treatment.
- [ ] Click a shoot pill. The Edit Shoot panel opens, and the URL is
      `/owner/calendar?view=month&month=YYYY-MM&date=<that day>&edit=shoot:<id>`.
- [ ] Close the panel — you land back on the same month view.

## 4. Meeting pills

- [ ] A meeting renders in the cooler blue-mauve family (visibly different
      from shoots at a glance), same left-border treatment.
- [ ] Requested meeting (if present): blue-toned stripes, not mauve-toned.
- [ ] Click → same edit panel behavior as shoots (`edit=shoot:<id>` — meetings
      live in the shoots table).

## 5. Time-block pills

- [ ] **Sonography**: grey-green tint, dark left border.
- [ ] **Work block**: green tint, green left border and green text.
- [ ] **Blocked**: faint mauve tint, muted italic text (no strikethrough).
- [ ] Time prefix shows the block's start time.
- [ ] Click one. The Time Block panel opens;
      URL ends `&edit=time_block:<id>`.

## 6. Google Calendar events

- [ ] Imported events have the Google-blue tint and blue left border.
- [ ] A timed event shows its start time; an **all-day** event shows
      "All day" instead.
- [ ] Hover tooltip ends with "· View in Google Calendar".
- [ ] Click one: it opens Google Calendar **in a new tab**. The portal tab
      does not navigate, and no edit panel opens.

## 7. Overflow — "+N more"

Find the day with 4+ events (create dummy time blocks if needed).

- [ ] The cell shows exactly **3** pills, then a muted "+N more" line where
      N = total − 3.
- [ ] The pills shown are the 3 earliest by start time.
- [ ] Click "+N more". The DayPanel opens listing **all** of that day's
      events, URL carries `&date=<that day>`.
- [ ] A day with exactly 3 events shows 3 pills and **no** overflow line.

## 8. Mobile pass (~390px viewport)

- [ ] Month grid fits the viewport width; 7 columns, no horizontal scroll.
- [ ] Pills are the smaller 16px-tall variant, day numbers smaller, weekday
      header abbreviated but readable.
- [ ] Tap an empty cell area → DayPanel. Tap a pill → edit panel. Tap
      "+N more" → DayPanel.

## 9. Other calendar views load

- [ ] `/owner/calendar` (week view) renders on desktop; the mobile fallback
      note appears at a narrow viewport.
- [ ] `/owner/calendar?view=agenda` renders.
- [ ] The pending-requests bar still appears when a requested future shoot
      exists (any view).

---

## 10. New surface smoke check (not regression — the Phase 3 calendar)

Quick confirmation the new content calendar behaves, while you're in there:

- [ ] `/owner/content` now lands on the **calendar** view; the Calendar/List
      toggle sits beside the month stepper.
- [ ] Photo posts show true-aspect 9:16 thumbnails in their day cells —
      full frame, not cropped square.
- [ ] Desktop: a day with >4 posts shows 4 tiles + a "+N" tile; mobile: one
      full-width tile with a "+N" badge.
- [ ] A post whose video is still processing shows a muted empty tile (not a
      broken image); a failed upload shows a danger-red border.
- [ ] Clicking a tile opens that post's edit panel. Clicking "+N", the
      badge, or a cell's empty area jumps to the List view scrolled to that
      day, with month + client filter preserved.
- [ ] Month stepper, client pills, and the view toggle all preserve each
      other's state in the URL.
- [ ] List view is unchanged from before (grouped by date, table on
      desktop, cards on mobile).

*If any item in sections 1–9 differs from production, stop and report it
before deploying — that is a live-calendar regression.*
