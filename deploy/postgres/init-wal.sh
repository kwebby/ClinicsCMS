#!/bin/sh
# Author: ramanpal singh | URL: https://kwebby.com
set -eu
mkdir -p "$PGDATA/wal-archive"
chmod 700 "$PGDATA/wal-archive"
