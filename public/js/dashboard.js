// --- Service Worker registration ---
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

async function loadDashboard() {
  try {
    const res = await fetch('/api/stats/dashboard');
    const data = await res.json();

    // Stat grid values (preserve number, append suffix via HTML)
    setStatValue('streak', data.streak);
    setStatValue('total-drills', data.total_drills);

    // Free production stats
    const free = data.free_today || { completed: 0, correct: 0 };
    setStatValue('free-completed', free.completed || 0);
    const freeAcc = free.completed > 0
      ? Math.round((free.correct / free.completed) * 100)
      : 0;
    document.getElementById('free-accuracy').textContent = freeAcc + '%';

    // Targeted drill stats
    const targeted = data.targeted_today || { completed: 0, correct: 0 };
    setStatValue('targeted-completed', targeted.completed || 0);

    // Vocab tiers
    const tierMap = {};
    if (data.vocabulary.tiers) {
      for (const t of data.vocabulary.tiers) tierMap[t.jpdb_tier] = t.count;
    }
    const strong = tierMap.strong || 0;
    const moderate = tierMap.moderate || 0;
    const weak = tierMap.weak || 0;
    const vocabTotal = strong + moderate + weak;

    document.getElementById('vocab-strong').textContent = strong;
    document.getElementById('vocab-moderate').textContent = moderate;
    document.getElementById('vocab-weak').textContent = weak;

    // Set progress bar widths
    if (vocabTotal > 0) {
      document.getElementById('vocab-strong-bar').style.width = ((strong / vocabTotal) * 100) + '%';
      document.getElementById('vocab-moderate-bar').style.width = ((moderate / vocabTotal) * 100) + '%';
      document.getElementById('vocab-weak-bar').style.width = ((weak / vocabTotal) * 100) + '%';
    }

    // Grammar
    const grammarTotal = data.grammar.total || 0;
    const grammarReliable = data.grammar.reliable || 0;
    document.getElementById('grammar-total').textContent = grammarTotal;
    document.getElementById('grammar-reliable').textContent = grammarReliable;

    // Grammar mastery gauge
    const masteryPct = grammarTotal > 0 ? Math.round((grammarReliable / grammarTotal) * 100) : 0;
    document.getElementById('grammar-mastery').textContent = masteryPct + '%';
    const circumference = 2 * Math.PI * 28; // r=28, ~175.93
    const filled = (masteryPct / 100) * circumference;
    document.getElementById('grammar-gauge-circle').setAttribute('stroke-dasharray', filled + ' ' + circumference);

    // Weakest patterns
    const list = document.getElementById('weakness-list');
    list.innerHTML = '';
    if (data.weakest_patterns.length === 0) {
      list.innerHTML = '<li><span style="color: var(--text-muted)">No data yet</span></li>';
    } else {
      for (const p of data.weakest_patterns) {
        const li = document.createElement('li');
        const accNum = p.bunpro_accuracy !== null ? Math.round(p.bunpro_accuracy * 100) : null;
        const acc = accNum !== null ? accNum + '%' : 'N/A';
        const barWidth = accNum !== null ? accNum : 0;
        li.innerHTML = `
          <span class="pattern-name">${escapeHtml(p.pattern_name)}</span>
          <span class="accuracy-group">
            <span class="accuracy-bar"><span class="fill" style="width: ${barWidth}%"></span></span>
            <span class="accuracy">${acc}</span>
          </span>
        `;
        list.appendChild(li);
      }
    }
  } catch (err) {
    console.error('Failed to load dashboard:', err);
  }
}

/**
 * Set the numeric portion of a stat-box value, preserving the jp-suffix span.
 */
function setStatValue(id, value) {
  const el = document.getElementById(id);
  const suffix = el.querySelector('.jp-suffix');
  if (suffix) {
    // Clear text nodes, keep suffix element
    while (el.firstChild !== suffix) {
      el.removeChild(el.firstChild);
    }
    el.insertBefore(document.createTextNode(value), suffix);
  } else {
    el.textContent = value;
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

loadDashboard();
