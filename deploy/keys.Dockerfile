# Build from the repository root: docker build -f deploy/keys.Dockerfile .
# keys.qlyphs.com: the Qlyphs Wallet served on the web (apps/keys), mainnet only.
FROM node:24-bookworm-slim AS build
RUN npm install --global pnpm@10.23.0
WORKDIR /workspace
COPY . .
# The build refuses to finish unless the mainnet API answers this origin's CORS preflight.
ENV QLYPHS_KEYS_PROFILE=production QLYPHS_KEYS_PINS=/workspace/deploy/mainnet/pins.json
RUN pnpm install --frozen-lockfile && cd apps/keys && node build.mjs

# The served files alone, to rebuild and compare a release (apps/keys/README.md, Verify a release):
#   docker build -f deploy/keys.Dockerfile --target release --output type=local,dest=keys-release .
FROM scratch AS release
COPY --from=build /workspace/apps/keys/dist/keys /

FROM node:24-bookworm-slim
WORKDIR /keys
COPY --from=build --chown=node:node /workspace/apps/keys/serve.mjs ./
COPY --from=build --chown=node:node /workspace/apps/keys/dist ./dist
USER node
ENV KEYS_LISTEN=0.0.0.0 KEYS_PORT=4410
EXPOSE 4410
CMD ["node", "serve.mjs"]
