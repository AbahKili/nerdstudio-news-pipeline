#!/usr/bin/env python3
"""Fetch trending AI-related topics from Google Trends."""
import json, sys
from pytrends.request import TrendReq

try:
    pytrends = TrendReq(hl='en-US', tz=360)

    # Get trending searches related to AI
    kw_list = ['artificial intelligence', 'machine learning', 'AI tools', 'ChatGPT', 'Gemini', 'Claude AI']
    trending = []

    for kw in kw_list:
        try:
            pytrends.build_payload([kw], timeframe='now 1-d', geo='US')
            related = pytrends.related_queries()
            if related and kw in related:
                rising = related[kw].get('rising')
                if rising is not None and not rising.empty:
                    topics = rising['query'].head(5).tolist()
                    trending.extend(topics)
        except:
            continue

    # Deduplicate and filter to AI-relevant
    seen = set()
    unique = []
    for t in trending:
        lower = t.lower()
        if lower not in seen and len(t) > 3:
            seen.add(lower)
            unique.append(t)

    topics = unique[:15] if unique else ['AI regulation', 'AI models', 'AI startups', 'AI chips', 'AI jobs']
    print(json.dumps(topics))

except Exception as e:
    # Fallback: trending AI topics
    print(json.dumps(['AI regulation', 'AI models', 'AI startups', 'AI chips', 'AI jobs', 'Gemini AI', 'ChatGPT updates']))
