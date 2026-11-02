# svidat backend: FastAPI under uvicorn. Built and run by the root
# docker-compose.yml; the API is only reachable through the frontend container.
FROM python:3.12-slim-bookworm

# rsync/ssh for scripts/get_data.sh.
RUN apt-get update \
    && apt-get install -y --no-install-recommends rsync openssh-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/server

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# All mutable state (DB, netCDF files, secret key) lives in the /data volume.
ENV DATA_DIR=/data \
    DATABASE_URL=sqlite:////data/svidat.db \
    PYTHONUNBUFFERED=1
VOLUME /data
EXPOSE 8000

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
