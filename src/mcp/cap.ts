/**
 * The most characters one tool result may carry, text and structured result
 * together. Claude drops the app view of a result over about 150,000; this
 * leaves room for the summary and the note below.
 */
export const RESULT_CAP = 120_000;

type Body = Record<string, unknown>;

/** The list a tool's result grows with, and how to ask for fewer of its rows. */
type Growing = {
	/** Where the rows sit in the body. */
	path: readonly string[];
	noun: string;
	/** What the tool takes to narrow the read, worded for the chat. */
	narrow: string;
};

const SMALLER_PAGE =
	"Call it again with a smaller limit; it has no filter to narrow by.";

// Only the lists whose size follows the account. A tool left out has a result
// the schema bounds (the render tools) or that is whole by nature (a page's
// blocks, the catalogs).
const GROWING: Record<string, Growing> = {
	list_campaigns: {
		path: ["data"],
		noun: "campaigns",
		narrow:
			"Call it again with a status, or with a smaller limit and the same cursor.",
	},
	list_forms: { path: ["data"], noun: "donation forms", narrow: SMALLER_PAGE },
	list_donations: {
		path: ["data"],
		noun: "donations",
		narrow:
			"Call it again with a campaign_id, a from and to date, or a smaller limit and the same cursor.",
	},
	list_donors: {
		path: ["data"],
		noun: "donors",
		narrow:
			"Call it again with q to match a name or email, or with a smaller limit and the same cursor.",
	},
	list_recurring_gifts: {
		path: ["data"],
		noun: "monthly gifts",
		narrow: SMALLER_PAGE,
	},
	get_donor: {
		path: ["gifts", "data"],
		noun: "gifts",
		narrow:
			"Call it again with a smaller limit and the same cursor to read the gifts in smaller pages.",
	},
	get_results: {
		path: ["campaigns"],
		noun: "campaign totals",
		narrow:
			"The totals above are exact. Call it again with a campaign_id, or a from and to date, to read one campaign or a shorter period.",
	},
};

const isBody = (value: unknown): value is Body =>
	typeof value === "object" && value !== null && !Array.isArray(value);

function rowsAt(body: Body, path: readonly string[]): unknown[] | null {
	let at: unknown = body;
	for (const key of path) {
		if (!isBody(at)) return null;
		at = at[key];
	}
	return Array.isArray(at) ? at : null;
}

// A copy of `body` with the rows at `path` cut to `keep`, and the page's
// cursor cleared: it points past the rows left out, so it would skip them.
function withRows(body: Body, path: readonly string[], keep: number): Body {
	const [head, ...rest] = path;
	if (head === undefined) return body;
	const at = body[head];
	if (rest.length === 0) {
		const cursor = "next_cursor" in body ? { next_cursor: null } : {};
		return { ...body, [head]: (at as unknown[]).slice(0, keep), ...cursor };
	}
	return { ...body, [head]: withRows(at as Body, rest, keep) };
}

// The body is printed into the text and carried again as the structured
// result, and the lead line and summary are a few hundred characters more.
const size = (body: Body) => 2 * JSON.stringify(body).length;

/**
 * A result that would pass `RESULT_CAP`, cut to the most rows that fit, with
 * the sentence that says how many were left out and how to narrow. Null when
 * the tool's result is not one that grows or already fits. Counts and totals
 * outside the rows are untouched.
 */
export function capResult(
	tool: string,
	body: unknown,
	cap = RESULT_CAP,
): { body: Body; note: string } | null {
	const growing = GROWING[tool];
	if (growing === undefined || !isBody(body)) return null;
	const rows = rowsAt(body, growing.path);
	if (rows === null || size(body) <= cap) return null;
	let low = 0;
	let high = rows.length;
	while (low < high) {
		const mid = Math.ceil((low + high) / 2);
		if (size(withRows(body, growing.path, mid)) <= cap) low = mid;
		else high = mid - 1;
	}
	const left = rows.length - low;
	return {
		body: withRows(body, growing.path, low),
		note: `This result was too big to show whole: ${low} of ${rows.length} ${growing.noun} are shown and ${left} were left out. ${growing.narrow}`,
	};
}
