// A deployment's https origin, only ever produced by `parseOrigin`.
export type Origin = string & { readonly __brand: "Origin" };

/** Better Giving Platform, the one site /connect sends every operator to. */
export const PLATFORM_ORIGIN = "https://better.giving" as Origin;

const HAS_SCHEME = /^[a-z][a-z\d+.-]*:\/\//i;
// The URL parser canonicalises every IPv4 spelling (`127.1`, `2130706433`) to dotted form.
const IPV4 = /^\d+\.\d+\.\d+\.\d+$/;

// Reads a bare host or any URL on a site as the https origin of a public
// host. DNS that resolves to a private range still passes; only literals are
// refused.
export function parseOrigin(input: string): Origin | null {
	const trimmed = input.trim();
	if (trimmed === "") return null;
	let url: URL;
	try {
		url = new URL(HAS_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`);
	} catch {
		return null;
	}
	// `give.example.org.` is the same host as `give.example.org`; `localhost.` is localhost.
	if (url.hostname.endsWith(".")) url.hostname = url.hostname.slice(0, -1);
	const host = url.hostname;
	const refused =
		url.protocol !== "https:" ||
		url.port !== "" ||
		url.username !== "" ||
		url.password !== "" ||
		host.startsWith("[") ||
		IPV4.test(host) ||
		!host.includes(".") ||
		host.endsWith(".") ||
		host.endsWith(".localhost");
	return refused ? null : (url.origin as Origin);
}
