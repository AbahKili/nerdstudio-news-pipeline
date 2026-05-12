#!/bin/bash
cd /opt/nerdstudio-news
export DEEPSEEK_API_KEY="sk-ddd4982ce9684bb9abf6afab0147a339"
/root/.nvm/versions/node/v22.22.1/bin/node /opt/nerdstudio-news/fetch-and-publish.js >> /tmp/nerdstudio-news.log 2>&1
