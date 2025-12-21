# Research Libraries - Quick Start

## What You Can Do Now

### 1. Browse Your Libraries ✅
- Visit `/research`
- See all your ADS libraries listed
- Click any library to expand/collapse
- See paper count and descriptions

### 2. View Paper Details ✅
- Click expanded library to see papers
- See title, authors, abstract, year
- Click title to open paper (arXiv or ADS)
- Click badges for direct links

### 3. Generate Paper Summaries ✅
- Click "Summarize" button on any paper
- 2-3 sentence AI summary appears
- Uses full paper text when available
- Great for quick paper overviews

### 4. Ask Questions About Papers ✅
- Use the "Ask About Papers" panel at top
- Type any question
- System searches your cached papers
- Get synthesized answer from multiple papers
- See which papers the answer is based on

## Getting Started

### Setup (5 minutes)

1. **Ensure ADS_API_TOKEN is set:**
   ```bash
   # Check .env.local
   echo $ADS_API_TOKEN
   ```

2. **Ensure ANTHROPIC_API_KEY is set** (for summaries):
   ```bash
   # Check .env.local
   echo $ANTHROPIC_API_KEY
   ```

3. **Visit the research page:**
   - Open http://localhost:3000/research
   - Wait for libraries to load (first time takes a few seconds)
   - Expand a library to see papers

### First Steps (10 minutes)

1. **Explore a library:**
   - Click "Benchmarks" to expand
   - Browse papers and their metadata
   - Click a paper title to read it

2. **Try a summary:**
   - Click "Summarize" on an interesting paper
   - Wait for summary to appear (5-10 seconds)
   - Read the AI-generated summary

3. **Ask a question:**
   - Scroll to "Ask About Papers" panel
   - Type: "What papers discuss machine learning?"
   - Wait for answer (10-15 seconds)
   - Click source papers to explore

## Common Tasks

### Find Papers on a Topic
```
Ask: "What papers discuss neural networks?"
→ System searches library
→ Returns relevant papers with answer
```

### Quickly Review Many Papers
```
1. Expand library
2. Click "Summarize" on 5-10 papers
3. Scroll through summaries
4. Click titles to read full papers if interested
```

### Build Research Summary
```
1. Ask: "What is X topic?" (broad question)
2. Read answer and review source papers
3. Summarize those specific papers
4. Compile findings
```

### Compare Papers
```
1. Summarize paper A
2. Summarize paper B
3. Ask: "How do these approaches compare?"
→ System uses summaries + full text
```

## What Happens Behind the Scenes

### First Library Load
1. Fetches all papers from ADS
2. Fetches title, authors, abstract, full text
3. Stores everything in local database
4. Displays papers in UI
5. Takes 10-30 seconds depending on library size

### Subsequent Loads
1. Uses cached database
2. Instant display
3. No API calls needed

### When You Summarize
1. Checks if paper is cached (usually yes)
2. Sends full text to Claude API
3. Gets back 2-3 sentence summary
4. Stores in browser session
5. Displays under paper

### When You Ask a Question
1. Searches all cached papers locally (fast)
2. Takes top 10 relevant papers
3. Sends to Claude with full context
4. Gets back synthesized answer
5. Shows source papers below

## API Endpoints

### Available endpoints:

```bash
# List all libraries
curl -X POST http://localhost:3000/api/libraries

# Get papers from a library
curl "http://localhost:3000/api/libraries?library=Benchmarks&rows=50&metadata=true"

# Get summary for a paper
curl -X POST "http://localhost:3000/api/papers/2025arXiv251212730D/summarize"

# Ask a question
curl -X POST "http://localhost:3000/api/papers/ask" \
  -H "Content-Type: application/json" \
  -d '{"question": "What is machine learning?"}'
```

## Database Storage

Everything fetched is stored locally in `.data/digest.db`:

### What's stored:
- Paper titles, authors, dates
- Abstracts
- **Full paper text** (from ADS API)
- Links (ADS + arXiv)
- Which papers are in which libraries

### Database tables:
- `ads_papers` - Paper metadata and full text
- `ads_library_papers` - Library membership
- `ads_libraries` - Library info

### Size estimate:
- ~100 papers: 5-10 MB
- ~1000 papers: 50-100 MB

## Limitations & Known Issues

### Limitations
1. Only works with papers in your ADS libraries
2. Q&A limited to top 10 papers (to avoid token limits)
3. Summaries limited to 500 tokens
4. Searches local cache (not ADS API directly)

### Known Issues
- First library load is slow (fetches all papers)
- Large libraries (1000+) may take 1-2 minutes
- Q&A may not work well with very broad questions
- Some papers may not have full text available

## Next Steps

1. **Explore your libraries:**
   - Browse all libraries
   - Expand a few and look at papers

2. **Generate summaries:**
   - Summarize papers you're interested in
   - Use summaries to decide what to read

3. **Ask questions:**
   - Try different question types
   - See how the system finds relevant papers
   - Refine questions based on results

4. **Keep exploring:**
   - More libraries = better Q&A results
   - As you expand more libraries, search improves
   - Paper database grows automatically

## Support

### Check Logs
```bash
# Terminal where app is running
# Look for [WARN] or [ERROR] messages
# Check specific API response errors
```

### Test API Directly
```bash
# Test metadata fetch
curl "http://localhost:3000/api/libraries?library=Benchmarks&start=0&rows=5&metadata=true"

# Should return papers with full text
```

### Database Inspection
```bash
# Check what's cached
sqlite3 .data/digest.db
sqlite> SELECT COUNT(*) FROM ads_papers;
sqlite> SELECT title FROM ads_papers LIMIT 5;
```

## Tips & Tricks

1. **Faster browsing**: Start with smaller libraries
2. **Better Q&A**: Expand multiple libraries first (more papers = better answers)
3. **Efficient reading**: Use summaries to prioritize papers
4. **Specific questions**: More specific questions give better results
5. **Topic questions**: "Papers about X" works better than open-ended questions

## Feedback & Future

What would make this more useful?
- Better search filters?
- Citation tracking?
- Paper recommendations?
- Export functionality?
- Integration with your digest?

Let me know what features would be most valuable!
