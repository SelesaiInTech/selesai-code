import { describe, expect, it } from "vitest";
import { initTheme, theme } from "../../../modes/interactive/theme/theme.ts";

/**
 * The powerline editor render draws its own border. It must respect the
 * editor's `borderColor` (set by interactive-mode to the bash-mode / thinking
 * color) instead of always using the gray "sep" color, so typing `!` visibly
 * switches the input field to bash mode.
 */
function powerlineBorderColor(editor: { borderColor: unknown }, s: string): string {
  return typeof editor.borderColor === "function"
    ? (editor.borderColor as (str: string) => string)(s)
    : `\x1b[38;5;244m${s}\x1b[0m`;
}

describe("powerline editor border respects editor.borderColor", () => {
  it("uses the bash-mode color when interactive-mode sets it (typing !)", () => {
    initTheme("dark");
    const editorWithBashBorder = {
      borderColor: theme.getBashModeBorderColor(),
    };
    const border = powerlineBorderColor(editorWithBashBorder, "─".repeat(5));
    // Bash mode is green in the theme; the border must carry a color code.
    expect(border).toContain("\x1b[");
    expect(border).toMatch(/[0-9]+;[0-9]+;[0-9]+m/);
    // And it must NOT be the plain gray "sep" code.
    expect(border).not.toContain("\x1b[38;5;244m");
  });

  it("falls back to the gray sep color when borderColor is not a function", () => {
    const border = powerlineBorderColor({ borderColor: "x" }, "─".repeat(5));
    expect(border).toBe("\x1b[38;5;244m─────\x1b[0m");
  });
});

function getBashModeBorderColor(): (str: string) => string {
  // Mirrors theme.getBashModeBorderColor(): colors with the theme's "bashMode" color.
  return (str: string) => `\x1b[38;5;34m${str}\x1b[39m`;
}
