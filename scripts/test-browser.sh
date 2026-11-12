#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Owns only the disposable octave-demo-e2e Compose project and volumes.
export PORT="${TEST_PORT:-18088}"
export DEMO_PASSWORD=campus-demo
export REQUIRE_REVIEW=false # Legacy direct-publication regression journeys; mandatory review has separate coverage.
project="octave-demo-e2e"
trap 'docker compose -p "$project" --profile test down -v --remove-orphans' EXIT
docker compose -p "$project" up --build -d --wait
docker compose -p "$project" --profile test run --build --rm browser-tests
