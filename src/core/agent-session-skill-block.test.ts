import { describe, expect, it } from "vitest";
import { parseSkillBlock, parseSkillBlocks } from "./agent-session.ts";

const research = '<skill name="research" location="/skills/research/SKILL.md">\nResearch instructions.\n</skill>';
const grill = '<skill name="batch-grill-me" location="/skills/batch-grill-me/SKILL.md">\nGrill instructions.\n</skill>';

describe("skill block parsing", () => {
	it("parses multiple skill blocks followed by the original prompt", () => {
		expect(parseSkillBlocks(`${research}\n\n${grill}\n\nPlan with #research and #batch-grill-me`)).toEqual({
			skills: [
				{ name: "research", location: "/skills/research/SKILL.md", content: "Research instructions.", userMessage: undefined },
				{ name: "batch-grill-me", location: "/skills/batch-grill-me/SKILL.md", content: "Grill instructions.", userMessage: undefined },
			],
			userMessage: "Plan with #research and #batch-grill-me",
		});
	});

	it("retains singular parser behavior", () => {
		expect(parseSkillBlock(`${research}\n\nDo research`)).toMatchObject({ name: "research", userMessage: "Do research" });
		expect(parseSkillBlock(`${research}\n\n${grill}`)).toBeNull();
	});
});
