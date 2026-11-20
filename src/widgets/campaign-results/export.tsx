/** @jsxImportSource hono/jsx/dom */
import { useRef, useState } from "hono/jsx/dom";
import { csvText } from "../csv";
import type { Host } from "../host";
import { Button } from "../ui/button";
import { type Called, callTool } from "../ui/tools";
import { useLocale, useSession } from "../ui/widget";

const PAGE = 100;
/** The most rows one file holds: 20 pages, so a huge account never keeps the card reading for minutes. */
export const MAX_ROWS = 2000;

type Page<T> = { data: T[]; next_cursor?: string | null | undefined };

/** Reads pages until the list ends or MAX_ROWS are in; `more` is true when rows remain past the cap. */
export async function readRows<T>(
	page: (cursor: string | undefined) => Promise<Called<Page<T>>>,
): Promise<
	{ ok: true; rows: T[]; more: boolean } | { ok: false; error: string }
> {
	const rows: T[] = [];
	let cursor: string | undefined;
	while (rows.length < MAX_ROWS) {
		const read = await page(cursor);
		if (!read.ok) return read;
		rows.push(...read.data.data);
		const next = read.data.next_cursor ?? undefined;
		if (next === undefined || next === cursor || read.data.data.length === 0) {
			return { ok: true, rows: rows.slice(0, MAX_ROWS), more: false };
		}
		cursor = next;
	}
	return { ok: true, rows: rows.slice(0, MAX_ROWS), more: true };
}

type Kind = "gifts" | "donors";

const fileName = (kind: Kind, campaignId: string) =>
	kind === "gifts" ? `gifts-${campaignId}.csv` : "donors.csv";

async function build(host: Host, kind: Kind, campaignId: string) {
	if (kind === "gifts") {
		const read = await readRows((cursor) =>
			callTool(host, "list_donations", {
				campaign_id: campaignId,
				limit: PAGE,
				...(cursor === undefined ? {} : { cursor }),
			}),
		);
		if (!read.ok) return read;
		return {
			ok: true as const,
			count: read.rows.length,
			more: read.more,
			text: csvText(
				["Date", "Amount", "Currency", "Donor ID", "Method", "Note", "Gift ID"],
				read.rows.map((g) => [
					g.date,
					g.amount.amount,
					g.amount.currency,
					g.donor_id,
					g.method ?? "",
					g.note ?? "",
					g.id,
				]),
			),
		};
	}
	const read = await readRows((cursor) =>
		callTool(host, "list_donors", {
			limit: PAGE,
			...(cursor === undefined ? {} : { cursor }),
		}),
	);
	if (!read.ok) return read;
	return {
		ok: true as const,
		count: read.rows.length,
		more: read.more,
		text: csvText(
			["Name", "Email", "Total", "Currency", "Gifts", "Donor ID"],
			read.rows.map((d) => [
				d.name,
				d.email ?? "",
				d.total.amount,
				d.total.currency,
				String(d.gift_count),
				d.id,
			]),
		),
	};
}

/** The CSV buttons, only on a host that takes a file from the widget. */
export function Export(props: {
	campaignId: string;
	onError: (error: string | null) => void;
}) {
	const { host } = useSession();
	const locale = useLocale();
	const [busy, setBusy] = useState<Kind | null>(null);
	const [note, setNote] = useState("");
	// a second press can land before the busy render does
	const running = useRef(false);
	if (!host.canDownloadFiles()) return null;

	const run = async (kind: Kind) => {
		if (running.current) return;
		running.current = true;
		setBusy(kind);
		props.onError(null);
		setNote("");
		const built = await build(host, kind, props.campaignId);
		if (!built.ok) {
			running.current = false;
			setBusy(null);
			props.onError(built.error);
			return;
		}
		const noun = kind === "gifts" ? "gifts" : "donors";
		const saved = await host
			.downloadFile({
				name: fileName(kind, props.campaignId),
				mimeType: "text/csv",
				text: built.text,
			})
			.catch(() => false);
		running.current = false;
		setBusy(null);
		if (!saved) {
			props.onError(`The file wasn't saved. Try ${noun} again.`);
			return;
		}
		const shown = new Intl.NumberFormat(locale).format(built.count);
		setNote(
			built.more
				? `Saved the first ${shown} ${noun}. There are more: ask in the chat for a date range or a name to get the rest.`
				: `Saved ${shown} ${noun}.`,
		);
	};

	return (
		<section aria-label="Export">
			<h3 class="eyebrow">Export</h3>
			<div class="foot-actions">
				<Button
					variant="secondary"
					busy={busy === "gifts"}
					disabled={busy !== null}
					keepFocus
					onClick={() => void run("gifts")}
				>
					Download gifts (CSV)
				</Button>
				<Button
					variant="secondary"
					busy={busy === "donors"}
					disabled={busy !== null}
					keepFocus
					onClick={() => void run("donors")}
				>
					Download donors (CSV)
				</Button>
			</div>
			<p class="muted" role="status">
				{note}
			</p>
		</section>
	);
}
