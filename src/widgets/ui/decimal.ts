// Exact arithmetic on decimal-string amounts: a float would turn 0.57 * 100
// into 56.99999999999999.

const fraction = (amount: string) => amount.split(".")[1]?.length ?? 0;

/** The digits after the point the widest of `amounts` carries. */
export const scaleOf = (amounts: readonly string[]) =>
	Math.max(0, ...amounts.map(fraction));

/** `amount` as an integer count of 10^-scale units. */
export function scaled(amount: string, scale: number): bigint {
	const [whole = "0", frac = ""] = amount.split(".");
	return BigInt(whole + frac.padEnd(scale, "0"));
}

/** An integer count of 10^-scale units back as a decimal string. */
export function unscaled(units: bigint, scale: number): string {
	const sign = units < 0n ? "-" : "";
	const digits = (units < 0n ? -units : units)
		.toString()
		.padStart(scale + 1, "0");
	if (scale === 0) return sign + digits;
	return `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

/** The exact sum of `amounts`, at the widest scale among them. */
export function sumAmounts(amounts: readonly string[]): string {
	const scale = scaleOf(amounts);
	return unscaled(
		amounts.reduce((sum, a) => sum + scaled(a, scale), 0n),
		scale,
	);
}
