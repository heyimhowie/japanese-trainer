// --- State ---
let currentDrill = null;
let drillStartTime = null;
let drillResultId = null;
let lastGradeResult = null;
let sessionDrillCount = 0;

// --- DOM refs ---
const btnGenerate = document.getElementById('btn-generate');
const generateArea = document.getElementById('generate-area');
const loadingGenerate = document.getElementById('loading-generate');
const promptCard = document.getElementById('prompt-card');
const promptDomain = document.getElementById('prompt-domain');
const promptJapanese = document.getElementById('prompt-japanese');
const promptTranslation = document.getElementById('prompt-translation');
const btnTtsPrompt = document.getElementById('btn-tts-prompt');
const btnTranslationToggle = document.getElementById('btn-translation-toggle');
const inputArea = document.getElementById('input-area');
const userInput = document.getElementById('user-input');
const btnVoice = document.getElementById('btn-voice');
const btnSubmit = document.getElementById('btn-submit');
const voiceStatus = document.getElementById('voice-status');
const loadingGrade = document.getElementById('loading-grade');
const resultCard = document.getElementById('result-card');
const resultHeader = document.getElementById('result-header');
const resultUserResponse = document.getElementById('result-user-response');
const resultGood = document.getElementById('result-good');
const resultCorrections = document.getElementById('result-corrections');
const resultExplanation = document.getElementById('result-explanation');
const resultErrors = document.getElementById('result-errors');
const resultAlternatives = document.getElementById('result-alternatives');
const alternativesList = document.getElementById('alternatives-list');
const resultVocabOpps = document.getElementById('result-vocab-opps');
const vocabOppsList = document.getElementById('vocab-opps-list');
const btnNext = document.getElementById('btn-next');
const chatArea = document.getElementById('chat-area');

// --- Difficulty auto-scaling ---
function getDifficulty() {
  // Starts at 1, increments every 2 drills, max 5
  return Math.min(5, 1 + Math.floor(sessionDrillCount / 2));
}

// --- Voice ---
const voice = initVoice({
  onStart() {
    btnVoice.classList.add('recording');
    voiceStatus.textContent = 'Recording... release to stop';
    voiceStatus.style.display = 'block';
  },
  onStop() {
    btnVoice.classList.remove('recording');
  },
  onTranscribing() {
    voiceStatus.textContent = 'Transcribing...';
  },
  onTranscribed(text) {
    userInput.value = text;
    btnSubmit.disabled = !text.trim();
    voiceStatus.textContent = 'Transcribed via Whisper';
  },
  onError() {
    voiceStatus.textContent = 'Microphone access denied';
    voiceStatus.style.display = 'block';
  },
});

btnVoice.addEventListener('mousedown', voice.start);
btnVoice.addEventListener('touchstart', (e) => { e.preventDefault(); voice.start(); });
btnVoice.addEventListener('mouseup', voice.stop);
btnVoice.addEventListener('touchend', voice.stop);
btnVoice.addEventListener('mouseleave', () => { if (voice.isRecording()) voice.stop(); });

// --- Chat ---
const chat = initChat({
  messagesEl: document.getElementById('chat-messages'),
  inputEl: document.getElementById('chat-input'),
  sendBtn: document.getElementById('btn-chat-send'),
  getContext() {
    if (!currentDrill || !lastGradeResult) return null;
    return {
      drillContext: {
        japanese_prompt: currentDrill.japanese_prompt,
        user_response: userInput.value.trim(),
        score: lastGradeResult.score,
        grammar_score: lastGradeResult.grammar_score,
        meaning_score: lastGradeResult.meaning_score,
        naturalness_score: lastGradeResult.naturalness_score,
        errors: lastGradeResult.errors,
        corrections: lastGradeResult.corrections,
        what_was_good: lastGradeResult.what_was_good,
        explanation: lastGradeResult.explanation,
      },
      drillResultId,
    };
  },
});

// --- Generate ---
btnGenerate.addEventListener('click', generate);

async function generate() {
  generateArea.style.display = 'none';
  loadingGenerate.style.display = 'block';
  promptCard.style.display = 'none';
  inputArea.style.display = 'none';
  resultCard.className = 'result-card';
  resultCard.style.display = 'none';
  chatArea.style.display = 'none';

  try {
    const res = await fetch('/api/drill/generate-free', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ difficulty: getDifficulty() }),
    });

    if (!res.ok) {
      let detail = `Server error (${res.status})`;
      try {
        const err = await res.json();
        detail = err.detail || err.error || detail;
      } catch (_) {}
      throw new Error(detail);
    }

    currentDrill = await res.json();
    drillStartTime = Date.now();

    // Show prompt
    promptDomain.textContent = currentDrill.domain.replace(/_/g, ' ');
    promptJapanese.innerHTML = furiganaToRuby(escapeHtml(currentDrill.japanese_prompt));
    promptTranslation.textContent = currentDrill.translation || '';
    promptTranslation.style.display = 'none';
    btnTranslationToggle.classList.remove('active');

    loadingGenerate.style.display = 'none';
    promptCard.style.display = 'block';
    inputArea.style.display = 'block';

    // Reset input
    userInput.value = '';
    btnSubmit.disabled = true;
    userInput.focus();
  } catch (err) {
    console.error('Generate error:', err);
    loadingGenerate.style.display = 'none';
    generateArea.style.display = 'block';
    alert('Failed to generate prompt: ' + err.message);
  }
}

// --- Translation toggle ---
btnTranslationToggle.addEventListener('click', () => {
  const showing = promptTranslation.style.display !== 'none';
  promptTranslation.style.display = showing ? 'none' : 'block';
  btnTranslationToggle.classList.toggle('active', !showing);
});

// --- Prompt TTS ---
btnTtsPrompt.addEventListener('click', async () => {
  const text = stripFurigana(currentDrill?.japanese_prompt || '');
  if (!text) return;
  btnTtsPrompt.disabled = true;
  btnTtsPrompt.textContent = '...';
  try {
    await playTts(text);
  } catch (err) {
    console.error('TTS error:', err);
  } finally {
    btnTtsPrompt.disabled = false;
    btnTtsPrompt.innerHTML = '&#x1F50A;';
  }
});

// --- Input handling (IME-safe) ---
let composing = false;
userInput.addEventListener('compositionstart', () => { composing = true; });
userInput.addEventListener('compositionend', () => {
  composing = false;
  btnSubmit.disabled = !userInput.value.trim();
});
userInput.addEventListener('input', () => {
  if (!composing) {
    btnSubmit.disabled = !userInput.value.trim();
  }
});

userInput.addEventListener('keydown', (e) => {
  if (e.isComposing || composing) return;
  if (e.key === 'Enter' && !e.shiftKey && userInput.value.trim()) {
    e.preventDefault();
    submit();
  }
});

// --- Submit ---
btnSubmit.addEventListener('click', submit);

async function submit() {
  if (!userInput.value.trim() || !currentDrill) return;

  const responseTime = drillStartTime ? (Date.now() - drillStartTime) / 1000 : null;
  const mode = voiceStatus.style.display !== 'none' && voiceStatus.textContent.includes('Transcribed')
    ? 'voice' : 'typed';

  inputArea.style.display = 'none';
  loadingGrade.style.display = 'block';

  try {
    const res = await fetch('/api/drill/submit-free', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        japanese_prompt: currentDrill.japanese_prompt,
        user_response: userInput.value.trim(),
        key_info_points: currentDrill.key_info_points,
        target_vocabulary: currentDrill.target_vocabulary,
        target_grammar: currentDrill.target_grammar,
        mode,
        domain: currentDrill.domain,
        difficulty: currentDrill.difficulty,
        response_time_seconds: responseTime,
      }),
    });

    if (!res.ok) {
      let detail = `Server error (${res.status})`;
      try {
        const err = await res.json();
        detail = err.detail || err.error || detail;
      } catch (_) {}
      throw new Error(detail);
    }

    const result = await res.json();
    drillResultId = result.drillResultId;
    lastGradeResult = result;
    sessionDrillCount++;
    showResult(result);
  } catch (err) {
    console.error('Submit error:', err);
    loadingGrade.style.display = 'none';
    inputArea.style.display = 'block';
    alert('Failed to grade: ' + err.message);
  }
}

// --- Show result ---
function showResult(result) {
  loadingGrade.style.display = 'none';

  resultCard.style.display = '';
  resultCard.className = 'result-card ' + (result.is_correct ? 'correct' : 'incorrect');

  const score = result.score != null ? ` (${result.score}/100)` : '';
  resultHeader.textContent = result.is_correct
    ? `Nice work!${score}`
    : `Keep practicing!${score}`;

  // Sub-scores
  setScore('score-grammar', result.grammar_score);
  setScore('score-meaning', result.meaning_score);
  setScore('score-naturalness', result.naturalness_score);

  resultUserResponse.textContent = userInput.value.trim();

  // What was good
  if (result.what_was_good) {
    resultGood.textContent = result.what_was_good;
    resultGood.style.display = 'block';
  } else {
    resultGood.style.display = 'none';
  }

  // Corrections
  if (result.corrections && !result.is_correct) {
    resultCorrections.innerHTML = furiganaToRuby(escapeHtml(result.corrections));
    resultCorrections.style.display = 'block';
  } else {
    resultCorrections.style.display = 'none';
  }

  resultExplanation.textContent = result.explanation || '';

  // Errors
  resultErrors.innerHTML = '';
  if (result.errors && result.errors.length > 0) {
    for (const err of result.errors) {
      const li = document.createElement('li');
      li.innerHTML = `<span class="error-type">${escapeHtml(err.type)}</span> ${escapeHtml(err.detail)}`;
      resultErrors.appendChild(li);
    }
  }

  // Alternative expressions
  if (result.alternative_expressions && result.alternative_expressions.length > 0) {
    alternativesList.innerHTML = '';
    for (const alt of result.alternative_expressions) {
      const li = document.createElement('li');
      li.innerHTML = furiganaToRuby(escapeHtml(alt));
      alternativesList.appendChild(li);
    }
    resultAlternatives.style.display = 'block';
  } else {
    resultAlternatives.style.display = 'none';
  }

  // Vocab opportunities
  if (result.vocab_opportunities && result.vocab_opportunities.length > 0) {
    vocabOppsList.innerHTML = '';
    for (const v of result.vocab_opportunities) {
      const li = document.createElement('li');
      li.innerHTML = `<strong>${escapeHtml(v.word)}</strong> (${escapeHtml(v.reading)}) — ${escapeHtml(v.meaning)}<br><span class="vocab-example">${furiganaToRuby(escapeHtml(v.example || ''))}</span>`;
      vocabOppsList.appendChild(li);
    }
    resultVocabOpps.style.display = 'block';
  } else {
    resultVocabOpps.style.display = 'none';
  }

  // Show chat area and reset
  chat.reset();
  chatArea.style.display = 'block';
}

// --- Next prompt ---
btnNext.addEventListener('click', () => {
  stopTts();
  resultCard.className = 'result-card';
  resultCard.style.display = 'none';
  voiceStatus.style.display = 'none';
  chatArea.style.display = 'none';
  chat.reset();
  drillResultId = null;
  lastGradeResult = null;
  currentDrill = null;
  generate();
});
