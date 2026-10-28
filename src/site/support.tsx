import { Page } from "./page";

export function SupportPage() {
	return (
		<Page heading="Support" title="Support: Better Giving Connector">
			<p>Contact: support@better.giving.</p>
			<p>
				To ask for access to or deletion of connector data, use the address
				above. The <a href="/privacy">privacy policy</a> describes what the
				connector stores. Response time: 30 days.
			</p>
			<p>Report a vulnerability to security@better.giving.</p>

			<h2>Connecting</h2>
			<ol>
				<li>
					Add the connector in your AI assistant at{" "}
					<a href="https://app.connect.better.giving/mcp">
						https://app.connect.better.giving/mcp
					</a>
					.
				</li>
				<li>Press Connect. better.giving opens.</li>
				<li>Sign in to your Better Giving account and press Allow.</li>
			</ol>
			<p>
				If the page says the connection request timed out, or that connecting
				didn't finish, go back to your AI assistant and press Connect again. If
				it says better.giving didn't answer or can't connect right now, wait a
				moment and press Connect again.
			</p>

			<h2>Disconnect</h2>
			<p>
				Disconnect Better Giving in your AI assistant's connector settings. That
				deletes the connection stored here and asks that account to revoke the
				key. If a tool tells you to reconnect, the account refused the key or
				moved: connect again.
			</p>

			<h2>Money</h2>
			<p>
				The connector does not move money. It cannot refund a donation, charge a
				card, or pay out funds. Recording a donation only writes down a gift
				that was already received in cash or by check. The same details again
				match the earlier gift and record nothing new.
			</p>

			<h2>More</h2>
			<ul>
				<li>
					<a href="/docs">Documentation</a>
				</li>
				<li>
					<a href="/privacy">Privacy policy</a>
				</li>
				<li>
					<a href="/terms">Terms of service</a>
				</li>
			</ul>
		</Page>
	);
}
