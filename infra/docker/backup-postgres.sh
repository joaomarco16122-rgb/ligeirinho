#!/usr/bin/env bash
# Exemplo operacional: requer age, Docker Compose e destinatário sem segredo.
set -euo pipefail
: "${BACKUP_DIR:?Defina diretório privado fora do checkout}"
: "${BACKUP_RECIPIENT:?Defina destinatário público age}"
command -v age >/dev/null
command -v docker >/dev/null
umask 077
mkdir -p -- "$BACKUP_DIR"
BACKUP_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_FINAL="$BACKUP_DIR/ligeirinho-$BACKUP_STAMP.dump.age"
if [ -e "$BACKUP_FINAL" ]; then
  echo 'Já existe backup para este instante; nenhum arquivo foi sobrescrito.' >&2
  exit 1
fi
BACKUP_TEMP="$(mktemp "$BACKUP_DIR/.ligeirinho-backup.XXXXXX")"
trap 'rm -f -- "$BACKUP_TEMP"' EXIT
docker compose exec -T postgres pg_dump -U ligeirinho -d ligeirinho -Fc |
  age -r "$BACKUP_RECIPIENT" > "$BACKUP_TEMP"
test -s "$BACKUP_TEMP"
ln -- "$BACKUP_TEMP" "$BACKUP_FINAL"
printf 'Backup criptografado criado. Teste a restauração em banco isolado.\n'
