# svidat TLS reverse proxy: terminates HTTPS in front of the frontend
# container. Optional; enabled with the "proxy" compose profile.
FROM nginx:1.27-alpine
RUN apk add --no-cache openssl
# The stock entrypoint renders templates/*.template into conf.d/, substituting
# only variables that are set in the environment (nginx's own $vars survive).
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY entrypoint.sh /svidat-proxy-entrypoint.sh
RUN chmod +x /svidat-proxy-entrypoint.sh && mkdir -p /var/www/certbot
EXPOSE 80 443
ENTRYPOINT ["/svidat-proxy-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
