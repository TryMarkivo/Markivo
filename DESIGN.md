---
name: Markivo
description: An operator's workroom for running a small business's social presence, built as a bolt of Uzbek ikat.
colors:
  indigo-ground: "#15152e"
  indigo-gutter: "#0f0f22"
  indigo-panel: "#1c1c3a"
  indigo-panel-raised: "#262649"
  indigo-panel-sunken: "#121228"
  raw-silk-ground: "#efe9dd"
  raw-silk-gutter: "#e2d9c7"
  raw-silk-panel: "#fbf8f2"
  madder: "#d81f3c"
  madder-deep: "#a5122a"
  madder-ink: "#ff6b80"
  jade: "#17a37c"
  jade-ink: "#3fd6a8"
  saffron: "#e3a018"
  saffron-ink: "#e3a018"
  pomegranate: "#b03060"
  pomegranate-ink: "#ea7fac"
  silk-ink: "#f0eee9"
  silk-ink-2: "#bcbacd"
  silk-ink-3: "#9997b0"
  on-dye: "#ffffff"
typography:
  display:
    fontFamily: "Golos Text, Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(2rem, 4.4vw, 3.25rem)"
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Golos Text, Segoe UI, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Golos Text, Segoe UI, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Golos Text, Segoe UI, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: "Martian Mono, ui-monospace, monospace"
    fontSize: "0.6875rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.06em"
  numeral:
    fontFamily: "Martian Mono, ui-monospace, monospace"
    fontSize: "2.125rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.04em"
    fontFeature: "tnum"
rounded:
  sm: "2px"
  md: "3px"
spacing:
  s1: "4px"
  s2: "8px"
  s3: "12px"
  s4: "16px"
  s5: "24px"
  s6: "32px"
  s7: "48px"
  s8: "64px"
components:
  button-primary:
    backgroundColor: "{colors.madder}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "12px 16px"
    typography: "{typography.body}"
  button-primary-hover:
    backgroundColor: "{colors.madder-deep}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.silk-ink}"
    rounded: "{rounded.sm}"
    padding: "12px 16px"
  panel:
    backgroundColor: "{colors.indigo-panel}"
    rounded: "{rounded.md}"
    padding: "24px"
  input-field:
    backgroundColor: "{colors.indigo-panel-sunken}"
    textColor: "{colors.silk-ink}"
    rounded: "{rounded.sm}"
    padding: "12px"
  stamp-live:
    backgroundColor: "rgba(23, 163, 124, 0.14)"
    textColor: "{colors.jade-ink}"
    rounded: "{rounded.sm}"
    padding: "3px 8px"
    typography: "{typography.label}"
  stamp-queued:
    backgroundColor: "rgba(227, 160, 24, 0.14)"
    textColor: "{colors.saffron-ink}"
    rounded: "{rounded.sm}"
    padding: "3px 8px"
    typography: "{typography.label}"
  stamp-failed:
    backgroundColor: "rgba(176, 48, 96, 0.14)"
    textColor: "{colors.pomegranate-ink}"
    rounded: "{rounded.sm}"
    padding: "3px 8px"
    typography: "{typography.label}"
---

# Design System: Markivo

## Overview

**Creative North Star: "The Bolt of Cloth"**

Markivo is a workroom, not an analytics dashboard. The interface is built as a length of Uzbek ikat: a bound left selvedge that never moves, a working field where the cloth is actually cut, and a narrow worked border band down the right. Regions are not cards floating over a background — they are panels stitched to each other, and the stitch is visible. This is what a suzani is: several strips embroidered separately and sewn into one hanging, seams and all.

The system refuses two things by name. It refuses the SaaS-app arrangement Markivo used to be — glassmorphism, blurred colour blobs drifting behind the content, gradient buttons with coloured glow shadows, a hero row of vanity metrics. It also refuses that arrangement's predictable opposite, the neutral Swiss admin panel with its hairlines and single red accent. What replaces both is flat saturated dye on a dark indigo or raw-silk ground, square corners, and structure made entirely of seams.

Density is high and deliberate. The operator using this is managing several business accounts across long sessions; the design optimises for the second hour, not the first minute. Ornament is earned, never applied. The one place the surface is allowed to shout is the landing page's closing panel, where the whole field takes the madder dye — the centre medallion of the cloth.

**Key Characteristics:**
- Flat dyed fields; no gradient anywhere in the system
- Structure from seams and dye bands, never from shadow
- Square corners (2–3px), because woven cloth is rectilinear
- Four named dyes with fixed meanings, plus a fifth "unfinished" state made of texture
- Cyrillic-native type throughout — the interface ships in Uzbek, Russian and English

## Colors

Five dyes from Uzbek resist-dyeing, laid on a ground that is indigo night in dark mode and raw silk in light. Colour carries status, never decoration.

### Primary
- **Madder** (`#d81f3c` dark / `#b8142f` light): the brand and the primary action. Buttons, the active nav thread on the selvedge, the focus ring, the band on the draft that is about to be published, the drenched closing panel on the landing page. It is the only colour that ever fills a large field.

### Secondary
- **Jade** (`#17a37c` dark / `#0a6248` light): live, connected, published, measured. The band on a channel that publishes for real, the "Posted" stamp, the AI-usage meter while under quota.
- **Saffron** (`#e3a018` dark / `#7d5504` light): queued, scheduled, needs attention, simulated. The band on a channel whose publishing is simulated, the "Queued" stamp, the frayed hem, every honesty notice.

### Tertiary
- **Pomegranate** (`#b03060` dark / `#8c2049` light): failed and error only. Deliberately *not* used for "disconnected" — a channel that has never been set up has not failed, and painting a fresh account blood-red asserts a problem that has not happened.

### Neutral
- **Indigo ground** (`#15152e`) and **indigo gutter** (`#0f0f22`): the page field and the selvedge/border rails in dark mode. Indigo rather than near-black — the blue-violet is itself a dye, and it keeps the surface out of the "black plus one neon accent" default.
- **Raw silk** (`#efe9dd` ground, `#fbf8f2` panel): the light-mode cloth. A woven ivory, not a beige wash; the dyes stay saturated against it.
- **Silk ink** (`#f0eee9` / `#bcbacd` / `#9997b0` on indigo): body, secondary, and micro-label text.
- **On-dye white** (`#ffffff`): the only text colour used on a *filled* dye — primary buttons, selected chips, the ordinal stamp, the drenched closing panel. It is white in both themes, because a dye fill is dark in both. Never used as a surface.

### Brand marks (deliberately outside this palette)

Two categories of colour appear in the product that are **not** part of this system and must not be forced into it:

- **Third-party platform marks** — Telegram `#0088cc`, TikTok `#010101` / `#25f4ee`, and the Instagram, Google, Facebook and YouTube glyph colours. A channel's mark has to be its real colour to be recognisable; recolouring it in madder would misidentify the platform.
- **Generated business logos** — the palette presets and colour swatches in onboarding belong to the *customer's* brand, not Markivo's. A café choosing a warm gold mark is authoring its own identity inside our tool.

Both are content passing through the interface, not chrome. The design-system colour check is waived for the onboarding surfaces on that basis (`.impeccable/config.json`). Nothing else may use an undocumented colour.

Note: the retired accent `#D4A373` — Markivo's previous brand gold — was removed from the logo defaults during this redesign. A new business no longer starts out wearing the app's old identity.

### Named Rules

**The Dye-Ink Rule.** A dye laid on its own tinted field is nearly the same value as the panel beneath it, so the solid dye fails as text there. Every dye therefore has a paired `-ink` variant, opened up until it clears 4.5:1 on its own field. Fills use the dye; text on a tinted field uses the ink. Never the reverse.

**The Measured-Contrast Rule.** No colour pairing enters this system by eye. Every text-on-surface pair in both themes is computed against WCAG AA at the small-text threshold (4.5:1) before it ships, including the 11px mono labels, which are the smallest type in the app.

## Typography

**Display / Body Font:** Golos Text (with Segoe UI, system-ui, sans-serif)
**Label / Numeral Font:** Martian Mono (with ui-monospace, monospace)

**Character:** Golos Text is a Cyrillic-native workhorse — it was drawn for a Russian-language state portal, which is exactly the reading environment this product lives in. It holds up at 13px in a dense table and turns blocky and confident at display weights. Martian Mono is not a costume for "technical": it is here so that times, counts, ranks and IDs align in a column, and it is confined to those.

### Hierarchy
- **Display** (800, `clamp(2rem, 4.4vw, 3.25rem)`, 1.05, −0.035em): landing hero only.
- **Headline** (800, 1.5–2.125rem clamp, 1.15, −0.03em): landing section heads.
- **Title** (700, 1rem–1.25rem, 1.2): panel heads and the field title in the app shell.
- **Body** (400, 0.8125rem, 1.55): dense UI text. Reading passages step up to 0.875rem and cap at 62–68ch.
- **Label** (Martian Mono 500, 0.6875rem, 0.06em, uppercase): column heads, status stamps, meta. The smallest type in the system.
- **Numeral** (Martian Mono 600, up to 2.125rem, −0.04em, tabular): metric values, queue times, prices.

### Named Rules

**The Tabular Rule.** Mono appears only where numbers must line up or a value is a code: times, counts, positions, ordinals, prices, status stamps. It never sets a sentence.

**The Expansion Rule.** Every label is laid out assuming roughly 1.4× growth into Russian. Fixed-height label slots reserve two lines (`min-height: 2.6em`) so one long translation cannot knock its neighbour's numeral off the shared baseline.

## Layout

The app shell is a three-part bolt: a fixed **selvedge** rail (232px) on the left, the **field** in the middle, and a **border band** (336px) on the right holding the Markiv agent. The band collapses to a 44px stub whose label runs vertically, like the printed end of a fabric bolt; the field reclaims the space.

Spacing is a single 4px-based rhythm (4/8/12/16/24/32/48/64) used everywhere, with more space above a heading than below it. The landing page runs as one centred column (max 1160px) with a fluid gutter and `--s8` between sections.

Responsive behaviour, in order of breakpoint:
- **1280px** — the border band stops reserving a column and overlays instead; the field keeps exactly the stub's 44px of clearance. Markiv defaults to *collapsed* below this width, because an open 336px panel on a phone buries the queue behind a chat nobody asked for.
- **1080px** — dense table rows reflow to two lines rather than dropping columns.
- **900px** — the selvedge becomes a drawer behind a scrim, opened by a hamburger in the field head.
- **700px** — grids collapse to one column, the warp band stacks, modal action rows reverse into full-width stacked buttons.

**The No-Deletion Rule.** A narrow screen never solves a space problem with `display: none` on data. Facts move to a second line; only decoration is allowed to disappear.

## Elevation & Depth

This system is flat. Content surfaces cast **no shadow at all** — `--shadow-sm` and `--shadow-md` are literally `none`. Depth is tonal and structural: a panel is distinguished from the ground by being a lighter or darker field, and from its neighbour by a seam.

Exactly one shadow token exists, and it is reserved for things that genuinely float above the page.

### Shadow Vocabulary
- **Lift** (`box-shadow: 0 12px 32px -8px rgba(6, 6, 18, 0.55)`): modals, the auth card, and the mobile selvedge drawer. It carries a real offset and a soft blur — never a zero-offset coloured halo.

### Named Rules

**The Seam-Not-Shadow Rule.** If two regions need separating, they get a 1px seam (`--seam`) or a dashed stitch rule (`--seam-strong`). Reaching for a shadow to separate flat content means the layout was not resolved.

**The Overlay-Only Rule.** Anything that casts a shadow must be dismissible. If it cannot be closed, it does not float.

## Shapes

Corners are effectively square: `2px` for controls, stamps and inputs, `3px` for panels. Nothing in this system is a pill — the previous design's `999px` and `50px` radii were removed wholesale. Circles survive only where the shape is the meaning: status dots and avatars.

Borders do the work that radius and shadow do elsewhere. A panel carries a 1px seam all round, and frequently a **3px dyed band** on one edge that states its status — top for a channel or a plan, left for the owner's own row in a comparison, a queue row's time cell, or an agent message.

### Named Rules

**The Comb.** The signature form of the system. In resist-dyed silk the warp threads are tied and dyed before weaving, so every colour boundary bleeds into a stepped comb. Here that comb is drawn with `repeating-linear-gradient` and a fade mask along an element's hem — the only "texture" in the system, and it carries meaning rather than atmosphere.

## Components

### Buttons
- **Shape:** square (2px radius), never a pill.
- **Primary:** madder fill, white text, 12px/16px padding, body type at weight 600.
- **Hover / Focus:** the field changes dye (`madder` → `madder-deep`). Buttons do **not** lift, scale, or grow a glow — the previous system's `translateY(-2px)` plus coloured shadow is gone.
- **Secondary:** transparent with a `--seam-strong` stroke; fills to `--panel-raised` on hover.
- **Ghost / Danger:** ghost is transparent with muted ink; danger is an outlined pomegranate that inverts to a fill on hover.

### Chips
- **Style:** transparent with a 1px stroke, square, mono or body-600 depending on context.
- **State:** selected takes the madder dye as a *fill* with white text — a chip changes colour the way a swatch takes dye, it does not gain a border glow.

### Cards / Containers
- **Corner Style:** 3px.
- **Background:** `--panel`; sunken wells use `--panel-sunken`, hovered rows `--panel-raised`.
- **Shadow Strategy:** none. See Elevation & Depth.
- **Border:** 1px seam, optionally with a 3px dyed status band on one edge.
- **Internal Padding:** `--s5` (24px), dropping to `--s4` below 700px.

### Inputs / Fields
- **Style:** sunken field, 1px `--seam-strong` stroke, 2px radius, 12px padding.
- **Focus:** the stroke takes the madder dye and the field lifts to `--panel-raised`. No glow ring on the field itself; keyboard focus elsewhere uses a 2px madder outline at 2px offset.
- **Labels:** mono, 11px, uppercase, `--ink-3`, always above the field.

### Navigation
- **Selvedge rail:** items are 13px body text with a 15px fixed icon column. Active state is a **2px madder thread down the left edge** plus a panel fill — not a filled pill.
- **In-page tabs:** a bottom border-only rail; the active tab carries a 2px madder underline.
- **Mobile:** the rail slides in as a drawer over a scrim.

### The Warp Band (signature)
The dashboard opens on a full-bleed row of channel stripes — one cell per connected platform, each carrying a **4px dye band** across its top and its state written underneath in mono. Compose is the band's rightmost cell, not a button floating above it. There is no title row above the band: the band *is* the top of the page. Every stripe is a route, including disconnected ones, which go to Connections.

### The Ikat Edge (signature)
The truth mechanism. A **hard edge** means a value is real and measured; a **frayed comb edge** (`.frayed`) means it is simulated, demo data, or a keyless fallback. It is driven by data, not decoration — the backend returns `metric.simulated` and a panel-level `simulated` map, and the agent returns `engine: 'model' | 'template'`.

Two invariants govern it:
1. **Texture never carries the meaning alone.** Every frayed element also states its condition in words (`.frayed-note`), and the Measurements panel head carries a legend that renders the two hems themselves.
2. **A simulated value makes no further claims.** Charts are suppressed on simulated metrics — a constant cannot honestly be "collecting data".

### The Fan (signature)
On the generation surface, drafts are stacked rather than destroyed. Each regeneration pushes the previous draft onto a fan (capped at 8) that can be pulled open beside the current one; each card steps back by recency with its timestamp on the exposed edge, and can be reinstated whole or raided for a single line. Generation is cheap to repeat and expensive to lose.

## Do's and Don'ts

### Do:
- **Do** separate regions with a 1px seam or a dashed stitch rule; let the seam be visible.
- **Do** state status with a 3px dyed band on an edge plus a word, never with colour alone.
- **Do** use the `-ink` variant of a dye for text on that dye's tinted field, and the solid dye for fills.
- **Do** compute contrast for every new text-on-surface pair in **both** themes before shipping it.
- **Do** keep mono to numbers, times, codes and stamps.
- **Do** reserve two lines for any label slot that a Russian or Uzbek string will grow into.
- **Do** mark anything simulated, demo, or fallback with the frayed hem *and* a word.
- **Do** move data to a second line on narrow screens rather than hiding it.

### Don't:
- **Don't** use a gradient. Not on text, not on a button, not on a background. Emphasis comes from weight, size, or dye.
- **Don't** use glass, blur, or backdrop-filter as decoration. The only `repeating-linear-gradient` in the system is the ikat comb.
- **Don't** add a shadow to flat content, and never a zero-offset coloured halo.
- **Don't** round a corner past 3px, and don't make anything a pill.
- **Don't** lift, scale, or glow a control on hover — change its field.
- **Don't** use pomegranate for "not set up yet". It means failed.
- **Don't** put an eyebrow or kicker label above a heading.
- **Don't** build a page out of same-size icon-plus-heading-plus-text cards; divide one panel with seams instead.
- **Don't** use flag emoji in the UI — Windows ships no regional-indicator glyphs and they render as raw letter pairs.
- **Don't** present simulated output with a hard edge, and don't let a demo number claim it is being collected.
