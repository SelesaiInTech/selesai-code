#!/usr/bin/env bash
# scripts/upstream.sh — sync Selesai with upstream pi-coding-agent
#
# Selesai is a flatten of earendil-works/pi :: packages/coding-agent/
# So local root  <->  upstream subtree packages/coding-agent/
#
# Usage:
#   ./scripts/upstream.sh sync                 # fetch/refresh upstream cache
#   ./scripts/upstream.sh compare [--ref X]    # diff local vs upstream subtree
#   ./scripts/upstream.sh log [--ref X] [N]    # last N upstream commits touching the pkg
#   ./scripts/upstream.sh pick <sha>           # apply one upstream commit here (path-rewritten)
#   ./scripts/upstream.sh patch <sha>          # emit rewritten .patch to stdout (review before pick)
#
# --ref defaults to the pi dep version pinned in package.json (e.g. v0.80.2),
# or `main` if unpinned/unresolvable. Pass --ref main|<tag>|<sha> to override.
#
# Cache lives in .upstream-cache/ (gitignored). Remove it to force a clean clone.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="$REPO_ROOT/.upstream-cache/pi"
UPSTREAM_URL="https://github.com/earendil-works/pi.git"
SUBPKG="packages/coding-agent"

# ---- helpers --------------------------------------------------------------

die() { echo "error: $*" >&2; exit 1; }

resolve_ref() {
  local explicit=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --ref) explicit="$2"; shift 2;;
      *) shift;;
    esac
  done
  if [ -n "$explicit" ]; then echo "$explicit"; return; fi
  # pin to the pi dep version in package.json -> tag v<x.y.z>
  local ver
  ver=$(node -e "
    const fs=require('fs');
    try{const p=JSON.parse(fs.readFileSync('$REPO_ROOT/package.json','utf8'));
    const dep=(p.dependencies&&p.dependencies['@earendil-works/pi-ai'])||'';
    const m=dep.match(/(\d+\.\d+\.\d+)/);process.stdout.write(m?m[1]:'');}catch(e){}
  ")
  if [ -n "$ver" ]; then echo "v$ver"; else echo "main"; fi
}

ensure_cache() {
  if [ ! -d "$CACHE/.git" ]; then
    echo "=> cloning upstream monorepo (shallow)…"
    mkdir -p "$(dirname "$CACHE")"
    git clone --depth 1 --no-single-branch --filter=blob:none \
      --sparse "$UPSTREAM_URL" "$CACHE"
    git -C "$CACHE" sparse-checkout set "$SUBPKG"
  fi
}

checkout_ref() {
  local ref="$1"
  ensure_cache
  echo "=> refreshing upstream ($ref)…"
  # Try the ref directly; fall back to fetching the tag explicitly.
  if ! git -C "$CACHE" checkout -q "$ref" 2>/dev/null; then
    git -C "$CACHE" fetch --depth 1 origin tag "$ref" 2>/dev/null \
      || git -C "$CACHE" fetch --depth 1 origin "$ref"
    git -C "$CACHE" checkout -q "$ref"
  fi
}

# Strip 3 path components (packages/coding-agent/) from a git diff/patch so it
# lands at our root. Strips both a/ and b/ prefixes plus the subtree dir.
rewrite_patch() {
  # only rewrite the diff control lines that name files; leave hunk bodies alone.
  awk '
    /^diff --git /        { sub(/a\/packages\/coding-agent\//,"a/"); sub(/b\/packages\/coding-agent\//,"b/"); print; next }
    /^[-][-][-] /         { sub(/^a\/packages\/coding-agent\//,"a/"); print; next }
    /^[+][+][+] /         { sub(/^b\/packages\/coding-agent\//,"b/"); print; next }
    /^rename (from|to) / { sub(/packages\/coding-agent\//,""); print; next }
    /^copy (from|to) /    { sub(/packages\/coding-agent\//,""); print; next }
    { print }
  '
}

# ---- commands -------------------------------------------------------------

cmd_sync() {
  checkout_ref "$(resolve_ref "$@")"
  echo "=> upstream ready at $CACHE ($(git -C "$CACHE" rev-parse --short HEAD))"
}

cmd_compare() {
  local ref; ref="$(resolve_ref "$@")"
  checkout_ref "$ref"
  local up="$CACHE/$SUBPKG"
  echo "=> diff: local root  vs  upstream $ref :: $SUBPKG"
  diff -rq \
    --exclude=node_modules --exclude=dist --exclude=.git \
    --exclude=.upstream-cache --exclude=.DS_Store \
    --exclude=package-lock.json \
    "$up" "$REPO_ROOT" \
    | sed "s#$up#UPSTREAM#g; s#$REPO_ROOT#LOCAL#g" \
    || true
  echo "(only in … = present on that side; differing files flagged by 'differ')"
}

cmd_log() {
  local args=("$@")
  local ref; ref="$(resolve_ref "$@")"
  # pop --ref pair so positional N survives
  local n=""
  local rest=()
  while [ ${#args[@]} -gt 0 ]; do
    case "${args[0]}" in
      --ref) shift_args=1; args=("${args[@]:2}");;
      *) rest+=("${args[0]}"); args=("${args[@]:1}");;
    esac
  done
  n="${rest[0]:-15}"
  checkout_ref "$ref"
  echo "=> last $n upstream commits touching $SUBPKG @ $ref"
  git -C "$CACHE" log "--pretty=format:%h %ad %s" --date=short -n "$n" -- "$SUBPKG"
  echo
}

cmd_patch() {
  local sha="${1:-}"; [ -n "$sha" ] || die "usage: patch <sha>"
  ensure_cache
  git -C "$CACHE" show --format=email --binary "$sha" -- "$SUBPKG" \
    | rewrite_patch
}

cmd_pick() {
  local sha="${1:-}"; [ -n "$sha" ] || die "usage: pick <sha>"
  ensure_cache
  echo "=> applying $sha (path-rewritten from $SUBPKG to root)…"
  git -C "$CACHE" show --format=email --binary "$sha" -- "$SUBPKG" \
    | rewrite_patch \
    | git -C "$REPO_ROOT" apply --index --whitespace=nowarn \
    || die "apply failed; inspect with: ./scripts/upstream.sh patch $sha"
  echo "=> staged. commit message suggestion:"
  echo "   git commit -m \"cherry-pick upstream $sha: $(git -C "$CACHE" log -1 --format=%s "$sha")\""
}

# ---- dispatch -------------------------------------------------------------

case "${1:-}" in
  sync)    shift; cmd_sync "$@";;
  compare) shift; cmd_compare "$@";;
  log)     shift; cmd_log "$@";;
  pick)    shift; cmd_pick "$@";;
  patch)   shift; cmd_patch "$@";;
  ""|-h|--help)
    sed -n '2,20p' "$0";;
  *) die "unknown command '$1'";;
esac