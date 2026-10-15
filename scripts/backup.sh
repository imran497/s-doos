#!/usr/bin/env bash
# Nightly backup of the SellerDoos database to S3. Run on the server from the folder with
# docker-compose.yml, e.g. from cron:
#   15 3 * * * cd /home/ubuntu/sellerdoos && ./scripts/backup.sh >> backup.log 2>&1
# Needs the AWS CLI configured with a user that can only write to the bucket (BACKUP_BUCKET).
# Without BACKUP_BUCKET it just leaves the compressed copy in ./backups (useful for testing).
set -euo pipefail
cd "$(dirname "$0")/.."
stamp=$(date +%Y-%m-%d)
mkdir -p backups

# A consistent copy while the app keeps running (SQLite's online backup).
docker compose exec -T app node -e "require('better-sqlite3')(process.env.DATABASE_PATH).backup('/data/backup.db').then(() => console.log('backup ok'))"
docker compose cp app:/data/backup.db "backups/sellerdoos-$stamp.db"
docker compose exec -T app rm -f /data/backup.db
gzip -f "backups/sellerdoos-$stamp.db"

if [ -n "${BACKUP_BUCKET:-}" ]; then
  aws s3 cp "backups/sellerdoos-$stamp.db.gz" "s3://$BACKUP_BUCKET/sellerdoos/sellerdoos-$stamp.db.gz"
fi
# Keep a week locally; the bucket's lifecycle rule keeps 30 days.
find backups -name 'sellerdoos-*.db.gz' -mtime +7 -delete
echo "$(date -Is) done"
