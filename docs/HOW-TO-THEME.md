# How to theme the plugin UI

The UI uses 8 **source colours** editable in the Settings panel. Surface variants, text shades, borders, hover states, and contrast colours are generated via CSS `color-mix()`.

## Source colours

| Variable | Purpose |
|---|---|
| `--canvas` | Page background |
| `--surface` | Card, input, and dropdown background |
| `--ink` | Primary text colour |
| `--accent` | Primary accent: buttons, links, user bubbles |
| `--secondary` | Secondary accent: model/behavior icons, prompt improvement |
| `--success` | Positive actions, status dots |
| `--warning` | Warnings, attention indicators |
| `--danger` | Destructive actions, errors, deleted diff lines |

## Derived tokens

The following tokens are computed from the 8 source colours and **must not** be used in palette data. They are:

| Token | Derivation |
|---|---|
| `--surface-raised` | `surface` mixed toward `canvas` (92:8) |
| `--sidebar` | `canvas` mixed toward `ink` (96:4 light, 90:10 dark) |
| `--muted` | `ink` at ~55% opacity over `canvas` |
| `--subtle` | `ink` at ~42% opacity over `canvas` |
| `--line` | `ink` at ~12% opacity over `canvas` |
| `--line-strong` | `ink` at ~20% opacity over `canvas` |
| `--accent-hover` | `accent` mixed toward `ink` (78:22) |
| `--accent-soft` | `accent` at ~12% opacity over `surface` |
| `--secondary-soft` | `secondary` at ~10% opacity over `surface` |
| `--success-soft` | `success` at ~13% opacity over `surface` |
| `--warning-strong` | `warning` mixed toward `ink` (65:35) |
| `--danger-soft` | `danger` at ~10% opacity over `surface` |
| `--on-accent` | Computed in JS: `#fff` when accent is dark, `#000` when light |
| `--on-danger` | Same luminance check as `--on-accent` |

## How theme application works

1. **CSS `:root` block** in `src/styles/base.css` sets defaults for all 8 source colours and the derived tokens.
2. **`applyThemePalette()`** in `src/features/settings/themes.ts` sets each source colour as a CSS custom property on the root element, plus the contrast colours `--on-accent` and `--on-danger`.
3. **Derived tokens** reference `var(--accent)`, `var(--ink)`, etc., so they update automatically when the source colours change.
4. **`[data-theme="dark"]`** overrides the 8 source colours and `color-scheme`, and applies dark-specific rule overrides for fine-tuned contrast.

## Editing a built-in theme

1. Open Settings via the gear icon.
2. Under **Color themes**, select any built-in theme (Light, Dark, Néon, GiPiTy, AntTropik, or Acid Pop).
3. Edit its name or the 8 source colours. Changes are saved locally and applied immediately.
4. Use **Restore default** to return to the shipped palette, name, and mode.

## Creating a new theme

1. Open Settings via the gear icon.
2. Under **Color themes**, click **New custom theme** to duplicate the active theme.
3. Name your theme.
4. Edit the 8 source colours. Each input accepts a 6-digit hex code (`#rrggbb`).
5. Select your theme from the dropdown to apply it.

## How colours map to the UI

### Canvas & surface hierarchy

```
--canvas         Page background, dialog footers
  ├── --sidebar  Left sidebar
  ├── --surface  Messages, cards, inputs, dropdowns
  │     └── --surface-raised  Content area, composer footer, elevated panels
```

### Text hierarchy

```
--ink            Headings, body text, primary content
  ├── --muted    Secondary text, timestamps, hints
  └── --subtle   Tertiary text, scrollbars, placeholder
```

### Accent palette

```
--accent         Buttons, links, user message bubbles, active indicators
  ├── --accent-hover     Hover/active state, darker variant
  ├── --accent-soft      Subtle accent background for hover surfaces
  └── --on-accent        Contrast text on accent backgrounds
```

### Semantic colours

- **Success** (`--success`, `--success-soft`): green dot, completed indicators, added diff lines.
- **Warning** (`--warning`, `--warning-strong`): attention badges, interrupted tool calls.
- **Danger** (`--danger`, `--danger-soft`): error messages, removed diff lines, destructive buttons.

## File reference

| File | Role |
|---|---|
| `src/features/settings/themes.ts` | Palette types, validation, persistence, `applyThemePalette()` |
| `src/features/settings/SettingsPanel.tsx` | Theme editor UI |
| `src/styles/base.css` | Source colour defaults, derived token definitions, dark mode overrides |
| Feature `.css` files | Refer to tokens via `var(--accent)`, etc. |

## When to add a new colour

Only add a new **source** colour when the semantic meaning is distinct and cannot be expressed by mixing the existing 8 colours. Examples of when to add:

- A new semantic category (e.g., `--info` for informational banners).
- A colour that must be finely tuned and cannot be derived from existing sources.

When the need is purely visual (hover, border, muted background), derive it from an existing source in `base.css` with `color-mix()`. Avoid adding derived tokens to the editable palette.
