const fs = require('fs');
const path = require('path');
const { getDb } = require('./index');

const DATA_DIR = path.join(__dirname, '..', 'data');

// --- Vocabulary seeding ---

function classifyVocabTier(reviews) {
  if (!reviews || reviews.length === 0) return 'weak';

  const passGrades = new Set(['okay', 'pass', 'easy', 'known', 'hard']);
  const strongLastGrades = new Set(['okay', 'pass', 'easy', 'known']);
  const moderateLastGrades = new Set(['okay', 'pass', 'hard']);

  const lastGrade = reviews[reviews.length - 1].grade;
  const passCount = reviews.filter(r => passGrades.has(r.grade)).length;
  const passRate = passCount / reviews.length;

  if (strongLastGrades.has(lastGrade) && passRate > 0.6) {
    return 'strong';
  } else if (moderateLastGrades.has(lastGrade) && passRate >= 0.4 && passRate <= 0.6) {
    return 'moderate';
  }
  return 'weak';
}

function seedVocabulary(db) {
  console.log('Seeding vocabulary from reviews.json...');
  const raw = fs.readFileSync(path.join(DATA_DIR, 'reviews.json'), 'utf8');
  const data = JSON.parse(raw);
  const words = data.cards_vocabulary_jp_en;

  const insert = db.prepare(`
    INSERT OR REPLACE INTO vocabulary_status (vid, spelling, reading, jpdb_tier)
    VALUES (?, ?, ?, ?)
  `);

  const insertAll = db.transaction((words) => {
    for (const word of words) {
      const tier = classifyVocabTier(word.reviews);
      insert.run(word.vid, word.spelling, word.reading, tier);
    }
  });

  insertAll(words);

  const counts = db.prepare(
    'SELECT jpdb_tier, COUNT(*) as count FROM vocabulary_status GROUP BY jpdb_tier'
  ).all();

  console.log(`  Imported ${words.length} vocabulary entries`);
  for (const { jpdb_tier, count } of counts) {
    console.log(`    ${jpdb_tier}: ${count}`);
  }
}

// --- Grammar seeding ---

function extractPatternName(fullText) {
  let text = fullText.replace(/^"|"$/g, '').trim();
  // Remove circled numbers
  text = text.replace(/[①②③④⑤]/g, '').trim();

  // 1. Conjugation patterns with Japanese prefix: う-Verb, る-Verb, い-Adjective, etc.
  const conjMatch = text.match(
    /^([うるいな]-(?:Verb|Adjective)s?\s*(?:\([^)]*\))?)/
  );
  if (conjMatch) {
    return conjMatch[1].trim();
  }

  // 2. Standalone "Verbs (tense)" or plural adjective forms
  const pluralMatch = text.match(
    /^((?:Verbs|い-Adjectives|な-Adjectives)\s*(?:\([^)]*\))?)/
  );
  if (pluralMatch) {
    return pluralMatch[1].trim();
  }

  // 3. Notation: "Verb[せる・させる]", "Verb + て", "Noun + まで", "Adjective + の(は)"
  const notationMatch = text.match(
    /^((?:Verb|Noun|Adjective)\s*(?:[\[［][\u3040-\u309F\u30A0-\u30FF・\s]+[\]］]|[\+\s]+[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF～・〜\[\]［］（）\(\)\s]+))(?:\s*\+\s*(?:Noun|Verb))?\s*/
  );
  if (notationMatch) {
    let result = notationMatch[0].replace(/[\s\+]+$/, '').trim();
    // Remove trailing artifact "B" from malformed export
    result = result.replace(/\s*\+?\s*B$/, '');
    return result;
  }

  // 4. All-Japanese start: 他動詞・自動詞, こと, や, etc.
  const kanjiMatch = text.match(
    /^([\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF～・〜\s]+)/
  );
  if (kanjiMatch && kanjiMatch[1].trim().length >= 1) {
    const afterIdx = kanjiMatch[1].length;
    if (afterIdx < text.length && /[A-Z]/.test(text[afterIdx])) {
      return kanjiMatch[1].trim();
    }
  }

  // 5. General fallback: find boundary where Japanese ends and English meaning starts
  for (let i = 1; i < text.length; i++) {
    const prev = text[i - 1];
    const curr = text[i];
    if (
      /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\uFF00-\uFFEF）］\]〕]/.test(prev) &&
      /[A-Z]/.test(curr)
    ) {
      return text.slice(0, i).trim();
    }
  }

  return text;
}

function parseBunproCSV(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const entries = [];
  let currentLevel = null;
  let i = 0;

  const levelPattern = /^(Beginner|Adept|Seasoned|Expert|Master)(\s+\d+)?$/;

  while (i < lines.length) {
    const line = lines[i].trim();

    // Skip empty lines
    if (!line) {
      i++;
      continue;
    }

    // Check for level header
    if (levelPattern.test(line)) {
      currentLevel = line.match(levelPattern)[1].toLowerCase();
      i++;
      continue;
    }

    // This should be a grammar point — read 4 lines
    if (i + 3 >= lines.length) break;

    const grammarPoint = line.replace(/^"|"$/g, '').trim();
    const nLevel = lines[i + 1].trim();
    const accuracyRaw = lines[i + 2].trim();
    const errorsRaw = lines[i + 3].trim();

    const accuracy = accuracyRaw === 'None' ? null : parseFloat(accuracyRaw) / 100;
    const errors = parseInt(errorsRaw, 10) || 0;

    entries.push({
      grammar_point: grammarPoint,
      pattern_name: extractPatternName(grammarPoint),
      bunpro_level: currentLevel || 'unknown',
      n_level: nLevel,
      bunpro_accuracy: accuracy,
      error_count: errors,
    });

    i += 4;
  }

  return entries;
}

function seedGrammar(db) {
  console.log('Seeding grammar from bunpro_progress.csv...');
  const entries = parseBunproCSV(path.join(DATA_DIR, 'bunpro_progress.csv'));

  const insert = db.prepare(`
    INSERT OR REPLACE INTO grammar_status
      (grammar_point, pattern_name, bunpro_level, bunpro_accuracy, n_level, error_count)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertAll = db.transaction((entries) => {
    for (const e of entries) {
      insert.run(
        e.grammar_point, e.pattern_name, e.bunpro_level,
        e.bunpro_accuracy, e.n_level, e.error_count
      );
    }
  });

  insertAll(entries);

  const counts = db.prepare(
    'SELECT bunpro_level, COUNT(*) as count FROM grammar_status GROUP BY bunpro_level'
  ).all();

  console.log(`  Imported ${entries.length} grammar entries`);
  for (const { bunpro_level, count } of counts) {
    console.log(`    ${bunpro_level}: ${count}`);
  }
}

// --- Run seed ---

function seed() {
  const db = getDb();

  // Clear existing data
  db.exec('DELETE FROM vocabulary_status');
  db.exec('DELETE FROM grammar_status');

  seedVocabulary(db);
  seedGrammar(db);

  console.log('\nSeeding complete!');
}

seed();
