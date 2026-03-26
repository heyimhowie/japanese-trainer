// --- Service Worker registration ---
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

var currentOffset = 0;
var PAGE_SIZE = 20;
var expandedId = null;

var filterType = document.getElementById('filter-type');
var filterDomain = document.getElementById('filter-domain');
var filterFrom = document.getElementById('filter-from');
var filterTo = document.getElementById('filter-to');
var resultsList = document.getElementById('results-list');
var loadMoreArea = document.getElementById('load-more-area');
var btnLoadMore = document.getElementById('btn-load-more');
var emptyState = document.getElementById('empty-state');
var loading = document.getElementById('loading');

// --- Init ---
async function init() {
  // Populate domain filter
  try {
    var res = await fetch('/api/drill/domains');
    var domains = await res.json();
    for (var d of domains) {
      var opt = document.createElement('option');
      opt.value = d.key;
      opt.textContent = d.label;
      filterDomain.appendChild(opt);
    }
  } catch (e) { /* ignore */ }

  loadResults(true);
}

// --- Load results ---
async function loadResults(reset) {
  if (reset) {
    currentOffset = 0;
    resultsList.innerHTML = '';
    expandedId = null;
  }

  loading.style.display = 'flex';
  emptyState.style.display = 'none';
  loadMoreArea.style.display = 'none';

  var params = new URLSearchParams({
    type: filterType.value,
    limit: PAGE_SIZE,
    offset: currentOffset,
  });
  if (filterDomain.value) params.set('domain', filterDomain.value);
  if (filterFrom.value) params.set('from', filterFrom.value);
  if (filterTo.value) params.set('to', filterTo.value);

  try {
    var res = await fetch('/api/history?' + params.toString());
    var data = await res.json();

    loading.style.display = 'none';

    if (data.items.length === 0 && currentOffset === 0) {
      emptyState.style.display = 'flex';
      return;
    }

    for (var item of data.items) {
      resultsList.appendChild(renderItem(item));
    }

    currentOffset += data.items.length;

    if (data.has_more) {
      loadMoreArea.style.display = 'flex';
    }
  } catch (err) {
    loading.style.display = 'none';
    console.error('Failed to load history:', err);
  }
}

// --- Render list item ---
function renderItem(item) {
  var li = document.createElement('li');
  li.className = 'history-item drill-history-item';
  li.dataset.id = item.id;

  var isTargeted = !item.drill_type || item.drill_type === 'targeted';
  var prompt = isTargeted
    ? (item.english_prompt || '')
    : (item.japanese_prompt || '');
  var snippet = prompt.length > 70 ? prompt.substring(0, 70) + '...' : prompt;

  var typeLabel = isTargeted ? 'Targeted' : 'Free';
  var domainLabel = item.life_domain
    ? item.life_domain.replace(/_/g, ' ')
    : '';

  var statusIcon = item.is_correct
    ? '<span class="material-symbols-outlined history-status-icon correct">check_circle</span>'
    : '<span class="material-symbols-outlined history-status-icon incorrect">cancel</span>';

  li.innerHTML =
    '<div class="drill-history-row">' +
      statusIcon +
      '<div class="history-item-main">' +
        '<div class="history-item-summary' + (isTargeted ? '' : ' jp-text') + '">' + escapeHtml(snippet) + '</div>' +
        '<div class="history-item-meta">' +
          '<span class="style-tag">' + typeLabel + '</span>' +
          (domainLabel ? '<span class="domain-tag">' + escapeHtml(domainLabel) + '</span>' : '') +
          '<span class="history-time">' + relativeTime(item.timestamp) + '</span>' +
        '</div>' +
      '</div>' +
      '<span class="material-symbols-outlined drill-history-chevron">expand_more</span>' +
    '</div>' +
    '<div class="drill-history-detail" id="detail-' + item.id + '"></div>';

  li.querySelector('.drill-history-row').addEventListener('click', function() {
    toggleDetail(item.id, li);
  });

  return li;
}

// --- Toggle detail ---
async function toggleDetail(id, li) {
  var detailEl = document.getElementById('detail-' + id);
  var chevron = li.querySelector('.drill-history-chevron');

  // Collapse if already expanded
  if (expandedId === id) {
    detailEl.innerHTML = '';
    detailEl.style.display = 'none';
    chevron.style.transform = '';
    expandedId = null;
    return;
  }

  // Collapse previous
  if (expandedId !== null) {
    var prev = document.getElementById('detail-' + expandedId);
    if (prev) {
      prev.innerHTML = '';
      prev.style.display = 'none';
    }
    var prevChevron = resultsList.querySelector('.drill-history-chevron[style]');
    if (prevChevron) prevChevron.style.transform = '';
  }

  expandedId = id;
  chevron.style.transform = 'rotate(180deg)';
  detailEl.innerHTML = '<div class="loading" style="display:flex;padding:16px 0;"><div class="spinner"></div></div>';
  detailEl.style.display = 'block';

  try {
    var res = await fetch('/api/history/' + id);
    var data = await res.json();
    detailEl.innerHTML = renderDetail(data);
  } catch (err) {
    detailEl.innerHTML = '<p style="color:var(--error);padding:12px;">Failed to load details</p>';
  }
}

// --- Render detail panel ---
function renderDetail(d) {
  var isTargeted = !d.drill_type || d.drill_type === 'targeted';
  var html = '';

  // Status banner
  if (d.is_correct) {
    html += '<div class="detail-status correct"><span class="material-symbols-outlined">check_circle</span> Correct</div>';
  } else {
    html += '<div class="detail-status incorrect"><span class="material-symbols-outlined">cancel</span> Incorrect</div>';
  }

  // Prompt
  if (isTargeted && d.english_prompt) {
    html += '<div class="detail-section"><div class="detail-label">Prompt</div><div class="detail-text">' + escapeHtml(d.english_prompt) + '</div></div>';
  } else if (d.japanese_prompt) {
    html += '<div class="detail-section"><div class="detail-label">Prompt</div><div class="detail-text jp-text">' + escapeHtml(d.japanese_prompt) + '</div></div>';
  }

  // User response
  html += '<div class="detail-section"><div class="detail-label">Your Response</div><div class="detail-text jp-text">' + escapeHtml(d.user_response || '') + '</div></div>';

  // Model answer
  if (d.target_japanese) {
    html += '<div class="detail-section"><div class="detail-label">Model Answer</div><div class="detail-text jp-text">' + escapeHtml(d.target_japanese) + '</div></div>';
  }

  // Errors
  if (d.errors && d.errors.length > 0) {
    html += '<div class="detail-section"><div class="detail-label">Errors</div>';
    for (var e of d.errors) {
      html += '<div class="detail-error"><span class="error-type-badge">' + escapeHtml(e.type || 'error') + '</span> ' + escapeHtml(e.detail || '') + '</div>';
    }
    html += '</div>';
  }

  // Vocabulary used
  if (d.vocabulary_used && d.vocabulary_used.length > 0) {
    html += '<div class="detail-section"><div class="detail-label">Vocabulary</div><div class="detail-tags">';
    for (var v of d.vocabulary_used) {
      var label = v.spelling || v.word || v;
      html += '<span class="domain-tag">' + escapeHtml(typeof label === 'string' ? label : JSON.stringify(label)) + '</span>';
    }
    html += '</div></div>';
  }

  // Grammar used
  if (d.grammar_used && d.grammar_used.length > 0) {
    html += '<div class="detail-section"><div class="detail-label">Grammar</div><div class="detail-tags">';
    for (var g of d.grammar_used) {
      var gLabel = g.pattern_name || g;
      html += '<span class="style-tag">' + escapeHtml(typeof gLabel === 'string' ? gLabel : JSON.stringify(gLabel)) + '</span>';
    }
    html += '</div></div>';
  }

  // Follow-up Q&A
  if (d.follow_up_qa && d.follow_up_qa.length > 0) {
    html += '<div class="detail-section"><div class="detail-label">Follow-up Q&A</div><div class="detail-qa">';
    for (var qa of d.follow_up_qa) {
      html += '<div class="qa-msg qa-' + (qa.role || 'user') + '">' + escapeHtml(qa.content || '') + '</div>';
    }
    html += '</div></div>';
  }

  // Metadata
  var meta = [];
  if (d.mode) meta.push(d.mode);
  if (d.response_time_seconds) meta.push(Math.round(d.response_time_seconds) + 's');
  if (d.difficulty_tier) meta.push('Tier ' + d.difficulty_tier);
  if (meta.length > 0) {
    html += '<div class="detail-meta">' + meta.join(' &middot; ') + '</div>';
  }

  return html;
}

// --- Helpers ---
function relativeTime(dateStr) {
  var diff = Date.now() - new Date(dateStr).getTime();
  var mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  var hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  var days = Math.floor(hrs / 24);
  if (days < 30) return days + 'd ago';
  return new Date(dateStr).toLocaleDateString();
}

function escapeHtml(text) {
  var div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// --- Events ---
filterType.addEventListener('change', function() { loadResults(true); });
filterDomain.addEventListener('change', function() { loadResults(true); });
filterFrom.addEventListener('change', function() { loadResults(true); });
filterTo.addEventListener('change', function() { loadResults(true); });
btnLoadMore.addEventListener('click', function() { loadResults(false); });

init();
