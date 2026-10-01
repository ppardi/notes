<!--
  - SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Colored ink

Status: built. Target: the `6.1.x` private build. Extends
[INK-DESIGN.md](INK-DESIGN.md), which said "color if it is cheap". It is nearly
cheap, and this file is about the part that is not.

Still open: whether `#b35900` is a pleasant orange on the device. It is the one
color chosen against a measurement rather than for how it looks, so it is
Paul's call once he has drawn with it; dropping it costs one line.

## The problem

Six colors to write in, chosen before the stroke is drawn. Nothing more: no
recoloring what is already on the page, no highlighter, no custom colors.

The mechanical part is small, but not quite as small as it looks. The whole
pipeline is monochrome by one constant, `INK_COLOR` in `src/inkRender.js`, set as
`fillStyle` in three places: `fit()` in `InkCanvas.vue`, which sets it on both
sheets' contexts whenever the canvas is sized; `pictureOf()`, which sets it on
the picture's own context; and the eraser's outline ring in `inkErase.js`.

So the color is currently a property of a *context*, not of a stroke —
`renderPage()` and `paintLive()` set no color at all and rely on `fit()` having
done it, which is also why a resize has to redo it. Color per stroke moves that
responsibility: both renderers set `fillStyle` inside their stroke loop, and
`fit()` stops setting a color, because there is no longer one color for a
canvas to carry.

The obstacle is the dark theme. Ink is stored as one color on transparency and
the theme is applied where the ink is *shown*, by a CSS filter on both the canvas
and the picture in the note. That is what makes a page written on a light screen
read on a dark one, and it is why ink saved before any of this existed follows
the theme without being rewritten. The filter is `invert`, and `invert` destroys
hue: it turns red into cyan. Color is therefore not an addition to this design,
it is a change to it.

## What was measured, not assumed

Read out of the running container, Nextcloud 35, 2026-10-01:

| Question | Answer |
| --- | --- |
| What is `--background-invert-if-dark`? | `invert(100%)` in `DarkTheme.php:142`; `no` in `DefaultTheme.php:265`. |
| Which themes invert? | `DarkTheme` and `DarkHighContrastTheme`, which extends it. `LightTheme` and `HighContrastTheme` extend `DefaultTheme` and do not. |
| What are the backgrounds? | `#ffffff` light, `#171717` dark, `#000000` dark high contrast. |
| Does `invert` keep hue? | **No.** `#cc0000` inverts to `#11ffff`. |
| Does `invert(100%) hue-rotate(180deg)`? | **Yes**, approximately — see below. |
| Does a browser agree with the computed table? | **Yes, exactly.** All six colors came back byte-identical in Blink (Chromium 152), measured through a canvas filter. |
| Does **WebKit** agree — the engine the iPad actually runs? | **Yes, within rounding.** Measured by rendering the real CSS filter in WebKit 26.6 and reading the pixels back: every channel is within 2/255 of Blink's, hue is preserved, and the contrast ratios move by at most 0.16. Worth stating because WebKit does *not* support the Canvas 2D `ctx.filter` property at all — a probe written through a canvas measures nothing there and silently reports the colors unchanged. |
| How is the dark theme scoped? | `[data-theme-dark] { … }`, and `@media (prefers-color-scheme: dark) [data-theme-default] { … }` for the default theme (`ThemingController.php:433`). |
| What does `no hue-rotate(180deg)` compute to? | `none` — the declaration is dropped, which is the light-theme behavior wanted. So does `none hue-rotate(180deg)`. |

The second filter is the one PencilKit uses: keep the hue, flip the lightness.
Computed from the fixed `hue-rotate` matrix in the Filter Effects specification,
and contrast from WCAG relative luminance:

| name | drawn | on `#ffffff` | dark mode | on `#171717` | on `#000000` |
| --- | --- | --- | --- | --- | --- |
| ink | `#000000` | 21.0:1 | `#ffffff` | 17.9:1 | 21.0:1 |
| red | `#cc0000` | 5.9:1 | `#ffa8a8` | 9.7:1 | 11.4:1 |
| orange | `#b35900` | 4.8:1 | `#e68c33` | 7.0:1 | 8.2:1 |
| green | `#008800` | 4.6:1 | `#3dc53d` | 7.9:1 | 9.3:1 |
| blue | `#0044cc` | 7.8:1 | `#80c4ff` | 9.6:1 | 11.3:1 |
| purple | `#7733cc` | 6.7:1 | `#dd99ff` | 8.6:1 | 10.1:1 |

An earlier version of this table overstated three of the dark-theme ratios — red
as 14.8:1, blue as 10.7:1, purple as 9.2:1. The hex values were always right, but
the ratios beside them had been computed from the matrix's raw output before it
was clamped to the 0-1 range: red's red channel comes out at 1.536, and feeding
that straight to the luminance formula inflates the result. Only the three colors
that clamp were affected. The numbers above are computed from the clamped values
a screen can actually show.

Three things to read out of that table. A dark red becomes a light red rather
than a cyan, which is the whole point. Black still becomes white, so every
drawing already saved is unaffected. And every color clears 4.5:1 on both
themes, which is the bar this palette was chosen against rather than chosen and
then excused. The weakest are green at 4.6:1 in light and orange at 7.0:1 in
dark.

**`hue-rotate` is a linear approximation, not a true rotation.** Lightness does
not flip evenly: red nearly doubles its contrast on the dark theme, green barely
brightens at all. The table is the evidence that the approximation is good enough
for these six values. It is not evidence about a seventh.

## Decisions

### A stroke carries its own color

A stroke becomes `{points, color}`, with `color` one of the palette's six hex
strings. A stroke with no `color` is drawn in the default, which is how every
file written before this change is read.

This is additive, so the `version: 1` envelope does not move. Both directions
work: a build without this change reads a new file, ignores a field it does not
know, and draws the strokes black — while the *picture* beside those strokes is
still the colored one, so the note looks right either way. A build with this
change reads an old file and finds no color, which is the default.

- **Not a color per drawing.** One color for a whole ink block would not need
  a format change at all, but it is the wrong unit: a diagram with a red
  annotation on black writing is the ordinary case, not an advanced one.

### The theme stays applied where the ink is shown

The filter becomes `invert(100%) hue-rotate(180deg)` on the dark themes, in both
places that have it today: `.ink__canvas` in `InkCanvas.vue` and the
`figure[data-component="image-view"]` rule in `NoteRich.vue`.

- **Not baked into the file.** Writing the final colors and dropping the filter
  is simpler and exact, and it breaks every drawing that already exists: they are
  black on transparency and would be invisible on the dark theme. It would also
  make a new drawing wrong on whichever theme it was not drawn on.
- **Not a second file convention.** Marking colored files in the name so the CSS
  can exclude them from the filter keeps today's behavior for monochrome
  drawings exactly, at the price of two code paths for the rest of time — and a
  drawing mixing black with red would still have invisible black on the dark
  theme.

**Written by extending the variable: `var(--background-invert-if-dark)
hue-rotate(180deg)`.** This reverses an earlier draft of this document, which
called for explicit dark-theme selectors on the grounds that the variable only
works by accident — in a light theme it resolves to `no hue-rotate(180deg)`,
which is invalid and therefore ignored. Two measurements changed the decision.

The server scopes its dark variables as `[data-theme-dark] { … }`, and the
default theme's dark values as `@media (prefers-color-scheme: dark)
[data-theme-default] { … }` (`ThemingController.php:433`). Writing the rule
explicitly therefore means hardcoding three selectors — `[data-theme-dark]`,
`[data-theme-dark-highcontrast]`, and the media-query form — and a fourth the
day Nextcloud adds another dark theme. Extending the variable tracks whatever
the server decides is dark, including themes that do not exist yet.

And the "accident" fails safe under every value the variable could plausibly
take. Measured in the browser: `no hue-rotate(180deg)` and `none
hue-rotate(180deg)` both drop the declaration and compute to `none`, while
`invert(100%) hue-rotate(180deg)` computes to `invert(1) hue-rotate(180deg)`.
There is no filter keyword that would combine with a function and produce
something unwanted.

What the earlier draft was right about is that this is not self-evident from
reading the CSS. The answer is a comment saying so, and a test that asserts the
computed filter on both a light and a dark theme — which turns the risk into
something that fails loudly rather than silently.

### Six colors, and the orange is not the obvious one

`#b35900` rather than `#cc6600`. The brighter orange measured 3.8:1 on white —
the only color in the set that failed the bar, and visibly the faint one. The
darker orange measures 4.8:1 and still reads as orange, lightening to `#e68c33`
on the dark theme.

The palette lives beside `INK_COLOR` as an ordered list, since the picker's order
and the stored values must not be able to disagree.

### The color applies to the next stroke, and nothing else

Picking a color sets what the next stroke will be. It does not touch what is
already drawn. To change a stroke's color you erase it and draw it again.

- **Not a selection model.** Tapping a stroke to recolor it needs hit-testing
  against stroke outlines, a visible selected state, a rule for a tap on blank
  canvas, and an answer for how selection interacts with the eraser and with
  undo. That is a larger feature than color, it is the part most likely to feel
  wrong on a first pass, and nothing about this design forecloses it later.

### The last color is remembered

The chosen color is kept in `localStorage` and restored when the canvas opens,
falling back to the default. A pen that forgets what color it was between one
drawing and the next is the kind of inconsistency this project has already
decided against once, when a reopened drawing used to move.

A value read back from storage is checked against the palette before it is used,
and anything unrecognized becomes the default. A failed read is a default, not an
error: `localStorage` throws in some private-browsing configurations and that
must not stop the canvas opening.

### Color read from a file is validated too

Any `color` arriving from a stroke file is checked against the palette before it
reaches `fillStyle`, and an unrecognized value is drawn in the default. An ink
file is a file like any other — it can be copied in from elsewhere, or edited —
and the render path should not take an arbitrary string from it. This is a
correctness rule rather than a security one: the worst a crafted value could do
is fill a canvas oddly or silently draw nothing.

### The picker is one button showing the current color

A single control in `.ink__bar`, filled with the color in use, opening an
`NcActions` popover of the six.

- **Not swatches inline.** One tap instead of two, and the current color always
  visible, which is better while writing. But the bar already holds four controls
  and will need room for the shape tools discussed separately, and five extra
  swatches is a crowded bar on an iPad in portrait. Two taps, once in a while, is
  the cheaper thing to spend.

Each swatch is a named action — "Red", not a colored square alone — so the
picker works for a reader who cannot distinguish them and for one using a
keyboard. The button's own label names the current color.

### The eraser does not learn about color

It erases whole strokes, whatever color they are, exactly as it does now. One
related tidy: the eraser's outline ring currently borrows `INK_COLOR` for its
`strokeStyle`. The ring is interface, not ink, and once `INK_COLOR` is one of six
it should stop standing in for "the color of a line on this canvas".

### What the note shows does not change

Still one cropped PNG at `INK_DENSITY`, still shown at the reciprocal. The color
is in the picture, so anything that can display a PNG shows the drawing in
color, including clients that know nothing about this app.

## Data flow

1. The canvas opens; the remembered color is read, validated, and shown on the
   picker button.
2. A stroke is finished and stored as `{points, color}` with the color in force.
3. The page render and the live sheet set `fillStyle` per stroke; `fit()` no
   longer sets one, so a resize has no color to lose.
4. Done renders the picture the same way, so the PNG carries the colors, and
   writes the strokes with theirs.
5. The note shows the picture under the themed filter.
6. Reopening reads each stroke's color back, validates it, and draws it.

## Failure handling

- **A color in the file that is not in the palette.** Drawn in the default; the
  drawing still opens. Never passed to `fillStyle`.
- **A color in storage that is not in the palette**, or storage that cannot be
  read at all. The default, and the canvas opens normally.
- **A file with no colors.** Every stroke is the default. This is every file
  written before this change.
- **A new file read by an older build.** The field is ignored and the strokes
  draw black, but the picture in the note is the colored one — so the reader
  sees the right thing and only an edit would flatten it.

## Out of scope

No highlighter: a wide translucent nib needs a nib-width concept, a draw-order
rule to keep it under the ink, and a decision about overlapping translucent
strokes darkening where they cross — which wants judging on the device, not in a
file. No recoloring an existing stroke. No custom colors or a color wheel. No
nib widths. Shapes are a separate design.

## Testing

- **Unit.** A stroke's color reaching `fillStyle` in the page render and in the
  saved picture, one color per stroke across several strokes. Palette validation,
  for a value from a file and for a value from storage. The remembered color
  round-tripping, including a `localStorage` that throws. A stroke with no color
  drawing in the default.
- **End to end.** Draw in a color, save, and read the pixel back out of the
  rendered picture — the assertion that the color survived the whole path rather
  than that a variable was set. Reopen and assert the color comes back. The
  picker by keyboard.
- **The filter.** Assert the computed `filter` on the rendered image under the
  dark theme, because this is the part where a silent CSS mistake looks exactly
  like success in the light theme — which is how the tests run by default.
- **Not testable here.** Whether `#e68c33` is a pleasant orange on an iPad in a
  dark room. That is Paul's eye, and the measurement only promises it is legible.

## Risks

- **The approximation, on a theme not measured.** The table covers four themes
  because those are the four Nextcloud ships. A custom theme with a mid-tone
  background could leave a color short, and nothing in this design detects that.
- **Six colors is a palette, and palettes attract additions.** Each new one
  needs the same two measurements, and the temptation will be to add by eye. The
  palette constant should carry that instruction.
- **The filter is a shared rule.** Both places that invert ink today must move
  together; one of them moving alone is a bug that only shows on one theme.

## Open questions

Whether orange earns its slot once it is seen on the device. It is the one chosen
against a measurement rather than for how it looks, and dropping it later costs
nothing but a line.
