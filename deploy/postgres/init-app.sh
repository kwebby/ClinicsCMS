#!/bin/sh
# Author: ramanpal singh | URL: https://kwebby.com
# Official postgres entrypoint runs this only for a fresh cluster.
set -eu
: "${APP_DATABASE_PASSWORD:?Set the independent application database password}"
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 --set=app_password="$APP_DATABASE_PASSWORD" <<'SQL'
CREATE ROLE clinic LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
REVOKE ALL ON DATABASE clinic FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE clinic TO clinic;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO clinic;
SQL
