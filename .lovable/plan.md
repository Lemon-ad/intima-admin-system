# 28 May Orientation — schedule seed + member merging

## Scope

Two deliverables, in order:

1. **Seed the schedule** `10c0abbd-fb3f-467e-b04e-944aeb164120` (renamed to "28 May 2026 Orientation @ LT") with every row from the four attachments, using the existing `group_label` / `programmes` / `note` fields. Save the result as a reusable template ("Orientation – Full Day").
2. **Add "merge same member across grouped positions"** so when one person (e.g. Lucas) covers many courses inside the same group (e.g. LR 507), their name appears once spanning all those rows — on the on-screen views, PDF export, Excel export, and screenshot/PNG export.

## Data model — no schema changes

The `schedule_slot_positions` table already has `group_label` and `programmes`. We will use:

- **group_label** = venue / cluster (e.g. `LR 507`, `Lecture Theatre`, `LR 508`)
- **position_name** = the course code (e.g. `CITA`, `DITA`) OR the role (`EMCEE`, `HALL MANAGER`)
- **programmes** = full course title shown under the code (`Certificate in Information Technology`)
- **slot.note** = section title (`Your INTI Experience, Getting Ready with SAO`)
- **slot.duty** = optional sub-detail like the starting point (`L1 - Music Room`)

For Tour De INTI (one slot 11:00–12:00), each team becomes a position named `Team A`…`Team J` with `group_label = "Starting point"` and `programmes = "L1 - Music Room"` etc. Assigned members = the facilitators.

## Slot list (15 slots, all dated 2026-05-28)

| # | Time | Note (section title) | Positions |
|---|------|----------------------|-----------|
| 1 | 07:45–09:00 | Orientation Kick-Off | L2 USHERS, L5 USHERS, HALL MANAGER, SLIDES, PHOTOGRAPHER, Facilitators, EMCEE, Tiger |
| 2 | 09:00–09:45 | Your INTI Experience, Getting Ready with SAO | PRESENTER, HALL MANAGERS, SLIDES, PHOTOGRAPHER, Facilitators, Tiger |
| 3 | 09:45–10:10 | Your Voice: INTIMA | EMCEE, HALL MANAGERS, SLIDES, PHOTOGRAPHER, Facilitators |
| 4 | 10:10–11:00 | Affiliates Session | EMCEE, AFFILIATES USHERS, HALL MANAGERS, SLIDES, PHOTOGRAPHER + 5 affiliate sub-slots (HYPE+, IICP Japanese ACG, Rotaract, Law & Economics, Model UN) — each as a position with its time in `programmes` |
| 5 | 11:00–12:00 | Tour De INTI | Team A…J (group_label=Starting point, programmes=venue) |
| 6 | 12:00–12:45 | Lunch | F&B (note: "which teams finished first can help out") |
| 7 | 12:45–14:00 | Empower Me!, Getting Ready with SAO | EMCEE, HALL MANAGERS, SLIDES, PHOTOGRAPHER |
| 8 | 14:00–15:00 | LMS Workshop | 22 course positions across 3 groups: LR 507 (Lucas + Loshna split), LR 508 (Xin Ying + Jia Yi split), Lecture Theater (Derrick) |
| 9 | 15:00–16:30 | Meet Your HOP | 22 course positions, 11 venue groups (LR602…LR511, LR402, LR403) |
|10 | 16:30–17:30 | Lab Briefing | Engineering + Science courses, LR504 (Li Ji) + LR605 (Lucas) |

## Member-merge feature

When rendering positions inside a slot, group consecutive positions by `group_label`; within each group, if the same member is assigned to several positions in a row, render the member's name **once** with row-span (HTML/PDF) or merged cell (Excel) covering those positions.

### Files to change

- `src/components/ScheduleExport.tsx` — Excel + PDF: build a `rowspan` map per group (PDF: use jspdf-autotable `rowSpan`; Excel via ExcelJS `mergeCells`)
- `src/components/PublicScheduleView.tsx` — table view: compute rowspan for member column
- `src/components/MergedScheduleView.tsx` — same
- (Admin editor display already groups; not changing edit UX)

### Algorithm (shared util)

```ts
// per group: iterate positions in order; for each, list of member names per position;
// collapse identical adjacent member-lists into a single cell with rowSpan = run length.
buildMergedMemberCells(positions, assignments) -> { positionId, members, rowSpan, skipMemberCell }[]
```

Extract into `src/lib/scheduleMerge.ts` and reuse across the four renderers.

## Template save

After seeding the slots, snapshot the schedule into a new template named **"Orientation – Full Day"** with `is_weekly=false`, capturing each slot's positions in `positions_by_slot_key` (already supported). No code change — use the existing "Save as Template" path in `AdminScheduleEditor`.

## Execution order

1. SQL: rename schedule → insert 10 time slots → insert positions per slot (with group_label/programmes) → no assignments yet (members may not all match by name; we will leave that to admin)
2. SQL: snapshot template row
3. Code: add `src/lib/scheduleMerge.ts` + wire into the four renderers
4. Verify in preview, then notify user to assign members via the editor (the names in the sheet — Lucas, Loshna, etc. — should already exist as members; admin can drag-assign quickly, or we run a second SQL that name-matches if you want)

## Open question

Should I also auto-assign the members shown in the attachments (matching by `name` / `display_name`)? Or leave assignment to be done manually in the editor? — I will ask after the structure is in place.
