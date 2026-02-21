// --- State ---
let currentTier = 1;
let currentLevel = 'blue';
let currentDomain = '';
let currentDrill = null; // holds the generated drill data
let drillStartTime = null;
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let ttsAudio = null; // currently playing TTS audio
let chatHistory = []; // follow-up Q&A conversation
let drillResultId = null; // DB id for saving Q&A
let lastGradeResult = null; // grading result for chat context

// --- DOM refs ---
const levelBtns = document.querySelectorAll('.level-btn');
const tierGroup = document.getElementById('tier-group');
const tierBtns = document.querySelectorAll('.tier-btn-group button');
const domainSelect = document.getElementById('domain-select');
const btnGenerate = document.getElementById('btn-generate');
const generateArea = document.getElementById('generate-area');
const loadingGenerate = document.getElementById('loading-generate');
const promptCard = document.getElementById('prompt-card');
const promptDomain = document.getElementById('prompt-domain');
const promptEnglish = document.getElementById('prompt-english');
const promptHints = document.getElementById('prompt-hints');
const inputArea = document.getElementById('input-area');
const userInput = document.getElementById('user-input');
const btnVoice = document.getElementById('btn-voice');
const btnSubmit = document.getElementById('btn-submit');
const voiceStatus = document.getElementById('voice-status');
const loadingGrade = document.getElementById('loading-grade');
const resultCard = document.getElementById('result-card');
const resultHeader = document.getElementById('result-header');
const resultUserResponse = document.getElementById('result-user-response');
const resultTarget = document.getElementById('result-target');
const resultCorrections = document.getElementById('result-corrections');
const resultExplanation = document.getElementById('result-explanation');
const resultErrors = document.getElementById('result-errors');
const btnTts = document.getElementById('btn-tts');
const btnNext = document.getElementById('btn-next');
const chatArea = document.getElementById('chat-area');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const btnChatSend = document.getElementById('btn-chat-send');

// --- Furigana: convert 漢字(かんじ) to <ruby> tags ---
function furiganaToRuby(text) {
  if (!text) return '';
  // Match kanji (possibly with okurigana between) followed by (reading)
  // Handles both 練習(れんしゅう) and 楽(たの)しい and 撮る(とる)
  return text.replace(
    /([\u4E00-\u9FFF\u3005]+[\u3040-\u309F]*)[\(（]([\u3040-\u309Fー\u30A0-\u30FF]+)[\)）]/g,
    '<ruby>$1<rp>(</rp><rt>$2</rt><rp>)</rp></ruby>'
  );
}

// Strip furigana for TTS: 練習(れんしゅう) → 練習
function stripFurigana(text) {
  if (!text) return '';
  return text.replace(/[\(（][\u3040-\u309F\u30A0-\u30FFー]+[\)）]/g, '');
}

// --- Init ---
async function init() {
  try {
    const res = await fetch('/api/drill/domains');
    const domains = await res.json();
    for (const d of domains) {
      const opt = document.createElement('option');
      opt.value = d.key;
      opt.textContent = d.key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      domainSelect.appendChild(opt);
    }
  } catch (err) {
    console.error('Failed to load domains:', err);
  }
}

// --- Level selection ---
levelBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    levelBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentLevel = btn.dataset.level;
    // Hide tier selector for white level (tiers don't apply)
    tierGroup.style.display = currentLevel === 'white' ? 'none' : '';
  });
});

// --- Tier selection ---
tierBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    tierBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTier = parseInt(btn.dataset.tier);
  });
});

domainSelect.addEventListener('change', () => {
  currentDomain = domainSelect.value;
});

// --- Generate drill ---
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
    const res = await fetch('/api/drill/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tier: currentTier,
        level: currentLevel,
        domain: currentDomain || undefined,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || err.error || 'Generation failed');
    }

    currentDrill = await res.json();
    drillStartTime = Date.now();

    // Show prompt
    promptDomain.textContent = currentDrill.domain.replace(/_/g, ' ');
    promptEnglish.textContent = currentDrill.english;
    promptHints.textContent = currentDrill.hints || '';
    promptHints.style.display = 'none';
    document.getElementById('btn-hint').textContent = 'Show Hint';

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
    alert('Failed to generate drill: ' + err.message);
  }
}

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

// --- Voice recording ---
btnVoice.addEventListener('mousedown', startRecording);
btnVoice.addEventListener('touchstart', (e) => { e.preventDefault(); startRecording(); });
btnVoice.addEventListener('mouseup', stopRecording);
btnVoice.addEventListener('touchend', stopRecording);
btnVoice.addEventListener('mouseleave', () => { if (isRecording) stopRecording(); });

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      if (audioChunks.length === 0) return;

      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      await transcribe(blob);
    };

    mediaRecorder.start();
    isRecording = true;
    btnVoice.classList.add('recording');
    voiceStatus.textContent = 'Recording... release to stop';
    voiceStatus.style.display = 'block';
  } catch (err) {
    console.error('Recording error:', err);
    voiceStatus.textContent = 'Microphone access denied';
    voiceStatus.style.display = 'block';
  }
}

function stopRecording() {
  if (!isRecording || !mediaRecorder) return;
  mediaRecorder.stop();
  isRecording = false;
  btnVoice.classList.remove('recording');
  voiceStatus.textContent = 'Transcribing...';
}

async function transcribe(blob) {
  try {
    const form = new FormData();
    form.append('audio', blob, 'recording.webm');

    const res = await fetch('/api/drill/transcribe', {
      method: 'POST',
      body: form,
    });

    if (!res.ok) throw new Error('Transcription failed');

    const data = await res.json();
    userInput.value = data.text;
    btnSubmit.disabled = !data.text.trim();
    voiceStatus.textContent = 'Transcribed via Whisper';
  } catch (err) {
    console.error('Transcription error:', err);
    voiceStatus.textContent = 'Transcription failed — try typing instead';
  }
}

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
    const res = await fetch('/api/drill/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        english_prompt: currentDrill.english,
        target_japanese: currentDrill.target_japanese,
        user_response: userInput.value.trim(),
        mode,
        domain: currentDrill.domain,
        tier: currentDrill.tier,
        response_time_seconds: responseTime,
        vocabulary_used: currentDrill.vocabulary_used,
        grammar_used: currentDrill.grammar_used,
        hints: currentDrill.hints,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || err.error || 'Grading failed');
    }

    const result = await res.json();
    drillResultId = result.drillResultId;
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

  // Clear inline display override so CSS class can take effect
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

  // Render target with ruby furigana
  const targetText = result.target_japanese || currentDrill.target_japanese;
  resultTarget.innerHTML = furiganaToRuby(escapeHtml(targetText));

  resultExplanation.textContent = result.explanation || '';

  // Corrections with ruby furigana
  if (result.corrections && !result.is_correct) {
    resultCorrections.innerHTML = furiganaToRuby(escapeHtml(result.corrections));
    resultCorrections.style.display = 'block';
  } else {
    resultCorrections.style.display = 'none';
  }

  // Errors
  resultErrors.innerHTML = '';
  if (result.errors && result.errors.length > 0) {
    for (const err of result.errors) {
      const li = document.createElement('li');
      li.innerHTML = `<span class="error-type">${escapeHtml(err.type)}</span> ${escapeHtml(err.detail)}`;
      resultErrors.appendChild(li);
    }
  }

  // Store plain text for TTS
  btnTts.dataset.text = stripFurigana(targetText);

  // Store grading result for chat context
  lastGradeResult = result;

  // Show chat area and reset conversation
  chatHistory = [];
  chatMessages.innerHTML = '';
  chatArea.style.display = 'block';
  chatInput.value = '';
  btnChatSend.disabled = true;
}

// --- TTS via OpenAI ---
btnTts.addEventListener('click', async () => {
  const text = btnTts.dataset.text;
  if (!text) return;

  // Stop any currently playing audio
  if (ttsAudio) {
    ttsAudio.pause();
    ttsAudio = null;
  }

  btnTts.disabled = true;
  btnTts.textContent = '... Loading';

  try {
    const res = await fetch('/api/drill/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) throw new Error('TTS failed');

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    ttsAudio = new Audio(url);
    ttsAudio.playbackRate = 0.85;
    ttsAudio.onended = () => {
      URL.revokeObjectURL(url);
      ttsAudio = null;
    };
    await ttsAudio.play();
  } catch (err) {
    console.error('TTS error:', err);
  } finally {
    btnTts.disabled = false;
    btnTts.innerHTML = '&#x1F50A; Listen';
  }
});

// --- Next drill ---
btnNext.addEventListener('click', () => {
  if (ttsAudio) { ttsAudio.pause(); ttsAudio = null; }
  resultCard.className = 'result-card';
  resultCard.style.display = 'none';
  voiceStatus.style.display = 'none';
  chatArea.style.display = 'none';
  chatHistory = [];
  chatMessages.innerHTML = '';
  drillResultId = null;
  lastGradeResult = null;
  currentDrill = null;
  generate();
});

function setScore(elementId, value) {
  const el = document.getElementById(elementId);
  if (!el) return;
  if (value == null) { el.textContent = '--'; el.className = 'score-value'; return; }
  el.textContent = value;
  el.className = 'score-value ' + (value >= 80 ? 'high' : value >= 50 ? 'mid' : 'low');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// --- Chat follow-up ---
chatInput.addEventListener('input', () => {
  btnChatSend.disabled = !chatInput.value.trim();
});

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && chatInput.value.trim()) {
    e.preventDefault();
    sendChat();
  }
});

btnChatSend.addEventListener('click', sendChat);

async function sendChat() {
  const question = chatInput.value.trim();
  if (!question || !currentDrill || !lastGradeResult) return;

  // Show user message
  appendChatMessage('user', question);
  chatInput.value = '';
  btnChatSend.disabled = true;

  // Show typing indicator
  const typingEl = appendChatMessage('assistant', '...');
  typingEl.classList.add('typing');

  try {
    const res = await fetch('/api/drill/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        drillContext: {
          english_prompt: currentDrill.english,
          user_response: userInput.value.trim(),
          target_japanese: lastGradeResult.target_japanese || currentDrill.target_japanese,
          score: lastGradeResult.score,
          grammar_score: lastGradeResult.grammar_score,
          meaning_score: lastGradeResult.meaning_score,
          naturalness_score: lastGradeResult.naturalness_score,
          errors: lastGradeResult.errors,
          corrections: lastGradeResult.corrections,
          explanation: lastGradeResult.explanation,
          hints: currentDrill.hints,
        },
        conversationHistory: chatHistory,
        question,
        drillResultId,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      let detail;
      try { detail = JSON.parse(text).detail || JSON.parse(text).error; } catch(_) { detail = text; }
      throw new Error(detail || `Chat failed (${res.status})`);
    }

    const data = await res.json();

    // Remove typing indicator and show real answer
    typingEl.remove();
    appendChatMessage('assistant', data.answer);

    // Update history
    chatHistory.push({ role: 'user', content: question });
    chatHistory.push({ role: 'assistant', content: data.answer });
  } catch (err) {
    console.error('Chat error:', err);
    typingEl.remove();
    appendChatMessage('assistant', 'Error: ' + err.message);
  }
}

function appendChatMessage(role, content) {
  const div = document.createElement('div');
  div.className = 'chat-msg ' + (role === 'user' ? 'chat-user' : 'chat-assistant');
  div.innerHTML = furiganaToRuby(escapeHtml(content));
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;
}

// --- Start ---
init();
