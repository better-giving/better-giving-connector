# fonts

Registry item `fonts` (files: `styles/fonts.css`, the `styles/fonts/*.woff2` faces, `styles/fonts/red-hat-round-OFL.txt`, `styles/fonts/gochi-hand-OFL.txt`).

## What it is

Self-hosted faces under the SIL Open Font License (texts in `red-hat-round-OFL.txt` and, for Gochi Hand, `gochi-hand-OFL.txt`): Red Hat Round Display (300 to 900, upright and italic), Red Hat Round Text and Red Hat Round Mono (300 to 700), and the full Gochi Hand face: the original font data converted to woff2, not subset or renamed (its license reserves the name "Gochi Hand", and the OFL FAQ treats a woff2 conversion of otherwise unchanged data as no modification). `fonts.css` declares the `@font-face` rules with `font-display: swap`.

## Using it

Import `styles/fonts.css` (the `variables` and `tokens` items already do). The faces are named by role variables in the `variables` item:

- `--font-display`: headings and figures.
- `--font-body`: everything else.
- `--font-mono`: ids and code.
- `--font-gochi`: the handwritten accent, used sparingly.

Do not name a face at a call site; use the variable (`font-display`, `font-body`, `font-mono` in Tailwind). `theme.css` reads the variables rather than repeating the family names, so Tailwind's `font-*` utilities follow whatever the variable holds where it is set.

## Round and plain Red Hat

Round is the platform face and matches its logo, so it is the default. An app that does not carry that logo adds the `fonts-red-hat` item and sets `data-font="red-hat"`; its note carries the steps.

## Notes

Only the weights a face ships are declared; Tailwind's weight ladder is closed to 400, 500, 600 and 700. Codepoints outside a face fall through to the next family in the stack.
