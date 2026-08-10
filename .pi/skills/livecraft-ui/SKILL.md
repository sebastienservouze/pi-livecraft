---
name: livecraft-ui
description: Use for any visual creation, redesign, layout, styling, theming, or visual fix in hermes-pi-coding-ui-plugin. Covers components, panels, modals, toolbars, forms, settings, widgets, status displays, and conversation surfaces. Not for frontend changes without visual impact (API calls, state wiring, data plumbing, event handlers).
---

Designs and refines the Pi Coding UI plugin interface. Production code that respects the visual contract; no speculative decoration.

## Required workflow

Before changing or creating any visual element, you MUST follow these steps in order:

1. **Identify the owning feature** — `src/features/<feature>/`. If the change touches several features, identify the one that owns the dominant surface.
2. **Read the component and its colocated CSS.** Understand the existing layout, spacing, control sizes, and states before writing anything.
3. **Read the canonical reference for the surface type:**
   - Controls, toolbars, selectors, icon buttons → `src/features/composer/composer.css`
   - Modals, dialogs, options, actions, backdrops → `src/features/dialogs/dialogs.css`
   - Colours, surfaces, tokens, theme derivation → `src/styles/base.css` and `docs/HOW-TO-THEME.md`
   - Breakpoints, reduced motion, global animations → `src/styles/responsive.css`
4. **Define the action hierarchy, visual groups, and alignment axes** before modifying CSS. A row of controls needs a single height and consistent vertical rhythm; a panel needs a clear surface stack; an action needs a clear primary/secondary distinction.
5. **After the change, visually inspect the touched surface** at rest, on hover, on focus, when active, when disabled, with long text, in both light and dark themes, and at every affected responsive width. Fix visible misalignments at the source — never compensate with one-off margins.

## Visual character

The Pi Coding UI is a dense, calm, precise work tool. Hierarchy comes from contrast, surface layering, alignment, and density — not decoration. Interfaces stay compact without feeling cramped. Colour serves actions and states, not ornament.

## Defaults for new code

These are starting points for new surfaces. Existing CSS contains historical variations; do not reproduce them blindly. When in doubt, prefer the composition in the canonical references.

| Concern | Default | Variant |
|---|---|---|
| Compact control | 30 px height | — |
| Primary icon action | 36 px height | `.icon-button.send` |
| Control / menu radius | 7–10 px | — |
| Large surface radius | 12–14 px | Modal, composer, settings panel |
| Small group gap | 5–8 px | Toolbar controls, options |
| Content / section gap | 10–18 px | Padding inside panels |
| Row alignment | Single height, vertical center | Flex `align-items: center` |
| Functional colours | Theme variables only | `var(--accent)`, `var(--line)`, etc. |
| 1D layout | Flexbox | `flex-wrap` when narrow |
| 2D layout | Grid | `grid-template-columns` |

## Mandatory states

Every interactive element MUST handle these states. Every container with content MUST handle overflow.

- **Hover** — `:hover:not(:disabled)`; subtle border or surface lift, `180ms ease` transition.
- **Focus-visible** — `outline: 2px solid var(--accent)` with `outline-offset` 1–2px, or the `:focus-within` ring pattern on composed controls (composer, inputs).
- **Active** — `:active:not(:disabled)`; subtle scale press (`scale(0.97)`).
- **Disabled** — `opacity: .42–.55` and `cursor: not-allowed`; `box-shadow: none`, `transform: none`.
- **Overflow** — `text-overflow: ellipsis`, `white-space: nowrap`, and a `min-width: 0` ancestor for flex/grid children; `overflow-y: auto` on scrollable panels.
- **Dark mode** — inspect when colours, surfaces, borders or shadows are touched.
- **Responsive** — inspect at the breakpoints that affect the feature (850px, 700px, 480px, and any local breakpoint in the feature CSS).
- **Reduced motion** — every new animation gets a `@media (prefers-reduced-motion: reduce)` override (instant or crossfade).
- **Long text / empty state** — when the surface can display variable content, confirm it does not overflow, clip, or collapse silently.

## Anti-slop guard

Before committing, reject these patterns. If one appears, restructure the element instead of refining it.

- Gradient text, glassmorphism, or decorative blurs with no functional role.
- A new card grid when a panel, list, or divider would carry the same information with less chrome.
- Nested bordered surfaces without a functional reason.
- A one-off colour, radius, shadow or margin to disguise a layout misalignment.
- Adjacent controls with different heights in the same row.
- Over-sized spacing borrowed from landing-page conventions (hero padding, massive gaps).
- Reproducing a historical CSS variation because it exists in a feature — when the canonical references show a cleaner pattern, follow the canonical pattern.
