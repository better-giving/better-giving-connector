# Widget screenshots

Each PNG is one widget state mounted in headless Chromium against a fake MCP Apps host (`test/widget-host/`). Names are `<nn>-<widget>-<state>-<light|dark>-<width>.png`: `01` campaign create, `02` campaigns carousel, `03` results card, `04` editor, `05` photo card. Regenerate with `pnpm widget-shots` (on a clean machine run `pnpm exec playwright-core install chromium` once first: playwright-core ships no browser); the states live in `test/widget-host/fixtures.ts`.

States: `01` presets (history) and starting (no history); `02` five, empty, error; `03` draft, live, end-confirm (End campaign pressed); `04` blocks (fullscreen); `05` dropped (a photo in the chat), none. Every state is shot light and dark at 1440 and 375. The inline widgets sit in a 736px column at 1440, as a chat column does.

## Where the widgets differ from DESIGN.md

The mockup images could not be opened in the build environment, so this compares the built widgets with DESIGN.md's written per-screen rationale.

**01 Campaign create**
- Four preset cards as a radio group, a "Recommended from your past results" strip with an evidence sentence per value, and Create draft / Customize match.
- Customize creates the draft and opens it in the fullscreen editor. Below 640px the cards and the strip wrap 2x2, as DESIGN.md asks.
- The mockup's pre-selected card comes from the render tool's `theme` input; with none, Emergency is selected.
- "Starting points" (fewer than 2 past campaigns and 25 gifts) is a state DESIGN.md leaves open; it shows the theme defaults with the strip labelled as starting points.

**02 Carousel**
- Same card layout as DESIGN.md: image, status chip, title, raised of goal with the real percent (123% shown, bar capped at 100% and green), one metadata line, one action.
- At 1440 the 736px chat column shows three cards and the rest scroll sideways; DESIGN.md's mockup shows all five at once. At 375 one card shows at a time.

**03 Results card**
- Draft: readiness checklist, "Gifts go to" and Publish / Preview match. "Gifts go to" is a select above the buttons, not in the footer.
- Live: raised vs goal with a progress bar, donors, average and median gift, last 7 days against the previous 7 with a sparkline. End campaign is the red-outline button; the confirm states the effect, the donor count and that it cannot be undone, focus starts on Keep it live, and only the filled red button ends the campaign.
- The sparkline has no axis or tooltip.

**04 Editor**
- Left: draggable block list (with up/down buttons and remove), Add block, and the selected block's fields. Right: live donor-page preview with a desktop/phone toggle. The header has Close, the draft chip, "Saved · v14", Save and Publish.
- Not built: the ChatGPT composer and the last assistant reply under the editor (the host draws them), and the "Add block" row inside the list (it is a select under the list).
- Block fields are the block's plain text, number and switch settings; richer settings (rich-text story, images) are changed by asking in the chat, and the editor says so.
- The preview uses Quicksand (the repo's bundled file, inlined in the widget) and 4px corners, as DESIGN.md asks. It shows no logo lockup: the repo has no lockup image, only the mark.
- At 375 the preview sits below the fields instead of beside them.

**05 Photo card**
- 16:9 cover, file name, size and type, editable alt text and Set as cover match. Where the host takes no file the card offers Open upload link instead.
- Not built: Adjust crop. The upload sends the file as it is, so a crop control would promise something the connector does not do.
- Account section: the connected nonprofit (from `get_profile`) and Disconnect. Disconnect asks the chat how to disconnect, because disconnecting is the host's own flow. There is no list of other orgs (the deployment has none), as the brief decided.
- The status lines, the locale table and the host-drawn parts of the mockup sheet are not widgets and are not built.

## Across all widgets
- Widget UI uses the system font and host radii; brand colour carries the meaning, as DESIGN.md says. The dark half is the repo's own addition (Platform's palette is light only); the donor-page preview stays light in dark hosts.
- Money and dates use the reader's locale and stay in the campaign's currency.
- The fake host is not ChatGPT or Claude. Rendering inside the real hosts, including whether they allow a font inlined as a data URL, has not been checked.
