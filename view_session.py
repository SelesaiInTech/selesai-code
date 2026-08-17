#!/usr/bin/env python3
"""Render a Selesai session.jsonl file as a styled HTML page."""
import html
import json
import sys
from datetime import datetime


def render_text(text: str) -> str:
    return html.escape(text).replace("\n", "<br>")


def render_content(content) -> str:
    if isinstance(content, str):
        return render_text(content)
    parts = []
    for block in content or []:
        if block.get("type") == "text":
            parts.append(render_text(block.get("text", "")))
        elif block.get("type") == "thinking":
            parts.append(f'<div class="thinking">{render_text(block.get("thinking", ""))}</div>')
        elif block.get("type") == "toolCall":
            name = html.escape(block.get("name", "?"))
            args = json.dumps(block.get("arguments") or block.get("input") or {}, indent=2)
            parts.append(
                f'<div class="toolcall"><b>tool call: {name}</b><pre>{html.escape(args)}</pre></div>'
            )
        else:
            parts.append(f'<pre class="raw">{render_text(json.dumps(block, indent=2))}</pre>')
    return "\n".join(parts)


def build_html(path: str) -> str:
    rows = []
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        try:
            d = json.loads(line)
        except json.JSONDecodeError:
            continue

        ts = d.get("timestamp", "")
        try:
            ts = datetime.fromisoformat(ts.replace("Z", "+00:00")).strftime("%H:%M:%S")
        except ValueError:
            pass

        if d.get("type") == "message":
            role = d["message"].get("role", "?")
            rows.append(f"""
<div class="msg {role}">
  <div class="meta"><span class="role">{role}</span><span class="ts">{ts}</span></div>
  <div class="body">{render_content(d["message"].get("content"))}</div>
</div>""")
        elif d.get("type") == "toolResult":
            text = d.get("content")
            if isinstance(text, list):
                text = "\n".join(c.get("text", "") for c in text)
            rows.append(f"""
<div class="msg toolresult">
  <div class="meta"><span class="role">tool result</span><span class="ts">{ts}</span></div>
  <div class="body"><pre>{render_text(str(text))}</pre></div>
</div>""")
        else:
            extra = {k: v for k, v in d.items()
                     if k not in ("type", "id", "parentId", "timestamp", "version")}
            if extra:
                rows.append(f"""
<div class="msg event">
  <div class="meta"><span class="role">{html.escape(str(d.get("type")))}</span><span class="ts">{ts}</span></div>
  <div class="body"><pre>{html.escape(json.dumps(extra, indent=2))}</pre></div>
</div>""")

    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>{html.escape(path)}</title>
<style>
body {{ font-family: -apple-system, Segoe UI, sans-serif; margin: 0; background: #f6f7f9; }}
header {{ background: #1f2937; color: #fff; padding: 12px 20px; font-size: 13px; word-break: break-all; }}
main {{ max-width: 900px; margin: 0 auto; padding: 16px; }}
.msg {{ background: #fff; border-radius: 8px; margin: 10px 0; padding: 10px 14px;
        box-shadow: 0 1px 2px rgba(0,0,0,.06); border-left: 3px solid #d1d5db; }}
.msg.user {{ border-left-color: #2563eb; }}
.msg.assistant {{ border-left-color: #059669; }}
.msg.toolresult {{ border-left-color: #d97706; background: #fffbeb; }}
.msg.event {{ border-left-color: #9ca3af; background: #f3f4f6; }}
.meta {{ display: flex; justify-content: space-between; margin-bottom: 6px; }}
.role {{ font-weight: 600; font-size: 12px; text-transform: uppercase; color: #6b7280; }}
.ts {{ font-size: 11px; color: #9ca3af; }}
.body {{ font-size: 14px; line-height: 1.5; }}
pre {{ background: #f3f4f6; padding: 8px; border-radius: 6px; overflow-x: auto;
      white-space: pre-wrap; word-break: break-word; font-size: 12px; }}
.thinking {{ color: #6b7280; font-style: italic; border-left: 3px solid #e5e7eb;
             padding-left: 10px; margin: 6px 0; font-size: 13px; }}
.toolcall {{ border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px; margin: 6px 0; }}
.toolcall b {{ font-size: 13px; }}
</style></head>
<body><header>{html.escape(path)}</header><main>
{''.join(rows) or '<p style="color:#6b7280">No messages found.</p>'}
</main></body></html>"""


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else (
        "/Users/andrewanggada/.selesai/agent/sessions/"
        "--Users-andrewanggada-Documents-workdir-js_proj-selesai--/"
        "2026-08-17T15-29-39-457Z_01a01057-b881-7429-b541-40e30c41795c/"
        "e83a7d83/run-0/session.jsonl"
    )
    out = path.rsplit(".", 1)[0] + ".html"
    open(out, "w", encoding="utf-8").write(build_html(path))
    print(f"Wrote {out}")
