// A spreadsheet runs a cell that starts with one of these as a formula, and a
// donor chooses their own name and note.
const FORMULA_START = /^[=+\-@\t\r]/;

/** One CSV cell: a formula-looking value gets a leading quote, and a value with a comma, quote or line break is quoted. */
export function csvCell(value: string): string {
	const safe = FORMULA_START.test(value) ? `'${value}` : value;
	return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** A CSV file's text: a header row and the rows, CRLF-separated, with the byte-order mark that has Excel read UTF-8. */
export function csvText(header: string[], rows: string[][]): string {
	return `﻿${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
