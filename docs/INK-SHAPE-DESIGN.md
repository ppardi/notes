<!--
  - SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Shapes in ink

Status: design, awaiting approval. Target: the `6.1.x` private build. Extends
[INK-DESIGN.md](INK-DESIGN.md) and follows [INK-COLOR-DESIGN.md](INK-COLOR-DESIGN.md),
whose picker this one is built in the image of.

## The problem

Paul's words: squares, circles and straight lines, "simple geometry for simple
diagrams and section delimiters". No arrows. A text block "would be nice but not
necessary if too complex" — it is too complex, and the reason is in
[Out of scope](#out-of-scope).

Freehand already draws all three badly. A ruled line under a heading comes out
wobbling, and a box around a note comes out as a quadrilateral that was meant to
be a rectangle. Nothing in the canvas can make a straight line straight.

## What was measured, not assumed

| Question | Answer |
| --- | --- |
| Does a dense polyline keep its corners through `traceStroke`? | **Almost.** A 200×100 rectangle sampled every 5 px comes back with its corner 0.99 px inside where the nib alone would put it, because perfect-freehand's `streamline` defaults to 0.5 and smooths the path it is given. |
| And with `streamline: 0`? | **Exactly.** The nearest outline vertex is 1.25 px from the corner, which is `STROKE_SIZE / 2` — a perfect corner. |
| Is 0.99 px visible? | Unknown. It is under half the 2.5 px nib's width, so it should not be. Not seen on a screen, only computed. |
| Does the Catmull-Rom gap filling interfere? | **No**, as long as vertices are no further apart than `SMOOTH_GAP` (6 px): `smoothed()` inserts nothing between points closer than that, so edges stay straight and corners stay sharp. |
| Do the icons exist? | Yes — `Pencil`, `VectorLine`, `RectangleOutline`, `EllipseOutline` are all in `vue-material-design-icons`. |
| How much room is in the bar? | Enough. It holds five controls today; six compact ones plus a labeled Done is comfortable at 768 pt, an iPad's portrait width. |

## Decisions

### A shape is a stroke

A shape is emitted as a densely sampled polyline — vertices no more than
`SMOOTH_GAP` apart — and stored as an ordinary stroke, `{points, color}`.

This is the whole design. Everything else already works on strokes and keeps
working the day shapes ship, with no new code and no change to the file format:

- **The eraser** tests segment against segment, so it rubs out a rectangle's
  edge exactly as it rubs out handwriting.
- **Undo** takes back one stroke, and a shape is one stroke.
- **Color** applies because a shape carries `color` like anything else.
- **Cropping to the ink, the PNG render, the saved metadata, the theme filter**
  are untouched.
- **A drawing stays a list of strokes.** That uniformity is why color cost a day,
  and it is the thing a parametric shape or a text box would spend.

- **Not parametric** (`{kind: 'rect', from, to}`). It would allow moving or
  resizing a shape after the fact, and it would cost branches in every render
  path, in `inkBounds`, in `erasedBy`, and a version bump with real backward
  compatibility. Nobody asked to move a shape. If that day comes, polylines do
  not block it — a drawing is still just strokes.

### The corner is left slightly soft, for now

`streamline: 0.5` rounds a corner by 0.99 px beyond the nib. The nib is 2.5 px
wide, so the rounding is under half a line width and is expected to be invisible.

Shipping without a fix is deliberate: the fix is a flag on the stroke that
renders it with `streamline: 0`, and that is an additive field in the file format
that should not be spent on a number nobody has seen yet. If the corners read as
soft on the device, the flag is a small change and the measurement above says
exactly what it buys.

### One tool picker, with the pen inside it

A button in the bar showing the tool in use, opening a popover of four named
choices: **Pen, Line, Rectangle, Ellipse**.

The pen is a member of the set rather than an absence of one. That gives the
mode a single home, and — the part that matters — the button shows at a glance
what the next stroke will be. A stateful tool's usual failure is "why is my pen
drawing boxes", and the answer is to keep the state where the eye already is.

It is built exactly like the color picker: an `NcActions` with `v-model:open`,
`NcActionButton type="radio"`, choices bound on both `update:modelValue` and
`click`, and the pen served from `pointerup`. That is not reuse for its own sake
— every one of those details was a bug found on the device, and a second picker
written any other way would find them all again.

- **Not three separate buttons.** Three slots for one decision, and no single
  place showing which is in force.
- **Not one button that cycles.** One slot, but the next state is a guess.

### The tool is not remembered between drawings

The canvas opens on the pen every time. Color is remembered because it is a
preference — what your ink looks like. A tool is a momentary intent: a reader
who drew three boxes last Tuesday and comes back to write a note means to write.

### Erasing suspends the tool rather than replacing it

The eraser stays its own button. Folding it into the picker would be a cleaner
model and would leave the bar at five, but erasing is the most-reached-for
control here and a popover costs a tap every time.

So: the tool is what you draw with, erasing suspends it, and tapping Erase again
resumes the tool you had. **Choosing a tool turns erasing off**, which is the
rule choosing a color already follows — anything that says "the next thing is a
stroke" stands the eraser down, because the eraser is the one thing on this
canvas that destroys work.

**Choosing a color does not change the tool.** They are orthogonal: a color says
what the ink looks like, a tool says what shape it takes.

### Drawing one

Pointer down sets the anchor, pointer move updates the far corner, pointer up
commits. A rectangle spans the two corners; an ellipse is inscribed in that box;
a line runs from one to the other.

The preview rides on the live sheet, which already paints an in-progress stroke
and clears only the rectangle it last painted. A shape in progress is the same
mechanism with a different generator, so the cost of showing it is a function
call rather than a feature.

A finger still pans and still never draws. Palm rejection is untouched.

### A shape that never grew is not a shape

A drag whose diagonal stays under 8 CSS pixels commits nothing. It is also what
keeps a stray tap from leaving a dot, and 8 is the threshold a finger already has
to cross to count as a pan.

Beyond that, Undo. No cancel gesture is invented: one that has to be explained
is one nobody finds.

**`pointercancel` abandons the shape**, where for a freehand stroke it commits
what was drawn. A half-drawn stroke is real ink that was really laid down; a
shape is only itself once you have said where it ends.

### Snapping

A line within **5°** of horizontal or vertical snaps true. That is what makes a
section delimiter worth having rather than irritating, and it is the one piece of
polish that serves the stated purpose directly.

A rectangle whose sides are within **6%** of each other becomes a true square,
and an ellipse a circle, both sides taking the mean. Paul asked for squares and
circles; this design gives free proportions instead, and the snap is what gives
the other reading back. The threshold is tight on purpose: a deliberate 100×92
box differs by 8% and stays as drawn.

## Data flow

1. A tool is chosen; `erasing` goes off and the menu closes.
2. Pointer down on the canvas with a shape tool selected records the anchor in
   page coordinates, as a freehand stroke's first sample already is.
3. Each move recomputes the whole shape from anchor and current point — applying
   the snap — and paints it on the live sheet.
4. Pointer up commits it as `{points, color}` with the color in force, exactly as
   `finishStroke` commits a freehand stroke, and pushes one entry onto `history`.
5. Everything after that — erase, undo, crop, picture, save, reopen — is the path
   a freehand stroke already takes.

## Failure handling

- **A drag that never grows.** Nothing is committed and nothing is painted.
- **`pointercancel` mid-drag.** The shape is abandoned; the page is unchanged.
- **A second pointer during a drag.** Refused, as a second stroke already is:
  one gesture at a time.
- **A shape dragged off the canvas edge.** Clamped to the canvas, as ink outside
  it can be neither seen nor rubbed out.
- **An unknown tool value**, from a future build or a hand-edited state. Falls
  back to the pen rather than refusing to draw.

## Out of scope

**Arrows.** Not asked for. An arrow needs a head, which no stroke has a concept
of, and a head that survives the eraser needs it to be part of the same polyline.

**Text blocks.** Asked for, and declined with a reason. A drawing is a list of
strokes and nothing else; every path — erase, undo, crop, render, color
validation — operates on `{points, color}`. A text object is not that, so each
of them grows a branch and the format gains a second kind of thing forever.
Typing also needs a keyboard, which on an iPad covers the lower half of the
screen — already a parked issue — and text that cannot be re-edited is worse
than none, so re-editing means hit-testing, a caret and selection: a text editor
inside a canvas. **The note is already a text editor.** Typing above and below
the ink costs nothing today, so a labeled diagram is available now. What is
missing is text *inside* a box, and that is not worth the invariant.

**Moving or resizing a shape after it is drawn.** Needs the parametric storage
this design deliberately does not build.

**Hold-to-snap recognition** — sketching a rough box and having it corrected, the
way PencilKit does. Considered and set aside: recognition misfires, and when it
does it replaces a stroke the reader wanted to keep. It is also undiscoverable
and hard to test honestly, since the interesting case is declining to snap. It
could be added on top of this later; it would share the same geometry.

## Testing

- **Unit, `src/inkShape.js`.** A rectangle's points lie on four straight edges and
  close. An ellipse's points satisfy its equation within a tolerance. No two
  consecutive points are further apart than `SMOOTH_GAP`, which is the property
  the whole design rests on. A line snaps inside 5° and does not outside it. A
  near-square snaps and a 100×92 box does not.
- **Unit, the canvas.** The tool selected is the shape committed. Choosing a tool
  turns erasing off. A drag under the threshold commits nothing. `pointercancel`
  commits nothing. The tool opens on the pen rather than on what was used last.
- **End to end.** Pick Rectangle, drag, Done, reopen, and read the pixels on the
  page sheet — the proof used for color, and the only one that covers the whole
  path through the file.
- **Not testable here.** Whether a 0.99 px corner reads as soft, and whether the
  snap thresholds feel helpful or interfering. Both are Paul's eye on the device.

## Risks

- **The corner rounding is a guess about perception.** Measured, not seen. The
  remedy is designed and costed; it just has not been spent.
- **A stateful tool is a stateful tool.** Showing it on the button is the
  mitigation, not a cure.
- **Snap thresholds are chosen, not measured.** 5° and 6% are judgments. They
  are two constants and trivial to move once there is an opinion.
- **`InkCanvas.vue` is 1273 lines before this.** The geometry lives in
  `src/inkShape.js` for that reason; the component gains a mode and a picker and
  nothing else.

## Open questions

Whether near-square snapping earns its place. It is the one piece here chosen to
reconcile "squares and circles" with free proportions, and it is the one that can
fight the reader. Dropping it is a deleted function and a deleted test.
