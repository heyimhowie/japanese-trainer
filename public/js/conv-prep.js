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

// Scenario summary
const scenarioSummary = document.getElementById('scenario-summary');
const scenarioTags = document.getElementById('scenario-tags');
const scenarioTitle = document.getElementById('scenario-title');
const scenarioText = document.getElementById('scenario-text');

// System prompt
const systemPromptCard = document.getElementById('system-prompt-card');
const promptOutput = document.getElementById('prompt-output');
const btnCopy = document.getElementById('btn-copy');

// Content sections
const vocabCard = document.getElementById('vocab-card');
const vocabList = document.getElementById('vocab-list');
const phrasesCard = document.getElementById('phrases-card');
const phraseList = document.getElementById('phrase-list');
const startersCard = document.getElementById('starters-card');
const starterList = document.getElementById('starter-list');
const topicsCard = document.getElementById('topics-card');
const topicsList = document.getElementById('topics-list');

// Save button
const btnSave = document.getElementById('btn-save');

// History toggle
const btnToggleHistory = document.getElementById('btn-toggle-history');
const historyContent = document.getElementById('history-content');
const historyList = document.getElementById('history-list');

let currentResult = null;   // the last generated/loaded result payload
let currentSavedId = null;  // non-null when viewing a saved entry or just saved
let savedCount = 0;
let historyLoaded = false;
let historyOpen = false;

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
  await fetchSavedCount();
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
    // Store the custom topic used for generation (needed for saving)
    result._customTopic = body.customTopic || null;
    currentResult = result;
    currentSavedId = null;
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

  // Reset save button
  btnSave.disabled = false;
  btnSave.innerHTML = '<span class="material-symbols-outlined">star</span>';
  btnSave.classList.remove('saved');
  btnSave.title = 'Save this prep';
  if (currentSavedId) {
    btnSave.innerHTML = '<span class="material-symbols-outlined" style="font-variation-settings: \'FILL\' 1;">star</span>';
    btnSave.classList.add('saved');
    btnSave.title = 'Saved';
  }

  // Scenario summary
  const styleLabels = {
    casual_chat: 'Casual Chat',
    role_play: 'Role Play',
    debate: 'Debate',
    storytelling: 'Storytelling',
  };
  const domain = (result.domain || '').replace(/_/g, ' ');
  const style = styleLabels[result.style] || result.style;
  const difficulty = 'Level ' + (result.difficulty || '?');

  scenarioTags.innerHTML = `
    <span class="domain-tag">${escapeHtml(domain)}</span>
    <span class="style-tag">${escapeHtml(style)}</span>
    <span class="difficulty-tag">${escapeHtml(difficulty)}</span>
  `;
  scenarioTitle.textContent = result.scenario_summary || '';
  scenarioText.textContent = result.scenario_description || '';
  scenarioSummary.style.display = '';

  // ChatGPT prompt
  promptOutput.textContent = result.chatgpt_prompt || '';
  btnCopy.innerHTML = '<span class="material-symbols-outlined" style="font-size: 1em;">content_copy</span> Copy Prompt';
  btnCopy.classList.remove('copied');
  systemPromptCard.style.display = '';

  // Vocabulary
  vocabList.innerHTML = '';
  if (result.key_vocabulary && result.key_vocabulary.length > 0) {
    for (const v of result.key_vocabulary) {
      const div = document.createElement('div');
      div.className = 'vocab-item';
      const isKnown = v.status === 'known';
      div.innerHTML = `
        <div class="vocab-item-header">
          <div class="vocab-kanji-group">
            <span class="reading">${escapeHtml(v.reading)}</span>
            <span class="word">${escapeHtml(v.word)}</span>
          </div>
          <span class="${isKnown ? 'known-badge' : 'new-badge'}">${isKnown ? 'Known' : 'New'}</span>
        </div>
        <div class="meaning">${escapeHtml(v.meaning)}</div>
        ${v.example ? `<div class="example">${furiganaToRuby(escapeHtml(v.example))}</div>` : ''}
      `;
      vocabList.appendChild(div);
    }
    vocabCard.style.display = '';
  } else {
    vocabCard.style.display = 'none';
  }

  // Phrases
  phraseList.innerHTML = '';
  const colors = ['primary', 'secondary', 'tertiary'];
  if (result.useful_phrases && result.useful_phrases.length > 0) {
    for (let i = 0; i < result.useful_phrases.length; i++) {
      const p = result.useful_phrases[i];
      const li = document.createElement('li');
      li.className = 'phrase-item';
      li.innerHTML = `
        <div class="phrase-bar ${colors[i % 3]}"></div>
        <div>
          <div class="jp">${furiganaToRuby(escapeHtml(p.japanese))}</div>
          <div class="en">${escapeHtml(p.english)}</div>
          ${p.note ? `<span class="note ${colors[i % 3]}">${escapeHtml(p.note)}</span>` : ''}
        </div>
      `;
      phraseList.appendChild(li);
    }
    phrasesCard.style.display = '';
  } else {
    phrasesCard.style.display = 'none';
  }

  // Starters
  starterList.innerHTML = '';
  if (result.conversation_starters && result.conversation_starters.length > 0) {
    for (const s of result.conversation_starters) {
      const li = document.createElement('li');
      li.className = 'starter-item';
      // Support both string and object starters
      if (typeof s === 'string') {
        li.innerHTML = `<div class="jp">${furiganaToRuby(escapeHtml(s))}</div>`;
      } else {
        li.innerHTML = `
          <div class="jp">${furiganaToRuby(escapeHtml(s.text || s.japanese || ''))}</div>
          ${s.label ? `<div class="starter-label">${escapeHtml(s.label)}</div>` : ''}
        `;
      }
      starterList.appendChild(li);
    }
    startersCard.style.display = '';
  } else {
    startersCard.style.display = 'none';
  }

  // Topics
  topicsList.innerHTML = '';
  if (result.topics_to_cover && result.topics_to_cover.length > 0) {
    for (const t of result.topics_to_cover) {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="material-symbols-outlined" style="font-size: 18px; color: var(--accent)">check_circle</span>
        <span>${escapeHtml(t)}</span>
      `;
      topicsList.appendChild(li);
    }
    topicsCard.style.display = '';
  } else {
    topicsCard.style.display = 'none';
  }

  output.style.display = 'block';
}

// --- Save button (toggle: save or unsave) ---
btnSave.addEventListener('click', async () => {
  if (!currentResult) return;

  btnSave.disabled = true;
  try {
    if (currentSavedId) {
      // Unsave: delete from DB
      const res = await fetch('/api/drill/conv-prep-history/' + currentSavedId, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');

      // Remove from history list if open
      if (historyOpen) {
        const li = historyList.querySelector(`[data-id="${currentSavedId}"]`);
        if (li) li.remove();
      } else {
        historyLoaded = false;
      }

      currentSavedId = null;
      btnSave.innerHTML = '<span class="material-symbols-outlined">star</span>';
      btnSave.classList.remove('saved');
      btnSave.title = 'Save this prep';

      savedCount--;
      updateHistoryLabel();
    } else {
      // Save: insert into DB
      const { domain, style, difficulty, _customTopic, ...payload } = currentResult;

      const res = await fetch('/api/drill/conv-prep-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain,
          style,
          difficulty,
          custom_topic: _customTopic || null,
          scenario_summary: currentResult.scenario_summary || null,
          payload,
        }),
      });

      if (!res.ok) throw new Error('Save failed');
      const { id } = await res.json();

      currentSavedId = id;
      btnSave.innerHTML = '<span class="material-symbols-outlined" style="font-variation-settings: \'FILL\' 1;">star</span>';
      btnSave.classList.add('saved');
      btnSave.title = 'Saved';

      savedCount++;
      updateHistoryLabel();

      // If history list is open, prepend the new item
      if (historyOpen) {
        const entry = {
          id,
          created_at: new Date().toISOString(),
          domain,
          style,
          difficulty,
          custom_topic: _customTopic || null,
          scenario_summary: currentResult.scenario_summary || null,
        };
        historyList.prepend(createHistoryItem(entry));
      } else {
        historyLoaded = false;
      }
    }
  } catch (err) {
    console.error('Save/unsave error:', err);
  } finally {
    btnSave.disabled = false;
  }
});

// --- History toggle button ---
btnToggleHistory.addEventListener('click', async () => {
  historyOpen = !historyOpen;
  if (historyOpen) {
    historyContent.style.display = '';
    btnToggleHistory.classList.add('expanded');
    if (!historyLoaded) {
      await loadHistoryList();
    }
  } else {
    historyContent.style.display = 'none';
    btnToggleHistory.classList.remove('expanded');
  }
});

// --- Fetch saved count on init ---
async function fetchSavedCount() {
  try {
    const res = await fetch('/api/drill/conv-prep-history');
    if (!res.ok) return;
    const entries = await res.json();
    savedCount = entries.length;
    updateHistoryLabel();
  } catch (err) {
    console.error('Failed to fetch saved count:', err);
  }
}

function updateHistoryLabel() {
  const label = btnToggleHistory.querySelector('.label');
  if (label) {
    label.textContent = savedCount > 0 ? `View Prep History (${savedCount})` : 'View Prep History';
  }
}

// --- Load history list ---
async function loadHistoryList() {
  try {
    const res = await fetch('/api/drill/conv-prep-history');
    if (!res.ok) return;
    const entries = await res.json();
    historyList.innerHTML = '';
    for (const entry of entries) {
      historyList.appendChild(createHistoryItem(entry));
    }
    historyLoaded = true;
  } catch (err) {
    console.error('Failed to load history list:', err);
  }
}

// --- Helpers ---
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

  li.querySelector('.history-item-main').addEventListener('click', () => loadSavedEntry(entry.id));
  li.querySelector('.history-delete').addEventListener('click', (e) => {
    e.stopPropagation();
    deleteSavedEntry(entry.id, li);
  });

  return li;
}

async function loadSavedEntry(id) {
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
    currentResult = result;
    currentSavedId = id;
    showResult(result);
  } catch (err) {
    console.error('Failed to load saved entry:', err);
    loading.style.display = 'none';
    generateArea.style.display = 'block';
    alert('Failed to load saved entry');
  }
}

async function deleteSavedEntry(id, li) {
  try {
    const res = await fetch('/api/drill/conv-prep-history/' + id, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete');
    li.remove();
    savedCount--;
    updateHistoryLabel();
    if (currentSavedId === id) {
      currentSavedId = null;
      btnSave.innerHTML = '<span class="material-symbols-outlined">star</span>';
      btnSave.classList.remove('saved');
      btnSave.title = 'Save this prep';
    }
  } catch (err) {
    console.error('Failed to delete saved entry:', err);
  }
}

// --- Copy button ---
btnCopy.addEventListener('click', async () => {
  const text = promptOutput.textContent;
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    btnCopy.innerHTML = '<span class="material-symbols-outlined" style="font-size: 1em;">check</span> Copied!';
    btnCopy.classList.add('copied');
    setTimeout(() => {
      btnCopy.innerHTML = '<span class="material-symbols-outlined" style="font-size: 1em;">content_copy</span> Copy Prompt';
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
    btnCopy.innerHTML = '<span class="material-symbols-outlined" style="font-size: 1em;">check</span> Copied!';
    btnCopy.classList.add('copied');
    setTimeout(() => {
      btnCopy.innerHTML = '<span class="material-symbols-outlined" style="font-size: 1em;">content_copy</span> Copy Prompt';
      btnCopy.classList.remove('copied');
    }, 2000);
  }
});
