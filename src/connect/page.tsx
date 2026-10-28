import { raw } from "hono/html";
import type { Child } from "hono/jsx";

// No design system exists yet (sheet: `screens`), so the look is this sheet:
// system font, one column, made for a 375 px phone.
const STYLE = `
*,*::before,*::after{box-sizing:border-box}
body{margin:0;font:18px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1a1a1a;background:#fff}
main{max-width:30rem;margin:0 auto;padding:2.5rem 1rem}
h1{font-size:1.6rem;line-height:1.25;margin:0 0 .75rem}
p{margin:0 0 1.5rem}
label{display:block;font-weight:600;margin-bottom:.4rem}
input{display:block;width:100%;font:inherit;color:inherit;padding:.75rem;border:2px solid #767676;border-radius:.5rem}
input[aria-invalid=true]{border-color:#b00020}
.hint{color:#555;font-size:.9rem;margin:.5rem 0 0}
.error{color:#b00020;margin:.5rem 0 0}
.status{margin:.75rem 0 0}
button{display:block;width:100%;margin-top:1.5rem;font:inherit;font-weight:600;padding:.9rem;border:2px solid #1d4ed8;border-radius:.5rem;color:#fff;background:#1d4ed8}
button[aria-disabled=true]{cursor:progress}
.secondary{margin-top:.75rem;color:#1d4ed8;background:transparent}
details{margin-top:1.5rem}
summary{padding:.6rem 0;font-weight:600;color:#1d4ed8;cursor:pointer}
details[open] summary{margin-bottom:.75rem}
:focus-visible{outline:3px solid #1d4ed8;outline-offset:2px}
@media (prefers-color-scheme:dark){body{color:#f2f2f2;background:#121212}.hint{color:#bbb}input{background:#1e1e1e;border-color:#8a8a8a}input[aria-invalid=true]{border-color:#ff8a80}.error{color:#ff8a80}button{background:#2563eb;border-color:#2563eb}:focus-visible{outline-color:#93c5fd}.secondary,summary{color:#93c5fd}.secondary{background:transparent}}
`;

function Page({
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
					<title>{title}</title>
					{/* as a child it would be escaped, and the font stack's quotes with it */}
					<style dangerouslySetInnerHTML={{ __html: STYLE }} />
				</head>
				<body>
					<main>
						<h1>{heading}</h1>
						{children}
					</main>
				</body>
			</html>
		</>
	);
}

// hello can take seconds; the pressed form's status line says so, and both
// buttons read busy because a second press of either form is refused.
// aria-disabled, not disabled, so the pressed button keeps focus. A page
// restored from the back-forward cache gets its buttons back.
// No top-level `status`: in a classic script that is window.status.
const PENDING = `
var pending = false;
var buttons = [document.getElementById("sign-in"), document.getElementById("continue")];
var lines = [];
function hold(formId, lineId, said) {
	var line = document.getElementById(lineId);
	lines.push(line);
	document.getElementById(formId).addEventListener("submit", function (event) {
		if (pending) return event.preventDefault();
		pending = true;
		buttons.forEach(function (button) {
			button.setAttribute("aria-disabled", "true");
		});
		line.textContent = said;
	});
}
addEventListener("pageshow", function () {
	pending = false;
	buttons.forEach(function (button) {
		button.removeAttribute("aria-disabled");
	});
	lines.forEach(function (line) {
		line.textContent = "";
	});
});
hold("sign-in-form", "sign-in-status", "Opening better.giving…");
hold("address-form", "address-status", "Checking your address…");
`;

/** What the sign-in button submits as the address. */
const PLATFORM_ADDRESS = "better.giving";

/** The sign-in form's `via`, which tells its post from the typed address's. */
export const VIA_SIGN_IN = "sign-in";

const SIGN_IN_ERROR_ID = "sign-in-error";
const ERROR_ID = "address-error";
const HINT_ID = "address-hint";

/**
 * The connect page: one button signs in at better.giving; "Use a different
 * site" opens the address form for a site of the operator's own. Both forms
 * post to `action`, the request's own path and query: the signed login
 * request rides in it from GET to POST. The sign-in form also posts `via`.
 * `error` is the address field's; `signInError` is the sign-in button's.
 */
export function AddressPage(props: {
	action: string;
	/** Where Cancel posts. */
	cancel: string;
	value?: string;
	error?: string;
	signInError?: string;
	/** Whether the verified login request asks for `read_only`. */
	readOnly?: boolean;
}) {
	const { action, cancel, value, error, signInError, readOnly } = props;
	const invalid = error !== undefined;
	const signInFailed = signInError !== undefined;
	return (
		<Page
			heading="Connect Better Giving"
			title={
				invalid || signInFailed ? "Error: Connect Better Giving" : undefined
			}
		>
			<p>
				Sign in to Better Giving and press Allow. Then you'll return to your AI
				assistant.
			</p>
			{readOnly && (
				<p>
					This connection is read-only: your AI assistant will be able to view
					your Better Giving account and site but not change anything.
				</p>
			)}
			<form id="sign-in-form" method="post" action={action}>
				<input type="hidden" name="address" value={PLATFORM_ADDRESS} />
				<input type="hidden" name="via" value={VIA_SIGN_IN} />
				<button
					id="sign-in"
					type="submit"
					autofocus={signInFailed}
					aria-describedby={signInFailed ? SIGN_IN_ERROR_ID : undefined}
				>
					Sign in with better.giving
				</button>
				{signInFailed && (
					<p id={SIGN_IN_ERROR_ID} class="error" role="alert">
						{signInError}
					</p>
				)}
				{/* present from the start: a live region added later isn't announced */}
				<p id="sign-in-status" role="status" class="status"></p>
			</form>
			<details open={invalid}>
				<summary>Use a different site</summary>
				<form id="address-form" method="post" action={action}>
					<label for="address">Your Better Giving site's address</label>
					<input
						id="address"
						name="address"
						type="text"
						inputmode="url"
						autocomplete="url"
						autocapitalize="none"
						spellcheck={false}
						required
						value={value}
						autofocus={invalid}
						aria-invalid={invalid ? "true" : undefined}
						aria-describedby={invalid ? `${ERROR_ID} ${HINT_ID}` : HINT_ID}
					/>
					{invalid && (
						<p id={ERROR_ID} class="error" role="alert">
							{error}
						</p>
					)}
					<p id={HINT_ID} class="hint">
						Only if your organization runs its own Better Giving site. Not its
						main website.
					</p>
					<button id="continue" type="submit">
						Continue
					</button>
					<p id="address-status" role="status" class="status"></p>
				</form>
			</details>
			<script dangerouslySetInnerHTML={{ __html: PENDING }} />
			<WayOut action={cancel} label="Cancel" />
		</Page>
	);
}

/**
 * A dead end with one thing to do, said in `message`. `back` is where "Back
 * to your AI assistant" posts, given only while the login request still
 * verifies.
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
				<WayOut action={props.back} label="Back to your AI assistant" />
			)}
		</Page>
	);
}

// Ends the chat app's request as declined.
function WayOut(props: { action: string; label: string }) {
	return (
		<form method="post" action={props.action}>
			<button type="submit" class="secondary">
				{props.label}
			</button>
		</form>
	);
}
