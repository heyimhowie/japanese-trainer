async function loadDashboard() {
  try {
    const res = await fetch('/api/stats/dashboard');
    const data = await res.json();

    document.getElementById('streak').textContent = data.streak;
    document.getElementById('total-drills').textContent = data.total_drills;

    // Free production stats
    const free = data.free_today || { completed: 0, correct: 0 };
    document.getElementById('free-completed').textContent = free.completed || 0;
    const freeAcc = free.completed > 0
      ? Math.round((free.correct / free.completed) * 100)
      : 0;
    document.getElementById('free-accuracy').textContent = freeAcc + '%';

    // Targeted drill stats
    const targeted = data.targeted_today || { completed: 0, correct: 0 };
    document.getElementById('targeted-completed').textContent = targeted.completed || 0;

    // Vocab tiers
    const tierMap = {};
    if (data.vocabulary.tiers) {
      for (const t of data.vocabulary.tiers) tierMap[t.jpdb_tier] = t.count;
    }
    document.getElementById('vocab-strong').textContent = tierMap.strong || 0;
    document.getElementById('vocab-moderate').textContent = tierMap.moderate || 0;
    document.getElementById('vocab-weak').textContent = tierMap.weak || 0;
    document.getElementById('vocab-produced').textContent = data.vocabulary.produced || 0;

    // Grammar
    document.getElementById('grammar-total').textContent = data.grammar.total;
    document.getElementById('grammar-reliable').textContent = data.grammar.reliable || 0;

    // Weakest patterns
    const list = document.getElementById('weakness-list');
    list.innerHTML = '';
    if (data.weakest_patterns.length === 0) {
      list.innerHTML = '<li><span style="color: var(--text-muted)">No data yet</span></li>';
    } else {
      for (const p of data.weakest_patterns) {
        const li = document.createElement('li');
        const acc = p.bunpro_accuracy !== null ? Math.round(p.bunpro_accuracy * 100) + '%' : 'N/A';
        li.innerHTML = `
          <span class="pattern-name">${escapeHtml(p.pattern_name)}</span>
          <span class="accuracy">${acc}</span>
        `;
        list.appendChild(li);
      }
    }
  } catch (err) {
    console.error('Failed to load dashboard:', err);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

loadDashboard();
