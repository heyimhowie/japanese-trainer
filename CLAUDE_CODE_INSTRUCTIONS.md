# How to Build This Project with Claude Code

## Getting Started

This folder contains everything you need to build a personalized Japanese learning tool.

### Step 1: Open this project in Claude Code
```bash
cd japanese-trainer
claude
```

### Step 2: Give Claude Code context
Tell Claude Code:
```
Read PROJECT_SPEC.md and all files in the data/ directory. This is a personal Japanese learning app. Build the MVP as described in the spec — a local web app with four modes: Sentence Builder Drill, Script Prep, Vocabulary Contextualizer, and Transcript Analysis. Start with the data processing layer (parsing JPDB vocab and Bunpro grammar), then build out one mode at a time.
```

### Step 3: Iterative building
Claude Code works best when you build iteratively:

1. **First: Data layer** — Parse reviews.json and bunpro_progress.csv into usable structures. Categorize vocab into strong/moderate/weak. Map grammar to mastery tiers.

2. **Second: Sentence Builder Drill** — This is the highest-impact feature. Get it generating sentences from your known vocabulary + grammar + life context using Claude API.

3. **Third: Script Prep** — Generates conversation prep cards for voice sessions.

4. **Fourth: Vocabulary Contextualizer** — Shows your vocab in life contexts, identifies gaps.

5. **Fifth: Transcript Analysis** — Paste in voice session transcripts for feedback.

### API Key
You'll need an Anthropic API key for Claude to generate Japanese content.
Set it as an environment variable:
```bash
export ANTHROPIC_API_KEY=your_key_here
```

## Project Structure After Building
```
japanese-trainer/
├── PROJECT_SPEC.md          # Full spec (Claude Code reads this)
├── CLAUDE_CODE_INSTRUCTIONS.md  # This file
├── data/
│   ├── reviews.json         # JPDB vocabulary (4,224 words)
│   ├── bunpro_progress.csv  # Bunpro grammar progress
│   └── life_context.json    # Life domains and scenarios
├── src/                     # (Claude Code creates this)
│   ├── server/              # Backend
│   ├── client/              # Frontend
│   └── lib/                 # Data processing, Claude API calls
├── learner_profile.json     # (Generated) Tracks production history
└── package.json             # (Generated)
```

## Tips for Working with Claude Code on This Project

- **Start small.** Get the data parsing working first, then one drill type, then expand.
- **Test Japanese output.** Ask Claude Code to generate a few sample sentences to verify quality before building the full UI.
- **Keep the UI simple.** This is a personal tool. Function over form.
- **Save your API calls.** Batch-generate content when possible rather than calling Claude for every single interaction.
- **Iterate on prompts.** The quality of the Japanese output depends heavily on the system prompts sent to Claude API. Refine these as you test.
