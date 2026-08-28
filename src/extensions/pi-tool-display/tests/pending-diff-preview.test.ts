import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildPendingEditPreviewData,
  buildPendingWritePreviewData,
} from "../src/pending-diff-preview.ts";

function withTempWorkspace(name: string, run: (workspace: string) => void): void {
  const workspace = mkdtempSync(join(tmpdir(), name));
  try {
    run(workspace);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

test("pending write preview compares existing safe workspace files", () => {
  withTempWorkspace("pi-tool-display-write-preview-", (workspace) => {
    writeFileSync(join(workspace, "sample.txt"), "before\n", "utf8");

    const preview = buildPendingWritePreviewData(
      { path: "sample.txt", content: "after\n" },
      workspace,
    );

    assert.equal(preview?.fileExistedBeforeWrite, true);
    assert.equal(preview?.previousContent, "before\n");
    assert.equal(preview?.nextContent, "after\n");
    assert.equal(preview?.notice, undefined);
  });
});

test("pending preview skips direct reads outside the workspace", () => {
  withTempWorkspace("pi-tool-display-boundary-", (workspace) => {
    const outside = mkdtempSync(join(tmpdir(), "pi-tool-display-outside-"));
    try {
      const outsideFile = join(outside, "secret.txt");
      writeFileSync(outsideFile, "secret\n", "utf8");

      const editPreview = buildPendingEditPreviewData(
        { path: outsideFile, oldText: "secret", newText: "safe" },
        workspace,
      );
      const writePreview = buildPendingWritePreviewData(
        { path: outsideFile, content: "replacement\n" },
        workspace,
      );

      assert.equal(editPreview?.previousContent, undefined);
      assert.equal(editPreview?.nextContent, undefined);
      assert.match(editPreview?.notice ?? "", /outside the current workspace/);
      assert.equal(writePreview?.previousContent, undefined);
      assert.equal(writePreview?.nextContent, "replacement\n");
      assert.match(writePreview?.notice ?? "", /outside the current workspace/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test("pending preview skips files over the read-size limit", () => {
  withTempWorkspace("pi-tool-display-large-preview-", (workspace) => {
    mkdirSync(join(workspace, "nested"));
    const nestedFile = join(workspace, "nested", "large.txt");
    writeFileSync(nestedFile, "x".repeat(1_000_001), "utf8");

    const preview = buildPendingEditPreviewData(
      { path: "nested/large.txt", oldText: "x", newText: "y" },
      workspace,
    );

    assert.equal(preview?.previousContent, undefined);
    assert.equal(preview?.nextContent, undefined);
    assert.match(preview?.notice ?? "", /preview read limit/);
  });
});
