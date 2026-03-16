// Tab Reaper - Popup Logic

const GROUP_COLORS = {
  grey: '#6b7280', blue: '#3b82f6', red: '#ef4444',
  yellow: '#f59e0b', green: '#10b981', pink: '#ec4899',
  purple: '#8b5cf6', cyan: '#06b6d4', orange: '#f97316'
};

const NO_GROUP_COLOR = '#334155';
const NO_GROUP_NAME = 'Ungrouped';

let settings = {};
let vault = [];
let searchQuery = '';

// ── Init ───────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  setupNav();
  setupDashboard();
  setupVault();
  setupSettings();
  renderAll();
});

async function loadData() {
  const result = await chrome.storage.local.get(['settings', 'vault']);
  settings = result.settings || {
    inactiveMinutes: 30, enabled: true, checkIntervalMinutes: 5,
    excludePinned: true, excludeAudible: true, excludeActiveTab: true, notifyOnReap: true
  };
  vault = result.vault || [];

  // Update header toggle
  document.getElementById('enabled-toggle').checked = settings.enabled;
  document.getElementById('enabled-toggle').addEventListener('change', async (e) => {
    settings.enabled = e.target.checked;
    await chrome.runtime.sendMessage({ action: 'updateSettings', settings });
    updateStatusText();
  });

  updateStatusText();
}

function updateStatusText() {
  const el = document.getElementById('status-text');
  el.textContent = settings.enabled
    ? `Active · reaps after ${settings.inactiveMinutes}m`
    : 'Paused · not reaping';
}

// ── Nav ────────────────────────────────────────────────────

function setupNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`panel-${btn.dataset.tab}`).classList.add('active');
    });
  });
}

// ── Dashboard ──────────────────────────────────────────────

async function setupDashboard() {
  document.getElementById('reap-now-btn').addEventListener('click', async () => {
    const btn = document.getElementById('reap-now-btn');
    btn.textContent = '⏳ Reaping…';
    btn.disabled = true;
    await chrome.runtime.sendMessage({ action: 'reapNow' });
    await loadData();
    renderAll();
    btn.textContent = '💀 REAP INACTIVE NOW';
    btn.disabled = false;
    showToast('✅ Reap complete — check your vault');
  });
}

async function renderDashboard() {
  // Stats
  const tabs = await chrome.tabs.query({});
  document.getElementById('stat-open').textContent = tabs.length;
  document.getElementById('stat-vault').textContent = vault.length;
  document.getElementById('stat-timeout').textContent = settings.inactiveMinutes;
  document.getElementById('stat-interval').textContent = settings.checkIntervalMinutes;
  document.getElementById('vault-badge').textContent = vault.length;

  // Group breakdown
  const groups = groupVault(vault);
  const keys = Object.keys(groups);
  const maxCount = Math.max(...keys.map(k => groups[k].items.length), 1);
  const container = document.getElementById('breakdown-list');
  container.innerHTML = '';

  if (keys.length === 0) {
    container.innerHTML = '<div style="padding: 12px; font-size: 11px; color: var(--text-muted); text-align: center;">No tabs in vault yet</div>';
    return;
  }

  keys.forEach(key => {
    const grp = groups[key];
    const pct = (grp.items.length / maxCount) * 100;
    const color = grp.color || NO_GROUP_COLOR;
    const row = document.createElement('div');
    row.className = 'breakdown-row';
    row.innerHTML = `
      <div style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></div>
      <div style="font-size:11px;color:var(--text-dim);flex:0 0 110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${grp.name}</div>
      <div class="breakdown-bar-wrap">
        <div class="breakdown-bar" style="width:${pct}%;background:${color};"></div>
      </div>
      <div class="breakdown-count">${grp.items.length}</div>
    `;
    container.appendChild(row);
  });
}

// ── Vault ──────────────────────────────────────────────────

function setupVault() {
  document.getElementById('search-input').addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase();
    renderVault();
  });

  document.getElementById('clear-all-btn').addEventListener('click', async () => {
    if (!confirm('Clear all vaulted tabs? This cannot be undone.')) return;
    vault = [];
    await chrome.storage.local.set({ vault: [] });
    renderAll();
    showToast('🗑️ Vault cleared');
  });
}

function groupVault(items) {
  const groups = {};
  const q = searchQuery;

  const filtered = q
    ? items.filter(t => t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q))
    : items;

  filtered.forEach(item => {
    const key = item.groupName || NO_GROUP_NAME;
    if (!groups[key]) {
      groups[key] = {
        name: key,
        color: item.groupColor ? GROUP_COLORS[item.groupColor] : NO_GROUP_COLOR,
        items: []
      };
    }
    groups[key].items.push(item);
  });

  // Sort: named groups first, then ungrouped
  const sorted = {};
  Object.keys(groups).sort((a, b) => {
    if (a === NO_GROUP_NAME) return 1;
    if (b === NO_GROUP_NAME) return -1;
    return a.localeCompare(b);
  }).forEach(k => sorted[k] = groups[k]);

  return sorted;
}

function renderVault() {
  const container = document.getElementById('vault-list');
  const groups = groupVault(vault);
  const keys = Object.keys(groups);
  container.innerHTML = '';

  if (vault.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">🗄️</div>
        <p>Your vault is empty.<br/>Inactive tabs will be saved here automatically.</p>
      </div>`;
    return;
  }

  if (keys.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">🔍</div>
        <p>No tabs match your search.</p>
      </div>`;
    return;
  }

  keys.forEach(key => {
    const grp = groups[key];
    const color = grp.color || NO_GROUP_COLOR;

    const section = document.createElement('div');
    section.className = 'group-section';
    section.dataset.key = key;

    const header = document.createElement('div');
    header.className = 'group-header';
    header.innerHTML = `
      <div class="group-dot" style="background:${color};box-shadow:0 0 6px ${color}55;"></div>
      <div class="group-name" style="color:${color};">${grp.name}</div>
      <div class="group-count">${grp.items.length} tab${grp.items.length !== 1 ? 's' : ''}</div>
      <div class="group-chevron">▾</div>
    `;
    header.addEventListener('click', () => {
      section.classList.toggle('collapsed');
    });

    const tabList = document.createElement('div');
    tabList.className = 'group-tabs';

    grp.items.forEach(item => {
      const el = document.createElement('div');
      el.className = 'tab-item';
      el.style.setProperty('--group-color', color);

      const domain = (() => {
        try { return new URL(item.url).hostname; } catch { return item.url; }
      })();

      const age = formatAge(item.reaped_at);

      el.innerHTML = `
        ${item.favIconUrl
          ? `<img class="tab-favicon" src="${item.favIconUrl}" onerror="this.style.display='none'" />`
          : `<div class="tab-favicon" style="background:${color}22;border-radius:2px;"></div>`
        }
        <div class="tab-info">
          <div class="tab-title">${escapeHtml(item.title)}</div>
          <div class="tab-url">${escapeHtml(domain)}</div>
        </div>
        <div class="tab-time">${age}</div>
        <div class="tab-actions">
          <button class="tab-btn restore" title="Restore tab">↗</button>
          <button class="tab-btn delete" title="Remove from vault">✕</button>
        </div>
      `;

      el.querySelector('.restore').addEventListener('click', async (e) => {
        e.stopPropagation();
        await chrome.runtime.sendMessage({ action: 'restoreTab', url: item.url });
        showToast('↗ Tab restored');
      });

      el.querySelector('.delete').addEventListener('click', async (e) => {
        e.stopPropagation();
        vault = vault.filter(t => t.id !== item.id);
        await chrome.storage.local.set({ vault });
        renderAll();
        showToast('🗑️ Removed from vault');
      });

      el.addEventListener('click', async () => {
        await chrome.runtime.sendMessage({ action: 'restoreTab', url: item.url });
      });

      tabList.appendChild(el);
    });

    section.appendChild(header);
    section.appendChild(tabList);
    container.appendChild(section);
  });
}

// ── Settings ───────────────────────────────────────────────

function setupSettings() {
  document.getElementById('save-settings-btn').addEventListener('click', async () => {
    const newSettings = {
      inactiveMinutes: parseInt(document.getElementById('s-inactive').value) || 30,
      checkIntervalMinutes: parseInt(document.getElementById('s-interval').value) || 5,
      excludePinned: document.getElementById('s-pinned').checked,
      excludeAudible: document.getElementById('s-audible').checked,
      excludeActiveTab: document.getElementById('s-active').checked,
      notifyOnReap: document.getElementById('s-notify').checked,
      enabled: settings.enabled
    };
    settings = newSettings;
    await chrome.runtime.sendMessage({ action: 'updateSettings', settings });
    updateStatusText();
    showToast('✅ Settings saved');
    renderDashboard();
  });
}

function renderSettings() {
  document.getElementById('s-inactive').value = settings.inactiveMinutes;
  document.getElementById('s-interval').value = settings.checkIntervalMinutes;
  document.getElementById('s-pinned').checked = settings.excludePinned;
  document.getElementById('s-audible').checked = settings.excludeAudible;
  document.getElementById('s-active').checked = settings.excludeActiveTab;
  document.getElementById('s-notify').checked = settings.notifyOnReap;
}

// ── Render All ─────────────────────────────────────────────

function renderAll() {
  document.getElementById('vault-badge').textContent = vault.length;
  renderDashboard();
  renderVault();
  renderSettings();
}

// ── Helpers ────────────────────────────────────────────────

function formatAge(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d`;
  if (h > 0) return `${h}h`;
  if (m > 0) return `${m}m`;
  return 'now';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

let toastTimer;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}
