# Story: Controller notes in the exercise report

**Feature:** AAR export package  ·  **Epic:** E10  ·  **Phase:** 4  ·  **Status:** Not Started · backlog
**Requirements:** EVL-030 (adjacent)  ·  **Design decisions:** none  ·  **Issue:** #556

## Context
Raised at the 10/15 internal demo while mocking up the printable exercise report (the "pretty" companion
to the demo-feedback story 02 `.xlsx` export). The report wants a couple of sentences on what happened, but
an AI-written summary was ruled out: an obvious AI summary would put clients off. The answer is a short
narrative **written by exercise control** and printed in the report under the metrics.

Nothing in Pulse stores such notes today. The demo report ships **without** the notes section; this
story tracks adding it. Staff world only.

## Acceptance Criteria
- [ ] A controller (or lead) can write and edit plain-text notes for the exercise from the staff console,
      and they are saved per exercise.
- [ ] The printable exercise report shows the notes under "At a glance", with the author's name and the
      time last edited; the section is left out entirely when there are no notes.
- [ ] Evaluators can read the notes; whether they can also write them is decided before build.
- [ ] Isolation (XC-001/COR-001): notes are exercise-scoped (`IExerciseScoped`); a cross-exercise read or
      write returns 403/404.
- [ ] Telemetry (XC-004): saving notes emits one event (actor, wall + scenario time); the payload carries
      no note text.
- [ ] Content security (NFR-004): notes are stored and rendered as plain text; markup never executes.

## Out of Scope
AI-generated summaries. Evaluator observations and annotations (`evaluator-tools`). Rich text and
attachments. Per-inject or per-post notes.

## Technical Notes
Smallest shape: an `ExerciseNotes` entity (or a column on the exercise) plus a `GET`/`PUT` staff endpoint,
and a text box on the console's export area. The report endpoint returns the notes alongside its summary.
A fallback for the demo, if wanted, is a text box in the export dialog that prints but does not save.

## Dependencies
The printable exercise report (not yet a story; mocked up 10/15).

## Tests
Backend: endpoint isolation and telemetry tests beside the report tests. Frontend: the report renders the
section only when notes exist.
