# Nightly backups

`studycafe-backup.sh` runs every night at 02:30 IST on the droplet and writes to the Google Drive of **backup@studycafe.in** (rclone remote `gdrive`, folder `studycafe-backups/`).

| What | Where on Drive | Kept |
|---|---|---|
| MySQL dump of `studycafe_db` | `db/studycafe-db-YYYY-MM-DD.sql.gz[.gpg]` | 15 days (last 3 also in `/var/backups/studycafe/db` on the server) |
| `.env*` + `ecosystem.config.cjs` of every app in `/var/www/html`, `/etc/nginx`, `/etc/cron.d`, root crontab, `/root/.my.cnf` | `config/studycafe-config-YYYY-MM-DD.tar.gz[.gpg]` | 15 days |
| `/var/www/html/study-cafe-media/uploads` | `uploads/current/` (mirror) | always current |
| files deleted or replaced in uploads | `uploads/history/YYYY-MM-DD/` | 15 days |
| `/var/lib/studycafe-ms` (certificates) | `data/current/`, `data/history/YYYY-MM-DD/` | same as uploads |

Whole-server images are separate: DigitalOcean Droplet Backups (daily, 7 days), switched on in the DO panel.

## Prerequisites (already done on the droplet, Oct 2026)

- rclone installed; `/root/.config/rclone/rclone.conf` has remote `gdrive` (Google Cloud project `studycafe-backup`, Desktop OAuth client, scope `drive.file`). rclone only sees files it created, so don't create folders in `studycafe-backups/` by hand in the Drive UI.
- `/root/.my.cnf` (mode 600) with the app's MySQL user, so `mysql`/`mysqldump` work as root without a password prompt.

## Install

As root on the droplet:

```bash
install -m 700 /var/www/html/study-cafe-api/scripts/backup/studycafe-backup.sh /usr/local/sbin/studycafe-backup

cat > /etc/logrotate.d/studycafe-backup <<'EOF'
/var/log/studycafe-backup.log {
  weekly
  rotate 8
  compress
  missingok
  notifempty
}
EOF
```

Optional settings go in `/etc/studycafe-backup.conf` (mode 600):

```bash
ENCRYPT=1                                      # gpg-encrypt DB + config before upload
HEALTHCHECK_URL=https://hc-ping.com/<uuid>     # healthchecks.io check, period 1 day, grace 2 h
```

With `ENCRYPT=1`, create the passphrase once and give a copy to the client for their password manager. **Without it the encrypted backups cannot be opened**, and if it only exists on the droplet it is lost with the droplet.

```bash
openssl rand -base64 32 > /root/.studycafe-backup-passphrase && chmod 600 /root/.studycafe-backup-passphrase
```

### First run

The first run uploads ~28 GB / ~70k files and takes several hours, so run it inside tmux and leave `HEALTHCHECK_URL` unset until it has finished (a run longer than the grace period is reported as down):

```bash
tmux new -s backup
/usr/local/sbin/studycafe-backup
# detach: Ctrl+B then D   ·   reattach later: tmux attach -t backup
```

Then schedule it:

```bash
echo '30 2 * * * root /usr/local/sbin/studycafe-backup >/dev/null 2>&1' > /etc/cron.d/studycafe-backup
```

Output goes to `/var/log/studycafe-backup.log`.

## Restore

Encrypted files: put `gpg --batch --pinentry-mode loopback --passphrase-file /root/.studycafe-backup-passphrase -d FILE.gpg |` in front of the commands below instead of reading the `.gz` directly.

**Database: test restore (do this after the first run, then monthly).** Needs a MySQL account that can create databases (the app user usually can't).

```bash
mysql -u root -p -e "CREATE DATABASE studycafe_restore_test"
gunzip -c /var/backups/studycafe/db/studycafe-db-YYYY-MM-DD.sql.gz | mysql -u root -p studycafe_restore_test
mysql -u root -p -e "SELECT COUNT(*) FROM studycafe_db.orders; SELECT COUNT(*) FROM studycafe_restore_test.orders;"
mysql -u root -p -e "DROP DATABASE studycafe_restore_test"
```

An older dump has to come from Drive first: `rclone copy gdrive:studycafe-backups/db/studycafe-db-YYYY-MM-DD.sql.gz /root/restore/`.

**Database: restoring over production** loses every order, payment and signup made after the dump. Stop the services (`pm2 stop all`), take a fresh dump of the current state first, and restore only the tables you need where possible.

**Uploads: whole folder**

```bash
rclone copy gdrive:studycafe-backups/uploads/current /var/www/html/study-cafe-media/uploads
```

**Uploads: one deleted or overwritten file**

```bash
rclone lsf -R gdrive:studycafe-backups/uploads/history | grep 'file-name'
rclone copyto gdrive:studycafe-backups/uploads/history/YYYY-MM-DD/path/to/file /var/www/html/study-cafe-media/uploads/path/to/file
```
