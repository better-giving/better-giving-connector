/** @jsxImportSource hono/jsx/dom */
import { useEffect, useId, useState } from "hono/jsx/dom";
import type { AppToolResult, PhotoData } from "../model";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { ImageWithPlaceholder, isAllowedImage } from "../ui/image";
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

type Nonprofit = AppToolResult<"list_nonprofits">["data"][number];

/** The most nonprofits the panel lists, the connected one first; the rest are a count. */
const MAX_LISTED = 8;

/**
 * Every Switch button sends this one message. A nonprofit's name is set by
 * whoever administers it, so it never goes into what the chat reads as the
 * person's own words.
 */
const SWITCH_PROMPT =
	"I want to connect a different Better Giving nonprofit. Walk me through switching.";

function Avatar(props: {
	name: string;
	logo: string | null | undefined;
	origins: readonly string[];
}) {
	const [failed, setFailed] = useState(false);
	const { logo } = props;
	return logo && !failed && isAllowedImage(logo, props.origins) ? (
		<img
			class="avatar avatar-logo"
			src={logo}
			alt=""
			aria-hidden="true"
			onError={() => setFailed(true)}
		/>
	) : (
		<span class="avatar" aria-hidden="true">
			{initials(props.name)}
		</span>
	);
}

/**
 * The connected account, and the person's other nonprofits when the service
 * lists them (list_nonprofits; Standalone and a failed call list none). A
 * switch asks the chat to start the host's own connect flow, where the next
 * nonprofit is picked.
 */
function Account(props: { origins: readonly string[] }) {
	const { host } = useSession();
	const [name, setName] = useState<string | null>(null);
	const [settled, setSettled] = useState(false);
	const [others, setOthers] = useState<Nonprofit[]>([]);
	const [logo, setLogo] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		void (async () => {
			const profile = await callTool(host, "get_profile", {});
			if (profile.ok)
				setName(profile.data.name.trim() ? profile.data.name : null);
			setSettled(true);
			const listed = await callTool(host, "list_nonprofits", {});
			if (!listed.ok) return;
			const current = listed.data.data.find((n) => n.current);
			const rest = listed.data.data.filter((n) => !n.current);
			if (!current) return;
			setLogo(current.logo_url ?? null);
			if (rest.length > 0) setOthers(rest);
		})();
	}, [host]);
	const shown = others.slice(0, MAX_LISTED - 1);
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
			<div class="account-row">
				<Avatar name={name ?? ""} logo={logo} origins={props.origins} />
				<div class="account-who">
					<p class="account-name">
						{name ?? (settled ? "Your nonprofit" : "…")}
					</p>
					<p class="account-label">Nonprofit</p>
				</div>
				<span class="ds-badge ds-badge-success">Connected</span>
			</div>
			{others.length > 0 ? (
				<>
					{shown.map((n) => (
						<div class="account-row" key={n.id}>
							<Avatar name={n.name} logo={n.logo_url} origins={props.origins} />
							<div class="account-who">
								<p class="account-name">{n.name}</p>
								<p class="account-label">
									{n.can_manage === false ? "View-only" : "Admin"}
								</p>
							</div>
							<Button
								variant="secondary"
								label={`Switch to ${n.name}`}
								onClick={() => ask(SWITCH_PROMPT)}
							>
								Switch
							</Button>
						</div>
					))}
					{others.length > shown.length && (
						<div class="account-row account-more">
							<span class="account-label">
								…and {others.length - shown.length} more
							</span>
						</div>
					)}
				</>
			) : (
				<div class="account-row">
					<div class="account-who">
						<p class="account-name">Another nonprofit?</p>
						<p class="account-label">
							Connect a different one; you pick it when you sign in.
						</p>
					</div>
					<Button variant="secondary" onClick={() => ask(SWITCH_PROMPT)}>
						Switch nonprofit
					</Button>
				</div>
			)}
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
			<Account origins={data.imageOrigins} />
		</Card>
	);
}
