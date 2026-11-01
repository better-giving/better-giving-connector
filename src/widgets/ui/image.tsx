/** @jsxImportSource hono/jsx/dom */
import { useState } from "hono/jsx/dom";

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

/** An image (decorative when `alt` is empty), or a neutral placeholder when there is none, its origin is blocked, or it fails to load. */
export function ImageWithPlaceholder(props: {
	src: string | null;
	alt: string;
	origins: readonly string[];
	class?: string;
}) {
	const [failed, setFailed] = useState<string | null>(null);
	const { src } = props;
	const cls = props.class ? `image ${props.class}` : "image";
	if (src && src !== failed && isAllowedImage(src, props.origins)) {
		return (
			<img
				class={cls}
				src={src}
				alt={props.alt}
				loading="lazy"
				decoding="async"
				onError={() => setFailed(src)}
			/>
		);
	}
	return (
		<div
			class={`${cls} image-placeholder`}
			{...(props.alt
				? { role: "img", "aria-label": props.alt }
				: { "aria-hidden": "true" })}
		>
			<svg viewBox="0 0 40 32" aria-hidden="true">
				<path
					fill-rule="evenodd"
					d="M4 2h32a2 2 0 0 1 2 2v24a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm1 3v19l9-9 7 7 5-5 9 9V5zm23 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8z"
				/>
			</svg>
		</div>
	);
}
