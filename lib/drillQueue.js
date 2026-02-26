const fs = require('fs');
const path = require('path');
const { getDb } = require('../db/index');
const { generateDrill, generateFreeDrill } = require('./claude');

const QUEUE_MAX = 5;
const QUEUE_THRESHOLD = 2;

// Load life context once
const lifeContext = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'life_context.json'), 'utf8')
);

// Helper: pick random item from array
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Atomically pop one pre-generated drill from the queue.
 * Returns parsed payload or null if queue is empty for these params.
 */
function popDrill(type, params) {
  const db = getDb();

  if (type === 'targeted') {
    const row = db.prepare(
      `SELECT id, payload FROM drill_queue
       WHERE drill_type = 'targeted' AND tier = ? AND level = ?
       ORDER BY id LIMIT 1`
    ).get(params.tier, params.level);

    if (!row) return null;
    db.prepare('DELETE FROM drill_queue WHERE id = ?').run(row.id);
    return JSON.parse(row.payload);
  }

  if (type === 'free') {
    const row = db.prepare(
      `SELECT id, payload FROM drill_queue
       WHERE drill_type = 'free' AND difficulty = ?
       ORDER BY id LIMIT 1`
    ).get(params.difficulty);

    if (!row) return null;
    db.prepare('DELETE FROM drill_queue WHERE id = ?').run(row.id);
    return JSON.parse(row.payload);
  }

  return null;
}

/**
 * Count available drills in the queue for given params.
 */
function countDrills(type, params) {
  const db = getDb();

  if (type === 'targeted') {
    return db.prepare(
      `SELECT COUNT(*) as n FROM drill_queue
       WHERE drill_type = 'targeted' AND tier = ? AND level = ?`
    ).get(params.tier, params.level).n;
  }

  if (type === 'free') {
    return db.prepare(
      `SELECT COUNT(*) as n FROM drill_queue
       WHERE drill_type = 'free' AND difficulty = ?`
    ).get(params.difficulty).n;
  }

  return 0;
}

/**
 * Generate one targeted drill and insert it into the queue.
 */
async function generateOneTargeted(tier, level) {
  const db = getDb();
  const domainKeys = Object.keys(lifeContext.life_domains);
  const domainKey = pickRandom(domainKeys);
  const domainData = lifeContext.life_domains[domainKey];
  const scenario = pickRandom(domainData.scenarios);

  // Same vocab/grammar selection logic as routes/drill.js
  let vocabQuery;
  if (level === 'white') {
    vocabQuery = `SELECT vid, spelling, reading FROM vocabulary_status WHERE jpdb_tier = 'strong' ORDER BY RANDOM() LIMIT 30`;
  } else if (tier === 1) {
    vocabQuery = `SELECT vid, spelling, reading FROM vocabulary_status WHERE jpdb_tier = 'strong' ORDER BY RANDOM() LIMIT 50`;
  } else if (tier === 2) {
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

  const neverAttempted = db.prepare(
    `SELECT vid, spelling, reading FROM vocabulary_status
     WHERE jpdb_tier IN ('strong', 'moderate') AND production_status = 'never_attempted'
     ORDER BY RANDOM() LIMIT 10`
  ).all();
  const vocabMap = new Map(vocabulary.map(v => [v.vid, v]));
  for (const v of neverAttempted) vocabMap.set(v.vid, v);
  const finalVocab = [...vocabMap.values()];

  let grammarLevels;
  let grammarLimit;
  if (level === 'white') {
    grammarLevels = ['master', 'expert'];
    grammarLimit = 1;
  } else if (tier === 1) {
    grammarLevels = ['master', 'expert'];
    grammarLimit = 6;
  } else if (tier === 2) {
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

  const drill = await generateDrill({
    tier,
    level,
    domain: domainKey,
    scenario,
    vocabulary: finalVocab,
    grammar,
  });

  const payload = {
    english: drill.english,
    target_japanese: drill.target_japanese,
    hints: drill.hints,
    vocabulary_used: drill.vocabulary_used,
    grammar_used: drill.grammar_used,
    domain: domainKey,
    tier,
    level,
  };

  db.prepare(
    `INSERT INTO drill_queue (drill_type, tier, level, domain, payload)
     VALUES ('targeted', ?, ?, ?, ?)`
  ).run(tier, level, domainKey, JSON.stringify(payload));

  return payload;
}

/**
 * Generate one free drill and insert it into the queue.
 */
async function generateOneFree(difficulty) {
  const db = getDb();
  const domainKeys = Object.keys(lifeContext.life_domains);
  const domainKey = pickRandom(domainKeys);
  const domainData = lifeContext.life_domains[domainKey];
  const scenario = pickRandom(domainData.scenarios);

  // Same vocab/grammar selection logic as routes/drill.js
  let vocabQuery;
  if (difficulty <= 2) {
    vocabQuery = `
      SELECT vid, spelling, reading FROM (
        SELECT vid, spelling, reading FROM (SELECT vid, spelling, reading FROM vocabulary_status WHERE jpdb_tier = 'strong' ORDER BY RANDOM() LIMIT 40)
        UNION ALL
        SELECT vid, spelling, reading FROM (SELECT vid, spelling, reading FROM vocabulary_status WHERE jpdb_tier = 'moderate' ORDER BY RANDOM() LIMIT 10)
      )`;
  } else if (difficulty <= 4) {
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

  let grammarLevels;
  let grammarLimit;
  if (difficulty <= 2) {
    grammarLevels = ['master', 'expert', 'seasoned'];
    grammarLimit = 8;
  } else if (difficulty <= 4) {
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
    difficulty,
    domain: domainKey,
    scenario,
    vocabulary,
    grammar,
  });

  const payload = {
    japanese_prompt: drill.japanese_prompt,
    translation: drill.translation,
    prompt_vocabulary: drill.prompt_vocabulary,
    target_vocabulary: drill.target_vocabulary,
    prompt_grammar: drill.prompt_grammar,
    target_grammar: drill.target_grammar,
    key_info_points: drill.key_info_points,
    domain: domainKey,
    difficulty,
  };

  db.prepare(
    `INSERT INTO drill_queue (drill_type, difficulty, domain, payload)
     VALUES ('free', ?, ?, ?)`
  ).run(difficulty, domainKey, JSON.stringify(payload));

  return payload;
}

/**
 * Check queue depth and replenish in background if below threshold.
 * Non-blocking — fires and forgets.
 */
function replenishIfNeeded(type, params) {
  const count = countDrills(type, params);
  if (count > QUEUE_THRESHOLD) return;

  const toGenerate = QUEUE_MAX - count;
  console.log(`[DrillQueue] Replenishing ${type} queue: ${count} remaining, generating ${toGenerate} more`);

  (async () => {
    for (let i = 0; i < toGenerate; i++) {
      try {
        if (type === 'targeted') {
          await generateOneTargeted(params.tier, params.level);
        } else {
          await generateOneFree(params.difficulty);
        }
        console.log(`[DrillQueue] Generated ${type} drill ${i + 1}/${toGenerate}`);
      } catch (err) {
        console.error(`[DrillQueue] Error generating ${type} drill:`, err.message);
      }
    }
    console.log(`[DrillQueue] Replenishment complete for ${type}`);
  })();
}

/**
 * Fill queue on startup for default parameter sets.
 * Fully async, non-blocking.
 */
function fillQueue() {
  const targetedParamSets = [
    { tier: 1, level: 'blue' },
    { tier: 1, level: 'white' },
  ];
  const freeParams = { difficulty: 1 };

  const needs = [];
  for (const params of targetedParamSets) {
    const count = countDrills('targeted', params);
    const needed = Math.max(0, QUEUE_MAX - count);
    if (needed > 0) needs.push({ type: 'targeted', params, needed, count });
  }
  const freeCount = countDrills('free', freeParams);
  const freeNeeded = Math.max(0, QUEUE_MAX - freeCount);
  if (freeNeeded > 0) needs.push({ type: 'free', params: freeParams, needed: freeNeeded, count: freeCount });

  if (needs.length === 0) {
    console.log(`[DrillQueue] Queue already full`);
    return;
  }

  for (const n of needs) {
    const label = n.type === 'targeted' ? `targeted(${n.params.level})` : 'free';
    console.log(`[DrillQueue] Need ${n.needed} ${label} drills (${n.count} in queue)`);
  }

  (async () => {
    for (const n of needs) {
      const label = n.type === 'targeted' ? `targeted(${n.params.level})` : 'free';
      for (let i = 0; i < n.needed; i++) {
        try {
          if (n.type === 'targeted') {
            await generateOneTargeted(n.params.tier, n.params.level);
          } else {
            await generateOneFree(n.params.difficulty);
          }
          console.log(`[DrillQueue] Startup: generated ${label} drill ${i + 1}/${n.needed}`);
        } catch (err) {
          console.error(`[DrillQueue] Startup ${label} generation error:`, err.message);
        }
      }
    }
    console.log('[DrillQueue] Startup fill complete');
  })();
}

module.exports = { popDrill, countDrills, replenishIfNeeded, fillQueue };
