# Logging Experience Redesign

## Decided Direction

The surprise version is: turn logging into a visual set composer, not a form plus calculator.

Imagine the exercise opens and you see a compact set lane:

- Target shown as a faint ghost bar
- Actual shown as the bar/load you are logging

For bench:

```text
Set 1    [ 45 | 45 | BAR | 45 | 45 ]     135 lb     reps __
Set 2    [ 45 | 45 | BAR | 45 | 45 ]     135 lb     reps __
Set 3    [ 45 | 45 | BAR | 45 | 45 ]     135 lb     reps __
```

But visually polished, not text-heavy. The bar is the load cell.

Tap the bar on any row and it expands into a load editor:

- Drag plates on/off visually
- `+5`, `+10`, `-5`, `-10`
- Direct number entry
- Apply to all working
- Apply from here down
- Copy previous set

Then collapse back to the row. No separate plate calculator block. The cool bar visual stays, but it lives inside the logging flow.

For machine exercises, the row becomes a stack visual:

```text
Set 1    [stack pin at 55]     Second floor right     reps __
```

Tap stack:

- Move pin up/down
- `+1 plate`, `-1 plate`
- Quick chips around last load
- Apply to all
- Apply from here down

For dumbbells:

```text
Set 1    [DB] [DB]     60s     reps __
```

Tap:

- `+5 each`
- `-5 each`
- Same as last

The key is: the visual changes by load type, but the logging flow stays identical.

What makes this feel awesome:

- You see the whole exercise as a stack of visual set rows.
- The app preloads the plan from smart defaults.
- You mostly enter reps.
- Load editing feels physical and playful.
- The calculator disappears as a separate tool and becomes part of the set itself.
- Applying load to multiple sets becomes a natural gesture/action, not a list of "use for set 1 / set 2 / set 3" buttons.

The best interaction: press and hold a load row, then drag it down to copy that load to lower sets.

So if set 1 is `185`, drag the bar/load pill down across sets 2 and 3, and they inherit it. That feels much better than buttons.

This keeps the engagement component we like, but removes the clunky transfer step. It becomes: edit the set visually, then log reps.

## Product North Star

Logging should feel like composing the exercise visually, not filling out a form. The set rows are the primary interface. Load editing happens inside the row. Smart defaults should make most sessions feel like: review the rows, adjust only what changed, enter reps, finish.

## Guardrails

- Keep this as a UX simplification, not a data-model expansion project.
- Do not add attachment tracking right now. Rope pushdowns, straight-bar pushdowns, and similar variants already exist as separate exercises.
- Do not expand into a full gym inventory or plate ownership model right now.
- Keep the machine profile system already added, but do not make this redesign depend on more equipment profile complexity.
- Do not silently save suggested target reps as actual reps. Actual reps must come from the user.
- Preserve direct total-load entry and reset behavior from the existing plate calculator work.
- Keep guided targets tied to prescribed workout rules, not the number of visible draft rows.

## Current Friction

- The load calculator sits outside the actual set rows.
- After calculating a load, the user has to transfer it with chips like "use for set 1" or "use for set 2".
- The bar visual is engaging, but it feels like a separate tool instead of part of logging.
- Users think in sets first. The current flow makes them calculate first, then assign to sets.
- Machine and dumbbell exercises need the same simple logging rhythm, even though their visuals should differ.

## Core Principles

- The set table is the source of truth.
- Every set row has the same basic shape: set number, visual load cell, load value, reps input, set kind.
- The visual load cell changes by load type.
- Target load can appear as a ghost or hint, while actual load remains editable.
- Smart defaults reduce typing, but the user stays in control.
- Bulk actions should be contextual: this set, all working sets, or from this set down.
- Last session and best session context should remain visible enough to guide the user.

## Phase 1: Smart Set Defaults

Status: Implemented.

Goal: when an exercise opens, the rows should already be useful.

Build:

- Generate sensible set rows from the guided recommendation, last session, or current exercise defaults.
- Prefill load when confidence is high.
- Show target reps as hints or quick actions, not saved actuals.
- Add quick actions like `Repeat last`, `Use target load`, and `Same as previous set`.
- Keep warm-up and working sets distinct.

Success:

- The user can usually start a set by only entering reps.
- No calculated target changes just because the user adds or removes visible rows.
- Actual reps remain empty until the user enters them.

## Phase 2: Inline Load Cell

Status: Implemented.

Goal: remove the separate calculator block from the logging flow.

Build:

- Add a compact visual load cell inside every set row.
- Tapping the load cell opens a contextual load editor.
- The editor can apply changes to:
  - This set
  - All working sets
  - This set and lower sets
  - The next set by copying previous
- Keep direct numeric entry available.

Success:

- The user edits load from the row they are logging.
- The old "use for set 1 / set 2" transfer step is no longer needed for the main path.

## Phase 3: Visual Load Editors

Status: Implemented.

Goal: make load editing feel physical and specific to the exercise type.

Build:

- Barbell editor:
  - Compact loaded-bar preview in the row
  - Expanded editor with plates, direct load entry, reset, and quick increments
- Machine stack editor:
  - Stack/pin preview in the row
  - Expanded editor with pin movement, plate-step increments, quick chips around last load, and selected machine profile label
- Dumbbell editor:
  - Paired dumbbell preview in the row
  - Expanded editor with per-hand increments and same-as-last actions
- Bodyweight plus/minus editor:
  - Clear badge for added load or assistance
  - Quick increments and same-as-last actions

Success:

- The interaction stays consistent while the visual language changes by load type.
- Existing bar engagement is preserved inside the set row instead of living in a separate panel.

## Phase 4: Gesture Polish

Status: Implemented, pending a real-device feel pass.

Goal: make bulk load changes feel natural.

Build:

- Press and hold a visual load cell.
- Drag downward across lower rows to copy that load.
- Highlight the rows that will inherit the load.
- Confirm the copied load when the drag ends.
- Keep button actions as the accessible fallback.

Success:

- Copying `185` from set 1 to sets 2 and 3 feels faster than tapping multiple buttons.
- Users can still complete the same action without gesture precision.

## Phase 5: Guided Workout Integration

Status: Implemented.

Goal: make guided sessions feel planned without becoming rigid.

Build:

- Show guided target as a ghost visual inside the row.
- Show actual logged load as the primary visual.
- Use same-machine history when a cable or machine profile is selected.
- Keep last and best context available near the exercise.
- Ensure logs and workout summary show the final actual data clearly.

Success:

- Guided workouts feel preloaded and easy to complete.
- Machine profile context improves suggestions without creating extra setup work during logging.

## Resolved Implementation Decisions

- Confident last-session/guided loads are prefilled into set rows; actual reps stay blank.
- Target reps appear as placeholders and small row hints, not saved values.
- `All working` and drag-copy skip warm-up rows.
- Small screens wrap row actions instead of shrinking text or overflowing.
- Drag-to-copy ships with the inline load cell release, with button actions retained as the accessible fallback.

## Implementation Notes

- Primary screens: `WorkoutScreen` and `GuidedWorkoutScreen`.
- Existing machine profile setup: `MachineProfilePanel`.
- Existing guided logic should stay centralized in `guidedWorkoutService`.
- Existing store and persistence should remain the source for active workout rows and saved sessions.
- First implementation should avoid new persistence unless the UX cannot work without it.
- This redesign should replace the main path for the old calculator transfer chips, not remove useful calculator logic underneath.

## Decision Log

- 2026-06-09: Attachment tracking is out of scope because exercise variants already represent attachment differences.
- 2026-06-09: The goal is a logging UX redesign, not a broader equipment model redesign.
- 2026-06-09: The accepted direction is the visual set composer: smart rows first, visual load cells inside rows, contextual editors, and bulk apply/copy actions.
