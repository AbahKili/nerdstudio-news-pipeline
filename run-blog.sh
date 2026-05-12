#!/bin/bash
cd /opt/nerdstudio-news
export DEEPSEEK_API_KEY="sk-ddd4982ce9684bb9abf6afab0147a339"
/root/.nvm/versions/node/v22.22.1/bin/node /opt/nerdstudio-news/auto-blog.js >> /tmp/auto-blog.log 2>&1

# Also notify Abah that a post was published
curl -s -X POST http://localhost:3232/send -H "Content-Type: application/json" -d '{"text":"📝 Auto-blog published! Check nerdstudio.online/blog/","to":"6281254571157"}' > /dev/null 2>&1
