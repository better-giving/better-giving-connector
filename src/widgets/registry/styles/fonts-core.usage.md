# fonts-core

Registry item `fonts-core` (files: `styles/fonts-core.css`, seven `styles/fonts/*.woff2` faces, `styles/fonts/red-hat-round-OFL.txt`). No npm packages, no Tailwind.

## What it is

The core subset of `fonts`, for a self-contained widget that inlines its fonts: Red Hat Round Text at 400, 500, 600 and 700, Red Hat Round Display at 600 and 700, and Red Hat Round Mono at 400, all upright. Seven files, about 310 KB, against the 35 faces and about 1.5 MB of `fonts`. `fonts-core.css` declares the `@font-face` rules with `font-display: swap`, and each rule equals the one in `fonts.css` for that face (a test holds them equal).

## Using it

Import `styles/fonts-core.css` in place of `styles/fonts.css`, and name the faces as `--font-body` ("Red Hat Round Text") and `--font-display` ("Red Hat Round Display") do. Weights outside the set fall back to the nearest face that is here.

- Mono 400 is included, so code samples set in `--font-mono` use Red Hat Round Mono instead of the system monospace. Mono at any other weight is not, and a bold code sample is synthesized from the 400 face.
- Not included: the other Mono weights, Gochi Hand, italics, and the light, extra-bold and black weights. A widget that sets `--font-gochi` gets the next family in the stack.
- `fonts` and `fonts-core` ship the same bytes for the seven faces they share, so the CLI lets both sit in one app: add them in one `add` call or one after the other, in either order.
- The `variables` and `tokens` items import no font stylesheet, so an app that wants only the core subset adds `fonts-core` alone and imports `fonts-core.css` beside `variables.css` or `index.css`.

## Notes

The faces are under the SIL Open Font License; the text travels with them in `red-hat-round-OFL.txt`.
