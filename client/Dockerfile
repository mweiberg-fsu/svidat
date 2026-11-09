# svidat frontend: the Vite build served by nginx, which also proxies /api to
# the backend container. Built and run by the root docker-compose.yml.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Google/Microsoft login client IDs are baked in at build time.
ARG VITE_GOOGLE_CLIENT_ID=""
ARG VITE_MS_CLIENT_ID=""
# URL prefix to serve under, e.g. /svidat/ (leading and trailing slash).
ARG VITE_BASE_PATH=/
RUN case "$VITE_BASE_PATH" in /|/*/) ;; \
      *) echo "SVIDAT_BASE_PATH must start and end with /, got '$VITE_BASE_PATH'" >&2; exit 1 ;; \
    esac \
 && VITE_API_URL="${VITE_BASE_PATH}api" npm run build

FROM nginx:1.27-alpine
ARG VITE_BASE_PATH=/
# Read by the nginx image's envsubst step when rendering the template, so the
# served paths always match what the build was made for.
ENV SVIDAT_BASE_PATH=${VITE_BASE_PATH}
COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template
# Files live under html<base>, so nginx's $uri maps straight onto them.
COPY --from=build /app/dist /usr/share/nginx/html${VITE_BASE_PATH}
EXPOSE 8080
