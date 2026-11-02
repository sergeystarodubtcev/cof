#!/usr/bin/env bash
# Обновление каталога на своём сервере (рекомендуется VPS в РФ — часть сайтов режет зарубежные IP).
# crontab -e:   17 */6 * * *  /opt/coffee-compare/deploy/update.sh >> /var/log/coffee-compare.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install -q -r requirements.txt
.venv/bin/python -m scraper.run
# site/ — готовая статика: отдавайте её nginx'ом (root /opt/coffee-compare/site;)
if git remote get-url origin >/dev/null 2>&1; then
  git add data site/data site/img && (git diff --cached --quiet || git commit -qm "Каталог $(date -u +%F\ %H:%M)") && git push -q || true
fi
