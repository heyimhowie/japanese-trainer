// theme.js — Dark/Light mode toggle (runs before paint to prevent FOUC)
(function () {
  var STORAGE_KEY = 'theme-preference';

  function getEffectiveTheme() {
    var stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', theme === 'dark' ? '#0f172a' : '#f9f9fb');
    }
  }

  // Apply immediately (before DOM loads) to prevent flash
  applyTheme(getEffectiveTheme());

  // Listen for system preference changes when user has no explicit preference
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
    if (!localStorage.getItem(STORAGE_KEY)) {
      applyTheme(e.matches ? 'dark' : 'light');
      updateToggleIcon();
    }
  });

  function toggleTheme() {
    var current = getEffectiveTheme();
    var next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
    updateToggleIcon();
  }

  function updateToggleIcon() {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    var icon = btn.querySelector('.material-symbols-outlined');
    if (!icon) return;
    var theme = getEffectiveTheme();
    icon.textContent = theme === 'dark' ? 'light_mode' : 'dark_mode';
    btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  }

  // Set up toggle after DOM ready
  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.addEventListener('click', toggleTheme);
      updateToggleIcon();
    }
  });
})();
