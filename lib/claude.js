const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic();

const SYSTEM_GENERATE = `You generate Japanese translation drills for an intermediate learner.

PROCESS — follow this order:
1. First, decide the target Japanese translation
2. Then, create hints that guide toward the KEY vocabulary in that target
3. The hints MUST reference words that appear in your target translation

ACCURACY RULES:
- The target_japanese MUST be a correct, natural Japanese translation of the English sentence
- Every word in your Japanese translation must mean what the English says
- Use simple, natural sentence structures. ONE sentence, max 20 words in Japanese
- Use polite form (です/ます) as default
- Before responding, mentally back-translate your Japanese to English and verify it matches

FURIGANA RULES:
- Put the reading RIGHT AFTER the kanji only, before any okurigana: 楽(たの)しい NOT 楽しい(たのしい)
- Each kanji compound gets its own reading: 練習(れんしゅう) 昨日(きのう) 靴(くつ)
- Double-check readings are correct. Common ones: 今日(きょう) 昨日(きのう) 楽(たの)しい 好(す)き

EXAMPLE:
English: "Yesterday's basketball practice was intense."
target_japanese: "昨日(きのう)のバスケの練習(れんしゅう)は激(はげ)しかったです。"
key_vocabulary: [{"word": "激しい", "reading": "はげしい", "meaning": "intense"}]
hints: "Key word: 激(はげ)しい means intense/fierce. Use past tense of い-adjective."

Notice: the hint introduces 激しい which IS the word used in the target. They are aligned.

Respond with ONLY valid JSON, no markdown fences:
{
  "english": "The English sentence to translate",
  "target_japanese": "Accurate Japanese translation with furigana",
  "key_vocabulary": [{"word": "...", "reading": "...", "meaning": "..."}],
  "vocabulary_used": [{"spelling": "...", "reading": "..."}],
  "grammar_used": ["pattern1"],
  "hints": "Hint that introduces key vocabulary FROM the target translation"
}`;

const SYSTEM_GRADE = `You evaluate a Japanese translation attempt. Be encouraging but precise.

GRADING PHILOSOPHY:
- There are MANY valid ways to translate any sentence. Evaluate the user's Japanese on its own merits.
- A simpler translation that is correct and natural should score high.
- If the user was given hints suggesting specific vocabulary, using that vocabulary is a CORRECT choice.
- Only mark is_correct = false if the Japanese has real grammatical errors, conveys the wrong meaning, or is missing critical information.

INTERNAL CONSISTENCY — THIS IS CRITICAL:
- Your "corrections", "explanation", and "errors" MUST all agree with each other.
- If your corrected version uses a word, your explanation MUST NOT say that word is wrong.
- If you list no errors, your explanation must not describe things as wrong.
- If the user's response is valid, corrections should be an empty string — do not "correct" valid choices into different valid choices.

SCORING — three separate scores (each 0-100):
- grammar_score: Is the Japanese grammatically correct? (particles, conjugations, sentence structure)
- meaning_score: Does it accurately convey the English meaning? (a simpler but correct translation still scores high)
- naturalness_score: Would a Japanese person actually say it this way? (natural phrasing, appropriate register)

The overall "score" is the average of these three.

Respond with ONLY valid JSON, no markdown fences:
{
  "is_correct": true or false,
  "grammar_score": 0 to 100,
  "meaning_score": 0 to 100,
  "naturalness_score": 0 to 100,
  "score": 0 to 100,
  "target_japanese": "One natural translation with furigana (as a reference, not the only valid answer)",
  "explanation": "2-3 sentences: what was good, what could improve. Must be consistent with errors and corrections.",
  "errors": [
    {"type": "grammar or vocabulary or particle or conjugation or word_order or missing", "detail": "specific description"}
  ],
  "corrections": "Minimally corrected version of what user wrote. ONLY fix actual errors. Do NOT rephrase valid vocabulary choices. Empty string if no real errors."
}`;

async function generateDrill({ tier, level, domain, scenario, vocabulary, grammar }) {
  const vocabSample = vocabulary.slice(0, level === 'white' ? 15 : 30);
  const vocabList = vocabSample
    .map(v => `${v.spelling}(${v.reading})`)
    .join('、');

  const grammarList = grammar
    .map(g => `- ${g.pattern_name}`)
    .join('\n');

  const levelInstructions = level === 'white'
    ? `Difficulty: SIMPLE — very short sentence (5-10 Japanese words max). Use exactly ONE grammar pattern. Keep it straightforward with common vocabulary. This is for building confidence.`
    : `Difficulty: ${tier === 1 ? 'easy — short sentence, basic grammar' : tier === 2 ? 'medium — slightly longer, one tricky grammar point' : 'harder — compound sentence, complex grammar'}`;

  const userPrompt = `Create ONE drill sentence about: ${scenario} (topic: ${domain.replace(/_/g, ' ')})

${levelInstructions}

Use some of these vocabulary words:
${vocabList}

Use one of these grammar patterns:
${grammarList}

Remember: first decide the target translation, then write hints that guide toward the key words IN that target.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_GENERATE,
    messages: [{ role: 'user', content: userPrompt + '\n\nRespond with ONLY the JSON object. No other text.' }],
  });

  const text = response.content[0].text;
  return JSON.parse(stripFences(text));
}

async function gradeResponse({ englishPrompt, targetJapanese, userResponse, hints }) {
  const userPrompt = `English prompt: "${englishPrompt}"

Howie's Japanese response: "${userResponse}"

Reference translation: "${targetJapanese}"

Hints shown to Howie: "${hints || 'none'}"

Grade Howie's response. Remember:
- The reference is just ONE valid translation, not the only correct answer.
- If the hints suggested specific vocabulary and Howie used it, that is a correct choice.
- Make sure your explanation, errors, and corrections are all consistent with each other.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_GRADE,
    messages: [{ role: 'user', content: userPrompt + '\n\nRespond with ONLY the JSON object. No other text.' }],
  });

  const text = response.content[0].text;
  return JSON.parse(stripFences(text));
}

function stripFences(text) {
  return text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
}

const SYSTEM_CHAT = `You are a friendly Japanese language tutor helping an intermediate learner understand their drill results.

You have full context of the drill they just completed — the English prompt, their Japanese response, the target translation, and the grading feedback.

RULES:
- Answer questions about grammar, vocabulary, kanji readings, nuance, and corrections
- Use furigana notation: 漢字(かんじ) — put reading right after the kanji, before okurigana
- Keep answers concise (2-5 sentences) unless the learner asks for a detailed explanation
- If they ask "why is X wrong", explain the grammar rule or usage pattern
- If they ask about alternative translations, explain the nuances between options
- You can give example sentences to illustrate points
- Be encouraging but honest about errors
- Respond in English with Japanese examples as needed`;

async function chatFollowUp({ drillContext, conversationHistory, question }) {
  const contextBlock = `Current drill context:
English prompt: "${drillContext.english_prompt}"
User's response: "${drillContext.user_response}"
Target translation: "${drillContext.target_japanese}"
Score: ${drillContext.score}/100 (Grammar: ${drillContext.grammar_score}, Meaning: ${drillContext.meaning_score}, Naturalness: ${drillContext.naturalness_score})
Errors: ${JSON.stringify(drillContext.errors || [])}
Corrections: "${drillContext.corrections || 'none'}"
Explanation: "${drillContext.explanation || ''}"
Hints given: "${drillContext.hints || 'none'}"`;

  const messages = [
    { role: 'user', content: contextBlock },
    { role: 'assistant', content: 'I have the full context of your drill. What would you like to know?' },
  ];

  for (const msg of conversationHistory) {
    messages.push({ role: msg.role, content: msg.content });
  }

  messages.push({ role: 'user', content: question });

  let response;
  try {
    response = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 1024,
      system: SYSTEM_CHAT,
      messages,
    });
  } catch (err) {
    // Fall back to Sonnet if Opus is unavailable
    console.warn('Opus unavailable, falling back to Sonnet:', err.message);
    response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM_CHAT,
      messages,
    });
  }

  return response.content[0].text;
}

module.exports = { generateDrill, gradeResponse, chatFollowUp };
