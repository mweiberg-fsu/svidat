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
RUN VITE_API_URL=/api npm run build

FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
