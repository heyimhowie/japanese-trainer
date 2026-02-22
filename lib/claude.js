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
  let contextBlock;
  if (drillContext.japanese_prompt) {
    contextBlock = `Current drill context (Free Production mode):
Japanese prompt: "${drillContext.japanese_prompt}"
User's response: "${drillContext.user_response}"
Score: ${drillContext.score}/100 (Grammar: ${drillContext.grammar_score}, Completeness: ${drillContext.meaning_score}, Naturalness: ${drillContext.naturalness_score})
Errors: ${JSON.stringify(drillContext.errors || [])}
Corrections: "${drillContext.corrections || 'none'}"
What was good: "${drillContext.what_was_good || ''}"
Explanation: "${drillContext.explanation || ''}"`;
  } else {
    contextBlock = `Current drill context:
English prompt: "${drillContext.english_prompt}"
User's response: "${drillContext.user_response}"
Target translation: "${drillContext.target_japanese}"
Score: ${drillContext.score}/100 (Grammar: ${drillContext.grammar_score}, Meaning: ${drillContext.meaning_score}, Naturalness: ${drillContext.naturalness_score})
Errors: ${JSON.stringify(drillContext.errors || [])}
Corrections: "${drillContext.corrections || 'none'}"
Explanation: "${drillContext.explanation || ''}"
Hints given: "${drillContext.hints || 'none'}"`;
  }

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

// --- Free Production mode ---

const SYSTEM_GENERATE_FREE = `You create Japanese-only situation prompts for an intermediate learner to practice free production.

ROLE: You are a friend, coworker, or acquaintance describing a situation in natural Japanese and asking the learner to respond. The learner must understand the Japanese prompt and respond freely — there is no English crutch.

DIFFICULTY LEVELS (1-5):
1 = Very simple situation, short prompt, basic vocabulary, polite form
2 = Simple situation, slightly longer prompt, common vocabulary
3 = Moderate situation, natural-length prompt, some less common vocabulary
4 = Complex situation, longer prompt with nuance, uses intermediate grammar
5 = Nuanced situation requiring detailed response, advanced vocabulary and grammar

FURIGANA RULES:
- Put the reading RIGHT AFTER the kanji only, before any okurigana: 楽(たの)しい NOT 楽しい(たのしい)
- Each kanji compound gets its own reading: 練習(れんしゅう) 昨日(きのう) 靴(くつ)
- Double-check readings are correct

OUTPUT RULES:
- The japanese_prompt should feel like natural spoken Japanese, as if a real person is talking to the learner
- End the prompt with a question or request that invites a response
- key_info_points lists the pieces of information a good response should cover
- target_vocabulary and target_grammar are words/patterns the learner COULD use in their response (not must use)
- translation is a natural English translation of the prompt (shown only on demand)

Respond with ONLY valid JSON, no markdown fences:
{
  "japanese_prompt": "Japanese situation prompt with furigana",
  "translation": "Natural English translation of the prompt",
  "prompt_vocabulary": [{"word": "...", "reading": "...", "meaning": "..."}],
  "target_vocabulary": [{"word": "...", "reading": "...", "meaning": "..."}],
  "prompt_grammar": ["pattern1"],
  "target_grammar": ["pattern1"],
  "key_info_points": ["what a good response should address"]
}`;

async function generateFreeDrill({ difficulty, domain, scenario, vocabulary, grammar }) {
  const vocabList = vocabulary.slice(0, 40)
    .map(v => `${v.spelling}(${v.reading})`)
    .join('、');

  const grammarList = grammar
    .map(g => `- ${g.pattern_name}`)
    .join('\n');

  const userPrompt = `Create ONE situation prompt about: ${scenario} (topic: ${domain.replace(/_/g, ' ')})

Difficulty level: ${difficulty}/5

Vocabulary the learner knows (use some in the prompt, suggest others for their response):
${vocabList}

Grammar patterns the learner knows (use some, suggest others for response):
${grammarList}

Remember: write a natural Japanese prompt as if you're a friend/coworker talking to the learner. End with a question or request.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_GENERATE_FREE,
    messages: [{ role: 'user', content: userPrompt + '\n\nRespond with ONLY the JSON object. No other text.' }],
  });

  const text = response.content[0].text;
  return JSON.parse(stripFences(text));
}

const SYSTEM_GRADE_FREE = `You evaluate a free Japanese production response. The learner received a Japanese-only situation prompt and responded freely — there is no target translation to compare against.

GRADING PHILOSOPHY:
- Evaluate the response on its own merits — there is no single "correct" answer
- A simpler response that is correct and natural is fine
- Consider whether the response appropriately addresses the situation described in the prompt

SCORING — three separate scores (each 0-100):
- grammar_score: Is the Japanese grammatically correct? (particles, conjugations, sentence structure)
- meaning_score: COMPLETENESS — does the response address the key information points from the prompt? Does it answer the question asked?
- naturalness_score: Would a Japanese person actually say it this way? (natural phrasing, appropriate register)

The overall "score" is the average of these three.

INTERNAL CONSISTENCY — THIS IS CRITICAL:
- Your "corrections", "explanation", and "errors" MUST all agree with each other
- If you list no errors, your explanation must not describe things as wrong
- If the user's response is valid, corrections should be an empty string

Respond with ONLY valid JSON, no markdown fences:
{
  "is_correct": true or false,
  "grammar_score": 0 to 100,
  "meaning_score": 0 to 100,
  "naturalness_score": 0 to 100,
  "score": 0 to 100,
  "what_was_good": "1-2 sentences highlighting what the learner did well",
  "explanation": "2-3 sentences: what could improve. Must be consistent with errors and corrections.",
  "errors": [
    {"type": "grammar or vocabulary or particle or conjugation or word_order or missing", "detail": "specific description"}
  ],
  "corrections": "Minimally corrected version of what user wrote with furigana. ONLY fix actual errors. Empty string if no real errors.",
  "alternative_expressions": ["2-3 other natural ways to express the same response, with furigana"],
  "vocab_opportunities": [{"word": "...", "reading": "...", "meaning": "...", "example": "how it could have been used in this response"}]
}`;

async function gradeFreeDrillResponse({ japanesePrompt, userResponse, keyInfoPoints, targetVocabulary, targetGrammar }) {
  const userPrompt = `Japanese prompt shown to the learner: "${japanesePrompt}"

Learner's Japanese response: "${userResponse}"

Key information points the response should address:
${keyInfoPoints.map((p, i) => `${i + 1}. ${p}`).join('\n')}

Vocabulary the learner could have used: ${(targetVocabulary || []).map(v => `${v.word}(${v.reading}): ${v.meaning}`).join(', ')}

Grammar patterns the learner could have used: ${(targetGrammar || []).join(', ')}

Grade the learner's response. Remember:
- There is no single correct answer — evaluate the response on its own merits
- meaning_score = how completely the response addresses the situation/question
- Make sure your explanation, errors, and corrections are all consistent with each other`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_GRADE_FREE,
    messages: [{ role: 'user', content: userPrompt + '\n\nRespond with ONLY the JSON object. No other text.' }],
  });

  const text = response.content[0].text;
  return JSON.parse(stripFences(text));
}

module.exports = { generateDrill, gradeResponse, chatFollowUp, generateFreeDrill, gradeFreeDrillResponse };
