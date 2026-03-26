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
      ? Math.round((free.correct / free.completed) * 100) + '%'
      : '--';
    document.getElementById('free-accuracy').textContent = freeAcc;

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

    // Grammar level breakdown
    renderGrammarLevels(data.grammar.levels);

    // Weekly trend chart
    renderWeeklyTrend(data.weekly_trend);

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
 * Render 7-day weekly trend as a dual-line SVG chart (Drills + Free).
 */
function renderWeeklyTrend(trend) {
  var chart = document.getElementById('trend-chart');
  if (!chart) return;

  // Build full 7-day range
  var days = [];
  var dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  for (var i = 6; i >= 0; i--) {
    var d = new Date();
    d.setDate(d.getDate() - i);
    var dateStr = d.toISOString().split('T')[0];
    days.push({ date: dateStr, label: dayNames[d.getDay()], targeted: 0, free: 0 });
  }

  // Merge API data
  var trendMap = {};
  if (trend) {
    for (var t of trend) trendMap[t.date] = t;
  }
  for (var day of days) {
    if (trendMap[day.date]) {
      day.targeted = trendMap[day.date].targeted || 0;
      day.free = trendMap[day.date].free || 0;
    }
  }

  var allVals = days.map(function(d) { return d.targeted; })
    .concat(days.map(function(d) { return d.free; }));
  var maxVal = Math.max.apply(null, allVals.concat([1]));

  // SVG dimensions
  var W = 500, H = 100;
  var padX = 36; // space for day labels on each side
  var padTop = 8, padBot = 0;
  var plotW = W - padX * 2;
  var plotH = H - padTop - padBot;
  var step = plotW / 6; // 7 points, 6 gaps

  function yPos(val) {
    return padTop + plotH - (val / maxVal) * plotH;
  }

  // Build polyline points
  var drillPts = [];
  var freePts = [];
  for (var j = 0; j < 7; j++) {
    var x = padX + j * step;
    drillPts.push(x + ',' + yPos(days[j].targeted));
    freePts.push(x + ',' + yPos(days[j].free));
  }

  var todayStr = new Date().toISOString().split('T')[0];

  // Build SVG
  var svg = '<svg viewBox="0 0 ' + W + ' ' + (H + 24) + '" width="' + W + '" height="' + (H + 24) + '" class="trend-svg">';

  // Horizontal grid lines
  for (var g = 0; g <= 3; g++) {
    var gy = padTop + (plotH / 3) * g;
    svg += '<line x1="' + padX + '" y1="' + gy + '" x2="' + (W - padX) + '" y2="' + gy + '" class="trend-grid"/>';
  }

  // Lines
  svg += '<polyline points="' + drillPts.join(' ') + '" class="trend-line drills" />';
  svg += '<polyline points="' + freePts.join(' ') + '" class="trend-line free" />';

  // Dots + labels
  for (var k = 0; k < 7; k++) {
    var cx = padX + k * step;
    var isToday = days[k].date === todayStr;
    // Drill dots
    if (days[k].targeted > 0) {
      svg += '<circle cx="' + cx + '" cy="' + yPos(days[k].targeted) + '" r="3.5" class="trend-dot drills"/>';
      svg += '<text x="' + cx + '" y="' + (yPos(days[k].targeted) - 8) + '" class="trend-val drills">' + days[k].targeted + '</text>';
    }
    // Free dots
    if (days[k].free > 0) {
      svg += '<circle cx="' + cx + '" cy="' + yPos(days[k].free) + '" r="3.5" class="trend-dot free"/>';
      svg += '<text x="' + cx + '" y="' + (yPos(days[k].free) - 8) + '" class="trend-val free">' + days[k].free + '</text>';
    }
    // Day labels
    svg += '<text x="' + cx + '" y="' + (H + 16) + '" class="trend-day-label' + (isToday ? ' today' : '') + '">' + days[k].label + '</text>';
  }

  svg += '</svg>';
  chart.innerHTML = svg;
}

/**
 * Render grammar level breakdown rows.
 */
function renderGrammarLevels(levels) {
  var container = document.getElementById('grammar-levels');
  if (!container || !levels) return;

  var order = ['master', 'expert', 'seasoned', 'adept', 'beginner'];
  var levelMap = {};
  for (var l of levels) levelMap[l.bunpro_level] = l;

  container.innerHTML = order
    .filter(function(name) { return levelMap[name]; })
    .map(function(name) {
      var l = levelMap[name];
      return '<div class="grammar-level-row">' +
        '<span class="level-name">' + name + '</span>' +
        '<span class="level-count">' + (l.reliable || 0) + '/' + l.count + '</span>' +
      '</div>';
    }).join('');
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
