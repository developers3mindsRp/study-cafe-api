#!/usr/bin/env bash
# Nightly backup to Google Drive (rclone remote "gdrive", account backup@studycafe.in):
#   - MySQL dump + config archive, kept KEEP_DAYS days on Drive and LOCAL_KEEP copies on the server
#   - uploads/ and /var/lib/studycafe-ms mirrored; files deleted or replaced on the server are
#     moved to <name>/history/<date>/ on Drive and kept KEEP_DAYS days
#
# Runs as root from /etc/cron.d/studycafe-backup. Setup and restore: scripts/backup/README.md
#
# Optional overrides in /etc/studycafe-backup.conf, e.g.
#   ENCRYPT=1
#   HEALTHCHECK_URL=https://hc-ping.com/<uuid>
set -Eeuo pipefail

export HOME=/root
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

CONF_FILE=/etc/studycafe-backup.conf
if [ -f "$CONF_FILE" ]; then
  # shellcheck source=/dev/null
  . "$CONF_FILE"
fi

DB_NAME="${DB_NAME:-studycafe_db}"
APPS_DIR="${APPS_DIR:-/var/www/html}"
UPLOADS_DIR="${UPLOADS_DIR:-$APPS_DIR/study-cafe-media/uploads}"
DATA_DIR="${DATA_DIR:-/var/lib/studycafe-ms}"
LOCAL_DIR="${LOCAL_DIR:-/var/backups/studycafe}"
REMOTE="${REMOTE:-gdrive:studycafe-backups}"
KEEP_DAYS="${KEEP_DAYS:-15}"
LOCAL_KEEP="${LOCAL_KEEP:-3}"
ENCRYPT="${ENCRYPT:-0}"
PASSPHRASE_FILE="${PASSPHRASE_FILE:-/root/.studycafe-backup-passphrase}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-}"
LOG_FILE="${LOG_FILE:-/var/log/studycafe-backup.log}"

STAMP="$(date +%F)"
# Never send deletions to Drive's trash: trashed files still count against the storage quota.
RCLONE=(rclone --config /root/.config/rclone/rclone.conf --drive-use-trash=false)

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root" >&2
  exit 1
fi

RUN_LOG="$(mktemp)"
trap 'rm -f "$RUN_LOG"' EXIT
exec > >(tee -a "$LOG_FILE" "$RUN_LOG") 2>&1

log() { echo "$(date '+%F %T') $*"; }

ping_hc() {  # $1: "" (success), "/start" or "/fail"; sends the tail of this run's log
  [ -n "$HEALTHCHECK_URL" ] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null --data-raw "$(tail -n 40 "$RUN_LOG")" "$HEALTHCHECK_URL$1" || true
}

on_error() {
  log "FAILED (exit $1) at line $2"
  sleep 1  # let tee flush the error into RUN_LOG before it is sent
  ping_hc /fail
  exit "$1"
}
trap 'on_error $? $LINENO' ERR

exec 9>/run/studycafe-backup.lock
if ! flock -n 9; then
  log "Another backup is still running, skipping"
  exit 0
fi

preflight() {
  local cmd
  for cmd in rclone mysqldump gzip curl; do
    command -v "$cmd" >/dev/null || { log "Missing command: $cmd"; return 1; }
  done
  if [ "$ENCRYPT" = 1 ]; then
    command -v gpg >/dev/null || { log "Missing command: gpg"; return 1; }
    [ -s "$PASSPHRASE_FILE" ] || { log "ENCRYPT=1 but $PASSPHRASE_FILE is missing or empty"; return 1; }
  fi
  mkdir -p "$LOCAL_DIR/db" "$LOCAL_DIR/config"
  chmod 700 "$LOCAL_DIR"
}

finalize() {  # $1: finished archive; encrypts it when ENCRYPT=1, then logs its size
  local f="$1"
  if [ "$ENCRYPT" = 1 ]; then
    gpg --batch --yes --pinentry-mode loopback --passphrase-file "$PASSPHRASE_FILE" \
      --symmetric --cipher-algo AES256 -o "$f.gpg" "$f"
    rm -f -- "$f"
    f="$f.gpg"
  fi
  log "Created $(basename "$f") ($(du -h "$f" | cut -f1))"
}

dump_db() {
  local out="$LOCAL_DIR/db/studycafe-db-$STAMP.sql.gz"
  log "Dumping database $DB_NAME"
  # Credentials come from /root/.my.cnf. --single-transaction gives a consistent InnoDB
  # snapshot without locking the site; --no-tablespaces avoids needing the PROCESS privilege.
  nice -n 10 mysqldump --single-transaction --no-tablespaces --hex-blob "$DB_NAME" | gzip -6 > "$out.part"
  if ! zcat "$out.part" | tail -n 1 | grep -q 'Dump completed'; then
    log "Dump of $DB_NAME looks incomplete"
    return 1
  fi
  mv "$out.part" "$out"
  finalize "$out"
}

archive_config() {
  local out="$LOCAL_DIR/config/studycafe-config-$STAMP.tar.gz" tmp p
  local -a candidates rel=()
  tmp="$(mktemp -d)"
  crontab -l > "$tmp/root-crontab.txt" 2>/dev/null || true
  shopt -s nullglob
  candidates=("$APPS_DIR"/*/.env* "$APPS_DIR"/*/ecosystem.config.cjs /etc/nginx /etc/cron.d "$CONF_FILE" /root/.my.cnf)
  shopt -u nullglob
  for p in "${candidates[@]}"; do
    [ -e "$p" ] && rel+=("${p#/}")
  done
  log "Archiving ${#rel[@]} config paths"
  tar -czf "$out.part" -C / "${rel[@]}" -C "$tmp" root-crontab.txt
  rm -rf -- "$tmp"
  mv "$out.part" "$out"
  finalize "$out"
}

upload_archives() {
  log "Uploading db/ and config/ archives"
  "${RCLONE[@]}" copy "$LOCAL_DIR/db" "$REMOTE/db" --exclude '*.part'
  "${RCLONE[@]}" copy "$LOCAL_DIR/config" "$REMOTE/config" --exclude '*.part'
}

mirror() {  # $1: local dir, $2: folder name under $REMOTE
  # An empty or missing source would move the whole Drive copy into history, where it
  # expires after KEEP_DAYS, so refuse instead.
  if [ ! -d "$1" ] || [ -z "$(ls -A "$1")" ]; then
    log "$1 is missing or empty; refusing to mirror it"
    return 1
  fi
  log "Mirroring $1 -> $REMOTE/$2/current"
  nice -n 10 "${RCLONE[@]}" sync "$1" "$REMOTE/$2/current" \
    --backup-dir "$REMOTE/$2/history/$STAMP" \
    --fast-list --transfers 8 --checkers 16 \
    --log-level INFO --stats 10m --stats-one-line
}

prune_remote() {  # $1: folder under $REMOTE whose entries are named with a YYYY-MM-DD date
  local cutoff entries entry day
  # Keep exactly KEEP_DAYS dated entries, today included. Pruning goes by the date in the
  # name, not mtime: files moved into history/ keep their original (old) modification time.
  cutoff="$(date -d "-$((KEEP_DAYS - 1)) days" +%F)"
  "${RCLONE[@]}" mkdir "$REMOTE/$1"
  entries="$("${RCLONE[@]}" lsf "$REMOTE/$1")"
  while read -r entry; do
    [[ $entry =~ ([0-9]{4}-[0-9]{2}-[0-9]{2}) ]] || continue
    day="${BASH_REMATCH[1]}"
    [[ $day < $cutoff ]] || continue
    log "Removing expired $1/$entry"
    if [[ $entry == */ ]]; then
      "${RCLONE[@]}" purge "$REMOTE/$1/${entry%/}"
    else
      "${RCLONE[@]}" deletefile "$REMOTE/$1/$entry"
    fi
  done <<< "$entries"
}

prune_local() {
  local dir f
  for dir in "$LOCAL_DIR/db" "$LOCAL_DIR/config"; do
    rm -f -- "$dir"/*.part
    ls -1t "$dir" | tail -n +$((LOCAL_KEEP + 1)) | while read -r f; do
      rm -f -- "$dir/$f"
    done
  done
}

main() {
  log "=== Backup $STAMP started ==="
  ping_hc /start
  preflight
  dump_db
  archive_config
  upload_archives
  mirror "$UPLOADS_DIR" uploads
  mirror "$DATA_DIR" data
  # Expire old copies only after today's backup has fully succeeded.
  prune_remote db
  prune_remote config
  prune_remote uploads/history
  prune_remote data/history
  prune_local
  log "=== Backup $STAMP finished OK ==="
  ping_hc ""
}

main "$@"
