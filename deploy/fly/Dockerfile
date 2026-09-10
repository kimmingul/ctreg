# ctreg-mcp-http 를 Fly.io 에 띄우는 이미지.
#
# **npm 에서 받는다** — 저장소를 복사해 빌드하지 않는다. 그래야 컨테이너가 도는 코드가
# `npm i -g` 로 받는 사용자와 정확히 같은 벌이 된다. 버전을 고정하는 이유도 같다:
# `latest` 로 두면 재배포 때 무엇이 올라갔는지 모른다.
FROM node:22-slim

ARG CTREG_VERSION
RUN test -n "$CTREG_VERSION" || (echo "CTREG_VERSION 이 필요하다 — fly.toml 의 [build.args]" && exit 1)
RUN npm i -g "@kimmingul/ctreg@${CTREG_VERSION}"

# 캐시·요청률 버킷·호출 통계가 전부 여기 산다. fly.toml 이 볼륨을 이 자리에 붙인다.
ENV CTREG_CACHE_DIR=/data
ENV CTREG_MCP_HOST=0.0.0.0
ENV CTREG_MCP_PORT=8080
EXPOSE 8080

CMD ["ctreg-mcp-http"]
