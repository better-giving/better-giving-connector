/** @jsxImportSource hono/jsx/dom */
import { useEffect, useId, useState } from "hono/jsx/dom";
import type { PhotoData } from "../model";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { ImageWithPlaceholder } from "../ui/image";
import { callTool } from "../ui/tools";
import { useLocale, useSession } from "../ui/widget";
import "./photo.css";

const kilobytes = (bytes: number, locale: string) =>
	bytes >= 1_000_000
		? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / 1_000_000)} MB`
		: `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(bytes / 1000)} KB`;

const initials = (name: string) =>
	name
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((w) => [...w][0]?.toUpperCase() ?? "")
		.join("");

/**
 * The connected account. The service knows one nonprofit per connection and
 * no list of the person's others, so switching asks the chat to start the
 * host's own connect flow, where the next nonprofit is picked.
 */
function Account() {
	const { host } = useSession();
	const [name, setName] = useState<string | null>(null);
	const [settled, setSettled] = useState(false);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		void callTool(host, "get_profile", {}).then((res) => {
			if (res.ok) setName(res.data.name.trim() ? res.data.name : null);
			setSettled(true);
		});
	}, [host]);
	const ask = (prompt: string) => {
		setError(null);
		host
			.sendFollowUp(prompt)
			.catch(() =>
				setError("Couldn't ask the chat. Ask it in your own words instead."),
			);
	};
	return (
		<section class="account" aria-label="Account">
			<div class="account-row account-current">
				<span class="avatar" aria-hidden="true">
					{name ? initials(name) : ""}
				</span>
				<div class="account-who">
					<p class="account-name">
						{name ?? (settled ? "Your nonprofit" : "…")}
					</p>
					<p class="account-label">Nonprofit</p>
				</div>
				<span class="ds-badge ds-badge-success">Connected</span>
			</div>
			<div class="account-row">
				<div class="account-who">
					<p class="account-name">Another nonprofit?</p>
					<p class="account-label">
						Connect a different one; you pick it when you sign in.
					</p>
				</div>
				<Button
					variant="secondary"
					onClick={() =>
						ask(
							"I want to connect a different Better Giving nonprofit. Walk me through switching.",
						)
					}
				>
					Switch nonprofit
				</Button>
			</div>
			<div class="account-row account-foot">
				<span class="account-label">
					Disconnecting removes this nonprofit from the chat.
				</span>
				<button
					type="button"
					class="link-btn"
					onClick={() =>
						ask(
							"I want to disconnect Better Giving from this chat. Where do I do that?",
						)
					}
				>
					How to disconnect
				</button>
			</div>
			{error && (
				<p class="error-line" role="alert">
					{error}
				</p>
			)}
		</section>
	);
}

export function PhotoCard(props: { data: PhotoData }) {
	const { host } = useSession();
	const locale = useLocale();
	const altId = useId();
	const { data } = props;
	const [alt, setAlt] = useState(data.suggestedAlt);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [done, setDone] = useState<string | null>(null);
	const { file } = data;

	const setCover = async () => {
		if (!file) return;
		setBusy(true);
		setError(null);
		const res = await callTool(host, "app_set_campaign_photo", {
			id: data.campaign.id,
			downloadUrl: file.downloadUrl,
			alt,
		});
		setBusy(false);
		if (!res.ok) {
			setError(res.error);
			return;
		}
		setDone("The photo is now the cover.");
	};

	const openLink = async () => {
		setError(null);
		const url =
			data.uploadUrl ??
			(await (async () => {
				const res = await callTool(host, "app_photo_upload_link", {
					id: data.campaign.id,
				});
				if (!res.ok) {
					setError(res.error);
					return null;
				}
				return res.data.url;
			})());
		if (url)
			await host.openLink(url).catch(() => {
				setError(
					`Couldn't open the page. It's at ${url} if you'd like to copy it.`,
				);
			});
	};

	const shown = file?.previewUrl ?? data.current?.url ?? null;
	return (
		<Card
			label="Cover photo"
			media={
				<ImageWithPlaceholder
					class="photo-crop"
					src={shown}
					alt={file ? alt : (data.current?.alt ?? "")}
					origins={data.imageOrigins}
				/>
			}
		>
			<h2 class="section-title">{data.campaign.title}</h2>
			{file ? (
				<>
					<p class="muted">
						{file.name} · {kilobytes(file.size, locale)} · {file.type}. It shows
						16:9 on the donor page.
					</p>
					<div class="ds-field">
						<label class="ds-label" for={altId}>
							Photo description (alt text)
						</label>
						<input
							id={altId}
							class="ds-field-input"
							type="text"
							value={alt}
							onInput={(e: Event) =>
								setAlt((e.target as HTMLInputElement).value)
							}
						/>
					</div>
					<div class="row">
						{data.canUpload ? (
							<Button
								variant="primary"
								busy={busy}
								disabled={done !== null}
								onClick={() => void setCover()}
							>
								Set as cover
							</Button>
						) : (
							<Button variant="primary" onClick={() => void openLink()}>
								Open upload link
							</Button>
						)}
					</div>
				</>
			) : (
				<>
					<p class="muted">
						{data.current
							? "This is the campaign's cover now. Drop a photo into the chat to replace it."
							: "This campaign has no cover photo yet. Drop a photo into the chat to add one."}
					</p>
					<div class="row">
						<Button variant="secondary" onClick={() => void openLink()}>
							Open upload link
						</Button>
					</div>
				</>
			)}
			{error && (
				<p class="error-line" role="alert">
					{error}
				</p>
			)}
			<p class="sr-only" role="status">
				{done ?? ""}
			</p>
			{done && <p class="done">{done}</p>}
			<Account />
		</Card>
	);
}
