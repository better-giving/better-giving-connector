# sparkline-css

Registry item `sparkline-css` (files: `styles/sparkline-css.css`; depends on `variables` and `badge-css`). Plain CSS: no Tailwind, no build step. The look of the `sparkline` item for a page that has only `variables`.

## Markup contract

Import `styles/variables.css`, `styles/badge-css.css` (the change badge) and `styles/sparkline-css.css`. The card is `card-css` and the table `table-css`; add them when you use them.

```html
<div class="ds-trend" role="group" aria-labelledby="fund-week">
  <p class="ds-trend-label" id="fund-week">Last 7 days</p>
  <div class="ds-trend-main">
    <b class="ds-trend-figure">$1,240</b>
    <span class="ds-badge ds-badge-success">
      <svg class="ds-trend-glyph" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 7h6v6"/><path d="m22 7-8.5 8.5-5-5L2 17"/></svg>
      Up 18%
    </span>
  </div>
  <p class="ds-trend-note">Previous 7 days: $1,050</p>
  <svg class="ds-sparkline" viewBox="0 0 140 32" preserveAspectRatio="none" role="img" aria-label="Amount raised per day over the last 14 days">
    <polyline class="ds-spark-before" points="0,19.9 10.8,12.1 … 75.4,15.4"/>
    <polyline class="ds-spark-recent" points="75.4,15.4 86.2,11 … 140,4.2"/>
  </svg>
</div>

<td><svg class="ds-sparkline ds-sparkline-inline" viewBox="0 0 140 32" preserveAspectRatio="none" role="img" aria-label="Amount raised per day over the last 14 days">…</svg></td>
<td class="ds-num"><span class="ds-trend-hidden">No change</span></td>
<td class="ds-num"><span class="ds-trend-hidden">Not enough days to compare</span></td>
```

- `ds-sparkline`: the `<svg>`, the container's width at 32px (`2rem`) high, `display: block`, not clipped. Write `viewBox="0 0 140 32"` and `preserveAspectRatio="none"`: it stretches to its box.
- `ds-sparkline-inline`, with `ds-sparkline`: 96 by 24px (`6rem` by `1.5rem`) and `flex: none`, for a table cell or a list row.
- `ds-spark-before` and `ds-spark-recent`: the two `<polyline>`s, which share one point, the first recent day. The earlier days 1.5px in `--gray-8`, the recent ones 2.5px in `--primary`; no fill, round caps and joins, and `vector-effect: non-scaling-stroke`, so the widths hold however the svg stretches. Forced colours: `GrayText` and `CanvasText`.
- `ds-trend`: the card block, a column 4px apart. It sets no margin. Give it `role="group"` and `aria-labelledby` pointing at its `ds-trend-label`, an id unique on the page, as the React `Trend` does.
- `ds-trend-label`: "Last 7 days", and `ds-trend-note`: the line under the figure, both `text-sm` in `--gray-11`.
- `ds-trend-main`: the row holding the figure and the badge, 12px apart, the badge wrapping under a long figure.
- `ds-trend-figure`: the total, the display face at `text-3xl`, bold, tabular figures.
- A `ds-sparkline` directly inside `ds-trend` sits 12px under the note.
- `ds-trend-glyph`: lucide's `trending-up` or `trending-down` `<svg>` inside the badge, 12px.
- `ds-trend-hidden`: text for assistive technology only.

The page computes what the React item computes (the `sparkline` note has the rules): the points, `x` across 0 to 140 and `y` from 2 (the largest value) to 30 (zero), one decimal each; the earlier polyline runs from the first day to the first of the last seven, the recent one from there to the end; the last seven days' total against the seven before as exact decimal sums, and the change as a whole percent, `null` with fewer than 14 days or when the week before is zero.

### States

- Up: `ds-badge ds-badge-success` with the rising glyph and "Up 18%". Down: `ds-badge ds-badge-warning` with the falling glyph and "Down 24%", the percent without its sign.
- Flat: no badge; the note says "Previous 7 days: $600".
- Fewer than 14 days: no badge; the note says "Not enough days to compare".
- No previous week (the week before summed to zero): no badge; the note says "Nothing in the 7 days before".
- In a table, the change cell of a state with no badge holds only `<span class="ds-trend-hidden">`: "No change" when flat, "No previous week" for no week before, "Not enough days to compare" under 14 days (the React item's `hidden_flat`, `hidden_no_previous` and `short_history`).

## Accessibility

- The `<svg>` is `role="img"` with an `aria-label` the page words: what it plots and over what span. The figure and the badge carry the numbers.
- The `ds-trend` block is a group named by its `ds-trend-label`, whatever the page words it ("Last 7 days" in the example).
- The badge reads as its text; the glyph is `aria-hidden="true"`.

## Theming

Reads only roles and scale steps from `variables`, so `data-theme`, `.dark` and `.light` recolor it. The spacing step, the type sizes and the weight Tailwind owns are declared on the classes under `--ds-` names with the same values; the sizes are in rem, so they follow the reader's browser font size. They are `calc(… * var(--ds-rem, 1rem))`, which is the rem while `--ds-rem` is unset; an embed under a host page that changes its root font size sets `--ds-rem: 16px` on its own root (see the `variables` note). A test holds the look equal to the React `Sparkline` and `Trend` in light and dark, in the default and the example themes.
