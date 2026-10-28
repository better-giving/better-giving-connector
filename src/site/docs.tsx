import { ACTIONS, type ToolName } from "../mcp/actions";
import { Page } from "./page";

const TOOL_CLASSES = ["Read", "Write", "Sensitive write"] as const;
type ToolClass = (typeof TOOL_CLASSES)[number];
type ToolDoc = { class: ToolClass; effects: string; errors?: string[] };

const CHANGED_SINCE_READ =
	"Nothing is saved if the campaign changed since it was read. Read it again and retry.";
const ENDED =
	"Nothing is saved if the campaign has ended. An ended campaign stays ended.";

// Keyed by every tool name, so a tool added to ACTIONS fails the type check
// until it is documented here. The errors are the tool's own; every tool can
// also return the ones under "Errors any tool can return".
const TOOL_DOCS: Record<ToolName, ToolDoc> = {
	list_campaigns: { class: "Read", effects: "None." },
	get_campaign: { class: "Read", effects: "None." },
	create_campaign: {
		class: "Write",
		effects:
			"Creates a draft campaign. Donors cannot see it until it is published. The same title sent again returns the earlier result and makes nothing new.",
	},
	update_campaign_blocks: {
		class: "Sensitive write",
		effects:
			"Replaces the content of a campaign's page. On a live campaign, donors see the change right away.",
		errors: [
			CHANGED_SINCE_READ,
			ENDED,
			"Nothing is saved if the cover photo was not uploaded for this campaign. Make an upload link first.",
			"Not offered on this account any more. Use update_campaign_content instead.",
		],
	},
	update_campaign_content: {
		class: "Sensitive write",
		effects:
			"Changes the parts of a campaign's page you send. On a live campaign, donors see the change right away.",
	},
	update_campaign_settings: {
		class: "Sensitive write",
		effects:
			"Changes a campaign's goal, end date, time zone, or share message. On a live campaign, donors see the change right away.",
		errors: [CHANGED_SINCE_READ, ENDED],
	},
	publish_campaign: {
		class: "Sensitive write",
		effects:
			"Puts a draft campaign live at its public link. The first time, it sets where the gifts go: a program, or the general fund.",
		errors: [
			CHANGED_SINCE_READ,
			ENDED,
			"Where a live campaign's gifts go can't be changed here. Change it in the Better Giving dashboard.",
		],
	},
	end_campaign: {
		class: "Sensitive write",
		effects: "Ends a campaign for good. It stops taking gifts.",
	},
	get_donation_page: { class: "Read", effects: "None." },
	update_donation_page_blocks: {
		class: "Sensitive write",
		effects: "Replaces the content of the main donation page that donors see.",
		errors: [
			"Not offered on this account any more. Use update_donation_page_content instead.",
		],
	},
	update_donation_page_content: {
		class: "Write",
		effects:
			"Changes the donation page's heading in its draft. Donors see it once you publish the page in the Better Giving dashboard.",
	},
	reset_donation_page: {
		class: "Sensitive write",
		effects:
			"Puts the main donation page back to its default content and discards what is there now. Donors see it right away.",
	},
	get_block_catalog: {
		class: "Read",
		effects: "None.",
		errors: [
			"Not offered on this account any more. Use get_content_catalog instead.",
		],
	},
	get_content_catalog: { class: "Read", effects: "None." },
	list_forms: { class: "Read", effects: "None." },
	get_form: { class: "Read", effects: "None." },
	create_form: {
		class: "Write",
		effects: "Creates a donation form. Each call makes a new form.",
		errors: [
			"The site is still working on this request. Wait, then check the list of forms before trying again.",
			"Nothing is made if the site matched this request to a different one. Check the list of forms, then try again if it is still needed.",
		],
	},
	update_form: {
		class: "Write",
		effects:
			"Changes the fields you send on a donation form. On a live form, a change donors would see waits for your yes.",
		errors: [
			"Nothing is saved if the form changed since it was read. Read it again and retry.",
			"Nothing is saved on a live form until you confirm a change donors would see.",
		],
	},
	get_results: { class: "Read", effects: "None." },
	list_donations: { class: "Read", effects: "None." },
	list_donors: { class: "Read", effects: "None." },
	get_donor: { class: "Read", effects: "None." },
	list_recurring_gifts: { class: "Read", effects: "None." },
	record_donation: {
		class: "Write",
		effects:
			"Records a gift already received in cash or by check, so it counts in totals and the donor's history. It moves no money. The same details again record nothing new.",
	},
	create_photo_upload_link: {
		class: "Sensitive write",
		effects:
			"Makes a short-lived, single-use link to add a photo. Nothing changes until you upload a photo there. The photo then becomes the cover, goes beside it, or replaces one, and on a live campaign donors see it right away.",
		errors: [ENDED],
	},
};

const TOOL_ROWS = TOOL_CLASSES.flatMap((toolClass) =>
	ACTIONS.filter((spec) => TOOL_DOCS[spec.tool].class === toolClass).map(
		(spec) => ({ tool: spec.tool, ...TOOL_DOCS[spec.tool] }),
	),
);

export function DocsPage() {
	return (
		<Page
			heading="Documentation"
			title="Documentation: Better Giving Connector"
		>
			<img
				class="mark"
				src="/icon.svg"
				width={64}
				height={64}
				alt="Better Giving logo"
			/>
			<p>
				The Better Giving Connector lets a nonprofit manage its Better Giving
				account from your AI assistant. You sign in at better.giving and press
				Allow.
			</p>

			<h2>Demo</h2>
			<p>
				A short recording of an MCP test client: connecting a Better Giving
				account, then listing campaigns, reading fundraising results, creating a
				draft campaign, recording a cash gift, and listing donors. It also shows
				three requests the connector refuses.
			</p>
			<p>
				<a href="/demo.mp4">Demo recording</a>
			</p>
			<video controls preload="metadata" src="/demo.mp4" width={640}>
				<track
					default
					kind="captions"
					src="/demo.vtt"
					srcLang="en"
					label="English"
				/>
				<a href="/demo.mp4">Demo recording</a>
			</video>

			<h2>Address</h2>
			<p>
				Server URL:{" "}
				<a href="https://app.connect.better.giving/mcp">
					https://app.connect.better.giving/mcp
				</a>
			</p>

			<h2>Before you connect</h2>
			<p>You need both of these:</p>
			<ul>
				<li>A Better Giving account you sign in to at better.giving.</li>
				<li>Permission to manage that account.</li>
			</ul>

			<h2>Connect</h2>
			<ol>
				<li>
					In your AI assistant, add the connector at the server URL above.
				</li>
				<li>Press Connect. better.giving opens.</li>
				<li>Sign in to your Better Giving account and press Allow.</li>
				<li>You return to your AI assistant, connected to that one account.</li>
			</ol>

			<h2>What it can do</h2>
			<p>
				Your AI assistant sees only the tools your Better Giving account
				supports. Some aren't available on every account yet.
			</p>

			<h3>Available now</h3>
			<ul>
				<li>
					List and read campaigns and their content, and create a draft
					campaign. Donors cannot see a draft until it is published. For the
					amount raised, use fundraising results.
				</li>
				<li>
					Edit a campaign page's title, story, and cover photo, and change its
					goal or end date.
				</li>
				<li>
					Publish or end a campaign. These change what donors see. Your AI
					assistant says what will change and waits for your explicit yes. The
					first time a campaign is published, it asks where the gifts go: a
					program, or the general fund. An ended campaign stays ended.
				</li>
				<li>
					Create and edit donation forms, including the donation page's form and
					each campaign's form. On a live form, a change donors would see waits
					for your yes.
				</li>
				<li>
					Make a short-lived, single-use link so you can add a campaign's cover
					photo from your phone. The connector does not upload the file itself.
				</li>
				<li>
					Read the main donation page, donation forms, donors, gifts, monthly
					gifts, and fundraising results. Monthly gifts cannot be changed from
					here.
				</li>
			</ul>

			<h3>Coming to more accounts</h3>
			<ul>
				<li>
					Edit a campaign page's photos beside the cover, gift tiers, and
					questions, and the donation page's heading, or put the donation page
					back to its default content. The site arranges each page from its
					content, so your AI assistant does not set the design. Resetting
					discards what is there now. Your AI assistant waits for your explicit
					yes before it resets the page.
				</li>
				<li>
					Change a campaign's time zone, or the message shown when it is shared.
				</li>
				<li>
					Record a donation already received in cash or by check. It is not tied
					to a campaign. This writes a record. It moves no money, charges no
					card, and issues no refund. The same details again match the earlier
					gift and record nothing new. Add a distinguishing note to record a
					second gift with the same details.
				</li>
			</ul>

			<h2>Example prompts</h2>
			<p>Once connected, type things like these to your AI assistant:</p>
			<ul>
				<li>Show me my published campaigns.</li>
				<li>How much have we raised this month?</li>
				<li>Create a draft campaign called Spring Food Drive.</li>
				<li>Show me the gifts we received last week.</li>
				<li>List our donors and how much each has given.</li>
			</ul>

			<h2>What it cannot do</h2>
			<p>
				It cannot charge a card, refund a gift, or pay out funds. It acts only
				on the account you connected. It does not accept or return the
				connection key.
			</p>

			<h2>Tool reference</h2>
			<p>
				Every tool the connector can offer. Your AI assistant sees only those
				your account supports, and which errors a tool returns can differ by
				account.
			</p>
			<ul>
				<li>Read: changes nothing.</li>
				<li>
					Write: changes your account, but donors see nothing until you publish
					it, or it waits for your yes.
				</li>
				<li>
					Sensitive write: changes what donors see. Before it publishes, ends,
					or resets anything, your AI assistant waits for your explicit yes.
				</li>
			</ul>
			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th scope="col">Tool</th>
							<th scope="col">Class</th>
							<th scope="col">Side effects</th>
							<th scope="col">Errors</th>
						</tr>
					</thead>
					<tbody>
						{TOOL_ROWS.map((row) => (
							<tr>
								<td>
									<code>{row.tool}</code>
								</td>
								<td>{row.class}</td>
								<td>{row.effects}</td>
								<td>
									{row.errors ? (
										<ul>
											{row.errors.map((error) => (
												<li>{error}</li>
											))}
										</ul>
									) : (
										"Only the errors any tool can return, below."
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			<h3>Errors any tool can return</h3>
			<ul>
				<li>
					The account no longer accepts the connection, or its site moved.
					Connect again.
				</li>
				<li>Not available on this account yet. The other tools still work.</li>
				<li>
					The site didn't answer. Try again in a moment. If it was a change, it
					may have gone through, so your AI assistant checks before trying
					again.
				</li>
				<li>
					The account refused the request, for example an id that doesn't exist.
					The answer says why.
				</li>
				<li>
					Something went wrong on Better Giving's side. Try again in a moment.
					If it was a change, it may have gone through, so your AI assistant
					checks before trying again.
				</li>
			</ul>
			<p>
				Each signed-in connection can make about 120 requests per minute. Past
				that, the account answers with HTTP 429 and the body{" "}
				<code>{'{"code":"rate_limited","status":429}'}</code>, with no
				Retry-After header. The connector passes that answer through without
				retrying, so your AI assistant should wait a minute before trying again.
			</p>

			<h2>Troubleshooting</h2>
			<ul>
				<li>
					If the page says the connection timed out or didn't finish, go back to
					your AI assistant and press Connect again.
				</li>
				<li>
					If the page says better.giving didn't answer or can't connect right
					now, wait a moment and press Connect again.
				</li>
				<li>
					If a tool tells you to reconnect, the account refused the key or
					moved. Connect again.
				</li>
			</ul>
			<p>
				Still stuck? See <a href="/support">Support</a>.
			</p>

			<h2>Disconnect</h2>
			<p>
				Disconnect the connector in your AI assistant. That deletes the
				connection stored here and asks that account to revoke the key. If a
				tool says the account has moved or no longer accepts the connection,
				connect again.
			</p>

			<h2>More</h2>
			<ul>
				<li>
					<a href="/support">Support</a>
				</li>
				<li>
					<a href="/privacy">Privacy policy</a>
				</li>
				<li>
					<a href="/terms">Terms of service</a>
				</li>
				<li>
					<a href="https://better.giving">better.giving</a>
				</li>
			</ul>
		</Page>
	);
}
