// --- Shared utilities for drill pages ---

// Convert 漢字(かんじ) notation to <ruby> tags
function furiganaToRuby(text) {
  if (!text) return '';
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

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function setScore(elementId, value) {
  const el = document.getElementById(elementId);
  if (!el) return;
  if (value == null) { el.textContent = '--'; el.className = 'score-value'; return; }
  el.textContent = value;
  el.className = 'score-value ' + (value >= 80 ? 'high' : value >= 50 ? 'mid' : 'low');
}

// --- TTS playback ---
let _ttsAudio = null;

async function playTts(text) {
  if (!text) return;
  if (_ttsAudio) { _ttsAudio.pause(); _ttsAudio = null; }

  const res = await fetch('/api/drill/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error('TTS failed');

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  _ttsAudio = new Audio(url);
  _ttsAudio.playbackRate = 0.85;
  _ttsAudio.onended = () => { URL.revokeObjectURL(url); _ttsAudio = null; };
  await _ttsAudio.play();
}

function stopTts() {
  if (_ttsAudio) { _ttsAudio.pause(); _ttsAudio = null; }
}

// --- Voice recording ---
// Returns { start, stop } functions. Calls opts.onTranscribed(text) when done.
function initVoice(opts) {
  let mediaRecorder = null;
  let audioChunks = [];
  let isRecording = false;

  async function start() {
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
        if (opts.onTranscribing) opts.onTranscribing();
        try {
          const form = new FormData();
          form.append('audio', blob, 'recording.webm');
          const res = await fetch('/api/drill/transcribe', { method: 'POST', body: form });
          if (!res.ok) throw new Error('Transcription failed');
          const data = await res.json();
          if (opts.onTranscribed) opts.onTranscribed(data.text);
        } catch (err) {
          console.error('Transcription error:', err);
          if (opts.onError) opts.onError(err);
        }
      };

      mediaRecorder.start();
      isRecording = true;
      if (opts.onStart) opts.onStart();
    } catch (err) {
      console.error('Recording error:', err);
      if (opts.onError) opts.onError(err);
    }
  }

  function stop() {
    if (!isRecording || !mediaRecorder) return;
    mediaRecorder.stop();
    isRecording = false;
    if (opts.onStop) opts.onStop();
  }

  return { start, stop, isRecording: () => isRecording };
}

// --- Chat follow-up ---
// Returns { send, appendMessage, reset } functions
function initChat(opts) {
  const { messagesEl, inputEl, sendBtn } = opts;
  let chatHistory = [];

  inputEl.addEventListener('input', () => {
    sendBtn.disabled = !inputEl.value.trim();
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && inputEl.value.trim()) {
      e.preventDefault();
      send();
    }
  });

  sendBtn.addEventListener('click', send);

  function appendMessage(role, content) {
    const div = document.createElement('div');
    div.className = 'chat-msg ' + (role === 'user' ? 'chat-user' : 'chat-assistant');
    div.innerHTML = furiganaToRuby(escapeHtml(content));
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  async function send() {
    const question = inputEl.value.trim();
    if (!question) return;
    const context = opts.getContext();
    if (!context) return;

    appendMessage('user', question);
    inputEl.value = '';
    sendBtn.disabled = true;

    const typingEl = appendMessage('assistant', '...');
    typingEl.classList.add('typing');

    try {
      const res = await fetch('/api/drill/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          drillContext: context.drillContext,
          conversationHistory: chatHistory,
          question,
          drillResultId: context.drillResultId,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        let detail;
        try { detail = JSON.parse(text).detail || JSON.parse(text).error; } catch(_) { detail = text; }
        throw new Error(detail || `Chat failed (${res.status})`);
      }

      const data = await res.json();
      typingEl.remove();
      appendMessage('assistant', data.answer);
      chatHistory.push({ role: 'user', content: question });
      chatHistory.push({ role: 'assistant', content: data.answer });
    } catch (err) {
      console.error('Chat error:', err);
      typingEl.remove();
      appendMessage('assistant', 'Error: ' + err.message);
    }
  }

  function reset() {
    chatHistory = [];
    messagesEl.innerHTML = '';
    inputEl.value = '';
    sendBtn.disabled = true;
  }

  return { send, appendMessage, reset };
}
