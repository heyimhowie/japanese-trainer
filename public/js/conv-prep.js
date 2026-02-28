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

const historyCard = document.getElementById('history-card');
const historyList = document.getElementById('history-list');

let activeHistoryId = null;

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
  await loadHistory();
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
    if (result.id) {
      prependHistoryItem({
        id: result.id,
        created_at: new Date().toISOString(),
        domain: result.domain,
        style: result.style,
        difficulty: result.difficulty,
        custom_topic: body.customTopic || null,
        scenario_summary: result.scenario_summary || null,
      });
      setActiveHistoryItem(result.id);
    }
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

// --- History ---
async function loadHistory() {
  try {
    const res = await fetch('/api/drill/conv-prep-history');
    if (!res.ok) return;
    const entries = await res.json();
    if (entries.length === 0) return;
    historyList.innerHTML = '';
    for (const entry of entries) {
      historyList.appendChild(createHistoryItem(entry));
    }
    historyCard.style.display = '';
  } catch (err) {
    console.error('Failed to load history:', err);
  }
}

function relativeTime(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days < 30) return days + 'd ago';
  return new Date(dateStr).toLocaleDateString();
}

const styleLabelsMap = {
  casual_chat: 'Casual Chat',
  role_play: 'Role Play',
  debate: 'Debate',
  storytelling: 'Storytelling',
};

function createHistoryItem(entry) {
  const li = document.createElement('li');
  li.className = 'history-item';
  li.dataset.id = entry.id;

  const summary = entry.scenario_summary || entry.custom_topic || 'Conversation prep';
  const domain = (entry.domain || '').replace(/_/g, ' ');
  const style = styleLabelsMap[entry.style] || entry.style;

  li.innerHTML = `
    <div class="history-item-main">
      <div class="history-item-summary">${escapeHtml(summary)}</div>
      <div class="history-item-meta">
        <span class="domain-tag">${escapeHtml(domain)}</span>
        <span class="style-tag">${escapeHtml(style)}</span>
        <span class="difficulty-tag">Lv ${entry.difficulty}</span>
        <span class="history-time">${relativeTime(entry.created_at)}</span>
      </div>
    </div>
    <button class="history-delete" title="Delete">&times;</button>
  `;

  li.querySelector('.history-item-main').addEventListener('click', () => loadHistoryEntry(entry.id));
  li.querySelector('.history-delete').addEventListener('click', (e) => {
    e.stopPropagation();
    deleteHistoryEntry(entry.id, li);
  });

  return li;
}

function prependHistoryItem(entry) {
  const li = createHistoryItem(entry);
  historyList.prepend(li);
  historyCard.style.display = '';
}

function setActiveHistoryItem(id) {
  activeHistoryId = id;
  for (const el of historyList.children) {
    el.classList.toggle('active', el.dataset.id === String(id));
  }
}

async function loadHistoryEntry(id) {
  loading.style.display = 'block';
  output.style.display = 'none';
  generateArea.style.display = 'none';

  try {
    const res = await fetch('/api/drill/conv-prep-history/' + id);
    if (!res.ok) throw new Error('Failed to load');
    const entry = await res.json();
    const result = {
      ...entry.payload,
      domain: entry.domain,
      style: entry.style,
      difficulty: entry.difficulty,
    };
    showResult(result);
    setActiveHistoryItem(id);
  } catch (err) {
    console.error('Failed to load history entry:', err);
    loading.style.display = 'none';
    generateArea.style.display = 'block';
    alert('Failed to load history entry');
  }
}

async function deleteHistoryEntry(id, li) {
  try {
    const res = await fetch('/api/drill/conv-prep-history/' + id, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete');
    li.remove();
    if (historyList.children.length === 0) {
      historyCard.style.display = 'none';
    }
    if (activeHistoryId === id) {
      activeHistoryId = null;
    }
  } catch (err) {
    console.error('Failed to delete history entry:', err);
  }
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
