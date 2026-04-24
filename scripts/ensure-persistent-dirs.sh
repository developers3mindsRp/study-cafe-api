#!/usr/bin/env bash
# Create subfolders under the hardcoded data root in shared/persistentDataRoot.js (default /var/lib/studycafe-ms).
# Run with sufficient privileges once on the server, e.g.:
#   sudo bash scripts/ensure-persistent-dirs.sh
#   sudo chown -R mynodeuser: /var/lib/studycafe-ms
set -e
DATA_DIR="/var/lib/studycafe-ms"
mkdir -p "$DATA_DIR/platform-uploads" "$DATA_DIR/user-uploads" "$DATA_DIR/certificates"
echo "OK: $DATA_DIR/{platform-uploads,user-uploads,certificates}"
