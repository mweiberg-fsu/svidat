#!/bin/sh
# Picks the TLS certificate, keeps it current, then hands off to the stock
# nginx entrypoint. Certificate sources, first match wins:
#   1. SVIDAT_SSL_CERT / SVIDAT_SSL_KEY  - your own cert (mounted under /certs)
#   2. Let's Encrypt                     - /etc/letsencrypt/live/$SVIDAT_DOMAIN
#   3. self-signed placeholder           - so nginx can start (and serve the
#                                          ACME challenge) before (2) exists
# A watcher re-checks every minute and reloads nginx when the cert changes
# (first issuance, renewals), so no restart is needed.
set -eu

: "${SVIDAT_DOMAIN:?set SVIDAT_DOMAIN in .env}"

SSL_DIR=/etc/nginx/ssl
LE_DIR="/etc/letsencrypt/live/$SVIDAT_DOMAIN"
mkdir -p "$SSL_DIR"

if [ -n "${SVIDAT_SSL_CERT:-}" ] || [ -n "${SVIDAT_SSL_KEY:-}" ]; then
    for f in "${SVIDAT_SSL_CERT:-}" "${SVIDAT_SSL_KEY:-}"; do
        if [ -z "$f" ] || [ ! -r "$f" ]; then
            echo "svidat-proxy: set both SVIDAT_SSL_CERT and SVIDAT_SSL_KEY to readable files (got '$f')" >&2
            exit 1
        fi
    done
fi

# Optional IP allowlist for the HTTPS site (port 80 only serves the ACME
# challenge and the redirect, so it stays open for Let's Encrypt).
# SVIDAT_ALLOW_IPS: addresses/CIDRs separated by spaces or commas.
ALLOW_CONF=/etc/nginx/svidat-allow.conf
: > "$ALLOW_CONF"
allow_list=$(printf '%s' "${SVIDAT_ALLOW_IPS:-}" | tr ',' ' ')
if [ -n "$(printf '%s' "$allow_list" | tr -d ' \t\n')" ]; then
    for ip in $allow_list; do
        if ! printf '%s\n' "$ip" | grep -qE '^(([0-9]{1,3}\.){3}[0-9]{1,3}(/[0-9]{1,2})?|[0-9A-Fa-f:]*:[0-9A-Fa-f:.]*(/[0-9]{1,3})?)$'; then
            echo "svidat-proxy: SVIDAT_ALLOW_IPS entry '$ip' is not an IP address or CIDR" >&2
            exit 1
        fi
        echo "allow $ip;" >> "$ALLOW_CONF"
    done
    echo "deny all;" >> "$ALLOW_CONF"
    echo "svidat-proxy: HTTPS restricted to: $allow_list"
else
    echo "svidat-proxy: no SVIDAT_ALLOW_IPS, HTTPS open to all addresses"
fi

if [ ! -s "$SSL_DIR/selfsigned.crt" ]; then
    openssl req -x509 -nodes -newkey rsa:2048 -days 30 \
        -subj "/CN=$SVIDAT_DOMAIN" \
        -keyout "$SSL_DIR/selfsigned.key" -out "$SSL_DIR/selfsigned.crt" 2>/dev/null
fi

link_cert() {
    if [ -n "${SVIDAT_SSL_CERT:-}" ]; then
        cert=$SVIDAT_SSL_CERT key=$SVIDAT_SSL_KEY
    elif [ -s "$LE_DIR/fullchain.pem" ] && [ -s "$LE_DIR/privkey.pem" ]; then
        cert=$LE_DIR/fullchain.pem key=$LE_DIR/privkey.pem
    else
        cert=$SSL_DIR/selfsigned.crt key=$SSL_DIR/selfsigned.key
    fi
    ln -sfn "$cert" "$SSL_DIR/cert.pem"
    ln -sfn "$key" "$SSL_DIR/key.pem"
}

fingerprint() { cat "$SSL_DIR/cert.pem" "$SSL_DIR/key.pem" 2>/dev/null | cksum; }

link_cert
echo "svidat-proxy: using certificate $(readlink "$SSL_DIR/cert.pem")"

# Redirect target keeps a non-default HTTPS port (e.g. :8443) in the URL.
if [ "${SVIDAT_HTTPS_PORT:-443}" = 443 ]; then
    SVIDAT_HTTPS_PORT_SUFFIX=""
else
    SVIDAT_HTTPS_PORT_SUFFIX=":$SVIDAT_HTTPS_PORT"
fi
export SVIDAT_HTTPS_PORT_SUFFIX

(
    last=$(fingerprint)
    while sleep 60; do
        link_cert
        now=$(fingerprint)
        if [ "$now" != "$last" ]; then
            echo "svidat-proxy: certificate changed, now $(readlink "$SSL_DIR/cert.pem"); reloading"
            nginx -s reload && last=$now
        fi
    done
) &

exec /docker-entrypoint.sh "$@"
