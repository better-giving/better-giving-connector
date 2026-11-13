import { raw } from "hono/html";
import type { Child } from "hono/jsx";
import { SITE_PRELOAD } from "../pages/fonts";
import siteCss from "./site.css?css";

// Dark is the registry's `dark` class on <html>. The class follows the
// browser's scheme, set before first paint and kept in step if it changes; a
// browser without scripts gets the light page.
const DARK = `const q=matchMedia("(prefers-color-scheme: dark)");const set=()=>document.documentElement.classList.toggle("dark",q.matches);set();q.addEventListener("change",set)`;

// The registry's site-nav disclosure: the stylesheet draws, this opens and
// closes. The menu button toggles the panel; Escape, a press outside, focus
// leaving it and widening past the fold (40rem) close it.
const MENU_GLYPH = `<path d="M4 5h16"/><path d="M4 12h16"/><path d="M4 19h16"/>`;
const CLOSE_GLYPH = `<path d="M18 6 6 18"/><path d="m6 6 12 12"/>`;

const NAV = `const b=document.querySelector(".ds-site-nav-toggle"),m=document.getElementById("site-menu");if(b&&m){const g=b.querySelector("svg"),w=matchMedia("(min-width: 40rem)"),set=(o)=>{b.setAttribute("aria-expanded",String(o));m.hidden=!o;g.innerHTML=o?${JSON.stringify(CLOSE_GLYPH)}:${JSON.stringify(MENU_GLYPH)}},out=(t)=>!m.contains(t)&&!b.contains(t);b.addEventListener("click",()=>set(m.hidden));m.addEventListener("click",(e)=>{if(e.target.closest("a"))set(false)});document.addEventListener("pointerdown",(e)=>{if(!m.hidden&&out(e.target))set(false)});document.addEventListener("keydown",(e)=>{if(e.key==="Escape"&&!m.hidden&&!e.defaultPrevented&&(m.contains(e.target)||b===e.target||e.target===document.body)){set(false);b.focus()}});for(const el of [m,b])el.addEventListener("focusout",(e)=>{if(!m.hidden&&e.relatedTarget&&out(e.relatedTarget))set(false)});w.addEventListener("change",()=>{if(w.matches)set(false)})}`;

const LINKS = [
	{ path: "/docs", label: "Docs" },
	{ path: "/support", label: "Support" },
	{ path: "/privacy", label: "Privacy" },
	{ path: "/terms", label: "Terms" },
] as const;

export function Page({
	heading,
	title = heading,
	current,
	children,
}: {
	heading: string;
	title?: string;
	/** The path of the page being shown, marked in the nav. */
	current: (typeof LINKS)[number]["path"];
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
					<a class="ds-site-nav-skip" href="#main">
						Skip to content
					</a>
					<header class="ds-site-nav">
						<div class="ds-site-nav-bar">
							<a class="ds-site-nav-brand" href="/">
								Better Giving
							</a>
							<nav class="ds-site-nav-links" aria-label="Main">
								<ul>
									{LINKS.map((link) => (
										<li>
											<a
												class="ds-site-nav-link"
												href={link.path}
												aria-current={
													link.path === current ? "page" : undefined
												}
											>
												{link.label}
											</a>
										</li>
									))}
								</ul>
							</nav>
							<button
								type="button"
								class="ds-btn ds-btn-ghost ds-btn-field ds-btn-icon ds-site-nav-toggle"
								aria-label="Menu"
								aria-expanded="false"
								aria-controls="site-menu"
							>
								<svg
									width="20"
									height="20"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"
								>
									{raw(MENU_GLYPH)}
								</svg>
							</button>
						</div>
						<nav
							id="site-menu"
							class="ds-site-nav-menu"
							aria-label="Main"
							hidden
						>
							<ul>
								{LINKS.map((link) => (
									<li>
										<a
											class="ds-site-nav-menu-link"
											href={link.path}
											aria-current={link.path === current ? "page" : undefined}
										>
											{link.label}
										</a>
									</li>
								))}
							</ul>
						</nav>
					</header>
					<main id="main" tabindex={-1}>
						<div class="ds-prose">
							<h1>{heading}</h1>
							{children}
						</div>
					</main>
					<script dangerouslySetInnerHTML={{ __html: NAV }} />
				</body>
			</html>
		</>
	);
}
