# radio-card-css

Registry item `radio-card-css` (files: `styles/radio-card-css.css`; depends on `variables`). Plain CSS: no Tailwind. The look of the React `radio-card` item.

## Markup contract

Import `styles/variables.css` and `styles/radio-card-css.css`.

```html
<fieldset>
  <legend>Cause area</legend>
  <div class="ds-radio-cards">
    <div class="ds-radio-card">
      <div class="ds-radio-card-cover"><img src="animals.jpg" alt=""></div>
      <span class="ds-radio-card-badge"><svg aria-hidden="true"><!-- a check --></svg></span>
      <div class="ds-radio-card-body">
        <span class="ds-radio-card-title" id="cause-animals">Animals</span>
        <div class="ds-radio-card-desc" id="cause-animals-desc">Shelters and rescue</div>
      </div>
      <input type="radio" name="cause" value="animals" aria-labelledby="cause-animals" aria-describedby="cause-animals-desc">
    </div>
  </div>
</fieldset>
```

- `ds-radio-cards` lays the cards four across, two under 640px.
- `ds-radio-card` is the card. Its `<input type="radio">` comes last and lies over the whole card at full size, unseen, so a press anywhere checks it.
- `ds-radio-card-cover` is the 4:3 picture; its child fills it with `object-fit: cover`. `ds-radio-card-badge` holds a 14px check and shows only on the checked card.
- `ds-radio-card-body` holds `ds-radio-card-title` and `ds-radio-card-desc`. Name the input by the title with `aria-labelledby` and describe it by the description with `aria-describedby`; the description may then hold a list. Name a list inside the description through `aria-labelledby`, not `aria-label`: an `aria-label` there is read in place of the list's items.

A refused group puts the predicate under the grid in `ds-radio-cards-error`, describes the fieldset by it, and sets `aria-invalid="true"` on every radio:

```html
<fieldset aria-describedby="cause-err">
  <legend>Cause area</legend>
  <div class="ds-radio-cards">
    <div class="ds-radio-card">
      <!-- cover, badge and body as above -->
      <input type="radio" name="cause" value="animals" aria-invalid="true" aria-labelledby="cause-animals" aria-describedby="cause-animals-desc">
    </div>
  </div>
  <p class="ds-radio-cards-error" id="cause-err">required</p>
</fieldset>
```

## States

Hover on an unchecked card darkens the edge to gray-8, only where the pointer can hover. Checked takes a `--primary` edge and a 1px `--primary` ring beside it, and shows the badge. Focus-visible on the input draws a 2px `--ring` outline 2px outside the card. A disabled input gives the card the `--gray-3` fill, gray-11 text, a half-opacity cover and the not-allowed cursor. In a refused group every unchecked card takes the `--destructive` edge, kept under the pointer, and a checked card keeps its checked edge and badge; the predicate is `--destructive-subtle-fg`, lowercase with no full stop.

## Accessibility

- The inputs are native radios: one tab stop per group, and the arrow keys move and check.
- Group the cards in a `<fieldset>` with a `<legend>`.

## Theming

Reads roles from `variables`, so `data-theme`, `.dark` and `.light` recolor it. The spacing step, type sizes and weight Tailwind owns are declared on the classes as `--ds-*` with the same values. The spacing step and type sizes are in rem, so the card follows the reader's browser font size. Each of those rem sizes is declared as `calc(N * var(--ds-rem, 1rem))`, which is the rem while `--ds-rem` is unset; an embed under a host page that changes its root font size sets `--ds-rem: 16px` on its own root and gets this size back (see the `variables` note). The breakpoints stay in rem: in a media query rem is the browser's default font size, so a host's root size does not move them. The corner comes from `variables` and stays in rem.
