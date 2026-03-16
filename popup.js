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
      document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
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
  const tabs = await chrome.tabs.query({});
  const activeTabs = await chrome.tabs.query({ active: true });
  const activeIds = new Set(activeTabs.map(t => t.id));

  document.getElementById('stat-open').textContent = tabs.length;
  document.getElementById('stat-vault').textContent = vault.length;
  document.getElementById('stat-timeout').textContent = settings.inactiveMinutes;
  document.getElementById('stat-interval').textContent = settings.checkIntervalMinutes;
  document.getElementById('vault-badge').textContent = vault.length;

  // Render open tabs list
  const openList = document.getElementById('open-tabs-list');
  openList.innerHTML = '';
  tabs.forEach(tab => {
    const row = document.createElement('div');
    row.className = 'open-tab-row';
    row.title = tab.url;

    const favicon = document.createElement('img');
    favicon.src = tab.favIconUrl || '';
    favicon.onerror = function() { this.style.display = 'none'; };

    const title = document.createElement('div');
    title.className = 'open-tab-title';
    title.textContent = tab.title || tab.url || 'New Tab';

    row.appendChild(favicon);
    row.appendChild(title);

    if (activeIds.has(tab.id)) {
      const dot = document.createElement('div');
      dot.className = 'open-tab-active';
      dot.title = 'Currently active';
      row.appendChild(dot);
    }

    row.addEventListener('click', () => {
      chrome.tabs.update(tab.id, { active: true });
      chrome.windows.update(tab.windowId, { focused: true });
    });

    openList.appendChild(row);
  });

  // Vault breakdown by group
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
    row.innerHTML =
      '<div style="width:8px;height:8px;border-radius:50%;background:' + color + ';flex-shrink:0;"></div>' +
      '<div style="font-size:11px;color:var(--text-dim);flex:0 0 110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + grp.name + '</div>' +
      '<div class="breakdown-bar-wrap"><div class="breakdown-bar" style="width:' + pct + '%;background:' + color + ';"></div></div>' +
      '<div class="breakdown-count">' + grp.items.length + '</div>';
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
        rawColor: item.groupColor || null,
        items: []
      };
    }
    groups[key].items.push(item);
  });

  const sorted = {};
  Object.keys(groups).sort((a, b) => {
    if (a === NO_GROUP_NAME) return 1;
    if (b === NO_GROUP_NAME) return -1;
    return a.localeCompare(b);
  }).forEach(k => { sorted[k] = groups[k]; });

  return sorted;
}

function renderVault() {
  const container = document.getElementById('vault-list');
  const groups = groupVault(vault);
  const keys = Object.keys(groups);
  container.innerHTML = '';

  if (vault.length === 0) {
    container.innerHTML =
      '<div class="empty-state"><div class="icon">🗄️</div><p>Your vault is empty.<br/>Inactive tabs will be saved here automatically.</p></div>';
    return;
  }

  if (keys.length === 0) {
    container.innerHTML =
      '<div class="empty-state"><div class="icon">🔍</div><p>No tabs match your search.</p></div>';
    return;
  }

  keys.forEach(key => {
    const grp = groups[key];
    const color = grp.color || NO_GROUP_COLOR;
    const isNamed = grp.name !== NO_GROUP_NAME;

    const section = document.createElement('div');
    section.className = 'group-section';
    section.dataset.key = key;

    // ── Group Header ──────────────────────────────────────
    const header = document.createElement('div');
    header.className = 'group-header';

    const dot = document.createElement('div');
    dot.className = 'group-dot';
    dot.style.cssText = 'background:' + color + ';box-shadow:0 0 6px ' + color + '55;';

    const nameEl = document.createElement('div');
    nameEl.className = 'group-name';
    nameEl.style.color = color;
    nameEl.textContent = grp.name;

    const countEl = document.createElement('div');
    countEl.className = 'group-count';
    countEl.textContent = grp.items.length + ' tab' + (grp.items.length !== 1 ? 's' : '');

    const chevron = document.createElement('div');
    chevron.className = 'group-chevron';
    chevron.textContent = '▾';

    header.appendChild(dot);
    header.appendChild(nameEl);
    header.appendChild(countEl);

    // ── Restore Group Button (only for named groups) ──────
    if (isNamed) {
      const restoreGroupBtn = document.createElement('button');
      restoreGroupBtn.className = 'group-restore-btn';
      restoreGroupBtn.title = 'Restore all tabs as a tab group with original name & color';
      restoreGroupBtn.innerHTML = '⊞ Restore Group';
      restoreGroupBtn.style.setProperty('--gc', color);

      restoreGroupBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        restoreGroupBtn.textContent = '⏳…';
        restoreGroupBtn.disabled = true;
        try {
          await chrome.runtime.sendMessage({
            action: 'restoreGroup',
            items: grp.items,
            groupName: grp.name,
            groupColor: grp.rawColor
          });
          const ids = new Set(grp.items.map(i => i.id));
          vault = vault.filter(t => !ids.has(t.id));
          await chrome.storage.local.set({ vault });
          renderAll();
          showToast('⊞ "' + grp.name + '" restored as tab group');
        } catch (err) {
          restoreGroupBtn.textContent = '⊞ Restore Group';
          restoreGroupBtn.disabled = false;
          showToast('❌ Could not restore group');
        }
      });

      header.appendChild(restoreGroupBtn);
    }

    header.appendChild(chevron);

    header.addEventListener('click', (e) => {
      if (e.target.classList.contains('group-restore-btn') || e.target.closest('.group-restore-btn')) return;
      section.classList.toggle('collapsed');
    });

    // ── Tab List ──────────────────────────────────────────
    const tabList = document.createElement('div');
    tabList.className = 'group-tabs';

    grp.items.forEach(item => {
      const el = document.createElement('div');
      el.className = 'tab-item';
      el.style.setProperty('--group-color', color);

      const domain = (function() {
        try { return new URL(item.url).hostname; } catch (e) { return item.url; }
      })();

      const age = formatAge(item.reaped_at);

      const favicon = document.createElement('div');
      if (item.favIconUrl) {
        const img = document.createElement('img');
        img.className = 'tab-favicon';
        img.src = item.favIconUrl;
        img.onerror = function() { this.style.display = 'none'; };
        favicon.appendChild(img);
      } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'tab-favicon';
        placeholder.style.cssText = 'background:' + color + '22;border-radius:2px;';
        favicon.appendChild(placeholder);
      }

      const info = document.createElement('div');
      info.className = 'tab-info';
      info.innerHTML =
        '<div class="tab-title">' + escapeHtml(item.title) + '</div>' +
        '<div class="tab-url">' + escapeHtml(domain) + '</div>';

      const timeEl = document.createElement('div');
      timeEl.className = 'tab-time';
      timeEl.textContent = age;

      const actions = document.createElement('div');
      actions.className = 'tab-actions';

      // Individual restore button
      const restoreBtn = document.createElement('button');
      restoreBtn.className = 'tab-btn restore';
      restoreBtn.title = 'Open this tab individually';
      restoreBtn.textContent = '↗';

      restoreBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await chrome.runtime.sendMessage({ action: 'restoreTab', url: item.url });
        // Remove from vault after restoring
        vault = vault.filter(t => t.id !== item.id);
        await chrome.storage.local.set({ vault });
        renderAll();
        showToast('↗ Tab opened');
      });

      // Delete button
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'tab-btn delete';
      deleteBtn.title = 'Remove from vault';
      deleteBtn.textContent = '✕';

      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        vault = vault.filter(t => t.id !== item.id);
        await chrome.storage.local.set({ vault });
        renderAll();
        showToast('🗑️ Removed from vault');
      });

      actions.appendChild(restoreBtn);
      actions.appendChild(deleteBtn);

      el.appendChild(favicon.firstChild || favicon);
      el.appendChild(info);
      el.appendChild(timeEl);
      el.appendChild(actions);

      // Click anywhere on tab item = open individually
      el.addEventListener('click', async () => {
        await chrome.runtime.sendMessage({ action: 'restoreTab', url: item.url });
        vault = vault.filter(t => t.id !== item.id);
        await chrome.storage.local.set({ vault });
        renderAll();
        showToast('↗ Tab opened');
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
  if (d > 0) return d + 'd';
  if (h > 0) return h + 'h';
  if (m > 0) return m + 'm';
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
  toastTimer = setTimeout(() => { el.classList.remove('show'); }, 2500);
}
