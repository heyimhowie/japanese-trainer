const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic();

const SYSTEM_GENERATE = `You generate Japanese translation drills for an intermediate learner.

PROCESS — follow this order:
1. First, decide the target Japanese translation
2. Then, create hints that guide toward the KEY vocabulary in that target
3. The hints MUST reference words that appear in your target translation

NATURALNESS RULES:
- Generate a sentence the learner might ACTUALLY SAY in the given situation — not a textbook description of the situation
- Vary sentence types: questions, requests, reactions, explanations, suggestions, apologies, invitations — not just declarative statements
- The learner knows the listed vocabulary and grammar — use what fits naturally, don't force unrelated words or patterns just to include them
- Naturalness comes first. If none of the listed grammar patterns fit the situation, just use natural grammar.

ACCURACY RULES:
- The target_japanese MUST be a correct, natural Japanese translation of the English sentence
- Every word in your Japanese translation must mean what the English says
- Use simple, natural sentence structures. ONE sentence, max 20 words in Japanese
- Use polite form (です/ます) as default unless the situation clearly calls for casual
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

  const userPrompt = `Situation: ${scenario}

${levelInstructions}

The learner knows these words (use naturally, don't force):
${vocabList}

The learner knows these grammar patterns (use if they fit):
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

ROLE: You are a friend, coworker, or acquaintance in a real conversational moment — react, ask, suggest, or respond as the situation calls for. The learner must understand your Japanese and respond freely — there is no English crutch.

NATURALNESS RULES:
- Set up a real conversational moment, not a textbook exercise
- Vary your speech acts: ask questions, make suggestions, react to news, invite, apologize, compare experiences — don't always just ask "please tell me about X"
- The vocabulary and grammar lists are reference material showing what the learner knows — use what fits naturally, don't force them in

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

  const userPrompt = `Situation: ${scenario}

Difficulty level: ${difficulty}/5

The learner knows these words (use naturally in your prompt or suggest for their response):
${vocabList}

The learner knows these grammar patterns (use if they fit):
${grammarList}

Speak naturally as if you're in this moment with the learner. End with a question or request.`;

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

// --- Conversation Prep mode ---

const SYSTEM_CONV_PREP = `You create conversation preparation materials for a ChatGPT voice-mode practice session. The learner is intermediate-level and wants to practice speaking Japanese with ChatGPT.

You generate TWO things:

1. A CHATGPT SYSTEM PROMPT (in English) that the learner will paste into ChatGPT to set up their conversation partner. This prompt should:
   - Define a persona appropriate to the domain/scenario (e.g., coworker, friend, shop clerk, neighbor)
   - Set the difficulty level with specific behavioral instructions
   - Define error correction behavior (when and how to correct mistakes)
   - Focus the conversation on the chosen topic/domain
   - Be written as direct instructions to ChatGPT (e.g., "You are...", "Speak in...", "When the user...")

2. PREP MATERIAL for the learner to review before starting the conversation:
   - 8-12 key vocabulary items (mark each as "known" if it appears in the provided vocabulary list, "new" if not)
   - 5-8 useful phrases with usage notes
   - 3-4 conversation starters the learner could use to begin or steer the conversation
   - 4-6 specific topics or questions to bring up during the conversation

DIFFICULTY LEVELS (1-5) — map these to specific ChatGPT behavior instructions:
1 = Speak very slowly and simply. Use only basic vocabulary and short sentences. Polite form (です/ます) only. Repeat and rephrase if the user seems confused. Correct all errors gently by restating the correct form.
2 = Speak at a slow-to-moderate pace. Use common vocabulary with occasional new words (explain them). Mostly polite form. Correct significant errors by offering the natural version.
3 = Speak at a natural moderate pace. Mix polite and casual forms as appropriate. Use a normal range of vocabulary. Only correct errors that cause confusion — let minor ones slide.
4 = Speak at a natural pace with some complex sentences. Use casual speech when appropriate. Introduce idiomatic expressions. Only correct errors if asked, or if they significantly change the meaning.
5 = Speak naturally as you would to another native speaker. Use colloquial expressions, contractions, and casual speech. Don't simplify. Only correct errors if the user explicitly asks.

CONVERSATION STYLE determines the type of conversation:
- casual_chat: Relaxed, friendly conversation. Back-and-forth about daily life, opinions, experiences.
- role_play: Act out a specific scenario (e.g., ordering food, asking for directions, job interview). Stay in character.
- debate: Present opinions and discuss disagreements. Push back respectfully. Ask for reasoning.
- storytelling: Take turns telling stories, reacting, asking follow-up questions about experiences.

FURIGANA RULES:
- Put the reading RIGHT AFTER the kanji only, before any okurigana: 楽(たの)しい NOT 楽しい(たのしい)
- Each kanji compound gets its own reading: 練習(れんしゅう) 昨日(きのう) 靴(くつ)

Respond with ONLY valid JSON, no markdown fences:
{
  "chatgpt_prompt": "The full system prompt to paste into ChatGPT (in English, 150-300 words)",
  "scenario_summary": "One sentence describing what this conversation session will be about",
  "key_vocabulary": [
    {"word": "漢字", "reading": "かんじ", "meaning": "kanji", "example": "Example sentence with furigana", "status": "known or new"}
  ],
  "useful_phrases": [
    {"japanese": "Phrase with furigana", "reading": "full reading", "english": "English meaning", "note": "When/how to use this"}
  ],
  "conversation_starters": ["Japanese sentence with furigana that the learner could say to start/steer the conversation"],
  "topics_to_cover": ["Specific topic or question to bring up, in English"]
}`;

async function generateConversationPrep({ difficulty, domain, scenario, style, customTopic, vocabulary, grammar }) {
  const vocabList = vocabulary.slice(0, 50)
    .map(v => `${v.spelling}(${v.reading})`)
    .join('、');

  const grammarList = grammar
    .map(g => `- ${g.pattern_name}`)
    .join('\n');

  const styleLabels = {
    casual_chat: 'Casual Chat',
    role_play: 'Role Play',
    debate: 'Debate / Discussion',
    storytelling: 'Storytelling',
  };

  const topicLine = customTopic
    ? `Custom topic focus: ${customTopic}`
    : '';

  const userPrompt = `Domain: ${domain.replace(/_/g, ' ')}
Scenario: ${scenario}
Conversation style: ${styleLabels[style] || style}
Difficulty level: ${difficulty}/5
${topicLine}

The learner knows these words (mark as "known" if you use them in key_vocabulary):
${vocabList}

The learner knows these grammar patterns:
${grammarList}

Generate the ChatGPT system prompt and prep materials. Make the prep material relevant to this specific scenario and style.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: SYSTEM_CONV_PREP,
    messages: [{ role: 'user', content: userPrompt + '\n\nRespond with ONLY the JSON object. No other text.' }],
  });

  const text = response.content[0].text;
  return JSON.parse(stripFences(text));
}

module.exports = { generateDrill, gradeResponse, chatFollowUp, generateFreeDrill, gradeFreeDrillResponse, generateConversationPrep };
