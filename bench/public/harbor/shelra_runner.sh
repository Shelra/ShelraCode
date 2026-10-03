#!/usr/bin/env bash
# Runs ShelraCode headless on one benchmark task inside a Harbor sandbox and enforces the benchmark's limits.
#
# The same limits apply to every harness in bench/public: at most SHELRA_STEP_LIMIT model steps (counted from the
# `step_finish` events of `--format json`) and SHELRA_TIME_LIMIT_SEC of wall-clock time; then SIGTERM, and SIGKILL
# after SHELRA_KILL_GRACE_SEC. The work on disk is kept either way: the verifier tests the working tree.
#
# Writes to SHELRA_LOG_DIR (default /logs/agent, which Harbor copies back to the host):
#   shelra.jsonl        the headless JSONL event stream (stdout)
#   shelra.stderr.txt   stderr
#   runner.json         how the run ended: exit code, stop reason (exit | step_limit | time_limit), steps, seconds
#
# Never prints the environment: OPENROUTER_API_KEY reaches ShelraCode through its environment only.
set -u

: "${SHELRA_BIN:=/installed-agent/shelra}"
: "${SHELRA_INSTRUCTION_FILE:=/installed-agent/instruction.md}"
: "${SHELRA_LOG_DIR:=/logs/agent}"
: "${SHELRA_STEP_LIMIT:=50}"
: "${SHELRA_TIME_LIMIT_SEC:=2910}"
: "${SHELRA_KILL_GRACE_SEC:=30}"
: "${SHELRA_MODEL_POLICY:=free}"

if [ -z "${SHELRA_MODEL:-}" ]; then
  echo "shelra_runner: SHELRA_MODEL is not set" >&2
  exit 2
fi

repo="${SHELRA_REPO_DIR:-}"
if [ -z "$repo" ]; then
  repo=$(git -C /app rev-parse --show-toplevel 2>/dev/null || git -C /testbed rev-parse --show-toplevel 2>/dev/null || echo /app)
fi
mkdir -p "$SHELRA_LOG_DIR"
out="$SHELRA_LOG_DIR/shelra.jsonl"
err="$SHELRA_LOG_DIR/shelra.stderr.txt"
: >"$out"
: >"$err"

cd "$repo" || exit 2
prompt=$(cat "$SHELRA_INSTRUCTION_FILE")
start=$(date +%s)

# Its own session (process group) when setsid exists, so a stop also ends the servers and tests it started.
launcher=""
if command -v setsid >/dev/null 2>&1; then
  launcher="setsid"
fi

signal_tree() {
  # $1: signal name. The whole process group when it has one, else the process alone.
  if [ -n "$launcher" ]; then
    kill "-$1" -- "-$pid" 2>/dev/null || kill "-$1" "$pid" 2>/dev/null
  else
    kill "-$1" "$pid" 2>/dev/null
  fi
}

count_steps() {
  local n
  n=$(grep -c '"type":"step_finish"' "$out" 2>/dev/null)
  echo "${n:-0}"
}

# stdout goes through a FIFO: tee keeps the whole stream, and the step cap acts on each step_finish line as it
# arrives (at most the request already in flight when the cap is reached is lost, never a whole extra step).
fifo="$SHELRA_LOG_DIR/.shelra-stdout.fifo"
flag="$SHELRA_LOG_DIR/.step-limit-reached"
rm -f "$fifo" "$flag"
mkfifo "$fifo"

$launcher "$SHELRA_BIN" \
  --prompt "$prompt" \
  --format json \
  --model "$SHELRA_MODEL" \
  --model-policy "$SHELRA_MODEL_POLICY" \
  --max-cost 0 \
  --max-tool-rounds "$SHELRA_STEP_LIMIT" \
  --no-sandbox \
  --directory "$repo" \
  >"$fifo" 2>"$err" </dev/null &
pid=$!

{
  tee "$out" <"$fifo" | grep --line-buffered -F '"type":"step_finish"' | {
    n=0
    while IFS= read -r _; do
      n=$((n + 1))
      if [ "$n" -ge "$SHELRA_STEP_LIMIT" ]; then
        : >"$flag"
        signal_tree TERM
        break
      fi
    done
    cat >/dev/null # keep draining so tee never blocks
  }
} &
reader=$!

stop_reason="exit"
while kill -0 "$pid" 2>/dev/null; do
  if [ -e "$flag" ]; then
    stop_reason="step_limit"
    break
  fi
  if [ $(($(date +%s) - start)) -ge "$SHELRA_TIME_LIMIT_SEC" ]; then
    stop_reason="time_limit"
    signal_tree TERM
    break
  fi
  sleep 1
done
if [ "$stop_reason" = "exit" ] && [ -e "$flag" ]; then
  stop_reason="step_limit"
fi

if [ "$stop_reason" != "exit" ]; then
  waited=0
  while kill -0 "$pid" 2>/dev/null && [ "$waited" -lt "$SHELRA_KILL_GRACE_SEC" ]; do
    sleep 1
    waited=$((waited + 1))
  done
  signal_tree KILL
fi

wait "$pid" 2>/dev/null
exit_code=$?
# The reader ends when the stream closes; a child that kept stdout open must not hold the run.
(sleep 10 && kill "$reader" 2>/dev/null) &
watchdog=$!
wait "$reader" 2>/dev/null
kill "$watchdog" 2>/dev/null
rm -f "$fifo" "$flag"
elapsed=$(($(date +%s) - start))
steps=$(count_steps)

printf '{"exit_code": %s, "stop_reason": "%s", "steps": %s, "elapsed_sec": %s, "step_limit": %s, "time_limit_sec": %s}\n' \
  "$exit_code" "$stop_reason" "$steps" "$elapsed" "$SHELRA_STEP_LIMIT" "$SHELRA_TIME_LIMIT_SEC" >"$SHELRA_LOG_DIR/runner.json"
echo "shelra_runner: stop_reason=$stop_reason exit_code=$exit_code steps=$steps elapsed_sec=$elapsed"
exit 0
