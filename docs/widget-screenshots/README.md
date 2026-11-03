# Widget screenshots

Each PNG is one widget state mounted in headless Chromium against a fake MCP Apps host (`test/widget-host/`). Names are `<nn>-<widget>-<state>-<light|dark>-<width>.png`: `01` campaign create, `02` campaigns carousel, `03` results card, `04` editor, `05` photo card. Regenerate with `pnpm widget-shots` (on a clean machine run `pnpm exec playwright-core install chromium` once first: playwright-core ships no browser); the states live in `test/widget-host/fixtures.ts`.

States: `01` presets (history) and starting (no history); `02` five, empty, error; `03` draft, live, end-confirm (End campaign pressed); `04` blocks (fullscreen); `05` dropped (a photo in the chat), none. Every state is shot light and dark at 1440 and 375. The inline widgets sit in a 768px column at 1440, as a chat column does (the carousel's five-up shot uses 1040px).

## Where the widgets still differ from the approved mockups

Compared against `01`-`05` of the approved mockups. The chat shell around each card (sidebar, assistant text, composer) is drawn by the host and is not built.

**01 Campaign create.** Matches: "Start a campaign" header and subtitle, Draft chip, scene illustrations, theme label in the brand colour, bold titles, goal and end date, gift amounts as pills, selected card with a 2px border and check badge, four recommendation columns with large values, the summary line left of Customize and Create draft.
- The scenes are simpler redrawings, not the mockup's artwork.
- The fourth recommendation is the theme, not the mockup's "Monthly ask"; the tool returns a theme recommendation, and "Length" is shown in days ("21 days"), not weeks.
- The most-chosen-gift column shows the one amount the tool returns, not a ranked list.

**02 Carousel.** Matches: image with the status chip on it, bold title, raised amount in bold with "of goal" muted and the percent at the right, bar, one meta line, one action. In a wide column (this shot uses a 1040px column) all five show; in a narrow one the row scrolls.
- No "next" arrow button on the row; it scrolls by touch, trackpad or keyboard.
- Cards have no illustrations: they show the campaign's own photo, or a neutral placeholder.
- Percent is rounded down (73%), not up (74%), so 100% always means the goal is met.

**03 Results card.** Matches: bold title with "Ends <date> · N days left", status chip at the top right, large raised figure with "raised of $X" beside it, "N% of goal" and "$N to go" under the bar, three tinted tiles (donors with gift count, average with median, last seven days with a trend pill and sparkline), footer with the update time, End campaign and Share link, and the inline confirm naming the campaign and the donor count. Draft: "$0 raised of $X goal", "Ready to publish · 4 of 4" in two columns, "Gifts go to" in the footer beside Preview and Publish.
- The readiness rows show a label only; the mockup also shows a detail beside each ("storm-relief-cover.jpg", "412 characters"). The tool does not return those details.
- "N new this week" under Donors is the gift count instead; the tool has no new-donors-this-week figure.
- "Updated N min ago" counts from when the card opened, not from when the figures were read.
- The confirm's warning icon is not drawn.
- The page link also has a View page button, which the mockup does not show.

**04 Editor.** Matches: header with Close, title, Draft chip, saved version and Publish; block rows with a title and a one-line summary; "+ Add block" as a dashed row at the end of the list; story, FAQ answers and the photo are edited in the editor (a text area per story, and Replace photo through the one-time upload page); live preview with a desktop and phone toggle in Quicksand with 4px corners.
- Blocks have no icons, and the list is not headed "Campaign page".
- The preview shows the donor page's blocks in a single column; the mockup's brand header with the logo, the floating "Donate now" card with a one-time/monthly switch, and the FAQ links are not drawn.
- After Replace photo, the new photo shows when the editor is reopened.
- No undo button and no character counter.
- The composer and the assistant's last reply are drawn by the host.

**05 Photo card and account panel.** Matches: the 16:9 cover with file details, editable alt text and Set as cover; an account panel with the connected nonprofit (initials tile, name, "Connected" pill) and a Disconnect link. States: `account` is the panel under the current cover with no dropped photo.
- No list of other nonprofits, no roles and no "View only" label. Nothing the connector can read returns a person's other nonprofits or roles: the site's `/connector/v1` has no such action, hello names one nonprofit, and a connection is one key for one site. So the mockup's Cebu Food Bank and Malinao School Fund rows, the per-row Switch buttons and "Signed in as <email>" are not built.
- The closest real thing: a "Switch nonprofit" row. It asks the chat to walk the person through connecting a different nonprofit; the host's connect flow then asks for the site, and the new connection replaces the old one.
- Disconnect also asks the chat, because removing the connector is the host's own action.
- The mockup's connected row also shows the person's role and the site's address; the connector does not hold either for display.
- Adjust crop is not built (the upload sends the file as it is).

## Across all widgets
- Widget UI uses the system font and host radii; brand colour carries the meaning, as DESIGN.md says. The dark half is the repo's own addition (Platform's palette is light only); the donor-page preview stays light in dark hosts.
- Money and dates use the reader's locale and stay in the campaign's currency.
- The fake host is not ChatGPT or Claude. Rendering inside the real hosts, including whether they allow a font inlined as a data URL, has not been checked.
