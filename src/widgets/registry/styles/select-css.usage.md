# select-css

Registry item `select-css` (files: `styles/select-css.css`; depends on `variables` and `field-css`). Plain CSS: no Tailwind. The look of the React `select` item: a native select on the field look, and the trigger, popup and rows of a listbox.

## Markup contract

Import `styles/variables.css`, `styles/field-css.css` and `styles/select-css.css`.

A native select: `ds-field-input` on the `<select>`, inside `ds-select`, with the chevron after it. The chevron takes no pointer, so a press on it opens the select.

```html
<div class="ds-field">
  <label class="ds-label" for="freq">Gift frequency</label>
  <div class="ds-select">
    <select id="freq" name="freq" class="ds-field-input" aria-invalid="true" aria-describedby="freq-err">
      <option>Monthly</option>
    </select>
    <svg class="ds-select-chevron" aria-hidden="true"><!-- a down chevron --></svg>
  </div>
  <p class="ds-field-err" id="freq-err">required</p>
</div>
```

- `ds-select-inline` beside `ds-select` is the inline size: the md button's 36px box, edge included, a 12px side inset, semibold, and a 16px chevron. Name an inline select with a visually hidden label or `aria-label`.

A listbox: the script that opens it, moves the highlight and picks a row is yours; the classes draw it. The markup is the WAI-ARIA select-only combobox: the trigger is `role="combobox"`, named by the label, so its text is read as the value ("Organization, Harbor Food Bank"), and focus stays on it while `aria-activedescendant` names the highlighted row. The look is the React `select`'s; the focus model is not (see Accessibility).

```html
<span class="ds-label" id="org-label">Organization</span>
<button type="button" role="combobox" class="ds-field-input ds-select-trigger" aria-haspopup="listbox" aria-expanded="true" aria-labelledby="org-label" aria-controls="org-list" aria-activedescendant="org-riverside">
  <span>Harbor Food Bank</span>
  <svg class="ds-select-chevron" aria-hidden="true"><!-- a down chevron --></svg>
</button>
<div class="ds-listbox" id="org-list" role="listbox" aria-labelledby="org-label">
  <div class="ds-option" id="org-harbor" role="option" aria-selected="true">
    <span>
      <span class="ds-option-label">Harbor Food Bank</span>
      <span class="ds-option-meta">San Diego, CA</span>
    </span>
    <svg class="ds-option-check" aria-hidden="true"><!-- a check --></svg>
  </div>
  <div class="ds-option" id="org-riverside" role="option" aria-selected="false" data-highlighted>…</div>
  <div class="ds-option" id="org-mill" role="option" aria-selected="false" aria-disabled="true">…</div>
</div>
```

- `ds-select-trigger` lays the value and the chevron in a row; the value truncates. `data-placeholder-shown` on it mutes the placeholder text. The chevron turns over while `aria-expanded="true"`.
- `ds-listbox` is the popup's look only: where it sits, its width and its stacking (above a dialog, if it opens in one) are yours.
- `ds-option` is a row: `aria-selected="true"` is the checked one, `data-highlighted` the one the arrow keys are on, `aria-disabled="true"` one that cannot be picked. `ds-option-label` is the first line, `ds-option-meta` the optional second, and `ds-option-check` shows on the checked row only.

## States

Hover darkens the control's edge; focus-visible draws a 2px `--ring` outline on the select and the trigger; disabled takes the disabled fill and ink and the not-allowed cursor; `aria-invalid="true"` takes the `--destructive` edge. The checked row is `--secondary-active`, the highlighted or hovered row `--secondary-hover`, and the second line steps up from gray-11 to gray-12 on both. A disabled row is muted and takes no pointer. Under forced colors (Windows High Contrast) the tints flatten to the system canvas and the highlighted row takes a 2px `CanvasText` outline inside its edge. The chevron turns at `--duration-fast`, which collapses under reduced motion. The popup has no open or close motion here.

## Accessibility

- The native select keeps its own keyboard, type-ahead and OS picker.
- Keep `role="combobox"` on the trigger: with a plain button, `aria-labelledby` replaces the button's text, and the value is never read.
- The listbox's keyboard is your script's: arrow keys move the highlight and `aria-activedescendant` with it, Enter picks, Escape closes, typing jumps to a match. Focus stays on the trigger throughout; clear `aria-activedescendant` on close.
- This differs from the React `select`, which moves focus into the open listbox (`tabindex="0"`, carrying `aria-activedescendant` itself) and returns it to the trigger on close. Both are valid WAI-ARIA, but styling keyed to focus or to `aria-activedescendant` lands on the trigger here and on the listbox there.
- Link an error with `aria-describedby` and mark the control `aria-invalid="true"`.

## Theming

Reads roles from `variables` (`--popover`, `--shadow-floating`, `--secondary-hover`, `--secondary-active`, the gray steps), so `data-theme`, `.dark` and `.light` recolor it. The spacing step, type sizes, weight and easing Tailwind owns are declared on the classes as `--ds-*` with the same values. The spacing step and type sizes are in rem, so the trigger and its list follow the reader's browser font size.
