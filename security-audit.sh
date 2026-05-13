#!/bin/bash
# Weekly security audit for nerdstudio.online — runs every Monday 10am WIB

DOMAINS="nerdstudio.online pptx.nerdstudio.online chat.nerdstudio.online skip.my.id"
SENSITIVE="/.git/HEAD /.env /.htaccess /wp-admin"
ISSUES=""

echo "=== Security Audit $(date +%Y-%m-%d) ==="

# 1. Check all domains respond with HTTPS
for d in $DOMAINS; do
  CODE=$(curl -skI -o /dev/null -w "%{http_code}" "https://$d" 2>/dev/null)
  if [ "$CODE" != "200" ]; then
    ISSUES="$ISSUES\n❌ $d returned HTTP $CODE"
  fi
done

# 2. Security headers
for d in $DOMAINS; do
  HSTS=$(curl -skI "https://$d" 2>/dev/null | grep -c "Strict-Transport")
  XFO=$(curl -skI "https://$d" 2>/dev/null | grep -c "X-Frame")
  if [ "$HSTS" = "0" ] || [ "$XFO" = "0" ]; then
    ISSUES="$ISSUES\n⚠️ $d missing headers (HSTS=$HSTS XFO=$XFO)"
  fi
done

# 3. Sensitive paths blocked
for d in $DOMAINS; do
  for p in $SENSITIVE; do
    CODE=$(curl -sk -o /dev/null -w "%{http_code}" "https://$d$p" 2>/dev/null)
    if [ "$CODE" = "200" ]; then
      ISSUES="$ISSUES\n🚨 CRITICAL: $d$p is accessible!"
    fi
  done
done

# 4. SSL expiry
EXPIRY=$(echo | openssl s_client -servername nerdstudio.online -connect nerdstudio.online:443 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
DAYS=$(( ($(date -d "$EXPIRY" +%s) - $(date +%s)) / 86400 ))
if [ "$DAYS" -lt 30 ]; then
  ISSUES="$ISSUES\n⚠️ SSL expires in $DAYS days ($EXPIRY)"
fi

# 5. Firewall — any unexpected open ports?
OPEN_PORTS=$(firewall-cmd --list-ports 2>/dev/null)
PORT_COUNT=$(echo "$OPEN_PORTS" | tr ' ' '\n' | grep -cE "^[0-9]+")
if [ "$PORT_COUNT" -gt 5 ]; then
  ISSUES="$ISSUES\n⚠️ $PORT_COUNT ports open in firewall — review: $OPEN_PORTS"
fi

# 6. Accidental credentials in repos
for repo in /opt/pptx /opt/nerdstudio-news /var/www/nerdstudio.online /opt/shortener; do
  DIRTY=$(git -C "$repo" diff --cached --name-only 2>/dev/null)
  if [ -n "$DIRTY" ]; then
    ISSUES="$ISSUES\n⚠️ $repo has staged changes (possible secrets leaked)"
  fi
  # Scan for common secret patterns in COMMITTED files only (not working tree)
  LEAKS=$(git -C "$repo" grep -lIE --cached \
    "(sk-[a-zA-Z0-9]{20,}|GOCSPX-[a-zA-Z0-9_-]{20,}|eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+|ghp_[a-zA-Z0-9]{36}|xox[baprs]-[a-zA-Z0-9-]+|api_key.*['\"]?[a-zA-Z0-9_-]{20,})" \
    -- '*.js' '*.json' '*.py' '*.ts' '*.yml' '*.yaml' '*.conf' '*.html' 2>/dev/null | grep -v ".gitignore\|.env.example" | head -5)
  if [ -n "$LEAKS" ]; then
    ISSUES="$ISSUES\n🚨 CREDENTIALS LEAKED in $repo: $LEAKS"
  fi
done

# 7. nginx version hidden
NGINX_VER=$(curl -skI https://nerdstudio.online 2>/dev/null | grep "Server" | grep -oP "\d+\.\d+\.\d+")
if [ -n "$NGINX_VER" ]; then
  ISSUES="$ISSUES\n⚠️ nginx version exposed: $NGINX_VER"
fi

# Build report
if [ -z "$ISSUES" ]; then
  REPORT="✅ Weekly security audit passed.\n\nAll domains secure. No issues detected.\nSSL: $DAYS days until expiry."
else
  REPORT="🔍 Weekly security audit — issues found:\n$ISSUES"
fi

echo -e "$REPORT"

# Send to Abah via WhatsApp
curl -s -X POST http://localhost:3232/send \
  -H "Content-Type: application/json" \
  -d "{\"text\":\"$REPORT\",\"to\":\"6281254571157\"}" > /dev/null 2>&1

echo "Report sent."
