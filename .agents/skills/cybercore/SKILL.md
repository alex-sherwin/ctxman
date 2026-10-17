---
name: cybercore
description: Use this skill when building, styling, or reviewing UI with CyberCore CSS (`cybercore-css`, classes prefixed `cyber-`) - cyberpunk, neon, synthwave, sci-fi HUD, hacker-terminal, or glitch-style interfaces in plain HTML/CSS. Covers installing the stylesheet, the `cyber-*` BEM components (buttons, cards, forms, alerts, badges, tabs, modals, dropdowns, tables, nav, terminal, progress, spinners, skeletons), effects (glitch, neon border, scanlines, noise, text glow), layout utilities, theming with `--cyber-*` variables, and the cyberpunk SVG icon set. Also use it when the user asks for a "cyberpunk theme", "neon dark UI" or "retro-futuristic dashboard" without naming the framework, or when existing markup already contains `cyber-` classes. Not for Tailwind/Bootstrap work, other design systems, or the separate cybercore-charts library.
metadata:
  cybercore-css-version: "0.3.0"
---

# CyberCore CSS

Pure-CSS cyberpunk framework: dark-only, neon cyan/magenta/yellow/green on near-black, BEM classes, CSS custom properties, `@layer` cascade. It ships **no JavaScript** - stateful widgets (modal, tabs, dropdown) are opened by toggling a class yourself.

This file was checked against the published `cybercore-css@0.3.0` stylesheet, not just the docs. Where the docs and the stylesheet disagree, follow this file (see Gotchas).

## Using the reference file

`references/llms.txt` is the upstream summary (214 lines). This file covers everyday work; load the reference only for what it adds:

- **Icon names/categories or the icon JS API** -> read its `## Icons` section (`grep -n "^## " references/llms.txt` to jump).
- **Modular SCSS import list** -> `## Modular Imports` (fix the paths first, see Gotchas).
- **Cross-checking a class name** -> `## Components` / `## Utilities`, then confirm with the validation step below; the reference contains names that do not exist in 0.3.0.

## Setup

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <!-- Fonts are NOT bundled; without these the stack falls back to system-ui/monospace -->
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Exo+2:wght@400;600&family=JetBrains+Mono:wght@400;700&family=Rajdhani:wght@500;700&display=swap">
  <link rel="stylesheet" href="https://unpkg.com/cybercore-css@0.3.0/dist/cybercore.min.css">
</head>
<body>...</body>
</html>
```

- Always write the `https://` scheme. The upstream snippet `href="unpkg.com/..."` is a *relative* URL and 404s.
- npm: `npm install cybercore-css`, then `import 'cybercore-css/dist/cybercore.css'` or `@use 'cybercore-css';`.
- `body` already gets the dark background, light text, body font and `color-scheme: dark`. Do not restyle them. There is no light theme.
- Needs `@layer`, `color-mix()` and container queries: modern evergreen browsers only.

## Conventions

- Every class, utilities included, has the `cyber-` prefix: `cyber-flex`, never `flex`.
- BEM: block `cyber-card`, element `cyber-card__header`, modifier `cyber-card--holo`. A modifier always accompanies its base class: `class="cyber-btn cyber-btn--magenta"`.
- Color meaning: **cyan** = default/primary/info, **magenta** = danger/error, **yellow** = warning, **green** = success. Cyan is the default, so most components have `--magenta`, `--yellow`, `--green` modifiers but no `--cyan`.
- Each component takes its accent from a custom property you can set inline for a one-off: `--btn-color`, `--card-accent`, `--alert-color`, `--modal-accent`, `--input-accent`, `--progress-color`.
- Cascade: `@layer reset, base, theme, components, utilities`. Utilities beat components regardless of specificity (`cyber-p-lg` on a card wins). **Unlayered** CSS beats every layer, so your own stylesheet overrides the framework without `!important`. If you put your CSS in a layer, declare it after `utilities`.
- The reset zeroes all margin and padding, and `h1`-`h6` are uppercase display-font by default. Space things with `cyber-gap-*` / `cyber-mt-*` / `cyber-p-*`.
- Use one dominant accent per region; reserve magenta/yellow/green for meaning. Use effects (glitch, scanlines, noise, glow) sparingly: on a heading, hero, or panel, not on every element.

## Gotchas (0.3.0 stylesheet vs. `llms.txt`)

Classes the reference lists that **do not exist** in `dist/cybercore.css` (using them silently does nothing):

| Reference says | Reality |
|---|---|
| `cyber-card__body`, `__footer` | Not styled. Put content directly in the card or in your own element. |
| `cyber-alert--info` | Info is the default `cyber-alert`. Variants: `--success --warning --error`. |
| `cyber-badge--cyan` | Cyan is the default `cyber-badge`. |
| `cyber-tabs__tab` | The tab button is `cyber-tab` (`cyber-tab--active`). |
| modal `__backdrop`, `__content` | `.cyber-modal` *is* the backdrop; the box is `cyber-modal__dialog`. |
| progress `--value` | The property is `--progress-value`: **with `%`** on `cyber-progress` (`60%`), **unitless 0-100** on `cyber-progress-circle` (`60`). |
| `cyber-skeleton--block` | Use `--text --title --avatar --button --badge --thumbnail --square`. |
| `cyber-center-xy` and all position utilities (`cyber-relative`, `cyber-absolute`, `cyber-fixed`, `cyber-sticky`, `cyber-inset-0`, `cyber-top-0`...) | In the SCSS source, **not in the default bundle**. Write plain CSS or import `cybercore-css/scss/utilities/position`. Same for sizing, borders, shadows, backgrounds, transforms, filters, layout, interactivity. |
| `cyber-field__helper`, `cyber-d-flex`, `cyber-terminal__chrome` (README) | Do not exist. Use `cyber-flex`, `cyber-terminal__header`. |
| `cyber-icon` as a styled base class | No rule of its own; only `cyber-icon--sm\|md\|lg\|xl`, colors, animations exist. |

Behavior traps:

- **Spacing utilities are a subset**, not the full matrix: no `ml/mr/pt/pb/pl/pr`, no `cyber-gap-0`, no `m-xl`. Exact set is under Utilities.
- **Color scales are sparse**, not 100-900. An undefined stop (e.g. `--cyber-magenta-300`) makes the whole declaration invalid. Defined stops are listed under Tokens.
- **`cyber-text-glow--magenta|yellow|green` (and `-magenta` etc.) show color but no glow**: `--glow-text-magenta|yellow|green` are never defined, only `--glow-text-cyan`. Define them (snippet under Tokens).
- **Glitch needs `data-text`** equal to the element's text; both pseudo-layers render from it. `cyber-heading` uses the same mechanism.
- **Effects are pseudo-element overlays** (`cyber-scanlines`, `cyber-noise`, `cyber-datastream`, `cyber-neon-border`, card corner brackets). Apply them to container elements, not `<img>`/`<input>` (replaced elements do not render pseudo-elements).
- **Modular SCSS paths**: the package only exposes `./scss/*`, so the working form is `@use 'cybercore-css/scss/components/buttons'`, not the reference's `cybercore-css/components/buttons`. The default `@use 'cybercore-css'` bundle includes buttons, cards, inputs, progress, badges, alerts, tables, nav, tabs, modal, dropdown, terminal, spinner, skeleton, noise, scanlines, glitch, neon-border, datastream, and display/flex/grid/spacing/text/accessibility/animation/icons utilities.
- **Icon JS API ships as TypeScript source** (`cybercore-css/icons` resolves to `.ts`): it needs a bundler (Vite, webpack, etc.). The docs' "copy SVGs from `src/icons/svg/`" does not work; that directory is not in the npm package.
- **No state styling for validation**: inputs have focus glow only. For an error state set `--input-accent` (e.g. `style="--input-accent: var(--cyber-magenta-500)"`) and add your own message.

## Tokens and theming

Defined in `:root` inside `@layer theme`. Only these color stops exist:

- `--cyber-cyan-` 300 400 **500** 600 700 900
- `--cyber-magenta-` **500** 700
- `--cyber-yellow-` **500** 700
- `--cyber-green-` 400 **500** 700 900
- `--cyber-void-` (backgrounds) 100 200 300 400 **500** 700 800 900
- `--cyber-chrome-` (grays) 100 200 300 400 500 600

Semantic: `--color-bg-primary|secondary|tertiary|elevated`, `--color-text-primary|secondary|muted`, `--color-border-default`. Glow: `--glow-cyan|magenta|yellow|green`, `--glow-text-cyan`. Type: `--font-display|body|mono`, `--text-xs` ... `--text-5xl`. Space (fluid): `--space-3xs` ... `--space-3xl`. Also `--radius-sm|md|lg|full|cyber`, `--border-thin|medium|thick`, `--duration-fast|normal|slow`, `--ease-cyber|bounce|out-expo`, `--z-sticky`, `--z-modal`, `--noise-opacity`, `--scanline-opacity`.

Theme by overriding in an unlayered `:root` block (the 500 stops are the default accents everywhere, so retinting one retints the whole UI, glows included):

```css
:root {
  --cyber-cyan-500: #00ffaa;
  --font-display: "Orbitron", system-ui, sans-serif;
  /* missing upstream; needed for cyber-text-glow--magenta (repeat for yellow, green) */
  --glow-text-magenta: 0 0 10px var(--cyber-magenta-500),
    0 0 20px color-mix(in srgb, var(--cyber-magenta-500) 60%, transparent);
}
```

## Components

| Component | Structure | Modifiers |
|---|---|---|
| Button | `cyber-btn` (`disabled` is styled) | `--magenta --yellow --green`, `--ghost`, `--filled`, `--sm`, `--lg` |
| Card | `cyber-card` > `__header` (`__icon`, `__title`, `__badge`) + free content | `--magenta --yellow --green`, `--interactive` (hover glow), `--holo` (shimmer) |
| Inputs | `cyber-input`, `cyber-textarea`, `cyber-select`; wrap in `cyber-field` + `cyber-field__label` | - |
| Alert | `cyber-alert` (+ `__title`) | `--success --warning --error` |
| Badge | `cyber-badge` (+ `__icon`); group with `cyber-badge-group` | `--magenta --yellow --green --chrome`, `--filled`, `--ghost`, `--pulse`, `--sm --lg`, `--counter`, `--online --offline --busy` |
| Status | `cyber-status` > `cyber-status__dot` | - |
| Nav | `cyber-nav` (sticky) > `__brand` + `__links` > `__link` | `__link--active` |
| Table | `cyber-table-wrapper` > `<table class="cyber-table">` | `--striped --bordered --compact`; `th[data-sortable]` + `data-sort="asc\|desc"` draws arrows (sorting logic is yours); cells `.cell-number`, `.cell-status(--active\|--inactive)` |
| Terminal | `cyber-terminal` > `__header` (`__dot--red\|yellow\|green`, `__title`) + `__body` > `__line` (`__prompt`, `__command`, `__cursor`) | `--glow --sm --lg --no-header --rounded --fullheight`; lines `--input --output --error --success --warning --info`; also `cyber-terminal-ascii`, `cyber-terminal-typing`, `.syntax-keyword\|string\|number\|comment\|function\|variable\|operator` |
| Spinner | `cyber-spinner`; also `cyber-spinner-dots`, `cyber-spinner-bars`, `cyber-spinner-overlay` (+ `__text`) | `--xs --sm --md --lg --xl`, `--magenta --yellow --green --chrome`, `--dotted --single --glow --pulse` |
| Skeleton | `cyber-skeleton`; composites `cyber-skeleton-card\|list\|profile\|table` | `--text --title --avatar(-sm\|-lg) --button --badge --thumbnail --square`, `--wave --pulse --glow --no-animation` |

Markup for the components that need exact structure:

```html
<!-- field + checkbox: <input> must come BEFORE __box (sibling selector) -->
<div class="cyber-field">
  <label class="cyber-field__label" for="u">USERNAME</label>
  <input id="u" class="cyber-input" placeholder="Enter handle...">
</div>
<label class="cyber-checkbox">
  <input type="checkbox">
  <span class="cyber-checkbox__box"></span>
  <span class="cyber-checkbox__label">Remember me</span>
</label>

<!-- progress: bar uses a % value; circle uses a unitless value and r=40 in a 100x100 viewBox -->
<div class="cyber-progress cyber-progress--green" style="--progress-value: 72%">
  <div class="cyber-progress__bar"></div><span class="cyber-progress__value">72%</span>
</div>
<div class="cyber-progress-circle" style="--progress-value: 72">
  <svg class="cyber-progress-circle__svg" viewBox="0 0 100 100">
    <circle class="cyber-progress-circle__track" cx="50" cy="50" r="40"/>
    <circle class="cyber-progress-circle__bar" cx="50" cy="50" r="40"/>
  </svg>
  <span class="cyber-progress-circle__value">72%</span>
</div>

<!-- dropdown: --css-only opens on :focus-within (trigger must be focusable);
     otherwise toggle cyber-dropdown--open. Modifiers: --right --up --magenta -->
<div class="cyber-dropdown cyber-dropdown--css-only">
  <button class="cyber-dropdown__trigger">Menu</button>
  <ul class="cyber-dropdown__menu">
    <li><a class="cyber-dropdown__item cyber-dropdown__item--active" href="#">Profile</a></li>
    <li><a class="cyber-dropdown__item" href="#">Logout</a></li>
  </ul>
</div>

<!-- modal: JS toggles cyber-modal--open on the .cyber-modal element.
     Modifiers: --sm --lg --xl --fullscreen --magenta --yellow --green --slide-up --zoom -->
<div class="cyber-modal" id="m1" role="dialog" aria-modal="true" aria-labelledby="m1-t">
  <div class="cyber-modal__dialog">
    <div class="cyber-modal__header">
      <h2 class="cyber-modal__title" id="m1-t">CONFIRM</h2>
      <button class="cyber-modal__close" aria-label="Close">&times;</button>
    </div>
    <div class="cyber-modal__body">Purge all logs?</div>
    <div class="cyber-modal__footer">
      <button class="cyber-btn cyber-btn--ghost">Cancel</button>
      <button class="cyber-btn cyber-btn--magenta">Purge</button>
    </div>
  </div>
</div>
<script>
  const m = document.getElementById('m1');
  // open: m.classList.add('cyber-modal--open')
  m.addEventListener('click', e => {   // backdrop click or X closes
    if (e.target === m || e.target.closest('.cyber-modal__close')) m.classList.remove('cyber-modal--open');
  });
</script>

<!-- tabs (nesting inferred from the stylesheet's selectors; confirm visually).
     JS must move --active on BOTH the tab and its panel, and update aria-selected. -->
<div class="cyber-tabs" role="tablist">
  <button class="cyber-tab cyber-tab--active" role="tab" aria-selected="true">Logs</button>
  <button class="cyber-tab" role="tab" aria-selected="false">Metrics</button>
</div>
<div class="cyber-tabs__panels">
  <div class="cyber-tabs__panel cyber-tabs__panel--active" role="tabpanel">...</div>
  <div class="cyber-tabs__panel" role="tabpanel">...</div>
</div>
```

Tabs also support `cyber-tabs--pills|vertical|fullwidth|scrollable` and `cyber-tab--magenta|yellow|green`, `__icon`, `__badge`, `--disabled`.

## Effects

| Class | Notes |
|---|---|
| `cyber-glitch` | Chromatic-aberration text; **requires `data-text="<same text>"`**. `--subtle`, `--intense`, `--hover` |
| `cyber-heading` | Glowing cyan display heading, same `data-text` mechanism |
| `cyber-neon-border` | Animated gradient border. `--cyan --magenta --yellow --green` |
| `cyber-text-glow` | Cyan by default; `--magenta --yellow --green` or `-cyan -magenta ...` (needs the glow tokens, see Gotchas) |
| `cyber-scanlines` | CRT overlay. `--fine --heavy --flicker --scroll` |
| `cyber-noise` | Static grain. `--animated` |
| `cyber-datastream` | Animated light sweep |
| `cyber-boot` | One-shot flicker-in on load |

Motion helpers: `cyber-animate-spin|pulse|bounce|ping|float|glow|none|paused|running`, `cyber-transition(-fast|-slow|-none)`, `cyber-duration-fast|normal|slow|slower`, `cyber-delay-100|200|300|500|1000`, and `cyber-motion-safe` / `cyber-motion-reduce`. Reduced-motion preferences are already honored by the built-in animations; keep that true for anything you add.

## Utilities (complete set in the default bundle)

- **Display**: `cyber-hidden|block|inline|inline-block|flex|inline-flex|grid`
- **Flex**: `cyber-flex-row|col|wrap|nowrap|1|auto|none`, `cyber-items-start|center|end|stretch`, `cyber-justify-start|center|end|between|around`
- **Grid**: `cyber-grid` + `--2|--3|--4|--auto-sm|--auto-md|--auto-lg`; children `cyber-col-span-2|3|full`
- **Gap**: `cyber-gap-xs|sm|md|lg|xl`
- **Margin**: `m-{0,auto,xs,sm,md,lg}`, `mx-{auto,sm,md,lg}`, `my-{sm,md,lg,xl}`, `mt-` / `mb-{0,xs,sm,md,lg,xl}`
- **Padding**: `p-{0,xs,sm,md,lg,xl}`, `px-{0,sm,md,lg}`, `py-{0,sm,md,lg,xl}`
- **Text**: `cyber-text-left|center|right`, `cyber-text-primary|secondary|muted|cyan|magenta|yellow|green`, `cyber-font-body|display|mono`, `cyber-font-normal|medium|semibold|bold`, `cyber-uppercase|lowercase|capitalize`, `cyber-truncate`, `cyber-line-clamp-2|3`
- **Accessibility**: `cyber-sr-only`, `cyber-sr-only-focusable`, `cyber-focus-visible`

Size tokens map to the fluid `--space-*` scale. Anything missing (positioning, widths, borders, `ml`/`pt`...) is a one-line custom rule in your own unlayered CSS.

## Icons

150+ stroke-based icons in 10 categories (navigation, actions, media, communication, data, security, tech, files, status, social); full names are in `references/llms.txt` under `## Icons`. They use `currentColor`, so `cyber-icon--cyan|magenta|yellow|green` (or any text color) tints them. Sizes: `cyber-icon--sm|md|lg|xl` = 1 / 1.5 / 2 / 3 rem. Animations: `--spin --pulse --glitch`. Layout helper: `--inline`.

- **With a bundler**: `import { renderIconDef } from 'cybercore-css/icons'; import { terminal } from 'cybercore-css/icons/defs/tech';` then `renderIconDef(terminal, { size: 24, color: 'cyan' })` (tree-shakeable). `renderIcon('terminal', {...})` from the same entry pulls in every icon. Variants: `outline` (default), `solid`, `duotone`, `glitch`.
- **Plain HTML**: inline an SVG yourself and wrap it:

```html
<span class="cyber-icon--cyan cyber-icon--md">
  <svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
  </svg>
</span>
```

Give icon-only buttons an `aria-label`; mark decorative icons `aria-hidden="true"`.

## Workflow

1. **Choose** components from the table; compose layout with `cyber-grid` / `cyber-flex` + gap utilities, not custom CSS.
2. **Assign color by meaning** (cyan default, magenta danger, yellow warning, green success).
3. **Add behavior** for modal, tabs, dropdown (unless `--css-only`), table sorting, and progress values: class/attribute/custom-property toggles only.
4. **Validate class names** before finishing. This prints every class used in `index.html` that the bundle does not define (empty output = good):

```bash
comm -13 \
  <(curl -sL https://unpkg.com/cybercore-css@0.3.0/dist/cybercore.css | grep -oE '\.cyber-[a-z0-9_-]+' | tr -d . | sort -u) \
  <(grep -ohE 'class="[^"]*"' index.html | grep -oE 'cyber-[a-z0-9_-]+' | sort -u)
```

   Offline, point the first command at `node_modules/cybercore-css/dist/cybercore.css`. Fix each hit using the Gotchas table, then re-run.
5. **Check in a browser** that modals open/close, tab panels switch, and focus rings are visible.

## Example

```html
<nav class="cyber-nav">
  <span class="cyber-nav__brand">NEXUS//OS</span>
  <div class="cyber-nav__links">
    <a class="cyber-nav__link cyber-nav__link--active" href="#">Dashboard</a>
    <a class="cyber-nav__link" href="#">Logs</a>
  </div>
</nav>

<main class="cyber-p-md">
  <h1 class="cyber-glitch" data-text="SYSTEM STATUS">SYSTEM STATUS</h1>

  <div class="cyber-grid cyber-grid--3 cyber-gap-md cyber-mt-md">
    <div class="cyber-card cyber-card--interactive">
      <div class="cyber-card__header">
        <h3 class="cyber-card__title">UPTIME</h3>
        <span class="cyber-badge cyber-badge--online">ONLINE</span>
      </div>
      <div class="cyber-progress" style="--progress-value: 82%">
        <div class="cyber-progress__bar"></div>
      </div>
    </div>

    <div class="cyber-card cyber-card--magenta">
      <div class="cyber-card__header"><h3 class="cyber-card__title">ALERTS</h3></div>
      <div class="cyber-alert cyber-alert--warning">
        <strong class="cyber-alert__title">LOW MEMORY</strong> Node 7 at 91%.
      </div>
      <div class="cyber-flex cyber-gap-sm cyber-mt-sm">
        <button class="cyber-btn cyber-btn--sm">ACK</button>
        <button class="cyber-btn cyber-btn--sm cyber-btn--magenta">REBOOT</button>
      </div>
    </div>
  </div>
</main>
```
