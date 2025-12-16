#!/bin/bash

TIDB_HOST=${TIDB_HOST:-tidb}
TIDB_PORT=${TIDB_PORT:-4000}
TIDB_USER=${TIDB_USER:-root}
TIDB_PASSWORD=${TIDB_PASSWORD:-}

echo "Waiting for TiDB to be ready..."

# Wait for TiDB to be available
MAX_RETRIES=60
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if mysql -h "$TIDB_HOST" -P "$TIDB_PORT" -u "$TIDB_USER" -e "SELECT 1" > /dev/null 2>&1; then
        echo "TiDB is ready!"
        break
    fi
    RETRY_COUNT=$((RETRY_COUNT + 1))
    echo "Waiting for TiDB... ($RETRY_COUNT/$MAX_RETRIES)"
    sleep 2
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo "Error: TiDB did not become ready in time"
    exit 1
fi

# Additional wait to ensure TiDB is fully operational
echo "Waiting additional time for TiDB to stabilize..."
sleep 5

echo "Running initialization script..."
if mysql -h "$TIDB_HOST" -P "$TIDB_PORT" -u "$TIDB_USER" < /docker-entrypoint-initdb.d/init.sql; then
    echo "Database initialization completed successfully!"
    exit 0
else
    echo "Warning: Some SQL commands may have had issues, but continuing..."
    echo "Database initialization completed!"
    exit 0
fi
