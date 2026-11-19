# image-css

Registry item `image-css` (files: `styles/image-css.css`; depends on `variables`). Plain CSS: no Tailwind, no build step. The look of the `image` item for a page that has only `variables`.

## Markup contract

Import `styles/variables.css` and `styles/image-css.css`. The overlay's badge is `badge-css`, and the card is `card-css`; add them when you use them.

```html
<article class="ds-card">
  <div class="ds-image-frame" data-state="loading">
    <img class="ds-image" src="https://uploads.example.com/coats.webp" alt="Volunteers sorting coats on a long table" loading="lazy" decoding="async">
    <div class="ds-image-overlay">
      <span class="ds-badge ds-badge-success ds-badge-on-photo">Live</span>
    </div>
  </div>
  <div class="ds-card-body">…</div>
</article>

<div class="ds-image-frame ds-image-frame-square" data-state="unavailable">
  <div class="ds-image-placeholder" role="img" aria-label="Volunteers sorting coats on a long table">
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
  </div>
</div>
```

- `ds-image-frame`: the box, `inline-size: 100%` at 16:9 on the `--gray-3` fill, with the card corner (`--radius-card`) and a 1px `--hairline` edge. `overflow: clip`. It sets no margin.
- `ds-image-frame-square`: square, for thumbnails.
- As the first child of a `ds-card`, the frame has no corner and no edge of its own (the card clips and draws them) and a 1px `--hairline` under it.
- `ds-image`: the `<img>`, filling the frame and cropped to cover. The frame holds the ratio, so a failed load cannot move the layout.
- `ds-image-placeholder`: shown in place of the `<img>` when there is no src, the origin is not one you allow, or the load failed; all three look alike. Lucide's `image` glyph as its `<svg>` child, drawn 32px at a 1.5 stroke (the stylesheet sets both, whatever the svg says) in `--gray-11`, centred.
- `ds-image-overlay`: a slot 12px in from the top-start corner, over the image or the placeholder. Put a `badge-css` badge with `ds-badge-on-photo` in it.
- Loading is the frame's fill with the `<img>` not yet painted over it: no glyph and no animation.

The page's script does what the React item does: it checks the src's origin before it writes the `<img>` (the `image` note has the rule), swaps the `<img>` for the placeholder on its `error` event, and sets `data-state` (`loading`, `loaded`, `unavailable`) on the frame for its own use; the stylesheet does not read it.

## Accessibility

- The `<img>` carries the `alt`.
- The placeholder with a text alternative is `role="img"` with it as `aria-label`; for a decorative image it is `aria-hidden="true"`.
- The glyph is `aria-hidden="true"`.

## Theming

Reads only roles and scale steps from `variables`, so `data-theme`, `.dark` and `.light` recolor it. The spacing step Tailwind owns is declared on the class as `--ds-spacing` with the same value; the glyph's size and the overlay's inset are in rem, so they follow the reader's browser font size. It is `calc(0.25 * var(--ds-rem, 1rem))`, which is the rem while `--ds-rem` is unset; an embed under a host page that changes its root font size sets `--ds-rem: 16px` on its own root (see the `variables` note). A test holds the look equal to the React `Image` in light and dark, in the default and the example themes.
