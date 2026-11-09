import { raw } from "hono/html";
import type { Child } from "hono/jsx";
import { SITE_PRELOAD } from "../pages/fonts";
import siteCss from "./site.css?css";

// Dark is the registry's `dark` class on <html>. The class follows the
// browser's scheme, set before first paint and kept in step if it changes; a
// browser without scripts gets the light page.
const DARK = `const q=matchMedia("(prefers-color-scheme: dark)");const set=()=>document.documentElement.classList.toggle("dark",q.matches);set();q.addEventListener("change",set)`;

export function Page({
	heading,
	title = heading,
	children,
}: {
	heading: string;
	title?: string;
	children: Child;
}) {
	return (
		<>
			{raw("<!doctype html>")}
			<html lang="en">
				<head>
					<meta charset="utf-8" />
					<meta name="viewport" content="width=device-width, initial-scale=1" />
					<link rel="icon" href="/icon.svg" type="image/svg+xml" />
					<title>{title}</title>
					<script dangerouslySetInnerHTML={{ __html: DARK }} />
					{SITE_PRELOAD.map((href) => (
						<link
							rel="preload"
							as="font"
							type="font/woff2"
							href={href}
							crossorigin=""
						/>
					))}
					<style dangerouslySetInnerHTML={{ __html: siteCss }} />
				</head>
				<body>
					<main>
						<nav>
							<a href="/docs">Docs</a>
							<a href="/support">Support</a>
							<a href="/privacy">Privacy</a>
							<a href="/terms">Terms</a>
						</nav>
						<div class="ds-prose">
							<h1>{heading}</h1>
							{children}
						</div>
					</main>
				</body>
			</html>
		</>
	);
}
