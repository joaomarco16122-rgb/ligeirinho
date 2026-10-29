# syntax=docker/dockerfile:1.7
# Static artifact only: run the isolated export before building this image.
FROM nginx:1.30-alpine@sha256:0e52bd054126cdc040b1276c0af347aeb02a41b9cfe305d6094767ac30e97949
RUN rm -rf /usr/share/nginx/html/*
COPY --chown=nginx:nginx --chmod=0444 infra/nginx/site.conf /etc/nginx/nginx.conf
COPY --chown=nginx:nginx apps/web/out/ /usr/share/nginx/html/
RUN test -f /usr/share/nginx/html/index.html && \
    test -f /usr/share/nginx/html/404.html
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=20s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -Y off -q -O /dev/null http://127.0.0.1:8080/ || exit 1
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
