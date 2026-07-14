#!/usr/bin/env bash
# Diagnostics PreToolUse hook (Azure project-create diagnostics)
# Records a start timestamp per tool_use_id so the PostToolUse hook can compute
# per-tool-call latency. Captures NO tool arguments or output.
#
# Separate, unsigned companion to track-telemetry.sh — does not modify it.

emit_success() { printf '{"continue":true}\n'; exit 0; }

raw_input="$(cat 2>/dev/null)"
[ -z "$raw_input" ] && emit_success

# Prefer jq when available; fall back to a minimal grep-based extractor.
get_field() {
    local key="$1"
    if command -v jq >/dev/null 2>&1; then
        printf '%s' "$raw_input" | jq -r --arg k "$key" '.[$k] // empty' 2>/dev/null
    else
        printf '%s' "$raw_input" | grep -o "\"$key\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -n1 | sed -E "s/.*:[[:space:]]*\"([^\"]*)\"/\1/"
    fi
}

tool_use_id="$(get_field tool_use_id)"
[ -z "$tool_use_id" ] && tool_use_id="$(get_field toolUseId)"
[ -z "$tool_use_id" ] && emit_success

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pointer="$script_dir/../.diagnostics-context.json"
[ -f "$pointer" ] || emit_success

runtime_dir=""
if command -v jq >/dev/null 2>&1; then
    runtime_dir="$(jq -r '.runtimeDir // empty' "$pointer" 2>/dev/null)"
else
    runtime_dir="$(grep -o '"runtimeDir"[[:space:]]*:[[:space:]]*"[^"]*"' "$pointer" | head -n1 | sed -E 's/.*:[[:space:]]*"([^"]*)"/\1/')"
fi
[ -z "$runtime_dir" ] && emit_success

starts_dir="$runtime_dir/starts"
mkdir -p "$starts_dir" 2>/dev/null
safe_id="$(printf '%s' "$tool_use_id" | tr -c 'A-Za-z0-9_.-' '_')"
now_ms=$(( $(date +%s%N) / 1000000 ))
printf '%s' "$now_ms" > "$starts_dir/$safe_id" 2>/dev/null

emit_success
