import { raw } from "hono/html";
import type { Child } from "hono/jsx";

// Where the connect routes serve the page's two assets.
export const LOGO_PATH = "/connect/assets/logo.png";
export const FONT_PATH = "/connect/assets/quicksand.woff2";

// Better Giving Platform's look, copied by value from the platform repo:
// packages/brand/src/colors.css (palette; light-only per
// packages/brand/design-system.md), packages/ui/src/styles/theme.css and
// fonts.css (Quicksand Variable, latin subset), components.css (.btn,
// .btn-primary at the btn-lg tier), and the solo-card notice layout of
// apps/platform/src/routes/_app.login_.reset/check-email.tsx. The focus ring
// is --primary, not the platform's --ring (blue-8): that is under WCAG's 3:1
// for non-text against the page.
const STYLE = `
@font-face{font-family:"Quicksand Variable";font-style:normal;font-display:swap;font-weight:300 700;src:url(${FONT_PATH}) format("woff2-variations");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
:root{--background:#fbfcfe;--panel:#f6f9fd;--border:#d2dbe7;--ink:#1a2029;--primary:#1e6dab;--primary-hover:#055f9c;--primary-fg:#fff;--secondary:#e4f4ff;--radius:.25rem}
*,*::before,*::after{box-sizing:border-box}
body{margin:0;font:400 1rem/1.5 "Quicksand Variable",sans-serif;color:var(--ink);background:var(--background)}
main{display:grid;justify-items:center;padding:2.5rem 1rem}
.card{display:grid;justify-items:center;width:100%;max-width:28rem;padding:1.75rem 1.5rem;background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);text-align:center}
.logo{display:block;width:4rem;height:4rem;border-radius:50%;background:var(--secondary)}
h1{font-size:1.5rem;line-height:1.333;font-weight:700;margin:1.25rem 0 0}
p{margin:.75rem 0 0;line-height:1.625}
form{width:100%;margin-top:1.5rem}
.btn{display:flex;justify-content:center;align-items:center;width:100%;min-block-size:3.25rem;padding:.75rem 2rem;font:inherit;font-size:1.125rem;line-height:1.556;font-weight:700;border:0;border-radius:var(--radius);cursor:pointer}
.btn-primary{background:var(--primary);color:var(--primary-fg)}
.btn-primary:hover,.btn-primary:active{background:var(--primary-hover)}
.btn-primary:active{transform:translateY(1px)}
:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
`;

function Page({ heading, children }: { heading: string; children: Child }) {
	return (
		<>
			{raw("<!doctype html>")}
			<html lang="en">
				<head>
					<meta charset="utf-8" />
					<meta name="viewport" content="width=device-width, initial-scale=1" />
					<title>{`${heading} · Better Giving`}</title>
					{/* as a child it would be escaped, and the font stack's quotes with it */}
					<style dangerouslySetInnerHTML={{ __html: STYLE }} />
				</head>
				<body>
					<main>
						<div class="card">
							<img
								class="logo"
								src={LOGO_PATH}
								alt="Better Giving"
								width="64"
								height="64"
							/>
							<h1>{heading}</h1>
							{children}
						</div>
					</main>
				</body>
			</html>
		</>
	);
}

/**
 * A dead end with one thing to do, said in `message`. `back` is where "Back
 * to your AI assistant" posts, ending the chat app's request as declined;
 * given only while the login request still verifies.
 */
export function MessagePage(props: {
	heading: string;
	message: string;
	back?: string;
}) {
	return (
		<Page heading={props.heading}>
			<p>{props.message}</p>
			{props.back !== undefined && (
				<form method="post" action={props.back}>
					<button type="submit" class="btn btn-primary">
						Back to your AI assistant
					</button>
				</form>
			)}
		</Page>
	);
}
