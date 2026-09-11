#!/bin/sh
# 저장소 루트에서 부른다. 소스에서 빌드하며 git 커밋을 CTREG_BUILD 로 실어 무엇이 올라갔는지 남긴다.
set -eu
cd "$(dirname "$0")/../.."
BUILD="$(git rev-parse --short HEAD)$(git diff --quiet || echo '-dirty')"
exec fly deploy --app ctreg-mcp --config deploy/fly/fly.toml --dockerfile deploy/fly/Dockerfile \
  --remote-only --ha=false --build-arg "CTREG_BUILD=$BUILD" "$@"
