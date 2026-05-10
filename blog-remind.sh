#!/bin/bash
# Weekly blog reminder — checks schedule and nudges when it's time

SCHEDULE="/opt/nerdstudio-news/blog-schedule.json"
NEXT=$(python3 -c "
import json
with open('$SCHEDULE') as f:
    posts = json.load(f)
for p in posts:
    if p['status'] == 'next':
        print(f\"{p['week']}|{p['title']}|{p.get('angle','')}\")
        break
")

if [ -z "$NEXT" ]; then
  echo "All posts done or no 'next' found."
  exit 0
fi

WEEK=$(echo "$NEXT" | cut -d'|' -f1)
TITLE=$(echo "$NEXT" | cut -d'|' -f2)
ANGLE=$(echo "$NEXT" | cut -d'|' -f3)

MSG="📝 Blog Week $WEEK: $TITLE"

if [ -n "$ANGLE" ]; then
  MSG="$MSG
Angle: $ANGLE"
fi

MSG="$MSG

Reply to start writing."

# Send to Abah via wa-relay
curl -s -X POST http://localhost:3232/send \
  -H "Content-Type: application/json" \
  -d "{\"text\": \"$MSG\"}"
