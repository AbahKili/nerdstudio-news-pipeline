#!/usr/bin/env node
'use strict';

// ── AI GitHub Digest — finds trending AI repos, summarizes with DeepSeek, publishes every 3 days ──

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || '';
const BLOG_DIR = path.join('/var/www/nerdstudio.online', 'blog');
const today = new Date().toISOString().slice(0, 10);

async function searchRepos(query, limit) {
  try {
    const cmd = `gh search repos "${query}" --sort stars --order desc --limit ${limit || 5} --json name,owner,stargazersCount,forksCount,description,url,language`;
    return JSON.parse(execSync(cmd, { encoding: 'utf8', timeout: 15000 }));
  } catch (err) {
    console.error(`[gh] ${query} failed: ${err.message}`);
    return [];
  }
}

async function main() {
  // Idempotency check
  const slug = `github-ai-digest-${today}`;
  const outputPath = path.join(BLOG_DIR, `${slug}.html`);
  if (fs.existsSync(outputPath)) {
    console.log(`[digest] Post for ${today} already exists. Skipping.`);
    process.exit(0);
  }

  console.log(`[digest] Starting GitHub AI digest for ${today}`);

  // 1. Search multiple categories
  const searches = [
    { label: 'AI Agents', query: 'AI agent open source', limit: 30 },
    { label: 'AI Tools', query: 'AI tools utility', limit: 30 },
    { label: 'LLM Skills', query: 'LLM tools skills Claude GPT', limit: 30 },
    { label: 'AI Automation', query: 'AI automation workflow open source', limit: 30 },
  ];

  let allRepos = [];
  for (const s of searches) {
    console.log(`[digest] Searching: ${s.label}...`);
    const repos = await searchRepos(s.query, s.limit);
    process.stdout.write(`[digest]   ${repos.length} repos\n`);
    allRepos.push(...repos.map(r => ({ ...r, category: s.label })));
  }

  // 2. Deduplicate by repo name
  const seen = new Set();
  const unique = [];
  for (const r of allRepos) {
    const key = `${r.owner.login}/${r.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(r);
  }

  // 3. Filter to repos with meaningful descriptions and decent stars
  const filtered = unique.filter(r =>
    r.description && r.description.length > 10 && r.stargazersCount > 50
  );

  // 4. Sort by stars, pick top 6 per category
  const categories = {};
  for (const r of filtered) {
    if (!categories[r.category]) categories[r.category] = [];
    if (categories[r.category].length < 2) categories[r.category].push(r);
  }

  const picks = Object.values(categories).flat();

  // Guard: require real GitHub data
  if (picks.length === 0) {
    console.error('[digest] No repos found. Skipping publish.');
    process.exit(2);
  }

  console.log(`[digest] Picked ${picks.length} repos across ${Object.keys(categories).length} categories`);

  // 5. Summarize with DeepSeek
  if (!DEEPSEEK_KEY) { console.error('[digest] No DeepSeek key'); process.exit(1); }

  const repoList = picks.map((r, i) =>
    `REPO ${i}:\nName: ${r.owner.login}/${r.name}\nStars: ${r.stargazersCount}\nForks: ${r.forksCount}\nLanguage: ${r.language || 'N/A'}\nDescription: ${r.description}\nURL: ${r.url}\nCategory: ${r.category}`
  ).join('\n\n---\n\n');

  const prompt = `You are a tech writer for Nerd Studio. Below are trending AI-related GitHub repositories.

For each repo, write a 2-3 sentence blurb that:
- Explains what it does in plain English
- Says why it matters / who should care
- Mentions the star count naturally

Then write an introduction paragraph (2-3 sentences) about what's trending in AI open source this week. And a title: "AI GitHub Digest — ${today}"

Return ONLY valid JSON, no markdown:
{
  "title": "...",
  "intro": "...",
  "repos": [
    { "name": "owner/repo", "url": "...", "stars": 1234, "forks": 567, "language": "Python", "category": "AI Agents", "blurb": "..." }
  ]
}`;

  console.log('[digest] Summarizing with DeepSeek...');
  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEEPSEEK_KEY}` },
    body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: prompt }], temperature: 0.6, max_tokens: 3000 }),
  });
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) { console.error('[digest] No JSON'); process.exit(1); }
  const digest = JSON.parse(jsonMatch[0]);

  // 6. Generate HTML
  const repoHTML = (digest.repos || []).map(r => `
    <article class="repo-card">
      <div class="repo-header">
        <h3><a href="${r.url}" target="_blank" rel="noopener">${r.name}</a></h3>
        <span class="repo-stats">⭐ ${r.stargazersCount} · 🍴 ${r.forks} · ${r.language || ''}</span>
      </div>
      <span class="repo-category">${r.category}</span>
      <p>${r.blurb}</p>
    </article>`).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${digest.title} — Nerd Studio</title>
  <meta name="description" content="${digest.intro}" />
  <meta property="og:title" content="${digest.title}" />
  <meta property="og:description" content="${digest.intro}" />
  <meta property="og:type" content="article" />
  <meta property="og:image" content="https://nerdstudio.online/og-image.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${digest.title}" />
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
    "headline": "${digest.title}",
    "description": "${digest.intro}",
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
    h1{font-size:1.75rem;font-weight:700;margin-bottom:0.3rem}
    .intro{color:var(--muted);font-size:1rem;margin-bottom:2.5rem;line-height:1.7}
    .repo-card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:1.2rem;margin-bottom:0.85rem}
    .repo-header{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.4rem}
    .repo-header h3{font-size:1.05rem;font-weight:700}
    .repo-header h3 a{color:var(--text)}
    .repo-header h3 a:hover{color:var(--accent);text-decoration:none}
    .repo-stats{color:var(--dim);font-size:0.72rem;white-space:nowrap}
    .repo-category{display:inline-block;background:rgba(34,197,94,0.1);color:var(--accent);font-size:0.65rem;font-weight:600;padding:0.15rem 0.5rem;border-radius:4px;margin-bottom:0.5rem;text-transform:uppercase;letter-spacing:0.05em}
    .repo-card p{color:var(--muted);font-size:0.85rem;line-height:1.6}
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
  <h1>${digest.title}</h1>
  <p class="intro">${digest.intro}</p>
  ${repoHTML}
</main>
<footer>
  <p>&copy; 2026 Nerd Studio. <a href="/">Home</a> · <a href="/blog/">Blog</a> · <a href="/news/">News</a></p>
</footer>
</body>
</html>`;

  const filePath = path.join(BLOG_DIR, `${slug}.html`);
  fs.writeFileSync(filePath, html);
  console.log(`[digest] Published to /blog/${slug}.html`);

  // 7. Update blog index
  const indexFile = path.join(BLOG_DIR, 'index.html');
  const entry = `\n  <article class="post-card">
    <div class="post-date">${today}</div>
    <h2><a href="/blog/${slug}.html">${digest.title}</a></h2>
    <p>${(digest.intro || '').slice(0, 180)}</p>
  </article>`;

  let indexHTML = fs.readFileSync(indexFile, 'utf8');
  // Insert after the first post-card
  const insertPoint = indexHTML.indexOf('<article class="post-card">');
  if (insertPoint > 0) {
    indexHTML = indexHTML.slice(0, insertPoint) + entry + '\n  ' + indexHTML.slice(insertPoint);
    fs.writeFileSync(indexFile, indexHTML);
  }
  console.log('[digest] Blog index updated');
  console.log(`[digest] Done. ${digest.repos.length} repos featured.`);
}

main().catch(err => { console.error('[digest] Fatal:', err); process.exit(1); });
