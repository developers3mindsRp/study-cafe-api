#!/usr/bin/env bash
# Create persistent directories (see shared/persistentDataRoot.js and shared/mediaUrl.js).
# Run with sufficient privileges once on the server, e.g.:
#   sudo bash scripts/ensure-persistent-dirs.sh
#   sudo chown -R mynodeuser: /var/lib/studycafe-ms /var/www/html/study-cafe-media
set -e
DATA_DIR="/var/lib/studycafe-ms"
MEDIA_DIR="/var/www/html/study-cafe-media/uploads"
mkdir -p "$MEDIA_DIR" "$DATA_DIR/certificates"
echo "OK: $MEDIA_DIR and $DATA_DIR/certificates"
