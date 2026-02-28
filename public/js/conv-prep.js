// --- DOM refs ---
const domainSelect = document.getElementById('domain-select');
const styleSelect = document.getElementById('style-select');
const customTopic = document.getElementById('custom-topic');
const difficultySlider = document.getElementById('difficulty-slider');
const difficultyValue = document.getElementById('difficulty-value');
const btnGenerate = document.getElementById('btn-generate');
const btnAnother = document.getElementById('btn-another');
const loading = document.getElementById('loading');
const generateArea = document.getElementById('generate-area');
const output = document.getElementById('output');

const outDomain = document.getElementById('out-domain');
const outStyle = document.getElementById('out-style');
const outDifficulty = document.getElementById('out-difficulty');
const outSummary = document.getElementById('out-summary');
const outPrompt = document.getElementById('out-prompt');
const btnCopy = document.getElementById('btn-copy');
const outVocab = document.getElementById('out-vocab');
const outPhrases = document.getElementById('out-phrases');
const outStarters = document.getElementById('out-starters');
const outTopics = document.getElementById('out-topics');

// --- Init ---
async function init() {
  try {
    const res = await fetch('/api/drill/domains');
    if (!res.ok) return;
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

init();

// --- Difficulty slider ---
difficultySlider.addEventListener('input', () => {
  difficultyValue.textContent = difficultySlider.value;
});

// --- Generate ---
btnGenerate.addEventListener('click', generate);
btnAnother.addEventListener('click', generate);

async function generate() {
  generateArea.style.display = 'none';
  output.style.display = 'none';
  loading.style.display = 'block';

  try {
    const body = {
      difficulty: Number(difficultySlider.value),
      style: styleSelect.value,
    };
    if (domainSelect.value) body.domain = domainSelect.value;
    if (customTopic.value.trim()) body.customTopic = customTopic.value.trim();

    const res = await fetch('/api/drill/generate-conv-prep', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
    showResult(result);
  } catch (err) {
    console.error('Generate error:', err);
    loading.style.display = 'none';
    generateArea.style.display = 'block';
    alert('Failed to generate prep: ' + err.message);
  }
}

// --- Show result ---
function showResult(result) {
  loading.style.display = 'none';

  // Scenario summary
  outDomain.textContent = (result.domain || '').replace(/_/g, ' ');
  const styleLabels = {
    casual_chat: 'Casual Chat',
    role_play: 'Role Play',
    debate: 'Debate',
    storytelling: 'Storytelling',
  };
  outStyle.textContent = styleLabels[result.style] || result.style;
  outDifficulty.textContent = 'Level ' + (result.difficulty || '?');
  outSummary.textContent = result.scenario_summary || '';

  // ChatGPT prompt
  outPrompt.textContent = result.chatgpt_prompt || '';
  btnCopy.textContent = 'Copy';
  btnCopy.classList.remove('copied');

  // Vocabulary
  outVocab.innerHTML = '';
  if (result.key_vocabulary && result.key_vocabulary.length > 0) {
    for (const v of result.key_vocabulary) {
      const div = document.createElement('div');
      div.className = 'vocab-item';
      const badge = v.status === 'known'
        ? '<span class="known-badge">Known</span>'
        : '<span class="new-badge">New</span>';
      div.innerHTML = `
        <div class="vocab-item-header">
          <span class="word">${escapeHtml(v.word)}</span>
          <span class="reading">${escapeHtml(v.reading)}</span>
          ${badge}
        </div>
        <div class="meaning">${escapeHtml(v.meaning)}</div>
        ${v.example ? `<div class="example">${furiganaToRuby(escapeHtml(v.example))}</div>` : ''}
      `;
      outVocab.appendChild(div);
    }
  }

  // Phrases
  outPhrases.innerHTML = '';
  if (result.useful_phrases && result.useful_phrases.length > 0) {
    for (const p of result.useful_phrases) {
      const li = document.createElement('li');
      li.className = 'phrase-item';
      li.innerHTML = `
        <div class="jp">${furiganaToRuby(escapeHtml(p.japanese))}</div>
        <div class="en">${escapeHtml(p.english)}</div>
        ${p.note ? `<div class="note">${escapeHtml(p.note)}</div>` : ''}
      `;
      outPhrases.appendChild(li);
    }
  }

  // Starters
  outStarters.innerHTML = '';
  if (result.conversation_starters && result.conversation_starters.length > 0) {
    for (const s of result.conversation_starters) {
      const li = document.createElement('li');
      li.className = 'starter-item';
      li.innerHTML = furiganaToRuby(escapeHtml(s));
      outStarters.appendChild(li);
    }
  }

  // Topics
  outTopics.innerHTML = '';
  if (result.topics_to_cover && result.topics_to_cover.length > 0) {
    for (const t of result.topics_to_cover) {
      const li = document.createElement('li');
      li.textContent = t;
      outTopics.appendChild(li);
    }
  }

  output.style.display = 'block';
}

// --- Copy button ---
btnCopy.addEventListener('click', async () => {
  const text = outPrompt.textContent;
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    btnCopy.textContent = 'Copied!';
    btnCopy.classList.add('copied');
    setTimeout(() => {
      btnCopy.textContent = 'Copy';
      btnCopy.classList.remove('copied');
    }, 2000);
  } catch (err) {
    // Fallback for older browsers
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    btnCopy.textContent = 'Copied!';
    btnCopy.classList.add('copied');
    setTimeout(() => {
      btnCopy.textContent = 'Copy';
      btnCopy.classList.remove('copied');
    }, 2000);
  }
});
