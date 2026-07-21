import { describe, expect, it } from "vitest";
import { buildSearchUrl, formatSearchResponse } from "./index.ts";

describe("grep-app extension", () => {
	it("maps search filters to grep.app parameters", () => {
		const url = buildSearchUrl({
			query: "useEffect cleanup",
			page: 2,
			caseSensitive: true,
			useRegex: true,
			repo: "facebook/react",
			path: "packages/",
			language: "TypeScript",
		});

		expect(Object.fromEntries(url.searchParams)).toEqual({
			q: "useEffect cleanup",
			page: "2",
			case: "true",
			regexp: "true",
			"f.repo.pattern": "facebook/react",
			"f.path.pattern": "packages/",
			"f.lang": "TypeScript",
		});
	});

	it("turns grep.app HTML snippets into readable numbered source", () => {
		const output = formatSearchResponse(
			{
				hits: {
					total: 42,
					hits: [
						{
							repo: "owner/repo",
							branch: "main",
							path: "src/a file.ts",
							content: {
								snippet: '<table><tr data-line="7"><td><pre>const x = &lt;mark&gt;;</pre></td></tr></table>',
							},
						},
					],
				},
			},
			3,
		);

		expect(output).toContain("42 total matches; page 3");
		expect(output).toContain("L7: const x = <mark>;");
		expect(output).toContain("https://github.com/owner/repo/blob/main/src/a%20file.ts#L7");
	});
});
