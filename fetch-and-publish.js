#!/usr/bin/env node
'use strict';

// ── Auto Daily AI News — fetches RSS, summarizes with Gemini, publishes HTML ──

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || '';
const NEWS_DIR = path.join('/var/www/nerdstudio.online', 'news');
// WIB date (UTC+7) — so cron at 1am UTC = 8am WIB gets the correct day
const now = new Date();
const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
const today = wib.toISOString().slice(0, 10);

// RSS feeds to pull from
const FEEDS = [
  { name: 'TechCrunch AI', url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
  { name: 'The Verge AI', url: 'https://www.theverge.com/ai-artificial-intelligence/rss/index.xml' },
  { name: 'Ars Technica AI', url: 'https://feeds.arstechnica.com/arstechnica/technology' },
  { name: 'MIT Technology Review AI', url: 'https://www.technologyreview.com/feed/' },
];

async function fetchFeed(feed) {
  try {
    const xml = execSync(`curl -sL --max-time 15 "${feed.url}"`, { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
    const items = [];
    const itemBlocks = xml.split('<item>').slice(1);
    for (const block of itemBlocks) {
      try {
        const title = (block.match(/<title[^>]*><!\[CDATA\[(.*?)\]\]><\/title>/) || block.match(/<title>(.*?)<\/title>/))?.[1] || '';
        const link = (block.match(/<link>(.*?)<\/link>/))?.[1] || '';
        const desc = (block.match(/<description[^>]*><!\[CDATA\[(.*?)\]\]><\/description>/) || block.match(/<description>(.*?)<\/description>/))?.[1] || '';
        const cleanDesc = desc.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 300);
        if (title && link) items.push({ title: title.trim(), link: link.trim(), source: feed.name, desc: cleanDesc });
        if (items.length >= 8) break;
      } catch {}
    }
    return items;
  } catch (err) {
    console.error(`[feed] ${feed.name} failed: ${err.message}`);
    return [];
  }
}

async function fetchArticleContent(url) {
  try {
    const html = execSync(`curl -sL --max-time 12 -H "User-Agent: NerdStudio/1.0" "${url}"`, {
      encoding: 'utf8', maxBuffer: 1 * 1024 * 1024
    });
    if (!html || html.length < 200) return null;

    // Extract text from common article containers, strip tags
    let body = html;
    // Try to isolate article content
    const articleMatch = body.match(/<article[\s\S]*?<\/article>/i);
    if (articleMatch) body = articleMatch[0];

    // Strip scripts, styles, nav, header, footer
    body = body.replace(/<script[\s\S]*?<\/script>/gi, '');
    body = body.replace(/<style[\s\S]*?<\/style>/gi, '');
    body = body.replace(/<nav[\s\S]*?<\/nav>/gi, '');
    body = body.replace(/<footer[\s\S]*?<\/footer>/gi, '');
    body = body.replace(/<header[\s\S]*?<\/header>/gi, '');
    body = body.replace(/<[^>]+>/g, ' ');
    body = body.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    body = body.replace(/\s+/g, ' ').trim();

    return body.slice(0, 4000); // enough for a good rewrite
  } catch {
    return null;
  }
}

async function summarize(items) {
  if (!DEEPSEEK_KEY) {
    console.error('[deepseek] No API key.');
    return null;
  }

  // Fetch article content for top candidates (max 8)
  const candidates = items.slice(0, 8);
  const withContent = [];
  for (const item of candidates) {
    process.stdout.write(`[news]   fetching: ${item.title.slice(0, 60)}... `);
    // Validate link first
    try {
      const head = execSync(`curl -sI --max-time 5 -o /dev/null -w "%{http_code}" "${item.link}"`, { encoding: 'utf8' }).trim();
      if (head !== '200') {
        console.log(`HTTP ${head} — skipped`);
        continue;
      }
    } catch {
      console.log('unreachable — skipped');
      continue;
    }

    const content = await fetchArticleContent(item.link);
    if (content && content.length > 200) {
      withContent.push({ ...item, content });
      console.log(`OK (${content.length} chars)`);
    } else {
      console.log('no content — skipped');
    }
    if (withContent.length >= 5) break;
  }

  if (withContent.length === 0) {
    console.error('[news] No articles with valid content found');
    return null;
  }

  console.log(`[news] Rewriting ${withContent.length} articles with DeepSeek...`);

  // Rewrite each article individually — no URL mapping needed, each story gets its real URL
  const stories = [];
  for (const item of withContent) {
    const prompt = `Rewrite this AI news article as a 3-4 paragraph original news story. Rephrase everything. Keep under 250 words. Include the source name "${item.source}".

DO NOT include URLs. Return ONLY a JSON object: { "headline": "...", "body": "... rewritten article ...", "source": "${item.source}" }

Article headline: ${item.title}
Full text: ${item.content}`;

    try {
      const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEEPSEEK_KEY}` },
        body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: prompt }], temperature: 0.5, max_tokens: 1000 }),
      });
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const story = JSON.parse(jsonMatch[0]);
        story.url = item.link; // exact URL from RSS, guaranteed correct
        story.source = item.source; // exact source from RSS
        stories.push(story);
        process.stdout.write('.');
      }
    } catch {}
  }
  console.log(` ${stories.length} rewritten`);

  if (stories.length === 0) return null;

  // Generate intro separately
  console.log('[news] Generating intro...');
  const headlines = stories.map(s => s.headline).join('; ');
  const introPrompt = `Write 2-3 sentences capturing today's AI news sentiment based on these headlines: ${headlines}. Return ONLY a JSON: { "intro": "..." }`;

  let intro = "Today's AI news roundup.";
  try {
    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEEPSEEK_KEY}` },
      body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: introPrompt }], temperature: 0.5, max_tokens: 200 }),
    });
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) intro = JSON.parse(jsonMatch[0]).intro || intro;
  } catch {}

  return { title: `AI Daily Briefing — ${today}`, intro, stories };
}

function buildHTML(briefing) {
  const storiesHTML = (briefing.stories || []).map(s => `
    <article class="story">
      <h3>${s.headline}</h3>
      <div class="story-body">${(s.body || s.summary || '').split('\n').filter(p => p.trim()).map(p => `<p>${p.trim()}</p>`).join('\n')}</div>
      <div class="story-meta">
        <span class="story-source">${s.source}</span>
        <a href="${s.url}" target="_blank" rel="noopener" class="original-link">Read original →</a>
      </div>
    </article>`).join('\n');

  const storySchema = (briefing.stories || []).map(s => ({
    '@type': 'NewsArticle',
    'headline': s.headline,
    'url': s.url,
    'datePublished': today,
    'publisher': { '@type': 'Organization', 'name': 'Nerd Studio', 'url': 'https://nerdstudio.online' },
    'description': (s.body || '').slice(0, 160),
  }));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8835580597891369" crossorigin="anonymous"></script>
  <title>${briefing.title} — Nerd Studio</title>
  <meta name="description" content="${briefing.intro}" />
  <meta property="og:title" content="${briefing.title}" />
  <meta property="og:description" content="${briefing.intro}" />
  <meta property="og:type" content="article" />
  <meta property="og:image" content="https://nerdstudio.online/og-image.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${briefing.title}" />
  <meta name="twitter:image" content="https://nerdstudio.online/og-image.png" />
  <link rel="canonical" href="https://nerdstudio.online/news/${today}/" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "itemListElement": ${JSON.stringify(storySchema)}
  }
  </script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Space+Grotesk:wght@600;700&display=swap" rel="stylesheet" />
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{--bg:#020617;--surface:#0f172a;--border:#1e293b;--accent:#22c55e;--text:#f8fafc;--muted:#94a3b8;--dim:#64748b}
    body{font-family:'DM Sans',-apple-system,sans-serif;background:var(--bg);color:var(--text);line-height:1.7;min-height:100vh}
    h1,h2,h3{font-family:'Space Grotesk',sans-serif}
    a{color:var(--accent);text-decoration:none}
    a:hover{text-decoration:underline}
    :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    .nav{position:sticky;top:0;z-index:10;display:flex;justify-content:space-between;align-items:center;padding:1rem 2rem;background:rgba(2,6,23,0.92);backdrop-filter:blur(12px);border-bottom:1px solid rgba(255,255,255,0.06)}
    .logo{font-family:'Space Grotesk',sans-serif;font-size:1.1rem;font-weight:700;color:var(--text);text-decoration:none}
    .logo span{color:var(--accent)}
    .logo:hover{text-decoration:none}
    .nav-links{display:flex;gap:1.5rem;align-items:center}
    .nav-links a{color:var(--muted);font-size:0.85rem;transition:color 0.2s}
    .nav-links a:hover{color:var(--text);text-decoration:none}
    .container{max-width:680px;margin:0 auto;padding:3rem 1.5rem}
    .date-badge{display:inline-block;background:rgba(34,197,94,0.12);color:var(--accent);border:1px solid rgba(34,197,94,0.2);border-radius:999px;padding:0.2rem 0.8rem;font-size:0.7rem;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:1rem}
    h1{font-size:1.75rem;font-weight:700;line-height:1.3;margin-bottom:0.5rem}
    .intro{color:var(--muted);font-size:1rem;margin-bottom:2.5rem;line-height:1.7}
    .story{padding:1.2rem 0;border-bottom:1px solid var(--border)}
    .story h3{font-size:1.1rem;font-weight:700;margin-bottom:0.3rem}
    .story h3 a{color:var(--text)}
    .story h3 a:hover{color:var(--accent);text-decoration:none}
    .story-body{color:var(--muted);font-size:0.88rem;line-height:1.7}
    .story-body p{margin-bottom:0.8rem}
    .story-meta{display:flex;justify-content:space-between;align-items:center;margin-top:0.8rem;padding-top:0.6rem;border-top:1px solid rgba(255,255,255,0.04)}
    .story-source{color:var(--dim);font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em}
    .original-link{color:var(--dim);font-size:0.75rem;transition:color 0.2s}
    .original-link:hover{color:var(--accent)}
    .auto-disclaimer{text-align:center;color:var(--dim);font-size:0.7rem;margin-top:3rem;padding-top:1.5rem;border-top:1px solid var(--border)}
    footer{text-align:center;padding:2rem;border-top:1px solid rgba(255,255,255,0.06);color:var(--dim);font-size:0.78rem}
    footer a{color:var(--muted)}
    @media(max-width:768px){.nav{padding:0.85rem 1.25rem}.container{padding:2rem 1.25rem}h1{font-size:1.35rem}}
  </style>
</head>
<body>
<nav class="nav">
  <a href="/" class="logo">Nerd<span>Studio</span></a>
  <div class="nav-links">
    <a href="/#features">Features</a>
    <a href="/#pricing">Pricing</a>
    <a href="/blog/">Blog</a>
    <a href="/news/">News</a>
  </div>
</nav>
<main class="container">
  <div class="date-badge">${today}</div>
  <h1>${briefing.title}</h1>
  <p class="intro">${briefing.intro}</p>
  ${storiesHTML}
  <p class="auto-disclaimer">Automated daily briefing. Sources linked. Not original reporting.</p>
</main>
<footer>
  <p>&copy; 2026 Nerd Studio. <a href="/">Home</a> · <a href="/news/">Archive</a></p>
</footer>
</body>
</html>`;
}

function updateArchive(briefing) {
  const archiveFile = path.join(NEWS_DIR, 'index.html');
  const entry = `<article class="news-card">
    <div class="news-date">${today}</div>
    <h3><a href="/news/${today}/">${briefing.title}</a></h3>
    <p>${(briefing.intro || '').slice(0, 180)}</p>
  </article>`;

  if (fs.existsSync(archiveFile)) {
    let html = fs.readFileSync(archiveFile, 'utf8');
    // Insert new entry after the archive-list div
    html = html.replace('<!-- NEW_ENTRIES -->', entry + '\n<!-- NEW_ENTRIES -->');
    fs.writeFileSync(archiveFile, html);
  } else {
    createArchivePage(entry);
  }
}

function createArchivePage(firstEntry) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AI News Archive — Nerd Studio</title>
  <meta name="description" content="Daily AI news briefings. Automated roundups of the most important AI stories." />
  <link rel="canonical" href="https://nerdstudio.online/news/" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Space+Grotesk:wght@600;700&display=swap" rel="stylesheet" />
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{--bg:#020617;--surface:#0f172a;--border:#1e293b;--accent:#22c55e;--text:#f8fafc;--muted:#94a3b8;--dim:#64748b}
    body{font-family:'DM Sans',-apple-system,sans-serif;background:var(--bg);color:var(--text);line-height:1.7;min-height:100vh}
    h1,h2,h3{font-family:'Space Grotesk',sans-serif}
    a{color:var(--accent);text-decoration:none}
    a:hover{text-decoration:underline}
    :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    .nav{position:sticky;top:0;z-index:10;display:flex;justify-content:space-between;align-items:center;padding:1rem 2rem;background:rgba(2,6,23,0.92);backdrop-filter:blur(12px);border-bottom:1px solid rgba(255,255,255,0.06)}
    .logo{font-family:'Space Grotesk',sans-serif;font-size:1.1rem;font-weight:700;color:var(--text);text-decoration:none}
    .logo span{color:var(--accent)}
    .logo:hover{text-decoration:none}
    .nav-links{display:flex;gap:1.5rem;align-items:center}
    .nav-links a{color:var(--muted);font-size:0.85rem;transition:color 0.2s}
    .nav-links a:hover{color:var(--text);text-decoration:none}
    .container{max-width:680px;margin:0 auto;padding:3rem 1.5rem}
    h1{font-size:1.75rem;font-weight:700;margin-bottom:0.3rem}
    .page-sub{color:var(--muted);font-size:0.95rem;margin-bottom:2rem}
    .news-card{padding:1.2rem 0;border-bottom:1px solid var(--border)}
    .news-date{font-size:0.72rem;color:var(--dim);margin-bottom:0.2rem;text-transform:uppercase;letter-spacing:0.05em}
    .news-card h3{font-size:1.1rem;font-weight:700;margin-bottom:0.2rem}
    .news-card h3 a{color:var(--text)}
    .news-card h3 a:hover{color:var(--accent);text-decoration:none}
    .news-card p{color:var(--muted);font-size:0.85rem}
    footer{text-align:center;padding:2rem;border-top:1px solid rgba(255,255,255,0.06);color:var(--dim);font-size:0.78rem}
    footer a{color:var(--muted)}
    @media(max-width:768px){.nav{padding:0.85rem 1.25rem}.container{padding:2rem 1.25rem}h1{font-size:1.35rem}}
  </style>
</head>
<body>
<nav class="nav">
  <a href="/" class="logo">Nerd<span>Studio</span></a>
  <div class="nav-links">
    <a href="/#features">Features</a>
    <a href="/#pricing">Pricing</a>
    <a href="/blog/">Blog</a>
    <a href="/news/">News</a>
  </div>
</nav>
<main class="container">
  <h1>AI News Archive</h1>
  <p class="page-sub">Daily automated briefings. The most important AI stories, summarized each morning.</p>
  <!-- NEW_ENTRIES -->
  ${firstEntry}
  <!-- NEW_ENTRIES -->
</main>
<footer>
  <p>&copy; 2026 Nerd Studio. <a href="/">Home</a> · <a href="/news/">Archive</a></p>
</footer>
</body>
</html>`;
  fs.writeFileSync(path.join(NEWS_DIR, 'index.html'), html);
}

function instagramCaption(briefing) {
  const headlines = (briefing.stories || []).slice(0, 4).map(s =>
    `• ${s.headline}`
  ).join('\n');

  return `🤖 AI Daily Briefing — ${today}

${briefing.intro?.slice(0, 200)}

Today's top stories:
${headlines}

Read full briefing: nerdstudio.online/news/${today}/

#AI #ArtificialIntelligence #TechNews #AINews #DailyBriefing`;
}

function getTrendingTopics() {
  try {
    const out = execSync('python3 /opt/nerdstudio-news/trending-topics.py', { encoding: 'utf8', timeout: 15000 });
    return JSON.parse(out.trim());
  } catch (err) {
    console.error(`[trends] Failed: ${err.message}`);
    return ['AI regulation', 'AI models', 'AI startups', 'AI chips', 'AI jobs'];
  }
}

function scoreArticle(item, trends) {
  const text = (item.title + ' ' + item.desc).toLowerCase();
  let score = 0;
  trends.forEach(t => {
    if (text.includes(t.toLowerCase())) score += 10;
    // Partial word match
    t.toLowerCase().split(/\s+/).forEach(word => {
      if (word.length > 3 && text.includes(word)) score += 2;
    });
  });
  return score;
}

// ── Main ──

(async () => {
  // Idempotency check — don't publish twice for the same date
  const pageDir = path.join(NEWS_DIR, today);
  if (fs.existsSync(pageDir)) {
    console.log(`[news] Post for ${today} already exists. Skipping.`);
    process.exit(0);
  }

  console.log(`[news] Starting daily fetch for ${today}`);

  // 0. Get trending AI topics from Google Trends
  console.log('[news] Fetching Google Trends...');
  const trends = getTrendingTopics();
  console.log(`[news] Trending topics: ${trends.slice(0, 8).join(', ')}`);

  // 1. Fetch all feeds in parallel
  const allItems = [];
  for (const feed of FEEDS) {
    console.log(`[news] Fetching ${feed.name}...`);
    const items = await fetchFeed(feed);
    console.log(`[news]   ${items.length} items from ${feed.name}`);
    allItems.push(...items);
  }

  // Score and sort by trending relevance
  const scored = allItems.map(i => ({ ...i, trendScore: scoreArticle(i, trends) }));
  scored.sort((a, b) => b.trendScore - a.trendScore);

  // Remove duplicates by similar titles
  const seen = new Set();
  const unique = scored.filter(i => {
    const key = i.title.slice(0, 60).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const trending = unique.filter(i => i.trendScore > 0);
  const rest = unique.filter(i => i.trendScore === 0);
  const ranked = [...trending, ...rest];

  console.log(`[news] ${scored.length} total, ${trending.length} trending, ${rest.length} other`);

  // 2. Rewrite with DeepSeek (top 8, prioritized by trend score)
  const briefing = await summarize(ranked.slice(0, 8));

  // 3. Publish
  if (briefing && briefing.stories?.length > 0) {
    fs.mkdirSync(pageDir, { recursive: true });

    const html = buildHTML(briefing);
    fs.writeFileSync(path.join(pageDir, 'index.html'), html);
    console.log(`[news] Published to /news/${today}/`);

    updateArchive(briefing);
    console.log('[news] Archive updated');

    // Instagram caption
    const ig = instagramCaption(briefing);
    const captionFile = path.join(pageDir, 'instagram.txt');
    fs.writeFileSync(captionFile, ig);
    console.log('[news] Instagram caption saved');

    console.log(`[news] Done. ${briefing.stories.length} stories published.`);
  } else {
    console.error('[news] Failed to generate briefing. Check Gemini API key.');
    process.exit(1);
  }
})().catch(err => {
  console.error('[news] Fatal:', err);
  process.exit(1);
});
