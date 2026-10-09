# svidat: backend + built frontend in one image; only port 4173 is exposed
# (the frontend proxies /api to the backend inside the container).
#
#   docker build -t svidat .
#   docker run -d --name svidat -p 4173:4173 -v svidat-data:/data \
#     -e SVIDAT_ADMIN_USER=admin -e SVIDAT_ADMIN_PASSWORD=change-me svidat
#
# Works the same with podman. Google/Microsoft login client IDs are baked into
# the frontend at build time: --build-arg VITE_GOOGLE_CLIENT_ID=... etc.
FROM node:22-bookworm-slim AS node

FROM python:3.12-slim-bookworm

# Node runtime for the build and `vite preview`; rsync/ssh for get_data.sh.
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && apt-get update \
    && apt-get install -y --no-install-recommends rsync openssh-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependency layers first so code changes don't reinstall everything.
COPY install.py ./
COPY server/requirements.txt server/requirements.txt
COPY client/package.json client/package-lock.json client/
RUN python3 install.py --yes --skip-frontend && rm -f server/.env \
    && cd client && npm ci

COPY . .

ARG VITE_GOOGLE_CLIENT_ID=""
ARG VITE_MS_CLIENT_ID=""
RUN cd client && VITE_API_URL=/api npm run build

# All mutable state (DB, netCDF files, secret key) lives in the /data volume.
ENV DATA_DIR=/data \
    DATABASE_URL=sqlite:////data/svidat.db \
    SKIP_BUILD=1 \
    VITE_ALLOWED_HOSTS=all
VOLUME /data
EXPOSE 4173

CMD ["./start.sh"]
