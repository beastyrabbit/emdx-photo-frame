# emdx-photo-frame — runs on a Synology NAS via Container Manager (tested on a DS420+),
# or anywhere with Docker (arm64 Macs included).
FROM node:22-bookworm-slim AS web-build
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build && npm run check

FROM node:22-bookworm-slim

# Fonts for the labels of the test pattern and under the artworks; tzdata so TZ works for the schedule.
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-dejavu-core tzdata libheif-examples libde265-0 util-linux \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    TZ=Europe/Brussels \
    DATA_DIR=/data

WORKDIR /app
COPY package.json package-lock.json ./
# onnxruntime-web (the face detector's runtime) ships builds for every kind of browser; Node
# uses one of them, the rest is 130 MB of ballast.
RUN npm ci --omit=dev && npm cache clean --force \
 && find node_modules/onnxruntime-web/dist -type f \
      ! -name 'ort.node.min.*js' ! -name 'ort-wasm-simd-threaded.mjs' ! -name 'ort-wasm-simd-threaded.wasm' -delete
COPY src ./src
COPY models ./models
COPY --from=web-build /web/dist ./web/dist

VOLUME /data
# The web page and what the display downloads.
EXPOSE 8321
HEALTHCHECK --interval=5m --timeout=10s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.HTTP_PORT||8321)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js", "serve"]
