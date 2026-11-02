import { useState } from "hono/jsx/dom";
import { useSession } from "./widget";

/**
 * A piece of widget state that survives a re-render: it lives in the host's
 * widget state (ChatGPT keeps it across renders) under `key`, and in memory
 * where the host keeps none. `valid` guards a stored value of the wrong shape.
 */
export function useWidgetState<T>(
	key: string,
	initial: T,
	valid: (value: unknown) => value is T,
): [T, (next: T) => void] {
	const { host } = useSession();
	const [value, setValue] = useState<T>(() => {
		const stored = host.getState<Record<string, unknown>>();
		const found =
			stored && typeof stored === "object" ? stored[key] : undefined;
		return valid(found) ? found : initial;
	});
	return [
		value,
		(next) => {
			setValue(next);
			const stored = host.getState<Record<string, unknown>>();
			host.setState({
				...(stored && typeof stored === "object" ? stored : {}),
				[key]: next,
			});
		},
	];
}
