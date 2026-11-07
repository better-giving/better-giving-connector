/** @jsxImportSource hono/jsx/dom */
import { useEffect, useState } from "hono/jsx/dom";
import type { Block, CampaignEditorData, Page } from "../model";
import { StatusBadge } from "../ui/badge";
import { Button } from "../ui/button";
import { useWidgetState } from "../ui/state";
import { callTool } from "../ui/tools";
import { useSession } from "../ui/widget";
import {
	BlockFields,
	CONTENT_SECTIONS,
	ContentFields,
	type ContentSection,
} from "./fields";
import { ADDABLE_BLOCKS, blockLabel } from "./labels";
import { Outline } from "./outline";
import { type Device, PagePreview } from "./preview";
import "./editor.css";

const isDevice = (v: unknown): v is Device => v === "desktop" || v === "phone";

/** A block's first line of text, for the list. */
function summaryOf(block: Block): string {
	const text = Object.entries(block).find(
		([key, value]) =>
			key !== "type" && typeof value === "string" && !/^https:/.test(value),
	)?.[1];
	return typeof text === "string"
		? text.length > 44
			? `${text.slice(0, 43)}…`
			: text
		: "";
}

function move<T>(list: readonly T[], from: number, to: number): T[] {
	const next = [...list];
	const [item] = next.splice(from, 1);
	if (item !== undefined) next.splice(to, 0, item);
	return next;
}

function AddBlock(props: { onAdd: (type: string) => void }) {
	const [open, setOpen] = useState(false);
	return (
		<div class="add-row">
			<button
				type="button"
				class="add-btn"
				aria-expanded={open}
				onClick={() => setOpen(!open)}
			>
				+ Add block
			</button>
			{open && (
				<ul class="add-menu" aria-label="Block types">
					{ADDABLE_BLOCKS.map((b) => (
						<li key={b.type}>
							<button
								type="button"
								class="add-choice"
								onClick={() => {
									props.onAdd(b.type);
									setOpen(false);
								}}
							>
								{b.label}
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

export function CampaignEditor(props: { data: CampaignEditorData }) {
	const { host } = useSession();
	const [data, setData] = useState(props.data);
	const [page, setPage] = useState<Page>(props.data.page);
	const [dirty, setDirty] = useState(false);
	const [selected, setSelected] = useState(0);
	const [device, setDevice] = useWidgetState<Device>(
		"device",
		"desktop",
		isDevice,
	);
	const [busy, setBusy] = useState<"save" | "publish" | "discard" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [status, setStatus] = useState("");

	useEffect(() => {
		void host.requestFullscreen();
	}, [host]);

	const { campaign } = data;
	const live = campaign.status === "published";
	const ended = campaign.status === "ended";
	// Standalone writes a live campaign's save through, so there is no draft to publish
	const savesAsDraft = live && data.draftsLiveEdits;

	const edit = (next: Page) => {
		setPage(next);
		setDirty(true);
		setStatus("");
	};
	const apply = (res: CampaignEditorData, message: string) => {
		setData(res);
		setPage(res.page);
		setDirty(false);
		setStatus(message);
	};

	const save = async (): Promise<boolean> => {
		setBusy("save");
		setError(null);
		const res = await callTool(host, "app_save_campaign_edit", {
			id: campaign.id,
			expectedVersion: campaign.version,
			page,
			draftRevision: data.draftRevision,
		});
		setBusy(null);
		if (!res.ok) {
			setError(res.error);
			return false;
		}
		apply(
			res.data,
			savesAsDraft
				? "Saved as a draft."
				: live
					? "Saved. Donors see it now."
					: "Saved.",
		);
		return true;
	};

	const publish = async () => {
		if (dirty && !(await save())) return;
		setBusy("publish");
		setError(null);
		const res = await callTool(host, "app_publish_campaign", {
			id: campaign.id,
			giftsGoTo: null,
		});
		setBusy(null);
		if (!res.ok) {
			setError(res.error);
			return;
		}
		const refreshed = await callTool(host, "app_get_campaign_editor", {
			id: campaign.id,
		});
		if (refreshed.ok) apply(refreshed.data, "Published.");
		else setStatus("Published.");
	};

	const discard = async () => {
		setBusy("discard");
		setError(null);
		const res = await callTool(host, "app_discard_campaign_draft", {
			id: campaign.id,
			draftRevision: data.draftRevision,
		});
		setBusy(null);
		if (!res.ok) {
			setError(res.error);
			return;
		}
		apply(res.data, "Draft edits discarded.");
	};

	const blocks = page.pageKind === "blocks" ? page.blocks : [];
	const items =
		page.pageKind === "blocks"
			? blocks.map((b, i) => ({
					key: `${b.type}-${i}`,
					label: blockLabel(b.type),
					summary: summaryOf(b),
				}))
			: CONTENT_SECTIONS.map((s) => ({ key: s.key, label: s.label }));
	const index = Math.min(selected, Math.max(items.length - 1, 0));

	const setBlock = (block: Block) =>
		page.pageKind === "blocks" &&
		edit({
			pageKind: "blocks",
			blocks: blocks.map((b, i) => (i === index ? block : b)),
		});

	const savedLine = dirty
		? "Unsaved changes"
		: campaign.version
			? `Saved · v${campaign.version}`
			: "Saved";

	return (
		<div class="editor">
			<header class="editor-head">
				<Button variant="secondary" onClick={() => void host.exitFullscreen()}>
					Close
				</Button>
				<h2 class="editor-title">{campaign.title}</h2>
				<StatusBadge status={campaign.status} />
				{data.pendingDraft && (
					<span class="badge badge-warning">Draft edits</span>
				)}
				<span class="editor-saved">{savedLine}</span>
				<span class="editor-actions">
					{data.pendingDraft && !ended && (
						<Button
							variant="secondary"
							busy={busy === "discard"}
							onClick={() => void discard()}
						>
							Discard draft edits
						</Button>
					)}
					<Button
						variant="secondary"
						busy={busy === "save"}
						disabled={!dirty || ended}
						onClick={() => void save()}
					>
						Save
					</Button>
					{(!live || savesAsDraft) && (
						<Button
							variant="primary"
							busy={busy === "publish"}
							disabled={ended || (live && !dirty && !data.pendingDraft)}
							onClick={() => void publish()}
						>
							{live ? "Publish changes" : "Publish"}
						</Button>
					)}
				</span>
			</header>
			{error && (
				<p class="error-line" role="alert">
					{error}
				</p>
			)}
			<p class="sr-only" role="status">
				{status}
			</p>
			<div class="editor-body">
				<div class="editor-left">
					<Outline
						footer={
							page.pageKind === "blocks" && !ended ? (
								<AddBlock
									onAdd={(type) => {
										edit({
											pageKind: "blocks",
											blocks: [...blocks, { type }],
										});
										setSelected(blocks.length);
									}}
								/>
							) : undefined
						}
						items={items}
						selected={index}
						onSelect={setSelected}
						onMove={
							page.pageKind === "blocks" && !ended
								? (from, to) =>
										edit({
											pageKind: "blocks",
											blocks: move(blocks, from, to),
										})
								: undefined
						}
						onRemove={
							page.pageKind === "blocks" && !ended
								? (i) => {
										edit({
											pageKind: "blocks",
											blocks: blocks.filter((_, j) => j !== i),
										});
										setSelected(Math.max(0, i - 1));
									}
								: undefined
						}
					/>
					<section class="editor-fields" aria-label="Selected section">
						<h3 class="section-title">
							{items[index]?.label ?? "Nothing selected"}
						</h3>
						{page.pageKind === "blocks" && blocks[index] && (
							<BlockFields
								campaignId={campaign.id}
								block={blocks[index]}
								onChange={setBlock}
							/>
						)}
						{page.pageKind === "content" && items[index] && (
							<ContentFields
								campaignId={campaign.id}
								section={items[index].key as ContentSection}
								content={page.content}
								currency={data.formAmounts[0]?.currency ?? "USD"}
								onChange={(content) => edit({ pageKind: "content", content })}
							/>
						)}
					</section>
				</div>
				<div class="editor-right">
					<fieldset class="device-toggle">
						<legend class="sr-only">Preview size</legend>
						{(["desktop", "phone"] as const).map((d) => (
							<button
								key={d}
								type="button"
								class="device-btn"
								aria-pressed={device === d}
								onClick={() => setDevice(d)}
							>
								{d === "desktop" ? "Desktop" : "Phone"}
							</button>
						))}
					</fieldset>
					<PagePreview data={data} page={page} device={device} />
				</div>
			</div>
		</div>
	);
}
