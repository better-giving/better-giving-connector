/** @jsxImportSource hono/jsx/dom */
import type { Child } from "hono/jsx";
import { useEffect, useState } from "hono/jsx/dom";

/**
 * `url` is https on one of `origins` (`https://host`, or `https://*.suffix` for
 * any subdomain of suffix), the list the resource's CSP lets an image load from.
 */
export function isAllowedImage(url: string, origins: readonly string[]) {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	if (parsed.protocol !== "https:") return false;
	return origins.some((origin) => {
		const wildcard = /^https:\/\/\*\.(.+)$/.exec(origin)?.[1];
		if (wildcard) return parsed.host.endsWith(`.${wildcard}`);
		return parsed.origin === origin;
	});
}

/**
 * The registry's image frame: an image (decorative when `alt` is empty), or the
 * placeholder when there is none, its origin is blocked, or it fails to load.
 * `overlay` is the frame's top-start slot, for a badge over either.
 */
export function ImageWithPlaceholder(props: {
	src: string | null;
	alt: string;
	origins: readonly string[];
	overlay?: Child;
	class?: string;
}) {
	const [state, setState] = useState<{
		src: string;
		value: "loaded" | "failed";
	}>();
	const { src } = props;
	// an outcome belongs to one showing of its src: leaving it (another src, or
	// none) drops it, so coming back reads "loading" until the new img reports.
	// Functional, so a load the new src already reported is kept.
	useEffect(() => {
		setState((s) => (s?.src === src ? s : undefined));
	}, [src]);
	const failed = state?.src === src && state.value === "failed";
	const shown = src !== null && !failed && isAllowedImage(src, props.origins);
	const data = shown
		? state?.src === src && state.value === "loaded"
			? "loaded"
			: "loading"
		: "unavailable";
	const cls = props.class ? `ds-image-frame ${props.class}` : "ds-image-frame";
	return (
		<div class={cls} data-state={data}>
			{shown ? (
				<img
					class="ds-image"
					src={src}
					alt={props.alt}
					loading="lazy"
					decoding="async"
					onLoad={() => setState({ src, value: "loaded" })}
					onError={() => setState({ src, value: "failed" })}
				/>
			) : (
				<div
					class="ds-image-placeholder"
					{...(props.alt
						? { role: "img", "aria-label": props.alt }
						: { "aria-hidden": "true" })}
				>
					<svg
						aria-hidden="true"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
						<circle cx="9" cy="9" r="2" />
						<path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
					</svg>
				</div>
			)}
			{props.overlay && <div class="ds-image-overlay">{props.overlay}</div>}
		</div>
	);
}
