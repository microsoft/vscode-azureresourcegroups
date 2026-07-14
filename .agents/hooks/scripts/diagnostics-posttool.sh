#!/usr/bin/env bash
# Diagnostics PostToolUse hook (Azure project-create diagnostics)
# Computes per-tool-call latency (paired with diagnostics-pretool.sh) and appends
# a metadata-only event tagged with the active phase to the run's local log.
# Captures ONLY: tool name, phase, latency, success. No arguments/paths/output.
#
# Separate, unsigned companion to track-telemetry.sh — does not modify it.

emit_success() { printf '{"continue":true}\n'; exit 0; }

raw_input="$(cat 2>/dev/null)"
[ -z "$raw_input" ] && emit_success

has_jq=0
command -v jq >/dev/null 2>&1 && has_jq=1

get_str() {
    local key="$1"
    if [ "$has_jq" = "1" ]; then
        printf '%s' "$raw_input" | jq -r --arg k "$key" '.[$k] // empty' 2>/dev/null
    else
        printf '%s' "$raw_input" | grep -o "\"$key\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -n1 | sed -E "s/.*:[[:space:]]*\"([^\"]*)\"/\1/"
    fi
}

tool_name="$(get_str tool_name)"
[ -z "$tool_name" ] && tool_name="$(get_str toolName)"
[ -z "$tool_name" ] && emit_success

tool_use_id="$(get_str tool_use_id)"
[ -z "$tool_use_id" ] && tool_use_id="$(get_str toolUseId)"

# Success: default true unless an obvious error signal is present.
success="true"
if [ "$has_jq" = "1" ]; then
    is_err="$(printf '%s' "$raw_input" | jq -r '.is_error // (.tool_response.error != null)' 2>/dev/null)"
    [ "$is_err" = "true" ] && success="false"
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pointer="$script_dir/../.diagnostics-context.json"
[ -f "$pointer" ] || emit_success

if [ "$has_jq" = "1" ]; then
    runtime_dir="$(jq -r '.runtimeDir // empty' "$pointer" 2>/dev/null)"
    session_id="$(jq -r '.sessionId // empty' "$pointer" 2>/dev/null)"
    phase="$(jq -r '.phase // empty' "$pointer" 2>/dev/null)"
else
    runtime_dir="$(grep -o '"runtimeDir"[[:space:]]*:[[:space:]]*"[^"]*"' "$pointer" | head -n1 | sed -E 's/.*:[[:space:]]*"([^"]*)"/\1/')"
    session_id="$(grep -o '"sessionId"[[:space:]]*:[[:space:]]*"[^"]*"' "$pointer" | head -n1 | sed -E 's/.*:[[:space:]]*"([^"]*)"/\1/')"
    phase="$(grep -o '"phase"[[:space:]]*:[[:space:]]*"[^"]*"' "$pointer" | head -n1 | sed -E 's/.*:[[:space:]]*"([^"]*)"/\1/')"
fi
{ [ -z "$runtime_dir" ] || [ -z "$session_id" ]; } && emit_success

latency_ms=-1
if [ -n "$tool_use_id" ]; then
    safe_id="$(printf '%s' "$tool_use_id" | tr -c 'A-Za-z0-9_.-' '_')"
    start_file="$runtime_dir/starts/$safe_id"
    if [ -f "$start_file" ]; then
        start_ms="$(cat "$start_file" 2>/dev/null)"
        now_ms=$(( $(date +%s%N) / 1000000 ))
        if [ -n "$start_ms" ]; then
            latency_ms=$(( now_ms - start_ms ))
            [ "$latency_ms" -lt 0 ] && latency_ms=0
        fi
        rm -f "$start_file" 2>/dev/null
    fi
fi

mkdir -p "$runtime_dir" 2>/dev/null
# Privacy-safe hash of the target path (for churn) — never the path itself.
target_hash=""
if [ "$has_jq" = "1" ]; then
    tool_path="$(printf '%s' "$raw_input" | jq -r '.tool_input.path // .tool_input.filePath // .tool_input.file_path // empty' 2>/dev/null)"
    if [ -n "$tool_path" ]; then
        if command -v sha256sum >/dev/null 2>&1; then
            target_hash="$(printf '%s' "$tool_path" | sha256sum | cut -c1-12)"
        elif command -v shasum >/dev/null 2>&1; then
            target_hash="$(printf '%s' "$tool_path" | shasum -a 256 | cut -c1-12)"
        fi
    fi
fi

# Escape backslashes and quotes in the tool name for safe JSON embedding.
esc_name="$(printf '%s' "$tool_name" | sed 's/\\/\\\\/g; s/"/\\"/g')"
esc_phase="$(printf '%s' "$phase" | sed 's/\\/\\\\/g; s/"/\\"/g')"
printf '{"name":"%s","phase":"%s","latencyMs":%s,"success":%s,"targetHash":"%s"}\n' \
    "$esc_name" "$esc_phase" "$latency_ms" "$success" "$target_hash" \
    >> "$runtime_dir/tool-events-$session_id.jsonl" 2>/dev/null

emit_success
