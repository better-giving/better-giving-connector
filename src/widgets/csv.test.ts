import { describe, expect, it } from "vitest";
import { csvCell, csvText } from "./csv";

describe("csvCell", () => {
	it.each([
		["=SUM(A1:A9)", "'=SUM(A1:A9)"],
		["+1 555 0100", "'+1 555 0100"],
		["-2+3", "'-2+3"],
		["@cmd", "'@cmd"],
		["\t=1", "'\t=1"],
		["\r=1", '"\'\r=1"'],
	])("puts a quote before %j so a spreadsheet won't run it", (value, cell) => {
		expect(csvCell(value)).toBe(cell);
	});

	it("leaves plain text and a formula character inside the text alone", () => {
		expect(csvCell("Maria Santos")).toBe("Maria Santos");
		expect(csvCell("a=b")).toBe("a=b");
		expect(csvCell("")).toBe("");
	});

	it("quotes a cell with a comma, a quote or a line break, and doubles the quotes", () => {
		expect(csvCell("Santos, Maria")).toBe('"Santos, Maria"');
		expect(csvCell('say "hi"')).toBe('"say ""hi"""');
		expect(csvCell("two\nlines")).toBe('"two\nlines"');
	});

	it("guards before quoting, so a quoted formula keeps its leading quote", () => {
		expect(csvCell('=HYPERLINK("x","y")')).toBe('"\'=HYPERLINK(""x"",""y"")"');
	});
});

describe("csvText", () => {
	it("is a BOM, a header and CRLF rows", () => {
		expect(
			csvText(
				["Name", "Note"],
				[
					["Ana", "=1+1"],
					["Bo", "ok"],
				],
			),
		).toBe("\ufeffName,Note\r\nAna,'=1+1\r\nBo,ok\r\n");
	});
});
