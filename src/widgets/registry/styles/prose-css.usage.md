# prose-css

Registry item `prose-css` (files: `styles/prose-css.css`; depends on `variables`). Plain CSS: no Tailwind. The look of the React `prose` item.

## Markup contract

Import `styles/variables.css` and `styles/prose-css.css`.

```html
<div class="ds-prose">
  <h1>Getting started</h1>
  <p class="ds-prose-lead">Copy the tokens and components you need into your app.</p>
  <small>Last updated November 7, 2026</small>
  <h2>Install the registry</h2>
  <p>Run <code>node cli.mjs add variables</code>, then read the <a href="/notes">usage notes</a>.</p>
  <ul><li>Add only the items you use.</li></ul>
  <blockquote>Change the theme, not the copied files.</blockquote>
  <hr />
</div>
```

- `ds-prose` is the reading column: capped at 65ch, 16px on a 1.625 leading, gray-12. Everything inside is styled by tag, so rendered markdown needs no classes.
  - Blocks are 16px apart; an h2, h3 or h4 has 40, 32 or 24px above it and 12px under it; an `<hr>` has 40px either side. The first block has no margin above it and the last none below, so nothing adds space outside the column. The browser's own margins are zeroed first, at every depth: a `<p>` inside a `<blockquote>` or `<li>` has none.
  - h1 to h4 take the display face at 700: h1 30px (36px from 48rem) and h2 24px (30px) tracked tight and balanced, h3 20px (24px), h4 18px.
  - `<small>` is 14px in gray-11; directly in the column it is its own line, and inside a sentence it stays inline.
  - `<a>` is the `--link` ink, underlined 2px under, `--link-hover` on hover, the 2px `--ring` outline 2px outside on focus. An `<a class="ds-btn …">` (the `button-css` item) keeps the button's look.
  - `<ul>` and `<ol>` sit 24px in with disc or decimal markers in gray-11; items are 4px apart, a nested list 4px below its item.
  - `<code>` is the mono face at .875em on `--panel`, the control corner, 2px by 6px.
  - `<blockquote>` has a 4px gray-7 start edge, 16px in, italic gray-11.
  - `<hr>` is a 1px `--hairline` rule.
- `ds-prose-lead` is the standfirst under the h1: 18px (20px from 48rem) in gray-11.

## Accessibility

Keep the heading outline in order: the sizes follow the level. Links in a sentence are underlined, so they are not told by color alone.

## Theming

Reads roles and scale steps from `variables`, so `data-theme`, `.dark` and `.light` recolor it. The spacing step, type ladder, leading, tracking and column width Tailwind owns are declared on the class as `--ds-*` with the same values. The spacing step and type ladder are in rem and the column width in `ch`, so the text and its measure follow the reader's browser font size. Each of those rem sizes is declared as `calc(N * var(--ds-rem, 1rem))`, which is the rem while `--ds-rem` is unset; an embed under a host page that changes its root font size sets `--ds-rem: 16px` on its own root and gets this size back (see the `variables` note). The breakpoints stay in rem: in a media query rem is the browser's default font size, so a host's root size does not move them. The corner comes from `variables` and stays in rem.
