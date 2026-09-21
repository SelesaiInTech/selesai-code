#!/usr/bin/env bash
# PRD 6 delta inventory: one check per fork-owned behaviour.
#
# Every row is a Selesai delta that lives inside an upstream-origin file, plus the
# observable token that proves it survived an upstream sync. Run this after any
# upstream port: a FAIL here means an upstream rewrite silently dropped fork
# behaviour that still compiles. See selesai-in-doc/reapply.md for the same
# inventory in prose, and GATES.pi-0861-sync.md for the gate that runs it.
#
# Usage: bash scripts/verify-deltas.sh          # from the repository root
set -uo pipefail
cd "$(dirname "$0")/.."
pass=0; fail=0
chk() { # chk <label> <file> <pattern>
  if grep -qE "$3" "$2" 2>/dev/null; then printf "PASS  %-42s %s\n" "$1" "$2"; pass=$((pass+1))
  else printf "FAIL  %-42s %s\n" "$1" "$2"; fail=$((fail+1)); fi
}
chk_file() { if [ -e "$2" ]; then printf "PASS  %-42s %s\n" "$1" "$2"; pass=$((pass+1)); else printf "FAIL  %-42s %s\n" "$1" "$2"; fail=$((fail+1)); fi }
echo "--- prompt content ---"
chk "fork identity preamble"          src/core/system-prompt.ts "SelesaiCode fork of Pi"
chk "fork docs pointer section"       src/core/system-prompt.ts "buildForkDocsSection"
chk "delegation-routing guideline"    src/core/system-prompt.ts "DELEGATION_ROUTING_GUIDELINE"
chk "skill section (read-tool aware)" src/core/system-prompt.ts "formatSkillsForPrompt"
chk "agent section (read-gated)"      src/core/system-prompt.ts "formatAgentsForPrompt"
chk "shell-aware file guidance"       src/core/system-prompt.ts "hasPowerShell"
echo "--- session runtime ---"
chk "auto handoff trigger"            src/core/agent-session.ts "_checkAutoHandoff"
chk "auto handoff goal"               src/core/handoff.ts "AUTO_HANDOFF_GOAL"
chk "length continuation (capped)"    src/core/agent-session.ts "MAX_LENGTH_CONTINUATIONS"
chk "length continuation message"     src/core/agent-session.ts "LENGTH_CONTINUATION_MESSAGE"
chk "vision caption relay"            src/core/agent-session.ts "_captionImagesForCurrentModel"
chk "caption context tail"            src/core/agent-session.ts "_recentConversationTail"
chk "compaction-failure event"        src/core/agent-session.ts "_emitSessionCompactFailed"
chk "skill block parsing"             src/core/agent-session.ts "parseSkillBlocks"
chk "thinking-tag normalization"      src/utils/thinking-tags.ts "normalizeAssistantThinkingTags"
echo "--- settings ---"
chk "auto-handoff settings"           src/core/settings-manager.ts "getAutoHandoffEnabled"
chk "vision caption settings"         src/core/settings-manager.ts "getImageCaptionModel"
chk "caption context budget"          src/core/settings-manager.ts "getImageCaptionContextTokens"
chk "capability overrides"            src/core/settings-manager.ts "getFullscreenCopyOnSelect"
chk "tui mode default fullscreen"     src/core/settings-manager.ts 'selesai defaults|Selesai defaults'
echo "--- extension surface ---"
chk "capability gateway"              src/extensions/capability-gateway/index.ts "capability"
chk "skill toggle (resolved skills)"  src/core/extensions/types.ts "getResolvedSkills"
chk "tool discovery metadata"         src/core/extensions/types.ts "discovery\?"
chk "multiselect UI hook"             src/core/extensions/types.ts "multiselect"
chk "extension host precedence"       src/core/settings-manager.ts "extensionHost"
echo "--- module resolution ---"
chk "fork alias in virtual modules"   src/core/extensions/virtual-modules.ts '"@selesai/code"'
chk "fork alias in jiti aliases"      src/core/extensions/loader.ts '"@selesai/code"'
echo "--- provider / model ---"
chk "TokenIn provider"                src/extensions/tokenin-onboarding.ts "tokenin"
chk "llama.cpp built-in extension"    src/core/built-in-extensions.ts "llama"
chk "fork default catalogue"          src/defaults/models.json ""
echo "--- terminal ---"
chk_file "startup box component"      src/modes/interactive/components/startup-box.ts
chk "startup box used"                src/modes/interactive/interactive-mode.ts "StartupBox"
chk "fork logo banner"                src/modes/interactive/interactive-mode.ts "SELESAI_LOGO"
chk "vision captioning indicator"     src/modes/interactive/interactive-mode.ts "ImageCaptioningStatusIndicator"
chk "skill toggle in settings"        src/modes/interactive/components/settings-selector.ts "SkillToggleItem"
echo "--- rpc / sdk ---"
chk "rpc fork additions"              src/modes/rpc/rpc-mode.ts "session_info_changed|steer"
chk "sdk fork tool defaults"          src/core/sdk.ts '"read", "bash", "edit", "write", "grep", "find", "ls"'
echo
echo "PASS=$pass FAIL=$fail"
[ "$fail" -eq 0 ]
