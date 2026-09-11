# ctreg-mcp-http 를 Fly.io 에 띄우는 이미지 — **저장소 소스에서 빌드한다.**
#
# 처음(0.3~0.11.3)에는 npm 에서 고정 버전을 받았다 — 컨테이너가 도는 코드가 `npm i -g` 사용자와
# 같은 벌이 되게 하려고. 그러나 웹페이지 한 줄을 고칠 때마다 버전 올리기·publish·2FA 를 거쳐야
# 했다(사용자: "웹앱 부분 고치는데요 npm publish 가 필요한가요?" 2026-09-11). 서버는 서버의
# 코드로, npm 은 CLI·플러그인 사용자의 채널로 가른다. 무엇이 올라갔는지는 `CTREG_BUILD` (git
# 커밋)가 말한다 — fly.toml 이 `fly deploy` 때 채운다.
#
# 빌드 컨텍스트는 저장소 루트다: `fly deploy --config deploy/fly/fly.toml --dockerfile deploy/fly/Dockerfile`
# 을 저장소 루트에서 부른다. `.dockerignore` 가 node_modules·dist·.git 을 뺀다.

FROM node:22-slim AS build
WORKDIR /src
# bun.lock 이 이 저장소의 잠금 파일이다 — npm 의 lock 은 없다. bun 으로 설치하고 tsc 로 빌드한다.
RUN npm i -g bun@1
COPY package.json bun.lock tsconfig.json ./
RUN bun install --frozen-lockfile
COPY src ./src
COPY web ./web
COPY skills ./skills
RUN npm run build
# 실행에 필요한 것만 남긴다 — devDependencies 를 뺀다.
RUN rm -rf node_modules && bun install --frozen-lockfile --production

FROM node:22-slim
WORKDIR /app
COPY --from=build /src/package.json ./
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/dist ./dist
COPY --from=build /src/web ./web
# 에이전트의 지침 — 플러그인 SKILL.md 를 런타임에 읽는다. 빠뜨리면 /api/agent 가 첫 호출에서 죽는다(2026-09-11 에 겪었다).
COPY --from=build /src/skills ./skills

ARG CTREG_BUILD=unknown
ENV CTREG_BUILD=$CTREG_BUILD
# 캐시·요청률 버킷·호출 통계가 전부 여기 산다. fly.toml 이 볼륨을 이 자리에 붙인다.
ENV CTREG_CACHE_DIR=/data
ENV CTREG_MCP_HOST=0.0.0.0
ENV CTREG_MCP_PORT=8080
EXPOSE 8080

CMD ["node", "dist/mcp/http.js"]
