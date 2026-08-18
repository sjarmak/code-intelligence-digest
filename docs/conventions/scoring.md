# Hybrid scoring system (LLM + BM25 + Recency + Engagement)

Detailed design and experiments: `history/docs/hybrid-scoring-system.md`.

## Final score formula

Every item receives a `finalScore`:

```
finalScore = (LLM_norm * 0.45) + (BM25_norm * 0.35) + (Recency * 0.15) + (Engagement * 0.05)
```

| Component | Weight | What it measures |
| --- | --- | --- |
| **LLM** | 45% | Relevance & usefulness to devs (0-10 scale) |
| **BM25** | 35% | Term matching against domain vocabulary (0-1 normalized) |
| **Recency** | 15% | Exponential time decay (weekly half-life ≈ 3 days) |
| **Engagement** | 5% | Community-only (Reddit upvotes / comments) |

## Domain terms (BM25 query expansion)

| Term | Boost |
| --- | --- |
| Code Search | 1.6× |
| Information Retrieval | 1.5× |
| Context Management | 1.5× |
| Agentic Workflows | 1.4× |
| Enterprise Codebases | 1.3× |
| Developer Tools | 1.2× |
| LLM Code Architecture | 1.2× |
| SDLC Processes | 1.0× |

## When to change weights

Re-tune weights only when an A/B comparison on starred items shifts. The current weights came out of the experiment series documented in `history/docs/hybrid-scoring-system.md`. Save tuning runs and the new formula in `history/docs/` if you change them.
