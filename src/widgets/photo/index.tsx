/** @jsxImportSource hono/jsx/dom */
// Placeholder entry so html.ts can bundle every widget; the Photo builder replaces it.
import { PhotoData } from "../model";
import { EmptyState } from "../ui/states";
import { startWidget } from "../ui/widget";

void startWidget(
	PhotoData,
	() => <EmptyState title="Photo isn't built yet" />,
	"Loading…",
);
