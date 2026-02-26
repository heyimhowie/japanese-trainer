const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../db/index');
const { generateDrill, gradeResponse, chatFollowUp, generateFreeDrill, gradeFreeDrillResponse } = require('../lib/claude');
const { popDrill, replenishIfNeeded } = require('../lib/drillQueue');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB cap
});

// Load life context once
const lifeContext = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'life_context.json'), 'utf8')
);

// Helper: pick N random items from array
function sample(arr, n) {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

// Helper: get today's date string
function today() {
  return new Date().toISOString().split('T')[0];
}

// Helper: fuzzy-match a grammar pattern string from Claude to a grammar_status row
function findGrammarMatch(db, rawPattern) {
  if (!rawPattern || typeof rawPattern !== 'string') return null;

  // Clean the raw pattern: strip em-dash suffixes, colon suffixes, trailing English parentheticals
  let cleaned = rawPattern
    .replace(/\s*[—–-]\s*.+$/, '')       // "に — time marker" → "に"
    .replace(/\s*[:：]\s*.+$/, '')        // "に: time marker" → "に"
    .replace(/\s*\([^()]*[a-zA-Z][^()]*\)\s*$/, '') // "に (time marker)" → "に"
    .trim();

  if (!cleaned) return null;

  // 1. Exact match
  let row = db.prepare('SELECT id FROM grammar_status WHERE pattern_name = ?').get(cleaned);
  if (row) return row.id;

  // 2. Case-insensitive match
  row = db.prepare('SELECT id FROM grammar_status WHERE pattern_name = ? COLLATE NOCASE').get(cleaned);
  if (row) return row.id;

  // 3. Tilde normalization (～ ↔ 〜 ↔ ~)
  const tildeNormalized = cleaned.replace(/[～〜~]/g, '～');
  row = db.prepare("SELECT id FROM grammar_status WHERE REPLACE(REPLACE(REPLACE(pattern_name, '〜', '～'), '~', '～'), '～', '～') = ?").get(tildeNormalized);
  if (row) return row.id;

  // 4. Substring containment — longest match wins to avoid "が" clobbering "がある"
  const candidates = db.prepare(
    "SELECT id, pattern_name FROM grammar_status WHERE ? LIKE '%' || pattern_name || '%' OR pattern_name LIKE '%' || ? || '%'"
  ).all(cleaned, cleaned);

  if (candidates.length > 0) {
    candidates.sort((a, b) => b.pattern_name.length - a.pattern_name.length);
    return candidates[0].id;
  }

  return null;
}

// Helper: update production tracking for vocab and grammar after grading
function updateProductionTracking(db, vocabItems, grammarItems, isCorrect) {
  try {
    const now = new Date().toISOString();

    // Update vocabulary
    if (Array.isArray(vocabItems) && vocabItems.length > 0) {
      const updateVocab = db.transaction(() => {
        for (const item of vocabItems) {
          const word = item.spelling || item.word;
          if (!word) continue;

          const row = db.prepare(
            'SELECT id, times_drilled, times_correct, production_status FROM vocabulary_status WHERE spelling = ?'
          ).get(word);
          if (!row) continue;

          const newDrilled = row.times_drilled + 1;
          const newCorrect = row.times_correct + (isCorrect ? 1 : 0);

          let newStatus = row.production_status;
          if (isCorrect && newStatus === 'never_attempted') {
            newStatus = 'produced_once';
          } else if (isCorrect && newCorrect >= 3) {
            newStatus = 'consistently_produced';
          }

          db.prepare(
            'UPDATE vocabulary_status SET times_drilled = ?, times_correct = ?, production_status = ?, last_drilled = ? WHERE id = ?'
          ).run(newDrilled, newCorrect, newStatus, now, row.id);
        }
      });
      updateVocab();
    }

    // Update grammar
    if (Array.isArray(grammarItems) && grammarItems.length > 0) {
      const updateGrammar = db.transaction(() => {
        for (const item of grammarItems) {
          const pattern = typeof item === 'string' ? item : (item.pattern_name || item.grammar_point || item.name);
          if (!pattern) continue;

          const grammarId = findGrammarMatch(db, pattern);
          if (!grammarId) continue;

          const row = db.prepare(
            'SELECT times_drilled, times_correct, production_status FROM grammar_status WHERE id = ?'
          ).get(grammarId);
          if (!row) continue;

          const newDrilled = row.times_drilled + 1;
          const newCorrect = row.times_correct + (isCorrect ? 1 : 0);

          let newStatus = row.production_status;
          if (isCorrect && newStatus === 'never_attempted') {
            newStatus = 'sometimes_correct';
          } else if (isCorrect && newCorrect >= 3) {
            newStatus = 'reliable';
          }

          db.prepare(
            'UPDATE grammar_status SET times_drilled = ?, times_correct = ?, production_status = ?, last_drilled = ? WHERE id = ?'
          ).run(newDrilled, newCorrect, newStatus, now, grammarId);
        }
      });
      updateGrammar();
    }
  } catch (err) {
    console.error('Production tracking update error (non-fatal):', err);
  }
}

// GET /api/drill/domains — list available life domains
router.get('/domains', (req, res) => {
  const domains = Object.entries(lifeContext.life_domains).map(([key, val]) => ({
    key,
    topics: val.topics,
    scenarios: val.scenarios,
  }));
  res.json(domains);
});

// POST /api/drill/generate — generate a new drill sentence
router.post('/generate', async (req, res) => {
  try {
    const { tier = 1, level = 'blue', domain: requestedDomain } = req.body;

    // Validate inputs
    const tierNum = Number(tier);
    if (!Number.isInteger(tierNum) || tierNum < 1 || tierNum > 3) {
      return res.status(400).json({ error: 'Invalid tier (must be 1-3)' });
    }

    // Try pre-generated queue first
    const queued = popDrill('targeted', { tier: tierNum, level });
    if (queued) {
      replenishIfNeeded('targeted', { tier: tierNum, level });
      return res.json(queued);
    }

    // Fall through to live generation
    const db = getDb();

    // Pick domain and scenario
    const domainKeys = Object.keys(lifeContext.life_domains);
    const domainKey = requestedDomain || domainKeys[Math.floor(Math.random() * domainKeys.length)];
    const domainData = lifeContext.life_domains[domainKey];
    const scenario = domainData.scenarios[Math.floor(Math.random() * domainData.scenarios.length)];

    // Select vocabulary based on level and tier
    let vocabQuery;
    if (level === 'white') {
      vocabQuery = `SELECT vid, spelling, reading FROM vocabulary_status WHERE jpdb_tier = 'strong' ORDER BY RANDOM() LIMIT 30`;
    } else if (tierNum === 1) {
      vocabQuery = `SELECT vid, spelling, reading FROM vocabulary_status WHERE jpdb_tier = 'strong' ORDER BY RANDOM() LIMIT 50`;
    } else if (tierNum === 2) {
      vocabQuery = `
        SELECT vid, spelling, reading FROM (
          SELECT vid, spelling, reading FROM (SELECT vid, spelling, reading FROM vocabulary_status WHERE jpdb_tier = 'strong' ORDER BY RANDOM() LIMIT 35)
          UNION ALL
          SELECT vid, spelling, reading FROM (SELECT vid, spelling, reading FROM vocabulary_status WHERE jpdb_tier = 'moderate' ORDER BY RANDOM() LIMIT 15)
        )`;
    } else {
      vocabQuery = `
        SELECT vid, spelling, reading FROM (
          SELECT vid, spelling, reading FROM (SELECT vid, spelling, reading FROM vocabulary_status WHERE jpdb_tier = 'strong' ORDER BY RANDOM() LIMIT 25)
          UNION ALL
          SELECT vid, spelling, reading FROM (SELECT vid, spelling, reading FROM vocabulary_status WHERE jpdb_tier = 'moderate' ORDER BY RANDOM() LIMIT 15)
          UNION ALL
          SELECT vid, spelling, reading FROM (SELECT vid, spelling, reading FROM vocabulary_status WHERE jpdb_tier = 'weak' ORDER BY RANDOM() LIMIT 10)
        )`;
    }
    const vocabulary = db.prepare(vocabQuery).all();

    // Bias toward never-attempted vocab
    const neverAttempted = db.prepare(
      `SELECT vid, spelling, reading FROM vocabulary_status
       WHERE jpdb_tier IN ('strong', 'moderate') AND production_status = 'never_attempted'
       ORDER BY RANDOM() LIMIT 10`
    ).all();
    // Merge without duplicates
    const vocabMap = new Map(vocabulary.map(v => [v.vid, v]));
    for (const v of neverAttempted) vocabMap.set(v.vid, v);
    const finalVocab = [...vocabMap.values()];

    // Select grammar based on level and tier
    let grammarLevels;
    let grammarLimit;
    if (level === 'white') {
      grammarLevels = ['master', 'expert'];
      grammarLimit = 1;
    } else if (tierNum === 1) {
      grammarLevels = ['master', 'expert'];
      grammarLimit = 6;
    } else if (tierNum === 2) {
      grammarLevels = ['master', 'expert', 'seasoned'];
      grammarLimit = 6;
    } else {
      grammarLevels = ['master', 'expert', 'seasoned', 'adept'];
      grammarLimit = 6;
    }
    const placeholders = grammarLevels.map(() => '?').join(',');
    const grammar = db.prepare(
      `SELECT id, grammar_point, pattern_name, bunpro_level
       FROM grammar_status
       WHERE bunpro_level IN (${placeholders})
       ORDER BY RANDOM() LIMIT ?`
    ).all(...grammarLevels, grammarLimit);

    // Call Claude to generate the drill
    const drill = await generateDrill({
      tier: tierNum,
      level,
      domain: domainKey,
      scenario,
      vocabulary: finalVocab,
      grammar,
    });

    res.json({
      english: drill.english,
      target_japanese: drill.target_japanese,
      hints: drill.hints,
      vocabulary_used: drill.vocabulary_used,
      grammar_used: drill.grammar_used,
      domain: domainKey,
      tier: tierNum,
      level,
    });
  } catch (err) {
    console.error('Drill generation error:', err);
    res.status(500).json({ error: 'Failed to generate drill' });
  }
});

// POST /api/drill/submit — grade user's response
router.post('/submit', async (req, res) => {
  try {
    const {
      english_prompt,
      target_japanese,
      user_response,
      mode = 'typed',
      domain,
      tier = 1,
      response_time_seconds,
      vocabulary_used,
      grammar_used,
      hints,
    } = req.body;

    if (!user_response || !user_response.trim()) {
      return res.status(400).json({ error: 'No response provided' });
    }
    if (typeof user_response !== 'string' || user_response.length > 2000) {
      return res.status(400).json({ error: 'Response too long (max 2000 characters)' });
    }

    const db = getDb();

    // Call Claude to grade — pass the hints so grader knows what was suggested
    const result = await gradeResponse({
      englishPrompt: english_prompt,
      targetJapanese: target_japanese,
      userResponse: user_response,
      hints,
    });

    // Save drill result
    const insertResult = db.prepare(`
      INSERT INTO drill_results
        (mode, english_prompt, target_japanese, user_response, is_correct,
         vocabulary_used, grammar_used, errors, life_domain, difficulty_tier, response_time_seconds)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      mode,
      english_prompt,
      result.target_japanese || target_japanese,
      user_response,
      result.is_correct ? 1 : 0,
      JSON.stringify(vocabulary_used || []),
      JSON.stringify(grammar_used || []),
      JSON.stringify(result.errors || []),
      domain,
      tier,
      response_time_seconds || null
    );

    result.drillResultId = Number(insertResult.lastInsertRowid);

    // Update daily stats
    const dateStr = today();
    db.prepare(`
      INSERT INTO daily_stats (date, drills_completed, drills_correct, voice_drills, typed_drills, streak_day)
      VALUES (?, 1, ?, ?, ?, TRUE)
      ON CONFLICT(date) DO UPDATE SET
        drills_completed = drills_completed + 1,
        drills_correct = drills_correct + EXCLUDED.drills_correct,
        voice_drills = voice_drills + EXCLUDED.voice_drills,
        typed_drills = typed_drills + EXCLUDED.typed_drills,
        accuracy_rate = CAST(drills_correct + EXCLUDED.drills_correct AS REAL) / (drills_completed + 1),
        streak_day = TRUE
    `).run(
      dateStr,
      result.is_correct ? 1 : 0,
      mode === 'voice' ? 1 : 0,
      mode === 'typed' ? 1 : 0
    );

    updateProductionTracking(db, vocabulary_used, grammar_used, result.is_correct);

    res.json(result);
  } catch (err) {
    console.error('Drill grading error:', err);
    res.status(500).json({ error: 'Failed to grade response' });
  }
});

// POST /api/drill/generate-free — generate a free production prompt
router.post('/generate-free', async (req, res) => {
  try {
    const { difficulty = 1, domain: requestedDomain } = req.body;

    // Validate inputs
    const diffNum = Number(difficulty);
    if (!Number.isInteger(diffNum) || diffNum < 1 || diffNum > 5) {
      return res.status(400).json({ error: 'Invalid difficulty (must be 1-5)' });
    }

    // Try pre-generated queue first
    const queued = popDrill('free', { difficulty: diffNum });
    if (queued) {
      replenishIfNeeded('free', { difficulty: diffNum });
      return res.json(queued);
    }

    // Fall through to live generation
    const db = getDb();

    // Pick domain and scenario
    const domainKeys = Object.keys(lifeContext.life_domains);
    const domainKey = requestedDomain || domainKeys[Math.floor(Math.random() * domainKeys.length)];
    const domainData = lifeContext.life_domains[domainKey];
    const scenario = domainData.scenarios[Math.floor(Math.random() * domainData.scenarios.length)];

    // Select vocabulary from ALL tiers, weighted by difficulty
    let vocabQuery;
    if (diffNum <= 2) {
      vocabQuery = `
        SELECT vid, spelling, reading FROM (
          SELECT vid, spelling, reading FROM (SELECT vid, spelling, reading FROM vocabulary_status WHERE jpdb_tier = 'strong' ORDER BY RANDOM() LIMIT 40)
          UNION ALL
          SELECT vid, spelling, reading FROM (SELECT vid, spelling, reading FROM vocabulary_status WHERE jpdb_tier = 'moderate' ORDER BY RANDOM() LIMIT 10)
        )`;
    } else if (diffNum <= 4) {
      vocabQuery = `
        SELECT vid, spelling, reading FROM (
          SELECT vid, spelling, reading FROM (SELECT vid, spelling, reading FROM vocabulary_status WHERE jpdb_tier = 'strong' ORDER BY RANDOM() LIMIT 25)
          UNION ALL
          SELECT vid, spelling, reading FROM (SELECT vid, spelling, reading FROM vocabulary_status WHERE jpdb_tier = 'moderate' ORDER BY RANDOM() LIMIT 15)
          UNION ALL
          SELECT vid, spelling, reading FROM (SELECT vid, spelling, reading FROM vocabulary_status WHERE jpdb_tier = 'weak' ORDER BY RANDOM() LIMIT 10)
        )`;
    } else {
      vocabQuery = `
        SELECT vid, spelling, reading FROM (
          SELECT vid, spelling, reading FROM (SELECT vid, spelling, reading FROM vocabulary_status WHERE jpdb_tier = 'strong' ORDER BY RANDOM() LIMIT 15)
          UNION ALL
          SELECT vid, spelling, reading FROM (SELECT vid, spelling, reading FROM vocabulary_status WHERE jpdb_tier = 'moderate' ORDER BY RANDOM() LIMIT 15)
          UNION ALL
          SELECT vid, spelling, reading FROM (SELECT vid, spelling, reading FROM vocabulary_status WHERE jpdb_tier = 'weak' ORDER BY RANDOM() LIMIT 20)
        )`;
    }
    const vocabulary = db.prepare(vocabQuery).all();

    // Select grammar from ALL levels, weighted by difficulty
    let grammarLevels;
    let grammarLimit;
    if (diffNum <= 2) {
      grammarLevels = ['master', 'expert', 'seasoned'];
      grammarLimit = 8;
    } else if (diffNum <= 4) {
      grammarLevels = ['master', 'expert', 'seasoned', 'adept'];
      grammarLimit = 8;
    } else {
      grammarLevels = ['master', 'expert', 'seasoned', 'adept', 'beginner'];
      grammarLimit = 10;
    }
    const placeholders = grammarLevels.map(() => '?').join(',');
    const grammar = db.prepare(
      `SELECT id, grammar_point, pattern_name, bunpro_level
       FROM grammar_status
       WHERE bunpro_level IN (${placeholders})
       ORDER BY RANDOM() LIMIT ?`
    ).all(...grammarLevels, grammarLimit);

    const drill = await generateFreeDrill({
      difficulty: diffNum,
      domain: domainKey,
      scenario,
      vocabulary,
      grammar,
    });

    res.json({
      japanese_prompt: drill.japanese_prompt,
      translation: drill.translation,
      prompt_vocabulary: drill.prompt_vocabulary,
      target_vocabulary: drill.target_vocabulary,
      prompt_grammar: drill.prompt_grammar,
      target_grammar: drill.target_grammar,
      key_info_points: drill.key_info_points,
      domain: domainKey,
      difficulty: diffNum,
    });
  } catch (err) {
    console.error('Free drill generation error:', err);
    res.status(500).json({ error: 'Failed to generate free drill' });
  }
});

// POST /api/drill/submit-free — grade a free production response
router.post('/submit-free', async (req, res) => {
  try {
    const {
      japanese_prompt,
      user_response,
      key_info_points,
      target_vocabulary,
      target_grammar,
      mode = 'typed',
      domain,
      difficulty = 1,
      response_time_seconds,
    } = req.body;

    if (!user_response || !user_response.trim()) {
      return res.status(400).json({ error: 'No response provided' });
    }
    if (typeof user_response !== 'string' || user_response.length > 2000) {
      return res.status(400).json({ error: 'Response too long (max 2000 characters)' });
    }

    const db = getDb();

    const result = await gradeFreeDrillResponse({
      japanesePrompt: japanese_prompt,
      userResponse: user_response,
      keyInfoPoints: key_info_points || [],
      targetVocabulary: target_vocabulary,
      targetGrammar: target_grammar,
    });

    // Save drill result
    const insertResult = db.prepare(`
      INSERT INTO drill_results
        (mode, japanese_prompt, user_response, is_correct,
         vocabulary_used, grammar_used, errors, life_domain,
         difficulty_tier, response_time_seconds, drill_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'free_production')
    `).run(
      mode,
      japanese_prompt,
      user_response,
      result.is_correct ? 1 : 0,
      JSON.stringify(target_vocabulary || []),
      JSON.stringify(target_grammar || []),
      JSON.stringify(result.errors || []),
      domain,
      difficulty,
      response_time_seconds || null
    );

    result.drillResultId = Number(insertResult.lastInsertRowid);

    // Update daily stats
    const dateStr = today();
    db.prepare(`
      INSERT INTO daily_stats (date, drills_completed, drills_correct, voice_drills, typed_drills, streak_day)
      VALUES (?, 1, ?, ?, ?, TRUE)
      ON CONFLICT(date) DO UPDATE SET
        drills_completed = drills_completed + 1,
        drills_correct = drills_correct + EXCLUDED.drills_correct,
        voice_drills = voice_drills + EXCLUDED.voice_drills,
        typed_drills = typed_drills + EXCLUDED.typed_drills,
        accuracy_rate = CAST(drills_correct + EXCLUDED.drills_correct AS REAL) / (drills_completed + 1),
        streak_day = TRUE
    `).run(
      dateStr,
      result.is_correct ? 1 : 0,
      mode === 'voice' ? 1 : 0,
      mode === 'typed' ? 1 : 0
    );

    updateProductionTracking(db, target_vocabulary, target_grammar, result.is_correct);

    res.json(result);
  } catch (err) {
    console.error('Free drill grading error:', err);
    res.status(500).json({ error: 'Failed to grade response' });
  }
});

// POST /api/drill/chat — follow-up Q&A about a drill
router.post('/chat', async (req, res) => {
  try {
    const { drillContext, conversationHistory = [], question, drillResultId } = req.body;

    if (!question || !question.trim()) {
      return res.status(400).json({ error: 'No question provided' });
    }
    if (typeof question !== 'string' || question.length > 2000) {
      return res.status(400).json({ error: 'Question too long (max 2000 characters)' });
    }
    if (Array.isArray(conversationHistory) && conversationHistory.length > 20) {
      return res.status(400).json({ error: 'Conversation history too long (max 20 entries)' });
    }

    const answer = await chatFollowUp({
      drillContext,
      conversationHistory,
      question: question.trim(),
    });

    // Update the drill_results record with the Q&A so far
    if (drillResultId) {
      const db = getDb();
      const updatedQA = [...conversationHistory, { role: 'user', content: question.trim() }, { role: 'assistant', content: answer }];
      db.prepare('UPDATE drill_results SET follow_up_qa = ? WHERE id = ?')
        .run(JSON.stringify(updatedQA), drillResultId);
    }

    res.json({ answer });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Failed to get answer' });
  }
});

// POST /api/drill/transcribe — voice input via Whisper
router.post('/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    const OpenAI = require('openai');
    const openai = new OpenAI();

    // Whisper needs a file-like object with a name
    const file = new File([req.file.buffer], 'audio.webm', { type: req.file.mimetype });

    const transcription = await openai.audio.transcriptions.create({
      model: 'whisper-1',
      file,
      language: 'ja',
    });

    res.json({ text: transcription.text });
  } catch (err) {
    console.error('Transcription error:', err);
    res.status(500).json({ error: 'Failed to transcribe audio' });
  }
});

// POST /api/drill/tts — text-to-speech via OpenAI
router.post('/tts', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'No text provided' });

    const OpenAI = require('openai');
    const openai = new OpenAI();

    const audio = await openai.audio.speech.create({
      model: 'tts-1',
      voice: 'nova',
      input: text,
      speed: 1.0,
    });

    const buffer = Buffer.from(await audio.arrayBuffer());
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': buffer.length,
    });
    res.send(buffer);
  } catch (err) {
    console.error('TTS error:', err);
    res.status(500).json({ error: 'Failed to generate speech' });
  }
});

module.exports = router;
