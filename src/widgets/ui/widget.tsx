/** @jsxImportSource hono/jsx/dom */
import type { Child, FC } from "hono/jsx";
import {
	createContext,
	render,
	useContext,
	useEffect,
	useState,
} from "hono/jsx/dom";
import type { z } from "zod";
import { DEFAULT_LOCALE } from "../../format";
import { connectHost, type Host } from "../host";
import { ErrorState, LoadingState } from "./states";
import "./styles.css";

type Session = { host: Host; locale: string };

const SessionContext = createContext<Session | null>(null);

/** The host and the reader's locale, inside a widget rendered by `renderWidget`. */
export function useSession(): Session {
	const session = useContext(SessionContext);
	if (!session) throw new Error("useSession outside renderWidget");
	return session;
}

/** The locale money and dates format in; en-US outside a widget. */
export function useLocale(): string {
	return useContext(SessionContext)?.locale ?? DEFAULT_LOCALE;
}

const UNREADABLE =
	"This card couldn't read what Better Giving sent. Ask again in a moment.";

function WidgetRoot<S extends z.ZodType>(props: {
	host: Host;
	schema: S;
	loading: string;
	View: FC<{ data: z.output<S> }>;
}) {
	const { host, schema, View } = props;
	const [, setVersion] = useState(0);
	useEffect(() => {
		const off = host.subscribe(() => setVersion((v) => v + 1));
		// a result or context that arrived between the first render and this
		// subscription notified no one; render again so it is read
		setVersion((v) => v + 1);
		return off;
	}, [host]);

	const { locale, touch } = host.context();
	useEffect(() => {
		document.documentElement.lang = locale;
		document.documentElement.toggleAttribute("data-touch", touch);
	}, [locale, touch]);

	const outcome = host.toolResult();
	let body: Child;
	if (!outcome) body = <LoadingState label={props.loading} />;
	else if (!outcome.ok) body = <ErrorState message={outcome.error} />;
	else {
		const parsed = schema.safeParse(outcome.data);
		body = parsed.success ? (
			<View data={parsed.data} />
		) : (
			<ErrorState message={UNREADABLE} />
		);
	}
	return (
		<SessionContext.Provider value={{ host, locale }}>
			{body}
		</SessionContext.Provider>
	);
}

/**
 * Renders `View` with the render tool's result parsed by `schema`, again on
 * every update from the host; loading and error states come for free.
 */
export function renderWidget<S extends z.ZodType>(
	root: HTMLElement,
	host: Host,
	schema: S,
	View: FC<{ data: z.output<S> }>,
	loading: string,
) {
	render(
		<WidgetRoot host={host} schema={schema} View={View} loading={loading} />,
		root,
	);
}

const NO_HOST = "This card needs a chat app to run in.";

/** A widget entry's whole body: connect to the host, then render into #root. */
export async function startWidget<S extends z.ZodType>(
	schema: S,
	View: FC<{ data: z.output<S> }>,
	loading: string,
) {
	const root = document.getElementById("root") as HTMLElement;
	let host: Host;
	try {
		host = await connectHost();
	} catch {
		render(<ErrorState message={NO_HOST} />, root);
		return;
	}
	renderWidget(root, host, schema, View, loading);
}
