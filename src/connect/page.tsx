import { raw } from "hono/html";
import type { Child } from "hono/jsx";
import { CONNECT_PRELOAD } from "../pages/fonts";
import connectCss from "./connect.css?css";

// Where the connect routes serve the page's logo; its faces come from
// src/pages/fonts.ts.
export const LOGO_PATH = "/connect/assets/logo.png";

function Page({ heading, children }: { heading: string; children: Child }) {
	return (
		<>
			{raw("<!doctype html>")}
			<html lang="en">
				<head>
					<meta charset="utf-8" />
					<meta name="viewport" content="width=device-width, initial-scale=1" />
					<title>{`${heading} · Better Giving`}</title>
					{CONNECT_PRELOAD.map((href) => (
						<link
							rel="preload"
							as="font"
							type="font/woff2"
							href={href}
							crossorigin=""
						/>
					))}
					{/* as a child it would be escaped, and the font stack's quotes with it */}
					<style dangerouslySetInnerHTML={{ __html: connectCss }} />
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
