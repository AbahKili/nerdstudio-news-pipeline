#!/usr/bin/env node
'use strict';

// ── Auto Blog — generates the next queued blog post using DeepSeek, publishes weekly ──

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || '';
const BLOG_DIR = '/var/www/nerdstudio.online/blog';
const SCHEDULE_FILE = '/opt/nerdstudio-news/blog-schedule.json';
const today = new Date().toISOString().slice(0, 10);

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function generatePost(topic) {
  const prompt = `You are a tech blogger for Nerd Studio. Write a blog post on this topic:

TITLE: ${topic.title}
ANGLE: ${topic.angle || 'Personal experience and technical insights'}

Write a 800-1200 word blog post in English. Structure:
1. Hook — why this matters (1 paragraph)
2. The problem or context (1-2 paragraphs)
3. The solution / what you built / what you learned (2-3 paragraphs)
4. Key takeaways or lessons (1-2 paragraphs)
5. A closing thought

Use a conversational, practical tone. Include specific technical details, real code snippets where relevant, and honest reflections. Write as a solo developer building in public.

Return as JSON:
{ "title": "...", "body": "... full HTML body with <p>, <h2>, <pre><code> tags ...", "description": "... SEO description, 160 chars max ..." }`;

  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEEPSEEK_KEY}` },
    body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: prompt }], temperature: 0.7, max_tokens: 4000 }),
  });
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in DeepSeek response');
  return JSON.parse(jsonMatch[0]);
}

function buildHTML(post) {
  const slug = slugify(post.title);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${post.title} — Nerd Studio</title>
  <meta name="description" content="${post.description}" />
  <meta property="og:title" content="${post.title}" />
  <meta property="og:description" content="${post.description}" />
  <meta property="og:type" content="article" />
  <meta property="og:image" content="https://nerdstudio.online/og-image.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="article:published_time" content="${today}T08:00:00+07:00" />
  <meta property="article:author" content="Abah" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${post.title}" />
  <meta name="twitter:image" content="https://nerdstudio.online/og-image.png" />
  <link rel="canonical" href="https://nerdstudio.online/blog/${slug}.html" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Space+Grotesk:wght@600;700&display=swap" rel="stylesheet" />
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8835580597891369" crossorigin="anonymous"></script>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": "${post.title}",
    "description": "${post.description}",
    "author": { "@type": "Person", "name": "Abah" },
    "datePublished": "${today}",
    "publisher": { "@type": "Organization", "name": "Nerd Studio", "url": "https://nerdstudio.online" }
  }
  </script>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{--bg:#020617;--surface:#0f172a;--border:#1e293b;--accent:#22c55e;--text:#f8fafc;--muted:#94a3b8;--dim:#64748b}
    body{font-family:'DM Sans',-apple-system,sans-serif;background:var(--bg);color:var(--text);line-height:1.8;min-height:100vh}
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
    h1{font-size:1.75rem;font-weight:700;line-height:1.3;margin-bottom:0.5rem}
    .post-meta{color:var(--dim);font-size:0.8rem;margin-bottom:2.5rem}
    .container h2{font-size:1.3rem;font-weight:700;margin:2rem 0 0.75rem;color:var(--accent)}
    .container p{margin-bottom:1.2rem;color:var(--muted);font-size:0.95rem}
    .container ul,.container ol{margin:0 0 1.2rem 1.5rem;color:var(--muted)}
    .container li{margin-bottom:0.4rem}
    .container strong{color:var(--text)}
    pre{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:1rem 1.2rem;overflow-x:auto;font-size:0.8rem;line-height:1.6;margin-bottom:1.2rem}
    code{font-family:monospace;font-size:0.85em}
    pre code{color:var(--text)}
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
  <article>
    <h1>${post.title}</h1>
    <p class="post-meta">${today} · Auto-generated by Nerd Studio</p>
    ${post.body}
  </article>
</main>
<footer>
  <p>&copy; 2026 Nerd Studio. <a href="/">Home</a> · <a href="/blog/">Blog</a> · <a href="/news/">News</a></p>
</footer>
</body>
</html>`;
}

async function main() {
  if (!DEEPSEEK_KEY) { console.error('[auto-blog] No DeepSeek key'); process.exit(1); }

  const schedule = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8'));
  const next = schedule.find(p => p.status === 'next');
  if (!next) { console.log('[auto-blog] No queued posts. All done!'); process.exit(0); }

  const slug = slugify(next.title);
  const filePath = path.join(BLOG_DIR, `${slug}.html`);

  // Idempotency guard
  if (fs.existsSync(filePath)) {
    console.log(`[auto-blog] Post already exists: ${slug}.html — skipping`);
    process.exit(0);
  }

  console.log(`[auto-blog] Generating Week ${next.week}: ${next.title}`);
  const post = await generatePost(next);

  // Save HTML
  fs.writeFileSync(filePath, buildHTML(post));
  console.log(`[auto-blog] Published to /blog/${slug}.html`);

  // Update blog index
  const indexFile = path.join(BLOG_DIR, 'index.html');
  const entry = `\n  <article class="post-card">
    <div class="post-date">${today}</div>
    <h2><a href="/blog/${slug}.html">${post.title}</a></h2>
    <p>${(post.description || '').slice(0, 180)}</p>
  </article>`;

  let indexHTML = fs.readFileSync(indexFile, 'utf8');
  const insertPoint = indexHTML.indexOf('<article class="post-card">');
  if (insertPoint > 0) {
    indexHTML = indexHTML.slice(0, insertPoint) + entry + '\n  ' + indexHTML.slice(insertPoint);
    fs.writeFileSync(indexFile, indexHTML);
  }
  console.log('[auto-blog] Blog index updated');

  // Mark as done, advance next
  next.status = 'done';
  next.file = `${slug}.html`;
  const nextQueued = schedule.find(p => p.status === 'queued');
  if (nextQueued) nextQueued.status = 'next';
  fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(schedule, null, 2));
  console.log('[auto-blog] Schedule advanced');
  console.log(`[auto-blog] Done. ${post.title}`);
}

main().catch(err => { console.error('[auto-blog] Fatal:', err); process.exit(1); });
