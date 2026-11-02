/** @jsxImportSource hono/jsx/dom */
import { formatDate, formatMoney } from "../../format";
import type { Money } from "../model";
import { useLocale } from "./widget";

/** `money` in the reader's locale; its currency is never converted. */
export function useMoney(): (money: Money) => string {
	const locale = useLocale();
	return (money) => formatMoney(money.amount, money.currency, locale);
}

/** An ISO date in the reader's locale. */
export function useDate(): (
	iso: string,
	options?: Intl.DateTimeFormatOptions,
) => string {
	const locale = useLocale();
	return (iso, options) => formatDate(iso, locale, options);
}

/** Like `useMoney`, but a whole amount drops its cents: $25,000, not $25,000.00. */
export function useWholeMoney(): (money: Money) => string {
	const locale = useLocale();
	return (money) =>
		formatMoney(money.amount, money.currency, locale, { dropZeroCents: true });
}

export function MoneyText(props: { value: Money }) {
	return <>{useMoney()(props.value)}</>;
}

export function DateText(props: {
	iso: string;
	options?: Intl.DateTimeFormatOptions;
}) {
	return (
		<time dateTime={props.iso}>{useDate()(props.iso, props.options)}</time>
	);
}
