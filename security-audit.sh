#!/bin/bash
# Weekly security audit for nerdstudio.online — runs every Monday 10am WIB

DOMAINS="nerdstudio.online pptx.nerdstudio.online chat.nerdstudio.online"
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

# 5. Exposed ports
EXPOSED=$(ss -tlnp 2>/dev/null | grep -v "127.0.0.1" | grep -v ":::\[" | awk '{print $4}' | grep -vE ":22$|:443$|:80$" | grep "0.0.0.0" | wc -l)
if [ "$EXPOSED" -gt 0 ]; then
  ISSUES="$ISSUES\n⚠️ $EXPOSED non-standard ports exposed to internet"
fi

# 6. nginx version hidden
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
