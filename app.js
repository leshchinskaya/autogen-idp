// Источник навыков теперь берётся из CSV (HardSkills Review QA 4.0.csv)
// Глобальный URL Apps Script (Cloud Sync)
const CLOUD_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwqOobmbWA97CN7cJUQ6sQ8pO63ITTVqEhrhkLA-90pzjfIlRTbUmaXPQF1oerLmxxnfA/exec';
let skillsData = { skills: {} };

// --- Автосохранение в Sheets (глобально, чтобы вызывалось из любых обработчиков) ---
let __autoCloudSaveTimer = null;
let __autoCloudSaveInFlight = false;
async function autoCloudSaveNow(reason) {
  try {
    const url = CLOUD_APPS_SCRIPT_URL;
    if (!url) return;
    const statusEl = document.getElementById('inlineCloudAutoSaveStatus');
    if (statusEl) statusEl.textContent = 'сохраняем…';
    const titleInput = document.getElementById('inlineCloudPlanTitleInput');
    const inlineTitle = (titleInput?.value || '').trim();
    if (inlineTitle) {
      appState.ui = appState.ui || {};
      appState.ui.cloudPlanTitle = inlineTitle;
    }
    const id = appState.ui?.cloudRecordId || '';
    const form = new URLSearchParams();
    let mode = '';
    if (id) {
      form.set('action', 'update');
      form.set('id', id);
      mode = 'update';
    } else {
      form.set('action', 'append');
      mode = 'append';
    }
    const payload = { ...appState };
    let titleVal = (appState.ui?.cloudPlanTitle || '').trim();
    if (!titleVal) {
      const name = appState.profile?.fullName || '';
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      titleVal = name ? `ИПР — ${name} (${y}-${m}-${d})` : `ИПР (${y}-${m}-${d})`;
      appState.ui = appState.ui || {};
      appState.ui.cloudPlanTitle = titleVal;
    }
    if (titleVal) {
      payload.title = titleVal;
      payload.nameidp = titleVal;
      form.set('nameidp', titleVal);
    }
    form.set('payload', JSON.stringify(payload));
    const res = await fetch(url, { method: 'POST', body: form });
    const json = await res.json().catch(() => ({}));
    if (json && json.ok) {
      if (mode === 'append' && json.id) {
        appState.ui.cloudRecordId = json.id;
        saveToLocalStorage();
        try {
          const el = document.getElementById('inlineCloudCurrentRecord');
          if (el) el.textContent = `id = ${json.id}`;
        } catch (_) {}
      }
      if (statusEl) {
        statusEl.textContent = '✓ сохранено';
        setTimeout(() => { if (statusEl.textContent === '✓ сохранено') statusEl.textContent = ''; }, 1500);
      }
    } else {
      console.warn('Auto cloud save failed', reason, json);
      if (statusEl) statusEl.textContent = '⚠ ошибка';
    }
  } catch (e) {
    console.warn('Auto cloud save error', reason, e);
    const statusEl = document.getElementById('inlineCloudAutoSaveStatus');
    if (statusEl) statusEl.textContent = '⚠ сеть';
  }
}
function autoCloudSaveDebounced(reason) {
  clearTimeout(__autoCloudSaveTimer);
  __autoCloudSaveTimer = setTimeout(async () => {
    if (__autoCloudSaveInFlight) return;
    __autoCloudSaveInFlight = true;
    try { await autoCloudSaveNow(reason); } finally { __autoCloudSaveInFlight = false; }
  }, 600);
}

// Вспомогательные функции для CSV → модель приложения
function slugify(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_\-а-яё]/gi, '')
    .replace(/_+/g, '_');
}

function extractActivitiesFromDescription(desc) {
  if (!desc) return [];
  // Нормализуем инлайн‑буллеты вида "  - item  - item" в многострочные
  let normalized = String(desc)
    .replace(/[\u2022\u2023\u25E6]/g, '-')            // точки → дефис
    .replace(/\s{2,}-\s+/g, '\n- ')                   // два+ пробела + дефис ⇒ перенос строки
    .replace(/\s*;\s*-\s+/g, '\n- ');                 // ; -  ⇒ перенос строки

  const lines = normalized
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);
  // Берём строки с маркером, иначе всё после первой строки как подпункты
  const bulletLines = lines.filter(l => /^([•\-\*]|\u2022)/.test(l));
  const cleaned = (bulletLines.length > 0 ? bulletLines : lines.slice(1))
    .map(l => l.replace(/^([•\-\*]|\u2022)\s*/, '').trim())
    .filter(Boolean);
  return cleaned.length > 0 ? cleaned : (lines.length ? [lines[0]] : []);
}

function buildSkillsDataFromRows(rows) {
  const skillsByGroup = {};
  let currentGroup = null;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    // Нормализуем длину
    while (row.length < 6) row.push('');

    const groupCell = (row[0] || '').trim();
    const skillName = (row[1] || '').trim();

    if (i === 0) {
      // Заголовок CSV — пропускаем
      continue;
    }

    if (groupCell && !skillName) {
      currentGroup = groupCell;
      if (!skillsByGroup[currentGroup]) skillsByGroup[currentGroup] = [];
      continue;
    }

    if (!skillName) {
      // пустая строка
      continue;
    }

    const levels = {
      '1': { description: row[2] || '', activities: extractActivitiesFromDescription(row[2] || '') },
      '2': { description: row[3] || '', activities: extractActivitiesFromDescription(row[3] || '') },
      '3': { description: row[4] || '', activities: extractActivitiesFromDescription(row[4] || '') },
      '4': { description: row[5] || '', activities: extractActivitiesFromDescription(row[5] || '') }
    };

    const skill = {
      id: slugify(skillName),
      name: skillName,
      levels
    };

    const groupKey = currentGroup || 'Прочее';
    if (!skillsByGroup[groupKey]) skillsByGroup[groupKey] = [];
    skillsByGroup[groupKey].push(skill);
  }

  skillsData = { skills: skillsByGroup };
}

async function loadSkillsFromCSV() {
  // Сначала пробуем загрузить локальный файл по относительному пути
  try {
    const resp = await fetch('HardSkills Review QA 4.0.csv', { cache: 'no-store' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const csvText = await resp.text();
    return new Promise((resolve, reject) => {
      if (typeof Papa === 'undefined') {
        reject(new Error('PapaParse не загружен'));
        return;
      }
      Papa.parse(csvText, {
        delimiter: ',',
        newline: '\n',
        quotes: true,
        skipEmptyLines: 'greedy',
        complete: (results) => {
          buildSkillsDataFromRows(results.data);
          const helper = document.getElementById('skillsCsvHelper');
          if (helper) helper.style.display = 'none';
          resolve();
        },
        error: (err) => reject(err)
      });
    });
  } catch (e) {
    console.warn('Автозагрузка CSV не удалась, предложим загрузку вручную:', e);
    // Попросим пользователя выбрать файл вручную
    const fileInput = document.getElementById('skillsCsvFile');
    const helper = document.getElementById('skillsCsvHelper');
    if (fileInput && helper) {
      helper.style.display = 'block';
      return new Promise((resolve, reject) => {
        fileInput.onchange = (ev) => {
          const file = ev.target.files?.[0];
          if (!file) { reject(new Error('Файл не выбран')); return; }
          if (typeof Papa === 'undefined') { reject(new Error('PapaParse не загружен')); return; }
          Papa.parse(file, {
            delimiter: ',',
            newline: '\n',
            quotes: true,
            skipEmptyLines: 'greedy',
            complete: (results) => {
              buildSkillsDataFromRows(results.data);
              if (helper) helper.style.display = 'none';
              resolve();
            },
            error: (err) => reject(err)
          });
        };
      });
    }
  }
}

// -------- Knowledge Base Picker: parse markdown tables into tasks --------
async function toggleKbPicker(show) {
  const modal = document.getElementById('kbPickerModal');
  if (!modal) return;
  if (show) {
    await renderKbPicker();
    modal.style.display = 'block';
    modal.setAttribute('aria-hidden', 'false');
  } else {
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
  }
}

async function renderKbPicker() {
  const filesList = document.getElementById('kbFilesList');
  const parsedTasks = document.getElementById('kbParsedTasks');
  const targetSelect = document.getElementById('kbTargetSkillSelect');
  const searchInput = document.getElementById('kbSearchInput');
  if (!filesList || !parsedTasks || !targetSelect) return;

  // Fill skills select from current plan skills; fallback to catalog
  const planEntries = Object.entries(appState.developmentPlan || {});
  const planOptions = planEntries.map(([id, p]) => ({ id, name: p.name }));
  let options = planOptions;
  if (options.length === 0) {
    // fallback: all catalog skills
    const catalog = [];
    Object.values(skillsData.skills || {}).forEach(arr => (arr || []).forEach(s => catalog.push({ id: s.id, name: s.name })));
    options = catalog;
  }
  const cur = targetSelect.value;
  targetSelect.innerHTML = '<option value="">Выберите навык</option>' + options.map(o => `<option value="${o.id}">${o.name}</option>`).join('');
  if (cur) targetSelect.value = cur;
  if (!targetSelect.value && options.length > 0) targetSelect.value = options[0].id;

  // Try root JSON first to allow removing База_знаний_ИПР/
  try {
    const r = await fetch('kb_tasks.json', { cache: 'no-store' });
    if (r.ok) {
      const kbJsonForModal = await r.json();
      if (Array.isArray(kbJsonForModal)) {
        filesList.innerHTML = '<div class="status status--info">Загружено из kb_tasks.json</div>';
        const parseAndRenderJson = async () => {
          const q = (searchInput?.value || '').trim().toLowerCase();
          const all = kbJsonForModal.map(t => ({ ...t, __source: t.category || 'kb_tasks.json' }));
          const filtered = q ? all.filter(t => (t.goal||t.title||'').toLowerCase().includes(q) || (t.description||'').toLowerCase().includes(q)) : all;
          parsedTasks.innerHTML = filtered.length ? `
            <div style="display:grid; gap:8px; margin-top:8px;">
              ${filtered.map((t, idx) => `
                <div class=\"kb-task\" data-idx=\"${idx}\" style=\"border:1px solid var(--color-card-border); border-radius:8px; background: var(--color-surface);\">\
                  <div class=\"kb-task-header\" style=\"display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:12px; cursor:pointer;\">\
                    <div style=\"display:flex; align-items:flex-start; gap:12px; min-width:0; flex:1;\">\
                      <input type=\"checkbox\" class=\"kb-task-chk\" data-idx=\"${idx}\" checked>\
                      <div style=\"min-width:0; display:flex; flex-direction:column; gap:6px;\">\
                        <strong class=\"activity-name\" style=\"white-space:normal;\">${escapeHtml(t.goal || t.title || '')}</strong>\
                        <div style=\"display:flex; gap:8px; flex-wrap:wrap;\">\
                          <span class=\"tag\" title=\"Категория\">${escapeHtml(String(t.category || 'kb_tasks.json'))}</span>\
                        </div>\
                      </div>\
                    </div>\
                    <span class=\"kb-task-toggle\" aria-hidden=\"true\">▾</span>\
                  </div>\
                  <div class=\"kb-task-body\" style=\"display:none; padding:12px; border-top:1px solid var(--color-card-border);\">\
                    ${t.description ? `<div class=\\\"activity-desc\\\">${linkify(t.description)}</div>` : ''}\
                    ${t.criteria ? `<div class=\\\"activity-expected\\\"><strong>Критерии:</strong> ${linkify(t.criteria)}</div>` : ''}\
                  </div>\
                </div>
              `).join('')}
            </div>
          ` : '<div class="status status--info">Нет задач по выбранным файлам/фильтру</div>';
          parsedTasks.querySelectorAll('.kb-task-header').forEach(h => {
            h.addEventListener('click', (e) => {
              if (e.target && (e.target.matches('input') || e.target.closest('input'))) return;
              const body = h.parentElement.querySelector('.kb-task-body');
              const icon = h.querySelector('.kb-task-toggle');
              if (!body) return;
              const open = body.style.display !== 'none';
              body.style.display = open ? 'none' : 'block';
              if (icon) icon.textContent = open ? '▾' : '▴';
            });
          });
          modalKbState.tasks = filtered;
        };
        if (searchInput) searchInput.oninput = () => { clearTimeout(window.__kbDeb); window.__kbDeb = setTimeout(parseAndRenderJson, 200); };
        await parseAndRenderJson();
        return; // do not proceed to legacy manifest
      }
    }
  } catch (_) {}

  // Load manifest of KB files (static list)
  let manifest = [];
  try {
    const resp = await fetch('База_знаний_ИПР/kb_manifest.json', { cache: 'no-store' });
    if (resp.ok) manifest = await resp.json();
  } catch (_) {}
  if (!Array.isArray(manifest) || manifest.length === 0) {
    filesList.innerHTML = '<div class="status status--warning">Не удалось загрузить список файлов БЗ</div>';
    return;
  }

  // Render file list
  filesList.innerHTML = manifest.map((f, i) => `
    <label class="checkbox" style="display:flex; align-items:center; gap:8px;">
      <input type="checkbox" class="kb-file-chk" data-path="${f.path}" checked>
      <span>${escapeHtml(f.category)}</span>
      <code style="font-size:11px; opacity:0.8;">${f.path.split('/').pop()}</code>
    </label>
  `).join('');

  // Parse selected files and show tasks
  const parseAndRender = async () => {
    const paths = Array.from(filesList.querySelectorAll('.kb-file-chk'))
      .filter(cb => cb.checked)
      .map(cb => cb.getAttribute('data-path'));
    const all = [];
    for (const p of paths) {
      try {
        const resp = await fetch(p, { cache: 'no-store' });
        if (!resp.ok) continue;
        const md = await resp.text();
        const tasks = parseMarkdownTableToTasks(md);
        tasks.forEach(t => all.push({ ...t, __source: p }));
      } catch (_) {}
    }
    const q = (searchInput?.value || '').trim().toLowerCase();
    const filtered = q ? all.filter(t => t.title.toLowerCase().includes(q) || (t.description||'').toLowerCase().includes(q)) : all;
    parsedTasks.innerHTML = filtered.length ? `
      <div style="display:grid; gap:8px; margin-top:8px;">
        ${filtered.map((t, idx) => `
          <div class=\"kb-task\" data-idx=\"${idx}\" style=\"border:1px solid var(--color-card-border); border-radius:8px; background: var(--color-surface);\">
            <div class=\"kb-task-header\" style=\"display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:12px; cursor:pointer;\">
              <div style=\"display:flex; align-items:flex-start; gap:12px; min-width:0; flex:1;\">
                <input type=\"checkbox\" class=\"kb-task-chk\" data-idx=\"${idx}\" checked>
                <div style=\"min-width:0; display:flex; flex-direction:column; gap:6px;\">
                  <strong class=\"activity-name\" style=\"white-space:normal;\">${escapeHtml(t.goal || t.title)}</strong>
                  <div style=\"display:flex; gap:8px; flex-wrap:wrap;\">
                    <span class=\"tag\" title=\"Источник\">${t.__source.split('/').slice(-2).join('/')}</span>
                  </div>
                </div>
              </div>
              <span class=\"kb-task-toggle\" aria-hidden=\"true\">▾</span>
            </div>
            <div class=\"kb-task-body\" style=\"display:none; padding:12px; border-top:1px solid var(--color-card-border);\">
              ${t.description ? `<div class=\\\"activity-desc\\\">${linkify(t.description)}</div>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    ` : '<div class="status status--info">Нет задач по выбранным файлам/фильтру</div>';
    // Accordion behavior + stash for import
    parsedTasks.querySelectorAll('.kb-task-header').forEach(h => {
      h.addEventListener('click', (e) => {
        if (e.target && (e.target.matches('input') || e.target.closest('input'))) return;
        const body = h.parentElement.querySelector('.kb-task-body');
        const icon = h.querySelector('.kb-task-toggle');
        if (!body) return;
        const open = body.style.display !== 'none';
        body.style.display = open ? 'none' : 'block';
        if (icon) icon.textContent = open ? '▾' : '▴';
      });
    });
    modalKbState.tasks = filtered;
  };

  filesList.querySelectorAll('.kb-file-chk').forEach(cb => cb.addEventListener('change', parseAndRender));
  if (searchInput) searchInput.oninput = () => { clearTimeout(window.__kbDeb); window.__kbDeb = setTimeout(parseAndRender, 200); };
  await parseAndRender();
}

const modalKbState = { tasks: [] };

function parseMarkdownTableToTasks(md) {
  // Expect a markdown table with columns: Навык | Уровень | Описание | Критерий выполнения | Цель | Время выполнения | Комментарий
  const lines = String(md).split(/\r?\n/);
  const headerIdx = lines.findIndex(l => /\|\s*Навык\s*\|/i.test(l) && /\|\s*Описание\s*\|/i.test(l));
  if (headerIdx < 0) return [];
  const rows = [];
  for (let i = headerIdx + 2; i < lines.length; i += 1) { // skip header and separator
    const l = lines[i];
    if (!l || !l.includes('|')) continue;
    if (/^\s*$/.test(l)) continue;
    rows.push(l);
  }
  const tasks = [];
  for (const row of rows) {
    // split markdown table row by pipes, preserve inner pipes in links by naive approach
    const cols = row.split('|').map(c => c.trim());
    if (cols.length < 4) continue;
    const skillName = cols[1] || '';
    const level = parseInt(cols[2] || '1') || 1;
    const description = (cols[3] || '').replace(/^`|`$/g,'');
    const criteria = cols[4] || '';
    const goal = cols[5] || '';
    const title = `${skillName} — задача из БЗ`;
    // explode description into multiple tasks if it contains enumerated list segments
    const subActs = extractActivitiesFromDescription(description);
    const perAct = subActs.map((text, idx) => ({
      id: `${slugify(skillName)}_kb_${idx}_${Math.random().toString(36).slice(2,7)}`,
      title: text,
      description: text,
      criteria,
      goal,
    level,
    skillName
    }));
    if (perAct.length === 0) {
    perAct.push({ id: `${slugify(skillName)}_kb_${Math.random().toString(36).slice(2,7)}`, title, description, criteria, goal, level, skillName });
    }
    tasks.push(...perAct);
  }
  return tasks;
}

// Embedded KB picker inside Skills tab
async function renderSkillsKbPicker() {
  const filesList = document.getElementById('skillsKbFilesList');
  const parsedTasks = document.getElementById('skillsKbParsedTasks');
  const targetSelect = document.getElementById('skillsKbTargetSkillSelect');
  const searchInput = document.getElementById('skillsKbSearchInput');
  const filterSkillSelect = document.getElementById('skillsKbFilterSkillSelect');
  const filterLevelSelect = document.getElementById('skillsKbFilterLevelSelect');
  const autoBindChk = document.getElementById('skillsKbAutoBind');
  const weakInfo = document.getElementById('skillsKbWeakFilterInfo');
  const weakCount = document.getElementById('skillsKbWeakFilterCount');
  const weakClearBtn = document.getElementById('skillsKbWeakFilterClearBtn');
  if (!filesList || !parsedTasks || !targetSelect) return;

  // Fill skills select with full catalog
  const catalog = [];
  Object.values(skillsData.skills || {}).forEach(arr => (arr || []).forEach(s => catalog.push({ id: s.id, name: s.name })));
  // dedupe by id and sort by name
  const seen = new Set();
  const options = catalog.filter(s => { if (seen.has(s.id)) return false; seen.add(s.id); return true; })
    .sort((a,b) => a.name.localeCompare(b.name, 'ru'));
  const cur = targetSelect.value;
  targetSelect.innerHTML = '<option value="">Выберите навык</option>' + options.map(o => `<option value="${o.id}">${o.name}</option>`).join('');
  if (autoBindChk && autoBindChk.checked) {
    targetSelect.value = '';
  } else {
    if (cur) targetSelect.value = cur;
    if (!targetSelect.value && options.length > 0) targetSelect.value = options[0].id;
  }

  // Mutual control: auto-bind <-> manual target selection
  if (autoBindChk) {
    autoBindChk.onchange = () => {
      if (autoBindChk.checked) targetSelect.value = '';
    };
  }
  if (targetSelect) {
    targetSelect.onchange = () => {
      if (targetSelect.value) {
        if (autoBindChk) autoBindChk.checked = false;
      }
    };
  }

  // Prefer unified JSON if present (try root first), fallback to legacy markdown manifest
  let kbJson = null;
  try {
    let r = await fetch('kb_tasks.json', { cache: 'no-store' });
    if (!r.ok) {
      r = await fetch('База_знаний_ИПР/kb_tasks.json', { cache: 'no-store' });
    }
    if (r.ok) kbJson = await r.json();
  } catch (_) {}

  let manifest = [];
  if (!kbJson) {
    try {
      const resp = await fetch('База_знаний_ИПР/kb_manifest.json', { cache: 'no-store' });
      if (resp.ok) manifest = await resp.json();
    } catch (_) {}
    if (!Array.isArray(manifest) || manifest.length === 0) {
      filesList.innerHTML = '<div class="status status--warning">Не удалось загрузить Базу знаний</div>';
      return;
    }
    // Legacy UI: file list
    filesList.innerHTML = manifest.map((f) => `
      <label class="checkbox" style="display:flex; align-items:center; gap:8px;">
        <input type="checkbox" class="skills-kb-file-chk" data-path="${f.path}" checked>
        <span>${escapeHtml(f.category)}</span>
        <code style="font-size:11px; opacity:0.8;">${f.path.split('/').pop()}</code>
      </label>
    `).join('');
  } else {
    // New UI: categories from JSON as checkboxes
    const categories = Array.from(new Set((kbJson || []).map(t => t.category || 'Без категории'))).sort();
    // Initialize persisted selected categories if absent
    if (!skillsKbState.selCats) {
      skillsKbState.selCats = new Set(categories);
    } else {
      // Ensure newly added categories are auto-selected (UI for categories is hidden)
      categories.forEach(cat => skillsKbState.selCats.add(cat));
      // Optionally, drop removed categories
      skillsKbState.selCats = new Set(Array.from(skillsKbState.selCats).filter(cat => categories.includes(cat)));
    }
    filesList.innerHTML = categories.map(cat => `
      <label class="checkbox" style="display:flex; align-items:center; gap:8px;">
        <input type="checkbox" class="skills-kb-cat-chk" data-cat="${escapeHtml(cat)}" ${skillsKbState.selCats.has(cat) ? 'checked' : ''}>
        <span>${escapeHtml(cat)}</span>
      </label>
    `).join('');
  }

  const parseAndRender = async () => {
    let all = [];
    if (kbJson) {
      // Filter by selected categories
      const selectedCats = new Set(
        Array.from(filesList.querySelectorAll('.skills-kb-cat-chk'))
          .filter(cb => cb.checked)
          .map(cb => cb.getAttribute('data-cat'))
      );
      if (selectedCats.size === 0) {
        // if user unchecked all, show nothing
        all = [];
      } else {
        all = (kbJson || [])
          .filter(t => selectedCats.has(t.category || 'Без категории'))
          .map(t => ({
            __source: 'kb_tasks.json',
            skillName: t.skillName || '',
            level: t.level || 1,
            durationWeeks: (typeof t.durationWeeks === 'number') ? t.durationWeeks : null,
            goal: t.goal || '',
            description: t.description || '',
            criteria: t.criteria || '',
            title: (t.goal || (t.description || '').split(/\r?\n/)[0] || '').trim()
          }));
      }
      // Persist selected cats in state
      skillsKbState.selCats = selectedCats;
    } else {
      const paths = Array.from(filesList.querySelectorAll('.skills-kb-file-chk'))
        .filter(cb => cb.checked)
        .map(cb => cb.getAttribute('data-path'));
      for (const p of paths) {
        try {
          const resp = await fetch(p, { cache: 'no-store' });
          if (!resp.ok) continue;
          const md = await resp.text();
          const tasks = parseMarkdownTableToTasks(md);
          tasks.forEach(t => all.push({ ...t, __source: p }));
        } catch (_) {}
      }
    }
    // Populate filter by skill (from KB) options
    if (filterSkillSelect) {
      const prev = filterSkillSelect.value || '';
      const uniqueSkills = Array.from(new Set(all.map(t => (t.skillName || '').trim()).filter(Boolean))).sort();
      const optsHtml = ['<option value="">Все навыки</option>']
        .concat(uniqueSkills.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`))
        .join('');
      filterSkillSelect.innerHTML = optsHtml;
      if (prev && uniqueSkills.some(n => n === prev)) {
        filterSkillSelect.value = prev;
      }
    }

    const q = (searchInput?.value || '').trim().toLowerCase();
    const filterSkill = (filterSkillSelect?.value || '').trim().toLowerCase();
    const filterLevel = parseInt(filterLevelSelect?.value || '') || null;
    // Build weak filter maps
    const weakEnabled = Array.isArray(appState.kbWeakFilter?.skills) && appState.kbWeakFilter.skills.length > 0;
    const weakNameSet = new Set((appState.kbWeakFilter?.skills || []).map(s => String(s.name || '').trim().toLowerCase()).filter(Boolean));
    const weakLevelMap = new Map((appState.kbWeakFilter?.skills || []).map(s => [String(s.name || '').trim().toLowerCase(), Number.isFinite(s.current) ? s.current : 0]));
    const filtered = all.filter(t => {
      const matchesText = !q || t.title.toLowerCase().includes(q) || (t.description||'').toLowerCase().includes(q);
      const matchesSkill = !filterSkill || (t.skillName && t.skillName.toLowerCase() === filterSkill);
      const matchesLevel = !filterLevel || (parseInt(t.level || 0) === filterLevel);
      // Weak skills filter: show only tasks whose KB skill is in pasted list AND task level >= current+1
      let matchesWeak = true;
      if (weakEnabled) {
        const kbSkillName = String(t.skillName || '').trim().toLowerCase();
        if (!kbSkillName || !weakNameSet.has(kbSkillName)) {
          matchesWeak = false;
        } else {
          const curLvl = weakLevelMap.get(kbSkillName) ?? 0;
          const minLvl = Math.max(1, curLvl + 1);
          const taskLvl = Number.parseInt(t.level || 0) || 0;
          matchesWeak = taskLvl >= minLvl;
        }
      }
      return matchesText && matchesSkill && matchesLevel && matchesWeak;
    });
    parsedTasks.innerHTML = filtered.length ? `
      <div style="display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:8px; margin-top:8px;">
        ${filtered.map((t, idx) => `
          <div class="kb-task" data-idx="${idx}" style="border:1px solid var(--color-card-border); border-radius:8px; background: var(--color-surface); display:flex; flex-direction:column; overflow:hidden;">
            <div class="kb-task-header" style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:12px; cursor:pointer;">
              <div style="display:flex; align-items:flex-start; gap:12px; min-width:0; flex:1;">
                <input type="checkbox" class="kb-task-chk" data-kbid="${(t.__source + '|' + (t.skillName||'') + '|' + (t.title||'') + '|' + (t.description||'') + '|' + (t.criteria||'')).replace(/"/g,'&quot;')}">
                <div style="min-width:0; display:flex; flex-direction:column; gap:6px;">
                  <strong class="activity-name" style="white-space:normal;">${escapeHtml(t.goal || t.title)}</strong>
                  <div style="display:flex; gap:8px; flex-wrap;">
                    ${t.skillName ? `<span class="tag tag--skill" title="Навык">${escapeHtml(t.skillName)}</span>` : ''}
                    <span class="tag tag--level" title="Уровень">Уровень: ${(['','Базовые знания','Уверенные значения','Глубокие знания','Любая сложность'])[Number.isFinite(t.level) ? t.level : 1] || ('Уровень ' + (Number.isFinite(t.level) ? t.level : 1))}</span>
                    ${Number.isFinite(t.durationWeeks) && t.durationWeeks > 0 ? `<span class="tag tag--duration" title="Длительность">~${t.durationWeeks} нед.</span>` : ''}
                  </div>
                </div>
              </div>
              <span class="kb-task-toggle" aria-hidden="true">▴</span>
            </div>
            <div class="kb-task-body" style="display:block; padding:12px; border-top:1px solid var(--color-card-border); overflow:auto;">
              ${t.description ? `<div class=\"activity-desc\">${linkify(t.description)}</div>` : ''}
              ${t.criteria ? `<div class=\"activity-expected\"><strong>Критерии:</strong> ${linkify(t.criteria)}</div>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    ` : '<div class="status status--info">Нет задач по выбранным файлам/фильтру</div>';
    // Accordion behavior
    parsedTasks.querySelectorAll('.kb-task-header').forEach(h => {
      h.addEventListener('click', (e) => {
        if (e.target && (e.target.matches('input') || e.target.closest('input'))) return;
        const body = h.parentElement.querySelector('.kb-task-body');
        const icon = h.querySelector('.kb-task-toggle');
        if (!body) return;
        const open = body.style.display !== 'none';
        body.style.display = open ? 'none' : 'block';
        if (icon) icon.textContent = open ? '▾' : '▴';
      });
    });
    // Persist selection across re-renders (approximate via kbId recompute)
    parsedTasks.querySelectorAll('.kb-task-chk').forEach(cb => {
      const id = cb.getAttribute('data-kbid');
      if (id && skillsKbState.selected && skillsKbState.selected.has(id)) cb.checked = true;
      cb.addEventListener('change', () => {
        const id2 = cb.getAttribute('data-kbid'); if (!id2) return;
        if (!skillsKbState.selected) skillsKbState.selected = new Set();
        if (cb.checked) skillsKbState.selected.add(id2); else skillsKbState.selected.delete(id2);
      });
    });
    // stash
    skillsKbState.tasks = filtered;
    // Update weak filter indicator
    if (weakInfo && weakCount) {
      const enabled = weakEnabled;
      weakInfo.style.display = enabled ? 'block' : 'none';
      if (enabled) weakCount.textContent = String((appState.kbWeakFilter?.skills || []).length);
    }
  };

  filesList.querySelectorAll('.skills-kb-file-chk').forEach(cb => cb.addEventListener('change', parseAndRender));
  if (searchInput) searchInput.oninput = () => { clearTimeout(window.__kbDeb2); window.__kbDeb2 = setTimeout(parseAndRender, 200); };
  if (filterSkillSelect) filterSkillSelect.onchange = () => parseAndRender();
  if (filterLevelSelect) filterLevelSelect.onchange = () => parseAndRender();
  if (weakClearBtn) weakClearBtn.onclick = () => { appState.kbWeakFilter = { skills: [] }; saveToLocalStorage(); parseAndRender(); };
  const addBtn = document.getElementById('skillsKbAddSelectedBtn');
  if (addBtn) addBtn.onclick = () => addSelectedSkillsKbTasks();
  const deselectBtn = document.getElementById('skillsKbDeselectAllBtn');
  if (deselectBtn) deselectBtn.onclick = () => {
    document.querySelectorAll('#skillsKbParsedTasks .kb-task-chk').forEach(cb => { cb.checked = false; const id = cb.getAttribute('data-kbid'); if (id && skillsKbState.selected) skillsKbState.selected.delete(id); });
  };
  const selectAllBtn = document.getElementById('skillsKbSelectAllBtn');
  if (selectAllBtn) selectAllBtn.onclick = () => {
    // выбрать только видимые (отфильтрованные) — они сейчас отрисованы в DOM
    document.querySelectorAll('#skillsKbParsedTasks .kb-task-chk').forEach(cb => { cb.checked = true; const id = cb.getAttribute('data-kbid'); if (id) { if (!skillsKbState.selected) skillsKbState.selected = new Set(); skillsKbState.selected.add(id); } });
  };
  await parseAndRender();
}

const skillsKbState = { tasks: [], selected: new Set() };

function addSelectedSkillsKbTasks() {
  const targetSelect = document.getElementById('skillsKbTargetSkillSelect');
  const autoBind = document.getElementById('skillsKbAutoBind');
  const targetSkillId = targetSelect?.value;
  if (!autoBind?.checked && !targetSkillId) { alert('Выберите навык для привязки'); return; }
  if (!appState.developmentPlan) appState.developmentPlan = {};
  const ids = Array.from(skillsKbState.selected || []);
  const ensurePlan = (skillId, nameHint) => {
    if (!skillId) return null;
    if (!appState.developmentPlan[skillId]) {
      const s = findSkillById(skillId) || { id: skillId, name: nameHint || getPlanSkillName(skillId) };
      appState.developmentPlan[skillId] = { name: s.name || skillId, currentLevel: 0, targetLevel: 1, activities: [], totalDuration: 2 };
    }
    return appState.developmentPlan[skillId];
  };

  ids.forEach((id, idx) => {
    const t = Array.from(document.querySelectorAll('#skillsKbParsedTasks .kb-task-chk'))
      .map(cb => ({ id: cb.getAttribute('data-kbid'), idx: parseInt(cb.closest('.kb-task')?.getAttribute('data-idx')) }))
      .find(x => x.id === id);
    const taskData = (typeof t?.idx === 'number') ? skillsKbState.tasks[t.idx] : null;
    if (!taskData) return;
    // resolve skill binding
    let bindSkillId = targetSkillId;
    if (autoBind?.checked && taskData.skillName) {
      const raw = String(taskData.skillName || '');
      const primaryName = raw.split(',')[0].trim();
      if (primaryName) {
        const found = findSkillByName(primaryName);
        if (found) bindSkillId = found.id;
      }
    }
    const plan = ensurePlan(bindSkillId, taskData.skillName);
    if (!plan) return;
    plan.activities.push({
      id: `${bindSkillId}_${Date.now()}_${idx}`,
      name: taskData.title,
      level: Math.max(1, plan.currentLevel + 1),
      duration: Number.isFinite(taskData.durationWeeks) && taskData.durationWeeks > 0 ? taskData.durationWeeks : 2,
      status: 'planned',
      completed: false,
      comment: '',
      description: taskData.description || '',
      expectedResult: taskData.criteria || '',
      relatedSkills: [],
      skillWeights: undefined
    });
    plan.totalDuration = plan.activities.reduce((s, a) => s + (a.duration || 0), 0);
  });
  saveToLocalStorage();
  // остаёмся на вкладке, обновим счётчики и план
  updateSelectedCounter();
  renderPlan();
  // перейти к Плану
  showSection('planSection');
}

function addSelectedKbTasks() {
  const modal = document.getElementById('kbPickerModal');
  if (!modal) return;
  const targetSelect = document.getElementById('kbTargetSkillSelect');
  const targetSkillId = targetSelect?.value;
  if (!targetSkillId) { alert('Выберите навык для привязки'); return; }
  if (!appState.developmentPlan) appState.developmentPlan = {};
  if (!appState.developmentPlan[targetSkillId]) {
    const s = findSkillById(targetSkillId) || { id: targetSkillId, name: getPlanSkillName(targetSkillId) };
    appState.developmentPlan[targetSkillId] = { name: s.name || targetSkillId, currentLevel: 0, targetLevel: 1, activities: [], totalDuration: 2 };
  }
  const plan = appState.developmentPlan[targetSkillId];
  const checks = modal.querySelectorAll('.kb-task-chk');
  const selectedIdxs = Array.from(checks).filter(cb => cb.checked).map(cb => parseInt(cb.getAttribute('data-idx')));
  selectedIdxs.forEach(i => {
    const t = modalKbState.tasks[i];
    if (!t) return;
    plan.activities.push({
      id: `${targetSkillId}_${Date.now()}_${i}`,
      name: t.title,
      level: Math.max(1, plan.currentLevel + 1),
      duration: Number.isFinite(t.durationWeeks) && t.durationWeeks > 0 ? t.durationWeeks : 2,
      status: 'planned',
      completed: false,
      comment: '',
      description: t.description || '',
      expectedResult: t.criteria || '',
      relatedSkills: [],
      skillWeights: undefined
    });
  });
  plan.totalDuration = plan.activities.reduce((s, a) => s + (a.duration || 0), 0);
  saveToLocalStorage();
  renderPlan();
  toggleKbPicker(false);
}

// Состояние приложения
let appState = {
  profile: {},
  selectedSkills: {},
  developmentPlan: {},
  progress: {},
  ui: {},
  sortSettings: {
    by: 'priority',
    direction: 'desc',
    crossSkills: true
  }
};

function updateSelectedCounter() {
  const counter = document.getElementById('selectedCounter');
  if (counter) {
    counter.textContent = `Выбрано: ${Object.keys(appState.selectedSkills || {}).length}`;
  }
}

// Утилиты
function saveToLocalStorage() {
  try {
    localStorage.setItem('iprAppState', JSON.stringify(appState));
  } catch (e) {
    console.warn('Не удалось сохранить в localStorage:', e);
  }
}

// Глобальные утилиты рендера
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function linkify(text) {
  if (!text) return '';
  const safe = escapeHtml(text);
  const urlRegex = /(?:https?:\/\/|www\.)[\w\-]+(\.[\w\-]+)+[\w\-\._~:\/?#\[\]@!$&'()*+,;=%]*/gi;
  return safe.replace(urlRegex, (m) => {
    const href = m.startsWith('http') ? m : `http://${m}`;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${m}</a>`;
  });
}

// Вернуть только кликабельные ссылки из текста (без остального текста)
function linkifyLinksOnly(text) {
  if (!text) return '';
  const urlRegex = /(?:https?:\/\/|www\.)[\w\-]+(\.[\w\-]+)+[\w\-\._~:\/?#\[\]@!$&'()*+,;=%]*/gi;
  const urls = (text.match(urlRegex) || []);
  if (urls.length === 0) return '';
  const unique = Array.from(new Set(urls));
  return unique
    .map((m) => {
      const href = m.startsWith('http') ? m : `http://${m}`;
      const safeText = escapeHtml(m);
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${safeText}</a>`;
    })
    .join(' ');
}

function loadFromLocalStorage() {
  try {
    const saved = localStorage.getItem('iprAppState');
    if (saved) {
      appState = { ...appState, ...JSON.parse(saved) };
      return true;
    }
  } catch (e) {
    console.warn('Ошибка загрузки из localStorage:', e);
  }
  return false;
}

function showSection(sectionId) {
  console.log('Показываем секцию:', sectionId);
  document.querySelectorAll('.section').forEach(section => {
    section.classList.remove('active');
  });
  const targetSection = document.getElementById(sectionId);
  if (targetSection) {
    targetSection.classList.add('active');
    if (sectionId === 'growthAnalysisSection') {
      renderAnalysis();
    }
  } else {
    console.error('Секция не найдена:', sectionId);
  }
}

function getDurationForLevel(currentLevel, targetLevel) {
  const levelDiff = targetLevel - currentLevel;
  const baseDurationWeeks = 8; // базовая длительность в неделях
  return Math.ceil(baseDurationWeeks * levelDiff);
}

// Инициализация приложения
document.addEventListener('DOMContentLoaded', function() {
  console.log('DOM загружен, инициализация приложения...');
  initializeApp();
  setupEventListeners();
  // Загружаем CSV, затем рендерим навыки
  loadSkillsFromCSV()
    .then(() => {
      renderSkills();
    })
    .catch((e) => {
      console.error('Ошибка загрузки CSV:', e);
      // Пытаемся показать хоть что-то: если skillsData ещё пустой, отрисуем заглушку
  renderSkills();
    });
});

function initializeApp() {
  console.log('Инициализация приложения...');
  
  if (loadFromLocalStorage() && Object.keys(appState.profile).length > 0) {
    migrateState();
    const continueBtn = document.getElementById('continuePlan');
    if (continueBtn) {
      continueBtn.style.display = 'inline-flex';
    }
    try { populateProfileFormFromState(); } catch (_) {}
  }
  
  // Устанавливаем тему: сохранённая → системная → light
  const savedTheme = appState.ui?.theme;
  const prefersDark = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const initialTheme = savedTheme || (prefersDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-color-scheme', initialTheme);
  const button = document.getElementById('darkModeToggle');
  if (button) button.textContent = initialTheme === 'dark' ? '☀️ Светлая тема' : '🌙 Тёмная тема';
}

// Миграция/нормализация сохранённого состояния (добавляем status для задач)
function migrateState() {
  const normalize = (plans) => {
    Object.values(plans || {}).forEach(plan => {
      (plan.activities || []).forEach(a => {
        if (!a.status || a.status === 'pending') {
          a.status = a.completed ? 'done' : 'planned';
        }
        // Не перетираем 'cancelled' в 'done'
        if (a.completed && a.status !== 'done' && a.status !== 'cancelled') {
          a.status = 'done';
        }
      });
      if (typeof plan.completedActivities !== 'undefined') {
        plan.completedActivities = (plan.activities || []).filter(x => x.completed).length;
        plan.overallProgress = (plan.activities || []).length > 0
          ? (plan.completedActivities / plan.activities.length) * 100
          : 0;
      }
    });
  };
  normalize(appState.developmentPlan);
  normalize(appState.progress);
  try { saveToLocalStorage(); } catch (_) {}
}

function setupEventListeners() {
  console.log('Настройка обработчиков событий...');
  
  // Навигация
  const createNewBtn = document.getElementById('createNewPlan');
  const continueBtn = document.getElementById('continuePlan');
  const themeBtn = document.getElementById('darkModeToggle');
  const infoBtn = document.getElementById('infoBtn');
  const quickLoadOpenBtn = document.getElementById('quickLoadOpenBtn');
  const quickImportCSVBtn = document.getElementById('quickImportCSVBtn');
  const homeLink = document.getElementById('homeLink');
  
  if (createNewBtn) {
    createNewBtn.addEventListener('click', function() {
      console.log('Создание нового плана...');
      // Сохраним выбранную тему, остальное сбросим
      const preservedTheme = appState?.ui?.theme;
      appState = { profile: {}, selectedSkills: {}, developmentPlan: {}, progress: {}, ui: {} };
      if (preservedTheme) appState.ui.theme = preservedTheme;
      // Очистим localStorage и сразу перезапишем свежим состоянием
      try { localStorage.removeItem('iprAppState'); } catch (_) {}
      try { saveToLocalStorage(); } catch (_) {}
      // Очистим поля UI
      try {
        const clearVal = (id) => { const el = document.getElementById(id); if (el) el.value = ''; };
        clearVal('fullName');
        clearVal('position');
        clearVal('grade');
        clearVal('track');
        clearVal('skillsSearch');
        clearVal('inlineCloudPlanTitleInput');
        clearVal('quickLoadIdInput');
        const onlySel = document.getElementById('showOnlySelected'); if (onlySel) onlySel.checked = false;
        const inlineId = document.getElementById('inlineCloudCurrentRecord'); if (inlineId) inlineId.innerHTML = '';
        const cloudInline = document.getElementById('cloudCurrentRecordInline'); if (cloudInline) cloudInline.innerHTML = '';
        updateSelectedCounter();
      } catch (_) {}
      // Спрячем кнопку "Продолжить существующий"
      const cont = document.getElementById('continuePlan'); if (cont) cont.style.display = 'none';
      // Перейдём к профилю и перерисуем пустые разделы
      showSection('profileSection');
      renderSkills();
    });
  }
  
  if (continueBtn) {
    continueBtn.addEventListener('click', function() {
      console.log('Продолжение существующего плана...');
      if (Object.keys(appState.progress).length > 0) {
        showSection('progressSection');
        renderProgress();
      } else if (Object.keys(appState.developmentPlan).length > 0) {
        showSection('planSection');
        renderPlan();
      } else {
        showSection('skillsSection');
        renderSkills();
      }
    });
  }

  if (themeBtn) {
    themeBtn.addEventListener('click', toggleTheme);
  }
  if (infoBtn) {
    infoBtn.addEventListener('click', () => toggleInfoModal(true));
  }
  if (homeLink) {
    homeLink.addEventListener('click', () => {
      showSection('welcomeSection');
    });
  }
  if (quickLoadOpenBtn) {
    quickLoadOpenBtn.addEventListener('click', () => toggleQuickLoadModal(true));
  }
  if (quickImportCSVBtn) {
    quickImportCSVBtn.addEventListener('click', () => {
      const fileInput = document.getElementById('importCSVProgressFile');
      if (fileInput) fileInput.click();
      // После выбора файла обработчик handleImportProgressCSV уже сработает и перерендерит прогресс
      // Переключим вкладку на Прогресс
      showSection('progressSection');
    });
  }

  // Профиль
  const profileForm = document.getElementById('profileForm');
  if (profileForm) {
    profileForm.addEventListener('submit', handleProfileSubmit);
  }
  
  const backToProfileBtn = document.getElementById('backToProfile');
  if (backToProfileBtn) {
    backToProfileBtn.addEventListener('click', () => showSection('profileSection'));
  }

  // Навыки
  const generatePlanBtn = document.getElementById('generatePlan');
  const generatePromptBtn = document.getElementById('generatePromptBtn');
  const openKbPickerBtn = document.getElementById('openKbPickerBtn');
  const appendToPlanBtn = document.getElementById('appendToPlan');
  const bulkSelectBtn = document.getElementById('bulkSelectBtn');
  const kbWeakOpenBtn = document.getElementById('skillsKbWeakFilterOpenBtn');
  const deselectAllBtn = document.getElementById('deselectAllBtn');
  const skillsTabManualBtn = document.getElementById('skillsTabManualBtn');
  const skillsTabKBBtn = document.getElementById('skillsTabKBBtn');
  const skillsTabManualPanel = document.getElementById('skillsTabManualPanel');
  const skillsTabKBPanel = document.getElementById('skillsTabKBPanel');
  const skillsHeaderTitle = document.getElementById('skillsHeaderTitle');
  if (generatePlanBtn) {
    generatePlanBtn.addEventListener('click', handleGeneratePlan);
  }
  if (appendToPlanBtn) {
    appendToPlanBtn.addEventListener('click', handleAppendToPlan);
  }
  if (bulkSelectBtn) {
    bulkSelectBtn.addEventListener('click', () => toggleBulkSelectModal(true));
  }
  if (kbWeakOpenBtn) {
    kbWeakOpenBtn.addEventListener('click', () => toggleKbWeakSkillsModal(true));
  }
  if (deselectAllBtn) {
    deselectAllBtn.addEventListener('click', () => {
      appState.selectedSkills = {};
      saveToLocalStorage();
      // Снимаем чекбокс только выбранные
      try { const cb = document.getElementById('showOnlySelected'); if (cb) cb.checked = false; } catch (_) {}
      renderSkills();
    });
  }
  if (generatePromptBtn) {
    generatePromptBtn.addEventListener('click', handleGeneratePrompt);
  }
  if (openKbPickerBtn) {
    openKbPickerBtn.addEventListener('click', () => toggleKbPicker(true));
  }
  if (skillsTabManualBtn && skillsTabKBBtn && skillsTabManualPanel && skillsTabKBPanel) {
    skillsTabManualBtn.addEventListener('click', async () => {
      skillsTabManualBtn.classList.add('active');
      skillsTabKBBtn.classList.remove('active');
      skillsTabManualPanel.classList.add('active');
      skillsTabKBPanel.classList.remove('active');
      if (skillsHeaderTitle) skillsHeaderTitle.textContent = 'Выбери навыки для развития';
      renderSkills();
    });
    skillsTabKBBtn.addEventListener('click', async () => {
      skillsTabKBBtn.classList.add('active');
      skillsTabManualBtn.classList.remove('active');
      skillsTabKBPanel.classList.add('active');
      skillsTabManualPanel.classList.remove('active');
      if (skillsHeaderTitle) skillsHeaderTitle.textContent = 'Выбор задач из Базы знаний';
      await renderSkillsKbPicker();
    });
  }
  
  const backToSkillsBtn = document.getElementById('backToSkills');
  if (backToSkillsBtn) {
    backToSkillsBtn.addEventListener('click', () => showSection('skillsSection'));
  }

  // План
  const startProgressBtn = document.getElementById('startProgress');
  if (startProgressBtn) {
    startProgressBtn.addEventListener('click', function() {
      // Если прогресс уже есть, не стирать — лишь добавить/синхронизировать новые задачи из плана
      if (appState.progress && Object.keys(appState.progress).length > 0) {
        mergePlanIntoProgress();
      } else {
        initializeProgress();
      }
      showSection('progressSection');
      renderProgress();
    });
  }
  
  const exportPDFBtn = document.getElementById('exportPDF');
  const exportCSVBtn = document.getElementById('exportCSV');
  const exportXLSXBtn = document.getElementById('exportXLSX');
  const exportCSVProgressBtn = document.getElementById('exportCSVProgress');
  const exportXLSXProgressBtn = document.getElementById('exportXLSXProgress');
  const exportKBTasksProgressBtn = document.getElementById('exportKBTasksProgress');
  const importCSVProgressFile = document.getElementById('importCSVProgressFile');
  const cloudSyncBtn = document.getElementById('cloudSyncBtn');
  const cloudQuickSaveBtn = document.getElementById('cloudQuickSaveBtn');
  const inlineCloudTitle = document.getElementById('inlineCloudPlanTitleInput');
  const inlineCloudSaveNewBtn = document.getElementById('inlineCloudSaveNewBtn');
  const inlineCloudUpdateBtn = document.getElementById('inlineCloudUpdateBtn');
  const inlineCloudCurrentRecord = document.getElementById('inlineCloudCurrentRecord');
  const analysisCsvFile = document.getElementById('analysisCsvFile');
  const analysisSkillSelect = document.getElementById('analysisSkillSelect');
  const planAnalysisSkillSelect = document.getElementById('planAnalysisSkillSelect');
  const importJsonBtn = document.getElementById('importJsonBtn');
  const importModal = document.getElementById('importModal');
  const closeImportModalBtn = document.getElementById('closeImportModal');
  const importJsonConfirmBtn = document.getElementById('importJsonConfirmBtn');
  
  if (exportPDFBtn) {
    exportPDFBtn.addEventListener('click', exportToPDF);
  }
  
  if (exportCSVBtn) {
    exportCSVBtn.addEventListener('click', exportToCSV);
  }
  if (exportCSVProgressBtn) {
    exportCSVProgressBtn.addEventListener('click', exportProgressToCSV);
  }
  if (exportXLSXProgressBtn) {
    exportXLSXProgressBtn.addEventListener('click', exportProgressToXLSX);
  }
  if (exportKBTasksProgressBtn) {
    exportKBTasksProgressBtn.addEventListener('click', exportProgressToKBTasks);
  }
  if (exportXLSXBtn) {
    exportXLSXBtn.addEventListener('click', exportToXLSX);
  }
  if (importCSVProgressFile) {
    importCSVProgressFile.addEventListener('change', handleImportProgressCSV);
  }
  if (analysisCsvFile) {
    analysisCsvFile.addEventListener('change', handleAnalysisCsvLoad);
  }
  if (analysisSkillSelect) {
    analysisSkillSelect.addEventListener('change', () => renderAnalysisSkill());
  }
  if (planAnalysisSkillSelect) {
    planAnalysisSkillSelect.addEventListener('change', () => renderPlanAnalysis());
  }
  if (importJsonBtn && importModal && closeImportModalBtn && importJsonConfirmBtn) {
    importJsonBtn.addEventListener('click', () => toggleImportModal(true));
    closeImportModalBtn.addEventListener('click', () => toggleImportModal(false));
    importModal.addEventListener('click', (e) => {
      if (e.target && e.target.hasAttribute('data-close-modal')) toggleImportModal(false);
    });
    importJsonConfirmBtn.addEventListener('click', importFromJson);
  }

  // Быстрое сохранение в Sheets (обновление текущей записи)
  if (cloudQuickSaveBtn) {
    cloudQuickSaveBtn.addEventListener('click', async () => {
      const url = CLOUD_APPS_SCRIPT_URL;
      const id = appState.ui?.cloudRecordId;
      if (!id) {
        alert('Нет текущей записи. Сначала сохраните любую запись через Sheets.');
        return;
      }
      try {
        cloudQuickSaveBtn.disabled = true;
        cloudQuickSaveBtn.textContent = '💾 Saving…';
        const form = new URLSearchParams();
        form.set('action', 'update');
        form.set('id', id);
        const payload = { ...appState };
        const titleVal = (appState.ui?.cloudPlanTitle || '').trim();
        if (titleVal) {
          payload.title = titleVal;
          payload.nameidp = titleVal;
          form.set('nameidp', titleVal);
        }
        form.set('payload', JSON.stringify(payload));
        const res = await fetch(url, { method: 'POST', body: form });
        const json = await res.json();
        if (!(json && json.ok)) {
          alert('Ошибка сохранения: ' + JSON.stringify(json));
        } else {
          cloudQuickSaveBtn.textContent = '✅ Saved';
          setTimeout(() => (cloudQuickSaveBtn.textContent = '💾 Save'), 1200);
        }
      } catch (e) {
        alert('Ошибка сети: ' + String(e));
      } finally {
        cloudQuickSaveBtn.disabled = false;
      }
    });
  }

  // Cloud modal
  const cloudModal = document.getElementById('cloudModal');
  const closeCloudModal = document.getElementById('closeCloudModal');
  // Хардкоднутый URL Apps Script
  const CLOUD_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwqOobmbWA97CN7cJUQ6sQ8pO63ITTVqEhrhkLA-90pzjfIlRTbUmaXPQF1oerLmxxnfA/exec';
  const cloudUrlInput = null;
  const cloudPlanTitleInput = document.getElementById('cloudPlanTitleInput');
  const cloudSaveNewBtn = document.getElementById('cloudSaveNewBtn');
  const cloudUpdateBtn = document.getElementById('cloudUpdateBtn');
  const cloudLoadLatestBtn = null; // удалено из UI
  const cloudRefreshListBtn = null; // удалено из UI
  const cloudList = document.getElementById('cloudList');
  const cloudLoadIdInput = document.getElementById('cloudLoadIdInput');
  const cloudLoadByIdBtn = document.getElementById('cloudLoadByIdBtn');
  const cloudLog = document.getElementById('cloudLog');
  const cloudCurrentRecord = document.getElementById('cloudCurrentRecord');
  const cloudCurrentRecordInline = document.getElementById('cloudCurrentRecordInline');
  const cloudLoading = document.getElementById('cloudLoading');
  const cloudLoadingText = document.getElementById('cloudLoadingText');
  if (cloudSyncBtn && cloudModal && closeCloudModal && cloudSaveNewBtn && cloudUpdateBtn && cloudLog) {
    cloudSyncBtn.addEventListener('click', () => {
      // URL теперь хардкоднут
      cloudPlanTitleInput.value = appState.ui?.cloudPlanTitle || '';
      const idTxt = appState.ui?.cloudRecordId ? `id = ${appState.ui.cloudRecordId}` : 'id отсутствует';
      if (cloudCurrentRecord) cloudCurrentRecord.textContent = `Текущая запись: ${appState.ui?.cloudRecordId || 'отсутствует'}`;
      if (cloudCurrentRecordInline) cloudCurrentRecordInline.textContent = appState.ui?.cloudRecordId ? `id = ${appState.ui.cloudRecordId}` : '';
      cloudLog.textContent = '';
      cloudModal.style.display = 'block';
      cloudModal.setAttribute('aria-hidden', 'false');
    });
    closeCloudModal.addEventListener('click', () => {
      cloudModal.style.display = 'none';
      cloudModal.setAttribute('aria-hidden', 'true');
    });
    cloudModal.addEventListener('click', (e) => {
      if (e.target && e.target.hasAttribute('data-close-modal')) {
        cloudModal.style.display = 'none';
        cloudModal.setAttribute('aria-hidden', 'true');
      }
    });
    const setLog = (msg) => cloudLog.textContent = msg;
    const setLoading = (on, text) => {
      if (!cloudLoading) return;
      cloudLoading.style.display = on ? 'inline-flex' : 'none';
      if (cloudLoadingText && typeof text === 'string') cloudLoadingText.textContent = text;
    };
    const ensureUrl = () => CLOUD_APPS_SCRIPT_URL;
    const ensureTitle = () => {
      const title = (cloudPlanTitleInput.value || '').trim();
      if (title) { appState.ui.cloudPlanTitle = title; saveToLocalStorage(); }
      return title;
    };
    cloudSaveNewBtn.addEventListener('click', async () => {
      const url = ensureUrl(); if (!url) return;
      try {
        setLoading(true, 'Сохраняем…');
        const form = new URLSearchParams();
        form.set('action', 'append');
        const payload = { ...appState };
        const titleVal = ensureTitle();
        if (titleVal) {
          payload.title = titleVal;
          payload.nameidp = titleVal;
          form.set('nameidp', titleVal);
        }
        form.set('payload', JSON.stringify(payload));
        const res = await fetch(url, { method: 'POST', body: form });
        const json = await res.json();
        if (json.ok && json.id) {
          appState.ui = appState.ui || {}; appState.ui.cloudRecordId = json.id; saveToLocalStorage();
          if (cloudCurrentRecord) cloudCurrentRecord.textContent = `Текущая запись: ${json.id}`;
          if (cloudCurrentRecordInline) cloudCurrentRecordInline.textContent = `id = ${json.id}`;
          setLog('Сохранено как новая запись');
        } else setLog('Ошибка: ' + JSON.stringify(json));
      } catch (e) { setLog('Ошибка сети: ' + String(e)); }
      finally { setLoading(false); }
    });
    cloudUpdateBtn.addEventListener('click', async () => {
      const url = ensureUrl(); if (!url) return;
      const id = appState.ui?.cloudRecordId; if (!id) { alert('Нет текущей записи (сначала сохраните как новую)'); return; }
      try {
        setLoading(true, 'Обновляем…');
        const form = new URLSearchParams();
        form.set('action', 'update');
        form.set('id', id);
        const payload = { ...appState };
        const titleVal = ensureTitle();
        if (titleVal) {
          payload.title = titleVal;
          payload.nameidp = titleVal;
          form.set('nameidp', titleVal);
        }
        form.set('payload', JSON.stringify(payload));
        const res = await fetch(url, { method: 'POST', body: form });
        const json = await res.json();
        setLog(json.ok ? 'Обновлено' : ('Ошибка: ' + JSON.stringify(json)));
      } catch (e) { setLog('Ошибка сети: ' + String(e)); }
      finally { setLoading(false); }
    });
    // Кнопка загрузки последней удалена из UI

    async function refreshCloudList() {
      const url = ensureUrl(); if (!url) return;
      setLoading(true, 'Загружаем список…');
      try {
        const res = await fetch(url);
        const json = await res.json();
        if (!(json.ok && Array.isArray(json.data))) { setLog('Ошибка ответа'); return; }
        const rows = json.data;
        const html = rows.map(r => {
          const t = (r.payload && (r.payload.title || r.payload.ui?.cloudPlanTitle)) || '(без названия)';
          return `<div style="display:flex; justify-content:space-between; gap:8px; padding:6px 0; border-bottom:1px solid var(--color-card-border-inner);">
            <div style="min-width:0;">
              <div style="font-weight:550;">${escapeHtml(t)}</div>
              <div style="font-size:12px; color:var(--color-text-secondary);">ID: ${r.id} • ${r.ts}</div>
            </div>
            <div style="flex-shrink:0; display:flex; gap:6px;">
              <button class="btn btn--outline btn--sm" data-load-id="${r.id}">Открыть</button>
              <button class="btn btn--secondary btn--sm" data-copy-id="${r.id}">Копировать ID</button>
            </div>
          </div>`;
        }).join('');
        cloudList.innerHTML = html || '<div class="text-secondary">Пусто</div>';
        cloudList.querySelectorAll('[data-load-id]').forEach(b => b.addEventListener('click', () => loadById(b.getAttribute('data-load-id'))));
        cloudList.querySelectorAll('[data-copy-id]').forEach(b => b.addEventListener('click', () => { navigator.clipboard.writeText(b.getAttribute('data-copy-id')); setLog('ID скопирован'); }));
        setLog('Список загружен');
      } catch (e) { setLog('Ошибка сети: ' + String(e)); }
      finally { setLoading(false); }
    }

    async function loadById(id) {
      const url = ensureUrl(); if (!url) return;
      try {
        setLoading(true, `Загружаем id ${id}…`);
        // нет прямого API фильтрации, тянем всё и ищем id на клиенте
        const res = await fetch(url);
        const json = await res.json();
        if (!(json.ok && Array.isArray(json.data))) { setLog('Ошибка ответа'); return; }
        const row = json.data.find(x => String(x.id) === String(id));
        if (!row) { setLog('Запись не найдена'); return; }
        if (!row.payload) { setLog('Пустой payload'); return; }
        appState = row.payload; saveToLocalStorage();
        renderSkills(); renderPlan(); renderProgress();
        showSection('progressSection');
        appState.ui = appState.ui || {}; appState.ui.cloudRecordId = id; saveToLocalStorage();
        if (cloudCurrentRecord) cloudCurrentRecord.textContent = `Текущая запись: ${id}`;
        if (cloudCurrentRecordInline) cloudCurrentRecordInline.textContent = `id = ${id}`;
        try { populateProfileFormFromState(); } catch (_) {}
        // Закрыть окно Sheets после успешной загрузки
        try {
          cloudModal.style.display = 'none';
          cloudModal.setAttribute('aria-hidden', 'true');
        } catch (_) {}
        setLog('Загружено');
      } catch (e) { setLog('Ошибка сети: ' + String(e)); }
      finally { setLoading(false); }
    }

    // Кнопка обновления списка удалена из UI
    cloudLoadByIdBtn?.addEventListener('click', () => {
      const id = cloudLoadIdInput.value.trim(); if (!id) { alert('Введите ID'); return; }
      loadById(id);
    });
  }

  // Кликабельные шаги прогресса (навигация по табам)
  const stepToSection = ['profileSection', 'skillsSection', 'planSection', 'progressSection', 'growthAnalysisSection'];
  document.querySelectorAll('.progress-bar').forEach(bar => {
    bar.querySelectorAll('.progress-step').forEach((stepEl, idx) => {
      stepEl.style.cursor = 'pointer';
      stepEl.addEventListener('click', () => {
        const target = stepToSection[idx];
        if (!target) return;
        showSection(target);
        if (target === 'skillsSection') renderSkills();
        if (target === 'planSection') renderPlan();
        if (target === 'progressSection') renderProgress();
      });
    });
  });

  // Prompt modal controls
  const infoModal = document.getElementById('infoModal');
  const closeInfoModalBtn = document.getElementById('closeInfoModal');
  const bulkSelectModal = document.getElementById('bulkSelectModal');
  const closeBulkSelectModalBtn = document.getElementById('closeBulkSelectModal');
  const bulkSelectConfirmBtn = document.getElementById('bulkSelectConfirmBtn');
  const kbWeakSkillsModal = document.getElementById('kbWeakSkillsModal');
  const closeKbWeakSkillsModalBtn = document.getElementById('closeKbWeakSkillsModal');
  const kbWeakSkillsConfirmBtn = document.getElementById('kbWeakSkillsConfirmBtn');
  if (infoModal && closeInfoModalBtn) {
    closeInfoModalBtn.addEventListener('click', () => toggleInfoModal(false));
    infoModal.addEventListener('click', (e) => {
      if (e.target && e.target.hasAttribute('data-close-modal')) toggleInfoModal(false);
    });
  }
  if (bulkSelectModal && closeBulkSelectModalBtn && bulkSelectConfirmBtn) {
    closeBulkSelectModalBtn.addEventListener('click', () => toggleBulkSelectModal(false));
    bulkSelectModal.addEventListener('click', (e) => {
      if (e.target && e.target.hasAttribute('data-close-modal')) toggleBulkSelectModal(false);
    });
    bulkSelectConfirmBtn.addEventListener('click', handleBulkSelectSkills);
  }
  if (kbWeakSkillsModal && closeKbWeakSkillsModalBtn && kbWeakSkillsConfirmBtn) {
    closeKbWeakSkillsModalBtn.addEventListener('click', () => toggleKbWeakSkillsModal(false));
    kbWeakSkillsModal.addEventListener('click', (e) => {
      if (e.target && e.target.hasAttribute('data-close-modal')) toggleKbWeakSkillsModal(false);
    });
    kbWeakSkillsConfirmBtn.addEventListener('click', handleKbWeakSkillsFilter);
  }

  // Quick load modal controls
  const quickLoadModal = document.getElementById('quickLoadModal');
  const closeQuickLoadModalBtn = document.getElementById('closeQuickLoadModal');
  const quickLoadConfirmBtn = document.getElementById('quickLoadConfirmBtn');
  if (quickLoadModal && closeQuickLoadModalBtn && quickLoadConfirmBtn) {
    closeQuickLoadModalBtn.addEventListener('click', () => toggleQuickLoadModal(false));
    quickLoadModal.addEventListener('click', (e) => {
      if (e.target && e.target.hasAttribute('data-close-modal')) toggleQuickLoadModal(false);
    });
    quickLoadConfirmBtn.addEventListener('click', quickLoadByIdFromHeader);
  }
  const promptModal = document.getElementById('promptModal');
  const closePromptModalBtn = document.getElementById('closePromptModal');
  const kbPickerModal = document.getElementById('kbPickerModal');
  const closeKbPickerModal = document.getElementById('closeKbPickerModal');
  const kbAddSelectedBtn = document.getElementById('kbAddSelectedBtn');
  if (kbPickerModal && closeKbPickerModal && kbAddSelectedBtn) {
    closeKbPickerModal.addEventListener('click', () => toggleKbPicker(false));
    kbPickerModal.addEventListener('click', (e) => {
      if (e.target && e.target.hasAttribute('data-close-modal')) toggleKbPicker(false);
    });
    kbAddSelectedBtn.addEventListener('click', addSelectedKbTasks);
  }
  if (promptModal && closePromptModalBtn) {
    closePromptModalBtn.addEventListener('click', () => togglePromptModal(false));
    promptModal.addEventListener('click', (e) => {
      if (e.target && e.target.hasAttribute('data-close-modal')) togglePromptModal(false);
    });
    const copyBtn = document.getElementById('copyPromptBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const ta = document.getElementById('promptTextArea');
        if (!ta) return;
        ta.select();
        document.execCommand('copy');
        copyBtn.textContent = 'Скопировано';
        setTimeout(() => (copyBtn.textContent = 'Скопировать'), 1500);
      });
    }
  }

  // Поиск навыков
  const skillsSearch = document.getElementById('skillsSearch');
  if (skillsSearch) {
    let debounceTimer = null;
    skillsSearch.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => renderSkills(), 250);
    });
  }
  const showOnlySelected = document.getElementById('showOnlySelected');
  if (showOnlySelected) {
    showOnlySelected.addEventListener('change', () => renderSkills());
  }

  // Счётчик выбранных — обновляем на первой загрузке
  updateSelectedCounter();
  // Показать кнопку "Добавить в текущий план", если уже есть план
  try {
    if (Object.keys(appState.developmentPlan || {}).length > 0 && appendToPlanBtn) {
      appendToPlanBtn.style.display = 'inline-flex';
    }
  } catch (_) {}

  // Progress summary prompt modal controls
  const genProgPromptBtn = document.getElementById('generateProgressPromptBtn');
  const progressPromptModal = document.getElementById('progressPromptModal');
  const closeProgressPromptModal = document.getElementById('closeProgressPromptModal');
  const copyProgressPromptBtn = document.getElementById('copyProgressPromptBtn');
  // Tabs controls (Progress)
  const tabBoard = document.getElementById('progressTabBoard');
  const tabList = document.getElementById('progressTabList');
  const tabAnalysis = document.getElementById('progressTabAnalysis');
  const panelBoard = document.getElementById('progressPanelBoard');
  const panelList = document.getElementById('progressPanelList');
  const panelAnalysis = document.getElementById('progressPanelAnalysis');
  if (genProgPromptBtn && progressPromptModal && closeProgressPromptModal && copyProgressPromptBtn) {
    genProgPromptBtn.addEventListener('click', () => {
      const text = buildProgressSummaryPrompt();
      const ta = document.getElementById('progressPromptTextArea');
      if (ta) {
        ta.value = text;
        toggleProgressPromptModal(true);
        ta.focus();
        ta.select();
      }
    });
    closeProgressPromptModal.addEventListener('click', () => toggleProgressPromptModal(false));
    progressPromptModal.addEventListener('click', (e) => {
      if (e.target && e.target.hasAttribute('data-close-modal')) toggleProgressPromptModal(false);
    });
    copyProgressPromptBtn.addEventListener('click', () => {
      const ta = document.getElementById('progressPromptTextArea');
      if (!ta) return;
      ta.select();
      document.execCommand('copy');
      copyProgressPromptBtn.textContent = 'Скопировано';
      setTimeout(() => (copyProgressPromptBtn.textContent = 'Скопировать'), 1500);
    });
  }

  // Inline cloud panel setup
  if (inlineCloudTitle && inlineCloudSaveNewBtn && inlineCloudUpdateBtn) {
    // Инициализация значений
    inlineCloudTitle.value = appState.ui?.cloudPlanTitle || '';
    if (inlineCloudCurrentRecord) inlineCloudCurrentRecord.textContent = appState.ui?.cloudRecordId ? `id = ${appState.ui.cloudRecordId}` : '';
    inlineCloudTitle.addEventListener('input', () => {
      const v = inlineCloudTitle.value.trim();
      if (v) { appState.ui = appState.ui || {}; appState.ui.cloudPlanTitle = v; saveToLocalStorage(); }
    });
    inlineCloudSaveNewBtn.addEventListener('click', async () => {
      try {
        inlineCloudSaveNewBtn.disabled = true;
        inlineCloudSaveNewBtn.textContent = 'Сохраняем…';
        const form = new URLSearchParams();
        form.set('action', 'append');
        const payload = { ...appState };
        const titleVal = (inlineCloudTitle.value || '').trim();
        if (titleVal) { payload.title = titleVal; payload.nameidp = titleVal; form.set('nameidp', titleVal); appState.ui.cloudPlanTitle = titleVal; saveToLocalStorage(); }
        form.set('payload', JSON.stringify(payload));
        const res = await fetch(CLOUD_APPS_SCRIPT_URL, { method: 'POST', body: form });
        const json = await res.json();
        if (json.ok && json.id) {
          appState.ui = appState.ui || {}; appState.ui.cloudRecordId = json.id; saveToLocalStorage();
          if (inlineCloudCurrentRecord) inlineCloudCurrentRecord.textContent = `id = ${json.id}`;
          inlineCloudSaveNewBtn.textContent = '✅ Сохранено';
        } else {
          inlineCloudSaveNewBtn.textContent = 'Ошибка';
          alert('Ошибка: ' + JSON.stringify(json));
        }
      } catch (e) {
        inlineCloudSaveNewBtn.textContent = 'Ошибка сети';
        alert('Ошибка сети: ' + String(e));
      } finally {
        setTimeout(() => (inlineCloudSaveNewBtn.textContent = 'Сохранить как новую запись', inlineCloudSaveNewBtn.disabled = false), 1200);
      }
    });
    inlineCloudUpdateBtn.addEventListener('click', async () => {
      const id = appState.ui?.cloudRecordId;
      if (!id) { alert('Нет текущей записи (сначала сохраните как новую)'); return; }
      try {
        inlineCloudUpdateBtn.disabled = true;
        inlineCloudUpdateBtn.textContent = 'Обновляем…';
        const form = new URLSearchParams();
        form.set('action', 'update');
        form.set('id', id);
        const payload = { ...appState };
        const titleVal = (inlineCloudTitle.value || '').trim();
        if (titleVal) { payload.title = titleVal; payload.nameidp = titleVal; form.set('nameidp', titleVal); appState.ui.cloudPlanTitle = titleVal; saveToLocalStorage(); }
        form.set('payload', JSON.stringify(payload));
        const res = await fetch(CLOUD_APPS_SCRIPT_URL, { method: 'POST', body: form });
        const json = await res.json();
        if (json && json.ok) {
          inlineCloudUpdateBtn.textContent = '✅ Обновлено';
        } else {
          inlineCloudUpdateBtn.textContent = 'Ошибка';
          alert('Ошибка: ' + JSON.stringify(json));
        }
      } catch (e) {
        inlineCloudUpdateBtn.textContent = 'Ошибка сети';
        alert('Ошибка сети: ' + String(e));
      } finally {
        setTimeout(() => (inlineCloudUpdateBtn.textContent = 'Обновить текущую запись', inlineCloudUpdateBtn.disabled = false), 1200);
      }
    });
  }

  // Tabs: switch between Board and List
  if (tabBoard && tabList && panelBoard && panelList) {
    const activate = (which) => {
      if (which === 'board') {
        tabBoard.classList.add('active');
        tabList.classList.remove('active');
        tabAnalysis?.classList.remove('active');
        panelBoard.classList.add('active');
        panelList.classList.remove('active');
        panelAnalysis?.classList.remove('active');
        renderProgressKanban();
      } else {
        if (which === 'list') {
          tabList.classList.add('active');
          tabBoard.classList.remove('active');
          tabAnalysis?.classList.remove('active');
          panelList.classList.add('active');
          panelBoard.classList.remove('active');
          panelAnalysis?.classList.remove('active');
          renderProgressTracking();
        } else if (which === 'analysis') {
          tabAnalysis?.classList.add('active');
          tabBoard.classList.remove('active');
          tabList.classList.remove('active');
          panelAnalysis?.classList.add('active');
          panelBoard.classList.remove('active');
          panelList.classList.remove('active');
          renderPlanAnalysis();
        }
      }
    };
    tabBoard.addEventListener('click', () => activate('board'));
    tabList.addEventListener('click', () => activate('list'));
    tabAnalysis?.addEventListener('click', () => activate('analysis'));
  }

  // Автосохранение в Sheets при изменениях прогресса (debounce)
  let __autoCloudSaveTimer = null;
  let __autoCloudSaveInFlight = false;
  async function autoCloudSaveNow(reason) {
    try {
      const url = CLOUD_APPS_SCRIPT_URL;
      if (!url) return;
      const statusEl = document.getElementById('inlineCloudAutoSaveStatus');
      if (statusEl) statusEl.textContent = 'сохраняем…';
      const titleInput = document.getElementById('inlineCloudPlanTitleInput');
      const inlineTitle = (titleInput?.value || '').trim();
      if (inlineTitle) {
        appState.ui = appState.ui || {};
        appState.ui.cloudPlanTitle = inlineTitle;
      }
      const id = appState.ui?.cloudRecordId || '';
      const form = new URLSearchParams();
      let mode = '';
      if (id) {
        form.set('action', 'update');
        form.set('id', id);
        mode = 'update';
      } else {
        form.set('action', 'append');
        mode = 'append';
      }
      const payload = { ...appState };
      let titleVal = (appState.ui?.cloudPlanTitle || '').trim();
      if (!titleVal) {
        const name = appState.profile?.fullName || '';
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        titleVal = name ? `ИПР — ${name} (${y}-${m}-${d})` : `ИПР (${y}-${m}-${d})`;
        appState.ui = appState.ui || {};
        appState.ui.cloudPlanTitle = titleVal;
      }
      if (titleVal) {
        payload.title = titleVal;
        payload.nameidp = titleVal;
        form.set('nameidp', titleVal);
      }
      form.set('payload', JSON.stringify(payload));
      const res = await fetch(url, { method: 'POST', body: form });
      const json = await res.json().catch(() => ({}));
      if (json && json.ok) {
        if (mode === 'append' && json.id) {
          appState.ui.cloudRecordId = json.id;
          saveToLocalStorage();
          try {
            const el = document.getElementById('inlineCloudCurrentRecord');
            if (el) el.textContent = `id = ${json.id}`;
          } catch (_) {}
        }
        if (statusEl) {
          statusEl.textContent = '✓ сохранено';
          setTimeout(() => { if (statusEl.textContent === '✓ сохранено') statusEl.textContent = ''; }, 1500);
        }
      } else {
        console.warn('Auto cloud save failed', reason, json);
        if (statusEl) statusEl.textContent = '⚠ ошибка';
      }
    } catch (e) {
      console.warn('Auto cloud save error', reason, e);
      const statusEl = document.getElementById('inlineCloudAutoSaveStatus');
      if (statusEl) statusEl.textContent = '⚠ сеть';
    }
  }
  function autoCloudSaveDebounced(reason) {
    clearTimeout(__autoCloudSaveTimer);
    __autoCloudSaveTimer = setTimeout(async () => {
      if (__autoCloudSaveInFlight) return;
      __autoCloudSaveInFlight = true;
      try { await autoCloudSaveNow(reason); } finally { __autoCloudSaveInFlight = false; }
    }, 600);
  }

  

  // Kanban task modal events
  const kanbanModal = document.getElementById('kanbanTaskModal');
  const closeKanbanBtn = document.getElementById('closeKanbanTaskModal');
  const saveKanbanBtn = document.getElementById('saveKanbanTaskBtn');
  const editKanbanBtn = document.getElementById('editKanbanTaskBtn');
  if (kanbanModal && closeKanbanBtn && saveKanbanBtn) {
    closeKanbanBtn.addEventListener('click', closeKanbanTaskModal);
    kanbanModal.addEventListener('click', (e) => {
      if (e.target && e.target.hasAttribute('data-close-modal')) closeKanbanTaskModal();
    });
    saveKanbanBtn.addEventListener('click', saveKanbanTaskModal);
    const d = document.getElementById('kanbanTaskDesc');
    const e = document.getElementById('kanbanTaskExpected');
    const c = document.getElementById('kanbanTaskComment');
    const descPrev = document.getElementById('kanbanTaskDescPreview');
    const expPrev = document.getElementById('kanbanTaskExpectedPreview');
    const comPrev = document.getElementById('kanbanTaskCommentPreview');
    if (d && descPrev) d.addEventListener('input', () => (descPrev.innerHTML = linkifyLinksOnly(d.value)));
    if (e && expPrev) e.addEventListener('input', () => (expPrev.innerHTML = linkifyLinksOnly(e.value)));
    if (c && comPrev) c.addEventListener('input', () => (comPrev.innerHTML = linkifyLinksOnly(c.value)));
    if (editKanbanBtn) editKanbanBtn.addEventListener('click', () => switchKanbanTaskMode('edit'));
  }
}

function handleProfileSubmit(e) {
  e.preventDefault();
  console.log('Обработка формы профиля...');
  
  const fullNameEl = document.getElementById('fullName');
  const positionEl = document.getElementById('position');
  const gradeEl = document.getElementById('grade');
  const trackEl = document.getElementById('track');
  
  if (!fullNameEl || !positionEl || !gradeEl) {
    console.error('Не найдены элементы формы профиля');
    return;
  }
  
  appState.profile = {
    fullName: fullNameEl.value,
    position: positionEl.value,
    grade: gradeEl.value,
    track: trackEl ? trackEl.value : ''
  };
  
  console.log('Профиль сохранен:', appState.profile);
  saveToLocalStorage();
  showSection('skillsSection');
}

// Заполняем форму профиля из appState.profile, если элементы присутствуют
function populateProfileFormFromState() {
  const fullNameEl = document.getElementById('fullName');
  const positionEl = document.getElementById('position');
  const gradeEl = document.getElementById('grade');
  const trackEl = document.getElementById('track');
  if (!fullNameEl || !positionEl || !gradeEl) return;
  const p = appState.profile || {};
  if (typeof p.fullName === 'string') fullNameEl.value = p.fullName;
  if (typeof p.position === 'string') positionEl.value = p.position;
  if (typeof p.grade === 'string') gradeEl.value = p.grade;
  if (trackEl && typeof p.track === 'string') trackEl.value = p.track;
}

function renderSkills() {
  console.log('Отрисовка навыков...');
  
  const categoriesRoot = document.querySelector('.skills-categories');
  if (!categoriesRoot) {
    console.error('Контейнер категорий .skills-categories не найден');
    return;
  }

  const entries = Object.entries(skillsData.skills || {});
  if (entries.length === 0) {
    categoriesRoot.innerHTML = `<div class="status status--warning">Не удалось загрузить навыки из CSV. Загрузите файл вручную выше.</div>`;
      return;
    }
    
  const qRaw = String((document.getElementById('skillsSearch')?.value || ''));
  const q = qRaw.toLowerCase();
  const onlySelected = !!document.getElementById('showOnlySelected')?.checked;
  const selectedSet = new Set(Object.keys(appState.selectedSkills || {}));
  categoriesRoot.innerHTML = entries.map(([categoryName, skills]) => {
    const categoryId = slugify(categoryName);
    let filtered = (skills || []).filter(s => !q || s.name.toLowerCase().includes(q));
    if (onlySelected) filtered = filtered.filter(s => selectedSet.has(s.id));
    const skillsHtml = filtered.map(skill => {
      const saved = appState.selectedSkills?.[skill.id] || { current: 0, target: 0 };
      const cur = Number(saved.current) || 0;
      const tar = Number(saved.target) || 0;
      const highlight = (name) => {
        if (!qRaw) return name;
        const safe = qRaw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return name.replace(new RegExp(`(${safe})`, 'ig'), '<mark class="highlight-match">$1</mark>');
      };
      const isSelected = selectedSet.has(skill.id);
      const removeBtnHtml = isSelected
        ? '<button type="button" class="btn btn--outline btn--sm" onclick="deselectSkill(\'' + skill.id + '\')">Снять выбор</button>'
        : '';
      const availableLevels = Object.entries(skill.levels || {})
        .filter(([lvl, data]) => {
          const d = data && (data.description?.trim() || (Array.isArray(data.activities) && data.activities.length > 0));
          return d && ['1','2','3','4'].includes(String(lvl));
        })
        .map(([lvl]) => parseInt(lvl))
        .sort((a,b)=>a-b);
      const levelLabel = (n) => {
        switch(n){
          case 1: return '1 - Базовый';
          case 2: return '2 - Уверенный';
          case 3: return '3 - Глубокий';
          case 4: return '4 - Очень глубокий';
          default: return String(n);
        }
      };
      const currentOptions = ['<option value="">Выберите уровень</option>']
        .concat(availableLevels.map(l => `<option value="${l}" ${cur===l ? 'selected' : ''}>${levelLabel(l)}</option>`))
        .join('');
      const targetOptions = ['<option value="">Выберите уровень</option>']
        .concat(availableLevels.map(l => `<option value="${l}" ${tar===l ? 'selected' : ''}>${levelLabel(l)}</option>`))
        .join('');
      const has1 = availableLevels.includes(1);
      const has2 = availableLevels.includes(2);
      const has3 = availableLevels.includes(3);
      const has4 = availableLevels.includes(4);
      return `
      <div class="skill-item ${isSelected ? 'skill-item--selected' : ''}" data-skill-id="${skill.id}">
        <div class="skill-header">
          <h4 class="skill-name">${highlight(skill.name)}</h4>
          <div class="skill-actions" style="display:flex; align-items:center; gap:8px;">
            ${removeBtnHtml}
          <button class="skill-toggle" type="button" onclick="toggleSkillDetails('${skill.id}')">+</button>
          </div>
        </div>
        <div class="skill-levels" style="display: none;">
          <div class="level-selector">
            <label>Текущий уровень:</label>
            <select id="current-${skill.id}">${currentOptions}</select>
          </div>
          <div class="level-selector">
            <label>Целевой уровень:</label>
            <select id="target-${skill.id}">${targetOptions}</select>
          </div>
          <div class="level-presets">
            <span class="form-label" style="margin:0;">Быстрый выбор:</span>
            <div class="preset-buttons">
              ${has1 ? `<button type="button" class="btn btn--outline btn--sm" onclick="applyLevelPreset('${skill.id}', 0, 1)">0→1</button>` : ''}
              ${(has1 && has2) ? `<button type="button" class="btn btn--outline btn--sm" onclick="applyLevelPreset('${skill.id}', 1, 2)">1→2</button>` : ''}
              ${(has2 && has3) ? `<button type=\"button\" class=\"btn btn--outline btn--sm\" onclick=\"applyLevelPreset('${skill.id}', 2, 3)\">2→3</button>` : ''}
              ${(has3 && has4) ? `<button type=\"button\" class=\"btn btn--outline btn--sm\" onclick=\"applyLevelPreset('${skill.id}', 3, 4)\">3→4</button>` : ''}
            </div>
          </div>
        </div>
        <div class="skill-description" style="display: none;" id="desc-${skill.id}"></div>
      </div>
    `}).join('');
    if (filtered.length === 0) return '';
    return `
      <div class="skill-category" id="${categoryId}">
        <h3>${categoryName}</h3>
        <div class="skills-list">${skillsHtml}</div>
      </div>
    `;
  }).filter(Boolean).join('') || `<div class="status status--info">По вашему запросу ничего не найдено</div>`;

  // После отрисовки укрепляем выбранные значения селектов из сохранённого состояния
  try {
    Object.entries(appState.selectedSkills || {}).forEach(([skillId, sel]) => {
      const curEl = document.getElementById(`current-${skillId}`);
      const tarEl = document.getElementById(`target-${skillId}`);
      if (curEl) curEl.value = sel.current ? String(sel.current) : '';
      if (tarEl) tarEl.value = sel.target ? String(sel.target) : '';
      if (curEl && tarEl) {
        updateSkillDescription(skillId);
      }
    });
    // Авто-раскрытие ранее выбранных навыков, чтобы было видно выбор сразу
    Object.keys(appState.selectedSkills || {}).forEach(skillId => {
      const item = document.querySelector(`[data-skill-id="${skillId}"] .skill-levels`);
      if (item && item.style.display === 'none') {
        toggleSkillDetails(skillId);
      }
    });
  } catch (e) {
    console.warn('Не удалось восстановить выбранные уровни после поиска:', e);
  }
  // Обновим счётчик выбранных
  updateSelectedCounter();
}

window.toggleSkillDetails = function(skillId) {
  console.log('Переключение детальной информации о навыке:', skillId);
  
  const skillItem = document.querySelector(`[data-skill-id="${skillId}"]`);
  if (!skillItem) {
    console.error('Элемент навыка не найден:', skillId);
    return;
  }
  
  const levels = skillItem.querySelector('.skill-levels');
  const description = skillItem.querySelector('.skill-description');
  const toggle = skillItem.querySelector('.skill-toggle');
  
  const isOpening = levels.style.display === 'none';
  if (isOpening) {
    levels.style.display = 'grid';
    description.style.display = 'block';
    toggle.textContent = '−';
    
    // Добавляем обработчики изменения уровней
    const currentSelect = document.getElementById(`current-${skillId}`);
    const targetSelect = document.getElementById(`target-${skillId}`);
    
    if (currentSelect && targetSelect) {
      const persist = (from) => {
        const cur = currentSelect.value ? parseInt(currentSelect.value) : 0;
        const tar = targetSelect.value ? parseInt(targetSelect.value) : 0;
        if (tar > cur) {
          appState.selectedSkills[skillId] = { current: cur, target: tar };
        } else {
          // Если выбран только текущий уровень — держим карточку раскрытой и ждём целевой
          appState.selectedSkills[skillId] = { current: cur, target: 0 };
        }
        saveToLocalStorage();
        updateSkillDescription(skillId);
        updateSelectedCounter();
        // Не закрываем карточку на выборе current; обновлять список полностью не нужно
        if (from === 'target') {
          renderSkills();
        }
      };
      currentSelect.addEventListener('change', () => persist('current'));
      targetSelect.addEventListener('change', () => persist('target'));
      // Инициализация описания по сохранённым значениям
      const saved = appState.selectedSkills?.[skillId];
      if (saved) {
        currentSelect.value = saved.current ? String(saved.current) : '';
        targetSelect.value = saved.target ? String(saved.target) : '';
        updateSkillDescription(skillId);
      }
    }
    
  } else {
    levels.style.display = 'none';
    description.style.display = 'none';
    toggle.textContent = '+';
  }
};

// Явное снятие выбора навыка
window.deselectSkill = function(skillId) {
  if (appState.selectedSkills && appState.selectedSkills[skillId]) {
    delete appState.selectedSkills[skillId];
    saveToLocalStorage();
    updateSelectedCounter();
    renderSkills();
  }
};

// Пресеты уровней
window.applyLevelPreset = function(skillId, current, target) {
  const curEl = document.getElementById(`current-${skillId}`);
  const tarEl = document.getElementById(`target-${skillId}`);
  if (!curEl || !tarEl) return;
  curEl.value = current ? String(current) : '';
  tarEl.value = target ? String(target) : '';
  // Сохраняем выбор
  const cur = current || 0;
  const tar = target || 0;
  if (!appState.selectedSkills) appState.selectedSkills = {};
  if (tar > cur) {
    appState.selectedSkills[skillId] = { current: cur, target: tar };
  } else {
    delete appState.selectedSkills[skillId];
  }
  saveToLocalStorage();
  updateSkillDescription(skillId);
  updateSelectedCounter();
  // Обновим список для мгновенного появления/скрытия кнопки "Снять выбор"
  renderSkills();
};

function updateSkillDescription(skillId) {
  const currentLevelEl = document.getElementById(`current-${skillId}`);
  const targetLevelEl = document.getElementById(`target-${skillId}`);
  const descriptionDiv = document.getElementById(`desc-${skillId}`);
  
  if (!currentLevelEl || !targetLevelEl || !descriptionDiv) {
    return;
  }
  
  const currentLevel = currentLevelEl.value || '0';
  const targetLevel = targetLevelEl.value || '';
  
  if (currentLevel || targetLevel) {
    const skill = findSkillById(skillId);
    if (!skill) return;
    
    let description = '';
    
    if (currentLevel !== '0') {
      description += `<strong>Текущий уровень ${currentLevel}:</strong> ${skill.levels[currentLevel].description}<br>`;
    } else {
      description += `<strong>Текущий уровень:</strong> не владеет<br>`;
    }
    
    if (targetLevel && targetLevel !== currentLevel) {
      description += `<strong>Целевой уровень ${targetLevel}:</strong> ${skill.levels[targetLevel].description}`;
    }
    
    descriptionDiv.innerHTML = description;
  }
}

function findSkillById(skillId) {
  for (const category of Object.values(skillsData.skills)) {
    const skill = category.find(s => s.id === skillId);
    if (skill) return skill;
  }
  return null;
}

function getPlanSkillName(skillId) {
  const plan = appState.progress?.[skillId] || appState.developmentPlan?.[skillId];
  if (plan) return plan.name;
  const s = findSkillById(skillId);
  return s ? s.name : skillId;
}

// --- Мультинавыковость: веса задач и глобальный пересчёт прогресса ---
function getTaskWeightForSkill(activity, skillId, primarySkillId) {
  // Явный вес выигрывает
  if (activity && activity.skillWeights && typeof activity.skillWeights[skillId] === 'number') {
    const w = activity.skillWeights[skillId];
    return Number.isFinite(w) && w > 0 ? w : 0;
  }
  const links = Array.isArray(activity?.relatedSkills) ? activity.relatedSkills : [];
  const touches = (skillId === primarySkillId) || links.includes(skillId);
  if (!touches) return 0;
  const denom = 1 + links.length;
  return denom > 0 ? 1 / denom : 1;
}

// --- Подзадачи: расчёт и руллап статуса/прогресса ---
function parseChecklistToSubtasks(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);
  const items = [];
  for (const raw of lines) {
    // match bullets: -, *, •, —, –
    const bulletMatch = raw.match(/^([-*•—–]\s+)(.+)$/);
    const numDotMatch = raw.match(/^(\d+)[\.)]\s+(.+)$/);
    const checkboxMatch = raw.match(/^\[(?: |x|X)\]\s+(.+)$/);
    let title = null;
    if (checkboxMatch) {
      title = checkboxMatch[1];
    } else if (bulletMatch) {
      title = bulletMatch[2];
    } else if (numDotMatch) {
      title = numDotMatch[2];
    }
    if (title) {
      items.push({ title: title.trim(), description: '', expectedResult: '', done: false });
    }
  }
  return items;
}

function computeSubtasksStats(activity) {
  const list = Array.isArray(activity?.subtasks) ? activity.subtasks : [];
  const total = list.length;
  const done = list.filter(s => !!s.done).length;
  return { total, done };
}

function getActivityCompletionRatio(activity) {
  if (!activity) return 0;
  if (activity.status === 'cancelled') return 1;
  const { total, done } = computeSubtasksStats(activity);
  if (total > 0) {
    return total > 0 ? done / total : 0;
  }
  if (activity.completed || activity.status === 'done') return 1;
  return 0;
}

function rollupActivityFromSubtasks(activity) {
  if (!activity) return;
  const { total, done } = computeSubtasksStats(activity);
  if (total === 0) return; // нечего руллапить
  if (done === 0) {
    activity.completed = false;
    // если раньше было done/cancelled — вернём в planned
    activity.status = 'planned';
  } else if (done < total) {
    activity.completed = false;
    activity.status = (activity.status === 'blocked') ? 'blocked' : 'doing';
  } else {
    activity.completed = true;
    activity.status = 'done';
  }
}

// Обновить содержимое открытой модалки, если она показывает эту же задачу
function refreshKanbanModalIfCurrent(skillId, index, preferredMode) {
  const modal = document.getElementById('kanbanTaskModal');
  if (!modal || modal.style.display === 'none') return;
  const curId = modal.dataset.skillId;
  const curIdx = parseInt(modal.dataset.index);
  if (curId === skillId && curIdx === index) {
    openKanbanTaskModal(skillId, index);
    if (preferredMode === 'edit') {
      try { switchKanbanTaskMode('edit'); } catch (_) {}
    }
  }
}

// Построение редактора подзадач внутри модалки (режим редактирования)
function ensureKanbanSubtasksEditor(skillId, index) {
  const editWrap = document.getElementById('kanbanTaskEditSection');
  if (!editWrap) return;
  const subtaskEditId = 'kanbanEditSubtasks';
  const prev = document.getElementById(subtaskEditId);
  if (prev) prev.remove();
  const act = appState.progress?.[skillId]?.activities?.[index];
  if (!act) return;
  const html = document.createElement('div');
  html.id = subtaskEditId;
  html.className = 'form-group task-field task-field--wide';
  html.innerHTML = `
    <label class="form-label">Подзадачи</label>
    <div id="kanbanEditSubtasksList" style="display:grid; gap:6px;">
      ${(Array.isArray(act.subtasks) ? act.subtasks : []).map((s, i) => `
        <div class=\"card subtask-card\" style=\"padding:8px; display:grid; gap:6px;\">
          <div style=\"display:flex; gap:6px; align-items:center;\">
            <input class=\"form-control\" style=\"flex:1;\" type=\"text\" value=\"${escapeHtml(s.title || '')}\" placeholder=\"Название подзадачи\" data-subtitle-index=\"${i}\" />
            <button class=\"btn btn--outline btn--xs\" data-subremove-index=\"${i}\">Удалить</button>
          </div>
          <div>
            <label class=\"form-label\">Описание</label>
            <textarea class=\"form-control\" rows=\"3\" data-subdesc-index=\"${i}\">${escapeHtml(s.description || '')}</textarea>
          </div>
          <div>
            <label class=\"form-label\">Плановый результат</label>
            <textarea class=\"form-control\" rows=\"3\" data-subexp-index=\"${i}\">${escapeHtml(s.expectedResult || '')}</textarea>
          </div>
        </div>
      `).join('')}
    </div>
    <div style="margin-top:6px;">
      <button class="btn btn--outline btn--sm" id="kanbanEditAddSubtask" type="button">Добавить подзадачу</button>
    </div>
  `;
  // Вставляем сразу под блоком "Плановый результат"
  const expectedEl = document.getElementById('kanbanTaskExpected');
  let anchor = null;
  try { anchor = expectedEl ? expectedEl.closest('.task-field') : null; } catch(_) {}
  if (anchor && anchor.parentNode) {
    anchor.parentNode.insertBefore(html, anchor.nextSibling);
  } else {
    editWrap.appendChild(html);
  }

  const list = html.querySelector('#kanbanEditSubtasksList');
  const bindSync = () => {
    const a = appState.progress?.[skillId]?.activities?.[index];
    if (!a) return;
    const titles = list.querySelectorAll('[data-subtitle-index]');
    const descs = list.querySelectorAll('[data-subdesc-index]');
    const exps = list.querySelectorAll('[data-subexp-index]');
    const max = Math.max(titles.length, descs.length, exps.length);
    a.subtasks = Array.from({ length: max }).map((_, i) => ({
      title: titles[i]?.value || '',
      description: descs[i]?.value || '',
      expectedResult: exps[i]?.value || '',
      done: (Array.isArray(a.subtasks) && a.subtasks[i]) ? !!a.subtasks[i].done : false
    }));
    rollupActivityFromSubtasks(a);
    saveToLocalStorage();
    try { syncProgressTaskToPlan(skillId, index); } catch (_) {}
  };

  html.addEventListener('input', (e) => {
    const t = e.target;
    if (t && (t.hasAttribute('data-subtitle-index') || t.hasAttribute('data-subdesc-index') || t.hasAttribute('data-subexp-index'))) {
      bindSync();
    }
  });
  html.addEventListener('click', (e) => {
    const del = e.target.closest('[data-subremove-index]');
    if (del) {
      const delIdx = parseInt(del.getAttribute('data-subremove-index'));
      const a = appState.progress?.[skillId]?.activities?.[index];
      if (!a || !Array.isArray(a.subtasks)) return;
      a.subtasks.splice(delIdx, 1);
      saveToLocalStorage();
      try { syncProgressTaskToPlan(skillId, index); } catch (_) {}
      ensureKanbanSubtasksEditor(skillId, index);
      return;
    }
    const add = e.target.closest('#kanbanEditAddSubtask');
    if (add) {
      e.preventDefault();
      const a = appState.progress?.[skillId]?.activities?.[index];
      if (!a) return;
      if (!Array.isArray(a.subtasks)) a.subtasks = [];
      a.subtasks.push({ title: 'Новая подзадача', description: '', expectedResult: '', done: false });
      saveToLocalStorage();
      try { syncProgressTaskToPlan(skillId, index); } catch (_) {}
      ensureKanbanSubtasksEditor(skillId, index);
    }
  });
}

function findSkillByName(name) {
  const lower = String(name || '').trim().toLowerCase();
  if (!lower) return null;
  for (const arr of Object.values(skillsData.skills || {})) {
    for (const s of arr) {
      if (String(s.name).toLowerCase() === lower) return s;
    }
  }
  return null;
}

function getMaxAvailableLevelForSkill(skill) {
  if (!skill || !skill.levels || typeof skill.levels !== 'object') return 1;
  let max = 0;
  Object.entries(skill.levels).forEach(([lvlStr, data]) => {
    const lvl = parseInt(lvlStr);
    if (!Number.isFinite(lvl) || lvl <= 0) return;
    const hasContent = !!(data && (
      (typeof data.description === 'string' && data.description.trim().length > 0) ||
      (Array.isArray(data.activities) && data.activities.length > 0)
    ));
    if (hasContent) {
      if (lvl > max) max = lvl;
    }
  });
  return Math.max(1, max || 1);
}

function ensureSkillInPlanAndProgress(skillId, name) {
  // В плане
  if (!appState.developmentPlan[skillId]) {
    appState.developmentPlan[skillId] = {
      name: name,
      currentLevel: 0,
      targetLevel: 0,
      activities: [],
      totalDuration: 0
    };
  }
  // В прогрессе
  if (!appState.progress[skillId]) {
    appState.progress[skillId] = {
      ...appState.developmentPlan[skillId],
      completedActivities: 0,
      overallProgress: 0,
      activities: []
    };
  }
}

window.addRelatedSkillByName = function(primarySkillId, activityIndex, inputValue) {
  const act = appState.developmentPlan?.[primarySkillId]?.activities?.[activityIndex];
  if (!act) return;
  const skill = findSkillByName(inputValue);
  if (!skill) { alert('Навык не найден в каталоге CSV'); return; }
  const relatedId = skill.id;
  if (relatedId === primarySkillId) return;
  if (!Array.isArray(act.relatedSkills)) act.relatedSkills = [];
  if (!act.relatedSkills.includes(relatedId)) {
    act.relatedSkills.push(relatedId);
    ensureSkillInPlanAndProgress(relatedId, skill.name);
    saveToLocalStorage();
    renderPlan();
  }
};

window.addRelatedSkillById = function(primarySkillId, activityIndex, relatedId) {
  if (!relatedId) return;
  const act = appState.developmentPlan?.[primarySkillId]?.activities?.[activityIndex];
  if (!act) return;
  const skill = findSkillById(relatedId) || { id: relatedId, name: getPlanSkillName(relatedId) };
  if (relatedId === primarySkillId) return;
  if (!Array.isArray(act.relatedSkills)) act.relatedSkills = [];
  if (!act.relatedSkills.includes(relatedId)) {
    act.relatedSkills.push(relatedId);
    ensureSkillInPlanAndProgress(relatedId, skill.name);
    saveToLocalStorage();
    renderPlan();
  }
};

function collectTasksForSkill(skillId) {
  const tasks = [];
  Object.entries(appState.progress || {}).forEach(([primarySkillId, plan]) => {
    (plan.activities || []).forEach(act => {
      const w = getTaskWeightForSkill(act, skillId, primarySkillId);
      if (w > 0) tasks.push({ act, weight: w });
    });
  });
  return tasks;
}

function recomputeAllProgress() {
  Object.entries(appState.progress || {}).forEach(([skillId, plan]) => {
    const items = collectTasksForSkill(skillId);
    const total = items.reduce((s, x) => s + x.weight, 0);
    const contribution = items.reduce((s, x) => s + (x.weight * getActivityCompletionRatio(x.act)), 0);
    plan.completedActivities = Math.round(contribution); // для обратной совместимости
    plan.overallProgress = total > 0 ? (contribution / total) * 100 : 0;
  });
}

function handleGeneratePlan() {
  console.log('Генерация плана развития...');
  
  // Собираем выбранные навыки, НЕ обнуляя весь выбор (чтобы поиск не сбрасывал)
  if (!appState.selectedSkills) appState.selectedSkills = {};
  
  document.querySelectorAll('.skill-item').forEach(item => {
    const skillId = item.dataset.skillId;
    const currentLevelEl = document.getElementById(`current-${skillId}`);
    const targetLevelEl = document.getElementById(`target-${skillId}`);
    
    if (currentLevelEl && targetLevelEl) {
      const currentLevel = currentLevelEl.value ? parseInt(currentLevelEl.value) : 0; // пусто = не владеет
      const targetLevel = targetLevelEl.value ? parseInt(targetLevelEl.value) : 0;
      
      if (targetLevel > currentLevel) {
        appState.selectedSkills[skillId] = { current: currentLevel, target: targetLevel };
      } else {
        // Не валидный выбор — удаляем только если карточка в DOM (не трогаем сохранённые фильтром)
        delete appState.selectedSkills[skillId];
      }
    }
  });
  
  if (Object.keys(appState.selectedSkills).length === 0) {
    alert('Пожалуйста, выберите хотя бы один навык для развития');
    return;
  }
  
  // Генерируем план развития
  generateDevelopmentPlan();
  saveToLocalStorage();
  showSection('planSection');
  renderPlan();
}

function handleGeneratePrompt() {
  // Соберём выбранные навыки аналогично, но разрешим target == current для промта
  const selections = [];
  document.querySelectorAll('.skill-item').forEach(item => {
    const skillId = item.dataset.skillId;
    const currentLevelEl = document.getElementById(`current-${skillId}`);
    const targetLevelEl = document.getElementById(`target-${skillId}`);
    if (!currentLevelEl || !targetLevelEl) return;
    const currentLevel = currentLevelEl.value ? parseInt(currentLevelEl.value) : 0;
    const targetLevel = targetLevelEl.value ? parseInt(targetLevelEl.value) : 0;
    if (targetLevel > 0) {
      const skill = findSkillById(skillId);
      if (!skill) return;
      selections.push({
        id: skillId,
        name: skill.name,
        currentLevel,
        targetLevel,
        currentDesc: currentLevel > 0 ? skill.levels[String(currentLevel)].description : 'Не владеет',
        targetDesc: skill.levels[String(targetLevel)]?.description || ''
      });
    }
  });

  if (selections.length === 0) {
    alert('Выберите хотя бы один навык и целевой уровень для генерации промта');
    return;
  }

  const profile = appState.profile || {};
  const prompt = buildPrompt(profile, selections);
  const ta = document.getElementById('promptTextArea');
  if (ta) {
    ta.value = prompt;
    togglePromptModal(true);
    ta.focus();
    ta.select();
  }
}

function buildPrompt(profile, selections) {
  const header = `Ты — помощник по плану развития. Сгенерируй подробные задачи для ИПР (2-6 задач на каждый уровень), с описанием задачи и ожидаемым результатом.`;
  const person = `Контекст: Должность: ${profile.position || ''} | Грейд: ${profile.grade || ''}`;
  const rules = `Требования:\n- Для каждого навыка распиши задачи пошагово, от текущего уровня к целевому.\n- На каждую задачу укажи: title, описание (что сделать), ожидаемый результат (как понять, что готово).\n- Избегай общих фраз. Форматируй как JSON-список задач по навыкам.`;
  const skills = selections.map(s => {
    return `- ${s.name}: тек.уровень=${s.currentLevel} (${s.currentDesc}); целевой=${s.targetLevel} (${s.targetDesc})`;
  }).join('\n');
  const jsonSchema = `Строго верни JSON формата:\n{\n  \"skills\": [\n    {\n      \"name\": \"<Навык>\",\n      \"fromLevel\": <число>,\n      \"toLevel\": <число>,\n      \"tasks\": [\n        {\"title\": \"...\", \"description\": \"...\", \"expectedResult\": \"...\"}\n      ]\n    }\n  ]\n}`;
  return [header, person, rules, 'Навыки:', skills, '', jsonSchema].join('\n\n');
}

function togglePromptModal(open) {
  const modal = document.getElementById('promptModal');
  if (!modal) return;
  modal.style.display = open ? 'block' : 'none';
  modal.setAttribute('aria-hidden', open ? 'false' : 'true');
}

function toggleInfoModal(open) {
  const modal = document.getElementById('infoModal');
  if (!modal) return;
  modal.style.display = open ? 'block' : 'none';
  modal.setAttribute('aria-hidden', open ? 'false' : 'true');
}

function toggleKbWeakSkillsModal(open) {
  const modal = document.getElementById('kbWeakSkillsModal');
  if (!modal) return;
  modal.style.display = open ? 'block' : 'none';
  modal.setAttribute('aria-hidden', open ? 'false' : 'true');
}

function toggleBulkSelectModal(open) {
  const modal = document.getElementById('bulkSelectModal');
  if (!modal) return;
  modal.style.display = open ? 'block' : 'none';
  modal.setAttribute('aria-hidden', open ? 'false' : 'true');
}

function handleBulkSelectSkills() {
  const ta = document.getElementById('bulkSelectText');
  if (!ta) return;
  const lines = String(ta.value || '')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);
  if (lines.length === 0) { toggleBulkSelectModal(false); return; }
  // Маппинг имя -> id
  const nameToId = new Map();
  Object.values(skillsData.skills || {}).forEach(arr => (arr || []).forEach(s => nameToId.set(String(s.name).toLowerCase(), s.id)));
  // выберем 0→1 для найденных
  if (!appState.selectedSkills) appState.selectedSkills = {};
  lines.forEach(raw => {
    // Поддержка формата: "Название\t1" или "Название 1" (цифра в конце)
    let name = raw;
    let curLevel = 0;
    const m = raw.match(/^(.*?)[\t\s]+(\d+)$/);
    if (m) {
      name = m[1].trim();
      curLevel = Math.max(0, Math.min(4, parseInt(m[2], 10) || 0));
    }
    const id = nameToId.get(String(name).toLowerCase());
    if (id) {
      const target = Math.max(curLevel + 1, 1);
      appState.selectedSkills[id] = { current: curLevel, target: Math.min(4, target) };
    }
  });
  // Активируем фильтр "Только выбранные"
  try { const cb = document.getElementById('showOnlySelected'); if (cb) { cb.checked = true; } } catch (_) {}
  saveToLocalStorage();
  renderSkills();
  toggleBulkSelectModal(false);
}

function handleKbWeakSkillsFilter() {
  const ta = document.getElementById('kbWeakSkillsText');
  if (!ta) return;
  const lines = String(ta.value || '')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);
  if (lines.length === 0) { toggleKbWeakSkillsModal(false); return; }
  // Build name -> current mapping
  const nameToId = new Map();
  Object.values(skillsData.skills || {}).forEach(arr => (arr || []).forEach(s => nameToId.set(String(s.name).toLowerCase(), s.id)));
  const weak = [];
  lines.forEach(raw => {
    let name = raw;
    let curLevel = 0;
    const m = raw.match(/^(.*?)[\t\s]+(\d+)$/);
    if (m) {
      name = m[1].trim();
      curLevel = Math.max(0, Math.min(4, parseInt(m[2], 10) || 0));
    }
    const norm = String(name).trim();
    if (!norm) return;
    // keep even if not found in catalog; filter by KB will use names
    weak.push({ name: norm, current: curLevel });
  });
  appState.kbWeakFilter = { skills: weak };
  saveToLocalStorage();
  try { renderSkillsKbPicker(); } catch (_) {}
  toggleKbWeakSkillsModal(false);
}

function toggleQuickLoadModal(open) {
  const modal = document.getElementById('quickLoadModal');
  if (!modal) return;
  modal.style.display = open ? 'block' : 'none';
  modal.setAttribute('aria-hidden', open ? 'false' : 'true');
}

async function quickLoadByIdFromHeader() {
  const input = document.getElementById('quickLoadIdInput');
  const status = document.getElementById('quickLoadStatus');
  const id = (input?.value || '').trim();
  if (!id) { alert('Введите ID'); return; }
  try {
    if (status) status.textContent = 'Загрузка…';
    const url = typeof CLOUD_APPS_SCRIPT_URL !== 'undefined' ? CLOUD_APPS_SCRIPT_URL : (appState.ui?.cloudUrl || '');
    if (!url) { alert('Не задан URL облака'); return; }
    const res = await fetch(url);
    const json = await res.json();
    if (!(json.ok && Array.isArray(json.data))) { if (status) status.textContent = 'Ошибка ответа'; return; }
    const row = json.data.find(x => String(x.id) === String(id));
    if (!row || !row.payload) { if (status) status.textContent = 'Запись не найдена'; return; }
    appState = row.payload || {};
    // Normalize UI title/id for headers and panels
    appState.ui = appState.ui || {};
    if (row.payload?.title && !appState.ui.cloudPlanTitle) appState.ui.cloudPlanTitle = row.payload.title;
    appState.ui.cloudRecordId = id;
    saveToLocalStorage();
    // Re-render all major sections and sync form fields/headers
    renderSkills();
    renderPlan();
    renderProgress();
    // Populate profile form fields
    try { populateProfileFormFromState(); } catch (_) {}
    // Update inline cloud title/id
    try {
      const inlineTitle = document.getElementById('inlineCloudPlanTitleInput');
      if (inlineTitle) inlineTitle.value = appState.ui?.cloudPlanTitle || '';
      const inlineIdEl = document.getElementById('inlineCloudCurrentRecord');
      if (inlineIdEl) inlineIdEl.textContent = appState.ui?.cloudRecordId ? `id = ${appState.ui.cloudRecordId}` : '';
    } catch (_) {}
    showSection('progressSection');
    appState.ui = appState.ui || {}; appState.ui.cloudRecordId = id; saveToLocalStorage();
    if (status) status.textContent = 'Загружено';
    toggleQuickLoadModal(false);
  } catch (e) {
    if (status) status.textContent = 'Ошибка: ' + String(e);
  }
}

function toggleImportModal(open) {
  const modal = document.getElementById('importModal');
  if (!modal) return;
  modal.style.display = open ? 'block' : 'none';
  modal.setAttribute('aria-hidden', open ? 'false' : 'true');
}

function importFromJson() {
  const ta = document.getElementById('importTextArea');
  if (!ta) return;
  let data;
  try {
    data = JSON.parse(ta.value);
  } catch (e) {
    alert('Некорректный JSON');
    return;
  }
  if (!data || !Array.isArray(data.skills)) {
    alert('Ожидается поле skills: []');
    return;
  }

  // Мапим по имени навыка. Если совпадение — заменяем задачи
  const nameToId = {};
  Object.entries(appState.developmentPlan).forEach(([id, plan]) => { nameToId[plan.name] = id; });

  data.skills.forEach(s => {
    const id = nameToId[s.name];
    if (!id) return;
    const plan = appState.developmentPlan[id];
    if (!Array.isArray(s.tasks)) return;
      plan.activities = s.tasks.map((t, i) => ({
      id: `${id}_ext_${i}`,
      name: t.title || t.name || 'Задача',
      level: Math.min(plan.targetLevel, Math.max(plan.currentLevel + 1, plan.currentLevel + 1)),
    duration: Number.isFinite(t.duration) ? Math.max(1, Math.round(t.duration)) : 2,
        status: 'planned',
      completed: false,
      comment: '',
      description: t.description || '',
      expectedResult: t.expectedResult || '',
      relatedSkills: [],
      skillWeights: undefined
    }));
    // Пересчитать totalDuration как сумму длительностей задач
    plan.totalDuration = plan.activities.reduce((sum, a) => sum + (a.duration || 0), 0);
  });

  saveToLocalStorage();
  renderPlan();
  toggleImportModal(false);
}

function toggleProgressPromptModal(open) {
  const modal = document.getElementById('progressPromptModal');
  if (!modal) return;
  modal.style.display = open ? 'block' : 'none';
  modal.setAttribute('aria-hidden', open ? 'false' : 'true');
}

function buildProgressSummaryPrompt() {
  const lines = [];
  lines.push('Ты — ассистент по подведению итогов ИПР. Кратко и структурированно опиши текущий прогресс: что сделано и что осталось.');
  const totals = { totalTasks: 0, doneTasks: 0 };
  Object.values(appState.progress || {}).forEach(plan => {
    const total = plan.activities.length;
    const done = plan.activities.filter(a => a.completed).length;
    totals.totalTasks += total;
    totals.doneTasks += done;
    const percent = total ? Math.round((done / total) * 100) : 0;
    lines.push(`Навык: ${plan.name} — ${done}/${total} (${percent}%)`);
    const doneList = plan.activities.filter(a => a.completed).map(a => `• ${a.name}`);
    const todoList = plan.activities.filter(a => !a.completed).map(a => `• ${a.name}`);
    if (doneList.length) {
      lines.push('Сделано:');
      lines.push(doneList.join('\n'));
    }
    if (todoList.length) {
      lines.push('Осталось:');
      lines.push(todoList.join('\n'));
    }
  });
  const totalPercent = totals.totalTasks ? Math.round((totals.doneTasks / totals.totalTasks) * 100) : 0;
  lines.unshift(`Итого по ИПР: ${totals.doneTasks}/${totals.totalTasks} задач (${totalPercent}%)`);
  lines.push('\nОформи ответ кратко, структурированно, списками.');
  return lines.join('\n');
}

function generateDevelopmentPlan() {
  appState.developmentPlan = {};
  
  Object.entries(appState.selectedSkills).forEach(([skillId, levels]) => {
    const skill = findSkillById(skillId);
    if (!skill) return;
    
    const activities = [];
    
    // Генерируем активности для каждого уровня между текущим и целевым
    for (let level = levels.current + 1; level <= levels.target; level++) {
      const levelActivities = skill.levels[level].activities;
      levelActivities.forEach((activity, index) => {
        activities.push({
          id: `${skillId}_${level}_${index}`,
          name: activity,
          level: level,
          duration: 2,
          status: 'planned',
          completed: false,
          comment: '',
          description: '',
          expectedResult: '',
          relatedSkills: [],
          skillWeights: undefined
        });
      });
    }
    
    appState.developmentPlan[skillId] = {
      name: skill.name,
      currentLevel: levels.current,
      targetLevel: levels.target,
      activities: activities,
      totalDuration: activities.reduce((s, a) => s + (a.duration || 0), 0)
    };
  });
}

// Добавление выбранных навыков к существующему плану, без пересоздания остальных
function appendSelectedSkillsToPlan() {
  const existing = appState.developmentPlan || {};
  Object.entries(appState.selectedSkills).forEach(([skillId, levels]) => {
    if (existing[skillId]) return; // уже есть — пропускаем
    const skill = findSkillById(skillId);
    if (!skill) return;
    const activities = [];
    for (let level = levels.current + 1; level <= levels.target; level++) {
      const levelActivities = skill.levels[level].activities;
      levelActivities.forEach((activity, index) => {
        activities.push({
          id: `${skillId}_${level}_${index}`,
          name: activity,
          level: level,
          duration: 2,
          status: 'planned',
          completed: false,
          comment: '',
          description: '',
          expectedResult: '',
          relatedSkills: [],
          skillWeights: undefined
        });
      });
    }
    existing[skillId] = {
      name: skill.name,
      currentLevel: levels.current,
      targetLevel: levels.target,
      activities,
      totalDuration: activities.reduce((s, a) => s + (a.duration || 0), 0)
    };
  });
  appState.developmentPlan = existing;
}

function handleAppendToPlan() {
  // Собрать текущий выбор из UI
  if (!appState.selectedSkills) appState.selectedSkills = {};
  document.querySelectorAll('.skill-item').forEach(item => {
    const skillId = item.dataset.skillId;
    const currentLevelEl = document.getElementById(`current-${skillId}`);
    const targetLevelEl = document.getElementById(`target-${skillId}`);
    if (!currentLevelEl || !targetLevelEl) return;
    const currentLevel = currentLevelEl.value ? parseInt(currentLevelEl.value) : 0;
    const targetLevel = targetLevelEl.value ? parseInt(targetLevelEl.value) : 0;
    if (targetLevel > currentLevel) {
      appState.selectedSkills[skillId] = { current: currentLevel, target: targetLevel };
    }
  });
  // Добавить новые навыки к плану
  appendSelectedSkillsToPlan();
  saveToLocalStorage();
  showSection('planSection');
  renderPlan();
}

function renderPlan() {
  const planContent = document.getElementById('planContent');
  if (!planContent) {
    console.error('Элемент planContent не найден');
    return;
  }
  
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Общая сводка по ИПР
  const totals = Object.entries(appState.developmentPlan).map(([id, p]) => ({ id, name: p.name, duration: p.totalDuration }));
  const totalMonths = totals.reduce((s, t) => s + (t.duration || 0), 0);
  const summaryHtml = `
    <div class="card" style="margin-bottom: 12px;">
      <div class="card__header"><h3>Сводка по ИПР</h3></div>
      <div class="card__body">
        <ul style="margin:0; padding-left: 18px;">
          ${totals.map(t => `<li>${t.name}: ~${t.duration} нед.</li>`).join('')}
        </ul>
        <p style="margin-top:12px;"><strong>Итого по ИПР:</strong> ~${totalMonths} нед.</p>
        <div class="form-actions" style="justify-content:flex-end; gap:8px; margin-top:12px;">
          <button class="btn btn--outline" id="backToSkills">Изменить навыки</button>
          <button class="btn btn--primary" id="startProgress">Начать выполнение</button>
        </div>
      </div>
    </div>`;

  const allSkillIds = Object.keys(appState.developmentPlan || {});
  // Каталог всех навыков из CSV (включая те, которых нет в плане)
  const catalog = [];
  Object.entries(skillsData.skills || {}).forEach(([group, arr]) => {
    (arr || []).forEach(s => catalog.push({ id: s.id, name: s.name }));
  });

  const addSkillPanel = `
    <div class="card" style="margin-bottom:12px;">
      <div class="card__body" style="display:flex; flex-direction:column; gap:12px;">
        <div class="form-group" style="display:flex; gap:8px; align-items:flex-end; margin:0;">
          <div style="flex:1; min-width:260px;">
            <label class="form-label">Добавить навык в план</label>
            <select id="planAddSkillSelect" class="form-control">
              <option value="">Выберите навык</option>
              ${catalog
                .filter(s => !allSkillIds.includes(s.id))
                .map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`)
                .join('')}
            </select>
          </div>
          <div style="display:flex; gap:8px;">
            <div>
              <label class="form-label">Целевой уровень</label>
              <select id="planAddSkillTarget" class="form-control" style="width:120px;">
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
              </select>
            </div>
            <button class="btn btn--outline" id="planAddSkillBtn">Добавить</button>
          </div>
        </div>
        <div class="form-group" style="display:flex; gap:8px; align-items:flex-end; margin:0;">
          <div style="flex:1; min-width:260px;">
            <label class="form-label">Выберите задачу из каталога</label>
            <select id="planAddTaskCatalogSelect" class="form-control">
              <option value="">Загрузка каталога задач...</option>
            </select>
          </div>
        </div>
      </div>
    </div>`;

  planContent.innerHTML = summaryHtml + Object.entries(appState.developmentPlan).map(([skillId, plan]) => `
    <div class="plan-skill" data-plan-skill-id="${skillId}">
      <div class="plan-skill-header">
        <h3 class="plan-skill-title">${plan.name}</h3>
        <div class="level-progression">
          Уровень ${plan.currentLevel} <span class="level-arrow">→</span> ${plan.targetLevel}
          <span class="activity-duration">(~${plan.totalDuration} нед.)</span>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <button class="btn btn--outline btn--sm" title="Удалить навык из плана" onclick="removePlanSkill('${skillId}')">Удалить навык</button>
        </div>
      </div>
      <div class="plan-activities">
        ${plan.activities.map((activity, idx) => `
          <div class="activity-item" data-activity-idx="${idx}">
            <div class="form-group" style="margin-bottom:8px;">
              <label class="form-label">Название задачи</label>
              <input class="form-control" type="text" value="${activity.name.replace(/\"/g, '&quot;')}" onchange="updatePlanActivity('${skillId}', ${idx}, { name: this.value })" />
            </div>
            <div class="plan-activity-grid">
              <div class="form-group" style="margin-bottom:8px;">
                <label class="form-label">Описание задачи</label>
                <textarea class="form-control" rows="6" onchange="updatePlanActivity('${skillId}', ${idx}, { description: this.value })">${(activity.description || '').replace(/</g,'&lt;')}</textarea>
              </div>
              <div class="form-group" style="margin-bottom:8px;">
                <label class="form-label">Плановый результат</label>
                <textarea class="form-control" rows="6" onchange="updatePlanActivity('${skillId}', ${idx}, { expectedResult: this.value })">${(activity.expectedResult || '').replace(/</g,'&lt;')}</textarea>
              </div>
            </div>
            <div class="form-group" style="margin-bottom:8px;">
              <label class="form-label">Связанные навыки (задача влияет также на)</label>
              <div class="related-skills-list">
                ${allSkillIds
                  .filter(id => id !== skillId)
                  .map(id => `
                    <label class=\"checkbox\">
                      <input type=\"checkbox\" ${((activity.relatedSkills||[]).includes(id)) ? 'checked' : ''} onchange=\"toggleRelatedSkill('${skillId}', ${idx}, '${id}', this.checked)\" />
                      <span>${appState.developmentPlan[id]?.name || id}</span>
                    </label>
                  `)
                  .join('')}
              </div>
              <div style="display:flex; gap:8px; margin-top:8px; align-items:center;">
                <select class="form-control" id="relatedAdd-${skillId}-${idx}">
                  <option value="">Выберите навык</option>
                  ${catalog
                    .filter(s => s.id !== skillId && !(activity.relatedSkills||[]).includes(s.id))
                    .map(s => `<option value="${s.id}">${s.name}</option>`)
                    .join('')}
                </select>
                <button type="button" class="btn btn--outline btn--sm" onclick="addRelatedSkillById('${skillId}', ${idx}, document.getElementById('relatedAdd-${skillId}-${idx}').value)">Добавить</button>
              </div>
            </div>
            <div class="form-group" style="margin-bottom:8px;">
              <label class="form-label">Подзадачи</label>
              <div style="display:grid; gap:6px;" id="subtasks-${skillId}-${idx}">
                ${Array.isArray(activity.subtasks) && activity.subtasks.length ? activity.subtasks.map((s, si) => `
                  <div class=\"card subtask-card\" style=\"padding:8px; display:grid; gap:6px;\">
                    <div style=\"display:flex; gap:6px; align-items:center;\">
                      <input class=\"form-control\" style=\"flex:1;\" type=\"text\" value=\"${escapeHtml(s.title || '')}\" placeholder=\"Название подзадачи\" onchange=\"updatePlanSubtask('${skillId}', ${idx}, ${si}, this.value)\" />
                      <button class=\"btn btn--outline btn--xs\" onclick=\"removePlanSubtask('${skillId}', ${idx}, ${si})\">Удалить</button>
                    </div>
                    <div>
                      <label class=\"form-label\">Описание</label>
                      <textarea class=\"form-control\" rows=\"3\" onchange=\"updatePlanSubtaskDesc('${skillId}', ${idx}, ${si}, this.value)\">${escapeHtml(s.description || '')}</textarea>
                    </div>
                    <div>
                      <label class=\"form-label\">Плановый результат</label>
                      <textarea class=\"form-control\" rows=\"3\" onchange=\"updatePlanSubtaskExpected('${skillId}', ${idx}, ${si}, this.value)\">${escapeHtml(s.expectedResult || '')}</textarea>
                    </div>
                  </div>
                `).join('') : '<div style="font-size:12px;color:var(--color-text-secondary)">Пока нет подзадач</div>'}
              </div>
              <div style="margin-top:6px;">
                <button class="btn btn--outline btn--sm" onclick="addPlanSubtask('${skillId}', ${idx})">Добавить подзадачу</button>
              </div>
            </div>
            <div style="display:flex; gap: 8px; align-items:center;">
              <label style="font-size:12px;color:var(--color-text-secondary)">Длительность (нед.)</label>
              <input class="form-control" type="number" min="1" style="width:100px" value="${activity.duration}" onchange="updatePlanActivity('${skillId}', ${idx}, { duration: parseInt(this.value)||1 })" />
               <label style="font-size:12px;color:var(--color-text-secondary)">Приоритет</label>
               <select class="form-control" style="width:140px" onchange="updatePlanActivity('${skillId}', ${idx}, { priority: this.value })">
                 <option value="" ${!activity.priority ? 'selected' : ''}>Нет</option>
                 <option value="urgent" ${activity.priority==='urgent' ? 'selected' : ''}>Срочный</option>
                 <option value="high" ${activity.priority==='high' ? 'selected' : ''}>Высокий</option>
                 <option value="medium" ${activity.priority==='medium' ? 'selected' : ''}>Средний</option>
                 <option value="low" ${activity.priority==='low' ? 'selected' : ''}>Низкий</option>
               </select>
              <button class="btn btn--outline btn--sm" onclick="removePlanActivity('${skillId}', ${idx})">Удалить</button>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="form-actions" style="justify-content:flex-start; gap:8px; margin-top:12px;">
        <button class="btn btn--secondary btn--sm" onclick="addPlanActivity('${skillId}')">Добавить задачу</button>
      </div>
    </div>
  `).join('') + addSkillPanel;

  // Привяжем обработчики к кнопкам, т.к. они динамические
  const backToSkillsBtn = document.getElementById('backToSkills');
  if (backToSkillsBtn) {
    backToSkillsBtn.onclick = () => showSection('skillsSection');
  }
  const planAddSkillBtn = document.getElementById('planAddSkillBtn');
  if (planAddSkillBtn) {
    planAddSkillBtn.onclick = () => {
      const sel = document.getElementById('planAddSkillSelect');
      const tgtEl = document.getElementById('planAddSkillTarget');
      const id = sel && sel.value;
      if (!id) return;
      let tgt = Math.max(1, parseInt(tgtEl?.value || '1') || 1);
      // max уровни навыка (по содержимому уровней)
      const skill = findSkillById(id);
      let maxLevel = getMaxAvailableLevelForSkill(skill);
      tgt = Math.min(tgt, maxLevel);
      const cur = Math.max(0, tgt - 1);
      addSkillToPlan(id, { currentLevel: cur, targetLevel: tgt });
    };
  }
  // Populate tasks catalog select async
  populatePlanTaskCatalogSelect();
  const planTaskCatalogSelect = document.getElementById('planAddTaskCatalogSelect');
  if (planTaskCatalogSelect) {
    const openKb = (e) => { e.preventDefault(); e.stopPropagation(); openSkillsKbSelectionFromPlan(); };
    planTaskCatalogSelect.addEventListener('mousedown', openKb);
    planTaskCatalogSelect.addEventListener('focus', openKb, { once: true });
  }
  // Динамически перестраивать уровни при смене навыка и корректировать target при смене current
  const planAddSkillSelectEl = document.getElementById('planAddSkillSelect');
  const planAddSkillTargetEl = document.getElementById('planAddSkillTarget');
  const rebuildPlanAddLevels = () => {
    if (!planAddSkillSelectEl || !planAddSkillTargetEl) return;
    const id = planAddSkillSelectEl.value;
    const skill = id ? findSkillById(id) : null;
    const maxLevel = getMaxAvailableLevelForSkill(skill);
    // rebuild target options
    planAddSkillTargetEl.innerHTML = Array.from({ length: maxLevel }, (_, i) => i + 1)
      .map(n => `<option value="${n}">${n}</option>`)
      .join('');
    const prevTgt = Math.max(1, parseInt(planAddSkillTargetEl.value || '1') || 1);
    planAddSkillTargetEl.value = String(Math.min(prevTgt, maxLevel));
  };
  if (planAddSkillSelectEl && planAddSkillTargetEl) {
    planAddSkillSelectEl.addEventListener('change', rebuildPlanAddLevels);
    // initial align
    rebuildPlanAddLevels();
  }
  const startProgressBtn = document.getElementById('startProgress');
  if (startProgressBtn) {
    startProgressBtn.onclick = () => {
      if (appState.progress && Object.keys(appState.progress).length > 0) {
        mergePlanIntoProgress();
      } else {
        initializeProgress();
      }
      showSection('progressSection');
      renderProgress();
    };
  }
}

// Открыть вкладку Выбор навыков/Задачи из Базы знаний из панели Плана
function openSkillsKbSelectionFromPlan() {
  const skillsTabManualBtn = document.getElementById('skillsTabManualBtn');
  const skillsTabKBBtn = document.getElementById('skillsTabKBBtn');
  const skillsTabManualPanel = document.getElementById('skillsTabManualPanel');
  const skillsTabKBPanel = document.getElementById('skillsTabKBPanel');
  const skillsHeaderTitle = document.getElementById('skillsHeaderTitle');
  showSection('skillsSection');
  if (skillsTabManualBtn && skillsTabKBBtn && skillsTabManualPanel && skillsTabKBPanel) {
    skillsTabManualBtn.classList.remove('active');
    skillsTabKBBtn.classList.add('active');
    skillsTabManualPanel.classList.remove('active');
    skillsTabKBPanel.classList.add('active');
    if (skillsHeaderTitle) skillsHeaderTitle.textContent = 'Выбор задач из Базы знаний';
    try { renderSkillsKbPicker(); } catch (_) {}
  }
}

function initializeProgress() {
  appState.progress = {};
  
  Object.entries(appState.developmentPlan).forEach(([skillId, plan]) => {
    appState.progress[skillId] = {
      ...plan,
      completedActivities: 0,
      overallProgress: 0,
      activities: plan.activities.map(activity => ({
        ...activity,
        status: activity.status || (activity.completed ? 'done' : 'planned'),
        priority: activity.priority || '',
        subtasks: Array.isArray(activity.subtasks)
          ? activity.subtasks.map(s => ({
              title: s.title || String(s || 'Подзадача'),
              description: s.description || '',
              expectedResult: s.expectedResult || '',
              done: !!s.done
            }))
          : activity.subtasks
      }))
    };
  });
  
  saveToLocalStorage();
}

// Добавляем/синхронизируем задачи из плана в текущий прогресс без потери статусов
function mergePlanIntoProgress() {
  if (!appState.progress) appState.progress = {};
  Object.entries(appState.developmentPlan || {}).forEach(([skillId, plan]) => {
    const target = appState.progress[skillId];
    if (!target) {
      appState.progress[skillId] = {
        name: plan.name,
        currentLevel: plan.currentLevel,
        targetLevel: plan.targetLevel,
        completedActivities: 0,
        overallProgress: 0,
        totalDuration: plan.totalDuration,
        activities: (plan.activities || []).map(a => ({
          ...a,
          status: a.status || (a.completed ? 'done' : 'planned'),
          priority: a.priority || '',
        subtasks: Array.isArray(a.subtasks)
          ? a.subtasks.map(s => ({
              title: s.title || String(s || 'Подзадача'),
              description: s.description || '',
              expectedResult: s.expectedResult || '',
              done: !!s.done
            }))
          : a.subtasks,
          completed: !!a.completed
        }))
      };
      return;
    }
    // Синхронизируем метаданные навыка
    target.name = plan.name;
    target.currentLevel = plan.currentLevel;
    target.targetLevel = plan.targetLevel;
    target.totalDuration = plan.totalDuration;
    const byId = new Map((target.activities || []).map((a, i) => [a.id, i]));
    (plan.activities || []).forEach(pAct => {
      if (!byId.has(pAct.id)) {
        // новая задача из плана — добавляем в прогресс
        target.activities.push({
          ...pAct,
          status: pAct.status || 'planned',
          priority: pAct.priority || '',
          subtasks: Array.isArray(pAct.subtasks)
            ? pAct.subtasks.map(s => ({
                title: s.title || String(s || 'Подзадача'),
                description: s.description || '',
                expectedResult: s.expectedResult || '',
                done: !!s.done
              }))
            : pAct.subtasks,
          completed: !!pAct.completed
        });
      }
    });
  });
  recomputeAllProgress();
  saveToLocalStorage();
}

// Синхронизация правок задачи из прогресса обратно в план по id
function syncProgressTaskToPlan(skillId, activityIndex) {
  const progPlan = appState.progress?.[skillId];
  if (!progPlan) return;
  const act = progPlan.activities?.[activityIndex];
  if (!act) return;
  if (!appState.developmentPlan) appState.developmentPlan = {};
  if (!appState.developmentPlan[skillId]) {
    appState.developmentPlan[skillId] = {
      name: progPlan.name,
      currentLevel: progPlan.currentLevel || 0,
      targetLevel: progPlan.targetLevel || 0,
      activities: [],
      totalDuration: 0
    };
  }
  const plan = appState.developmentPlan[skillId];
  const idx = (plan.activities || []).findIndex(a => a.id === act.id);
  const patchFields = ['name', 'description', 'expectedResult', 'duration', 'relatedSkills', 'priority'];
  if (idx >= 0) {
    patchFields.forEach(k => { plan.activities[idx][k] = act[k]; });
    if (Array.isArray(act.subtasks)) {
      plan.activities[idx].subtasks = act.subtasks.map(s => ({
        title: s.title || String(s || 'Подзадача'),
        description: s.description || '',
        expectedResult: s.expectedResult || '',
        done: !!s.done
      }));
    }
  } else {
    plan.activities.push({
      id: act.id,
      name: act.name,
      level: act.level,
      duration: act.duration,
      status: 'planned',
      completed: false,
      comment: '',
      description: act.description || '',
      expectedResult: act.expectedResult || '',
      relatedSkills: Array.isArray(act.relatedSkills) ? [...act.relatedSkills] : [],
      skillWeights: act.skillWeights,
      subtasks: Array.isArray(act.subtasks) ? act.subtasks.map(s => ({
        title: s.title || String(s || 'Подзадача'),
        description: s.description || '',
        expectedResult: s.expectedResult || '',
        done: !!s.done
      })) : undefined
    });
  }
  // Пересчитать длительность
  plan.totalDuration = (plan.activities || []).reduce((s, a) => s + (a.duration || 0), 0);
  saveToLocalStorage();
}

function renderProgress() {
  // Гарантируем пересчёт агрегатов с учётом связанных навыков
  recomputeAllProgress();
  // Инициализируем настройки сортировки только один раз
  if (!window.sortSettingsInitialized) {
    initSortSettings();
    window.sortSettingsInitialized = true;
  }
  // Инициализируем модальное окно добавления задачи только один раз
  if (!window.addNewTaskInitialized) {
    initAddNewTaskModal();
    window.addNewTaskInitialized = true;
  }
  // Инициализируем модальное окно меню только один раз
  if (!window.progressMenuInitialized) {
    initProgressMenuModal();
    window.progressMenuInitialized = true;
  }
  if (typeof Chart !== 'undefined') {
    renderProgressCharts();
  }
  // Сначала список и канбан
  renderProgressTracking();
  renderProgressKanban();
  // Затем блок со связанными навыками (как отдельный список вне графиков)
  renderRelatedSkillsSummary();
}

// Инициализация настроек сортировки
function initSortSettings() {
  initSortSettingsModal();
  initSortSettingsButton();
}

// Инициализация модального окна настроек сортировки
function initSortSettingsModal() {
  const modal = document.getElementById('sortSettingsModal');
  const sortBySelect = document.getElementById('taskSortBy');
  const sortDirectionSelect = document.getElementById('taskSortDirection');
  const crossSkillsCheckbox = document.getElementById('taskSortCrossSkills');
  const applyBtn = document.getElementById('applySortSettings');
  const closeButtons = modal.querySelectorAll('[data-close-modal]');
  
  if (!modal || !sortBySelect || !sortDirectionSelect || !crossSkillsCheckbox || !applyBtn) return;
  
  // Убеждаемся, что модальное окно закрыто при инициализации
  modal.style.display = 'none';
  modal.setAttribute('aria-hidden', 'true');
  
  // Закрытие модального окна
  const closeModal = () => {
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
  };
  
  // Открытие модального окна
  const openModal = () => {
    // Загружаем текущие настройки в форму
    const settings = appState.sortSettings || { by: 'priority', direction: 'desc', crossSkills: true };
    sortBySelect.value = settings.by;
    sortDirectionSelect.value = settings.direction;
    crossSkillsCheckbox.checked = settings.crossSkills;
    
    modal.style.display = 'block';
    modal.setAttribute('aria-hidden', 'false');
  };
  
  // Применение настроек
  const applySettings = () => {
    appState.sortSettings = {
      by: sortBySelect.value,
      direction: sortDirectionSelect.value,
      crossSkills: crossSkillsCheckbox.checked
    };
    saveToLocalStorage();
    renderProgressTracking();
    renderProgressKanban();
    closeModal();
  };
  
  // Обработчики событий
  applyBtn.onclick = applySettings;
  closeButtons.forEach(btn => btn.onclick = closeModal);
  
  // Закрытие по клику на overlay
  const overlay = modal.querySelector('.modal__overlay');
  if (overlay) {
    overlay.onclick = closeModal;
  }
  
  // Закрытие по Escape (только для этого конкретного модального окна)
  const handleEscape = (e) => {
    if (e.key === 'Escape' && modal.style.display === 'block') {
      closeModal();
    }
  };
  
  // Добавляем обработчик, только если его еще нет
  if (!modal.dataset.escapeHandlerAdded) {
    document.addEventListener('keydown', handleEscape);
    modal.dataset.escapeHandlerAdded = 'true';
  }
  
  // Сохраняем функцию открытия для использования кнопкой
  window.openSortSettingsModal = openModal;
}

// Инициализация кнопки настроек сортировки
function initSortSettingsButton() {
  const sortBtn = document.getElementById('sortSettingsBtn');
  if (!sortBtn) return;
  
  sortBtn.onclick = () => {
    if (window.openSortSettingsModal) {
      window.openSortSettingsModal();
    }
  };
}

// Инициализация модального окна добавления новой задачи
function initAddNewTaskModal() {
  const modal = document.getElementById('addNewTaskModal');
  const addNewTaskBtn = document.getElementById('addNewTaskBtn');
  const saveNewTaskBtn = document.getElementById('saveNewTaskBtn');
  const closeButtons = modal?.querySelectorAll('[data-close-modal]');
  
  if (!modal || !addNewTaskBtn || !saveNewTaskBtn) return;

  // Функция открытия модального окна
  const openModal = () => {
    // Заполняем список навыков
    populateSkillsDropdown();
    // Очищаем форму
    clearNewTaskForm();
    // Инициализируем поиск по навыкам
    initSkillSearch();
    modal.style.display = 'block';
    modal.setAttribute('aria-hidden', 'false');
  };

  // Функция закрытия модального окна
  const closeModal = () => {
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
  };

  // Обработчики событий
  addNewTaskBtn.addEventListener('click', openModal);
  saveNewTaskBtn.addEventListener('click', saveNewTask);
  
  closeButtons?.forEach(btn => {
    btn.addEventListener('click', closeModal);
  });
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal || e.target.hasAttribute('data-close-modal')) {
      closeModal();
    }
  });
}

// Заполнение выпадающего списка навыков
function populateSkillsDropdown() {
  const skillSelect = document.getElementById('newTaskSkill');
  if (!skillSelect) return;
  
  // Очищаем список
  skillSelect.innerHTML = '<option value="">Выберите навык</option>';
  
  // Создаем группы для организации навыков
  const currentSkillsGroup = document.createElement('optgroup');
  currentSkillsGroup.label = '📋 Текущие навыки в плане';
  
  const allSkillsGroup = document.createElement('optgroup');
  allSkillsGroup.label = '📚 Все доступные навыки';
  
  const skillsSet = new Set();
  let hasCurrentSkills = false;
  
  // Добавляем навыки из прогресса
  Object.entries(appState.progress || {}).forEach(([skillId, skill]) => {
    if (!skillsSet.has(skillId)) {
      const option = document.createElement('option');
      option.value = skillId;
      option.textContent = skill.name || skillId;
      currentSkillsGroup.appendChild(option);
      skillsSet.add(skillId);
      hasCurrentSkills = true;
    }
  });
  
  // Добавляем навыки из плана развития, если их еще нет в прогрессе
  Object.entries(appState.developmentPlan || {}).forEach(([skillId, skill]) => {
    if (!skillsSet.has(skillId)) {
      const option = document.createElement('option');
      option.value = skillId;
      option.textContent = skill.name || skillId;
      currentSkillsGroup.appendChild(option);
      skillsSet.add(skillId);
      hasCurrentSkills = true;
    }
  });
  
  // Добавляем группу текущих навыков, если есть
  if (hasCurrentSkills) {
    skillSelect.appendChild(currentSkillsGroup);
  }
  
  // Собираем все навыки из каталога по категориям
  const categorizedSkills = [];
  Object.entries(skillsData.skills || {}).forEach(([categoryName, skills]) => {
    if (skills && skills.length > 0) {
      const categoryGroup = document.createElement('optgroup');
      categoryGroup.label = categoryName;
      
      let hasSkillsInCategory = false;
      skills.forEach(skill => {
        if (!skillsSet.has(skill.id)) {
          const option = document.createElement('option');
          option.value = skill.id;
          option.textContent = skill.name;
          categoryGroup.appendChild(option);
          hasSkillsInCategory = true;
        }
      });
      
      if (hasSkillsInCategory) {
        categorizedSkills.push(categoryGroup);
      }
    }
  });
  
  // Добавляем категории навыков
  categorizedSkills.forEach(categoryGroup => {
    skillSelect.appendChild(categoryGroup);
  });
  
  // Добавляем опцию для создания нового навыка
  const newSkillOption = document.createElement('option');
  newSkillOption.value = 'new_skill';
  newSkillOption.textContent = '➕ Создать новый навык';
  newSkillOption.style.fontWeight = 'bold';
  newSkillOption.style.color = '#007bff';
  skillSelect.appendChild(newSkillOption);
}

// Инициализация поиска по навыкам
function initSkillSearch() {
  const searchInput = document.getElementById('newTaskSkillSearch');
  const skillSelect = document.getElementById('newTaskSkill');
  
  if (!searchInput || !skillSelect) return;
  
  // Сохраняем все опции для фильтрации
  const allOptions = Array.from(skillSelect.querySelectorAll('option, optgroup'));
  
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    
    if (!query) {
      // Показываем все опции
      allOptions.forEach(element => {
        element.style.display = '';
      });
      return;
    }
    
    // Фильтруем опции
    allOptions.forEach(element => {
      if (element.tagName === 'OPTGROUP') {
        // Для групп проверяем, есть ли видимые дочерние элементы
        const visibleChildren = Array.from(element.querySelectorAll('option')).filter(option => {
          const matches = option.textContent.toLowerCase().includes(query);
          option.style.display = matches ? '' : 'none';
          return matches;
        });
        element.style.display = visibleChildren.length > 0 ? '' : 'none';
      } else if (element.tagName === 'OPTION') {
        const matches = element.textContent.toLowerCase().includes(query);
        element.style.display = matches ? '' : 'none';
      }
    });
  });
  
  // Очищаем поиск при выборе навыка
  skillSelect.addEventListener('change', () => {
    if (skillSelect.value) {
      searchInput.value = '';
      // Показываем все опции
      allOptions.forEach(element => {
        element.style.display = '';
      });
    }
  });
  
  // Двойной клик для быстрого выбора и закрытия модального окна
  skillSelect.addEventListener('dblclick', () => {
    if (skillSelect.value && skillSelect.value !== 'new_skill') {
      // Заполняем название задачи названием навыка, если оно пустое
      const titleField = document.getElementById('newTaskTitle');
      if (titleField && !titleField.value.trim()) {
        const selectedOption = skillSelect.options[skillSelect.selectedIndex];
        if (selectedOption) {
          titleField.value = `Изучить ${selectedOption.textContent}`;
        }
      }
    }
  });
}

// Очистка формы добавления задачи
function clearNewTaskForm() {
  const fields = [
    'newTaskTitle',
    'newTaskDescription', 
    'newTaskExpected',
    'newTaskSkill',
    'newTaskSkillSearch',
    'newTaskPriority'
  ];
  
  fields.forEach(fieldId => {
    const field = document.getElementById(fieldId);
    if (field) field.value = '';
  });
  
  const durationField = document.getElementById('newTaskDuration');
  if (durationField) durationField.value = '2';
}

// Сохранение новой задачи
function saveNewTask() {
  const titleField = document.getElementById('newTaskTitle');
  const descField = document.getElementById('newTaskDescription');
  const expectedField = document.getElementById('newTaskExpected');
  const skillField = document.getElementById('newTaskSkill');
  const priorityField = document.getElementById('newTaskPriority');
  const durationField = document.getElementById('newTaskDuration');
  
  if (!titleField || !skillField) return;
  
  const title = titleField.value.trim();
  let skillId = skillField.value;
  
  if (!title || !skillId) {
    alert('Пожалуйста, заполните название задачи и выберите навык');
    return;
  }
  
  let newSkillName = null;
  
  // Если выбрано создание нового навыка
  if (skillId === 'new_skill') {
    newSkillName = prompt('Введите название нового навыка:');
    if (!newSkillName || !newSkillName.trim()) {
      alert('Название навыка не может быть пустым');
      return;
    }
    skillId = slugify(newSkillName.trim());
    
    // Проверяем, что такого навыка еще нет
    if (appState.progress[skillId]) {
      alert('Навык с таким названием уже существует');
      return;
    }
  }
  
  // Определяем уровень для новой задачи
  let taskLevel = 1;
  const existingProgress = appState.progress[skillId];
  const existingPlan = appState.developmentPlan[skillId];
  
  if (existingProgress && existingProgress.currentLevel) {
    taskLevel = Math.max(1, existingProgress.currentLevel + 1);
  } else if (existingPlan && existingPlan.currentLevel) {
    taskLevel = Math.max(1, existingPlan.currentLevel + 1);
  }

  // Создаем новую задачу
  const newTask = {
    id: `${skillId}_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
    name: title,
    description: descField?.value.trim() || '',
    expectedResult: expectedField?.value.trim() || '',
    priority: priorityField?.value || '',
    level: taskLevel,
    duration: parseInt(durationField?.value) || 2,
    status: 'planned',
    completed: false,
    comment: '',
    relatedSkills: [],
    skillWeights: undefined
  };
  
  // Добавляем задачу к выбранному навыку
  if (!appState.progress[skillId]) {
    // Определяем имя навыка
    let skillName = skillId;
    if (newSkillName) {
      // Для нового навыка используем введенное пользователем имя
      skillName = newSkillName.trim();
    } else {
      // Для существующего навыка ищем имя в прогрессе, плане или каталоге
      const existingSkill = appState.progress[skillId] || appState.developmentPlan[skillId];
      if (existingSkill && existingSkill.name) {
        skillName = existingSkill.name;
      } else {
        // Ищем в каталоге навыков
        const catalogSkill = findSkillById(skillId);
        if (catalogSkill && catalogSkill.name) {
          skillName = catalogSkill.name;
        }
      }
    }
    
    appState.progress[skillId] = {
      name: skillName,
      currentLevel: 0,
      targetLevel: Math.max(1, taskLevel),
      activities: [],
      totalDuration: 0
    };
  }
  
  if (!appState.progress[skillId].activities) {
    appState.progress[skillId].activities = [];
  }
  
  appState.progress[skillId].activities.push(newTask);
  
  // Обновляем общую длительность навыка
  appState.progress[skillId].totalDuration = appState.progress[skillId].activities.reduce((sum, a) => sum + (a.duration || 0), 0);
  
  // Сохраняем и обновляем интерфейс
  saveToLocalStorage();
  renderProgress();
  
  // Закрываем модальное окно
  const modal = document.getElementById('addNewTaskModal');
  if (modal) {
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
  }
  
  // Автосохранение в облако
  try {
    autoCloudSaveDebounced('add-new-task');
  } catch (_) {}
  
  alert('Задача успешно добавлена!');
}

// Инициализация модального окна меню прогресса
function initProgressMenuModal() {
  const modal = document.getElementById('progressMenuModal');
  const progressMenuBtn = document.getElementById('progressMenuBtn');
  const closeButtons = modal?.querySelectorAll('[data-close-modal]');
  
  if (!modal || !progressMenuBtn) return;

  // Функция открытия модального окна
  const openModal = () => {
    modal.style.display = 'block';
    modal.setAttribute('aria-hidden', 'false');
  };

  // Функция закрытия модального окна
  const closeModal = () => {
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
  };

  // Обработчики событий
  progressMenuBtn.addEventListener('click', openModal);
  
  closeButtons?.forEach(btn => {
    btn.addEventListener('click', closeModal);
  });
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal || e.target.hasAttribute('data-close-modal')) {
      closeModal();
    }
  });

  // Перенаправление кликов на кнопки меню к оригинальным обработчикам
  setupMenuButtonRedirects(closeModal);
}

// Настройка перенаправления кликов кнопок меню
function setupMenuButtonRedirects(closeModal) {
  // Промт для анализа прогресса
  const menuGeneratePromptBtn = document.getElementById('menuGenerateProgressPromptBtn');
  const originalGeneratePromptBtn = document.getElementById('generateProgressPromptBtn');
  if (menuGeneratePromptBtn && originalGeneratePromptBtn) {
    menuGeneratePromptBtn.addEventListener('click', () => {
      closeModal();
      originalGeneratePromptBtn.click();
    });
  }

  // Экспорт в CSV
  const menuExportCSVBtn = document.getElementById('menuExportCSVProgress');
  const originalExportCSVBtn = document.getElementById('exportCSVProgress');
  if (menuExportCSVBtn && originalExportCSVBtn) {
    menuExportCSVBtn.addEventListener('click', () => {
      closeModal();
      originalExportCSVBtn.click();
    });
  }

  // Экспорт в XLSX
  const menuExportXLSXBtn = document.getElementById('menuExportXLSXProgress');
  const originalExportXLSXBtn = document.getElementById('exportXLSXProgress');
  if (menuExportXLSXBtn && originalExportXLSXBtn) {
    menuExportXLSXBtn.addEventListener('click', () => {
      closeModal();
      originalExportXLSXBtn.click();
    });
  }

  // Экспорт Tasks JSON
  const menuExportKBTasksBtn = document.getElementById('menuExportKBTasksProgress');
  const originalExportKBTasksBtn = document.getElementById('exportKBTasksProgress');
  if (menuExportKBTasksBtn && originalExportKBTasksBtn) {
    menuExportKBTasksBtn.addEventListener('click', () => {
      closeModal();
      originalExportKBTasksBtn.click();
    });
  }

  // Облачная синхронизация
  const menuCloudSyncBtn = document.getElementById('menuCloudSyncBtn');
  const originalCloudSyncBtn = document.getElementById('cloudSyncBtn');
  if (menuCloudSyncBtn && originalCloudSyncBtn) {
    menuCloudSyncBtn.addEventListener('click', () => {
      closeModal();
      originalCloudSyncBtn.click();
    });
  }

  // Импорт CSV
  const menuImportCSVBtn = document.getElementById('menuImportCSVProgress');
  const importCSVFile = document.getElementById('importCSVProgressFile');
  if (menuImportCSVBtn && importCSVFile) {
    menuImportCSVBtn.addEventListener('click', () => {
      closeModal();
      importCSVFile.click();
    });
  }
}

// Отдельный блок: агрегированный список связанных навыков, не влияющий на графики
function renderRelatedSkillsSummary() {
  const wrap = document.getElementById('relatedSkillsSummary');
  if (!wrap) return;
  const relatedSet = new Map(); // id -> name
  Object.entries(appState.progress || {}).forEach(([primarySkillId, plan]) => {
    (plan.activities || []).forEach(act => {
      (act.relatedSkills || []).forEach(id => {
        if (!relatedSet.has(id)) {
          relatedSet.set(id, getPlanSkillName(id));
        }
      });
    });
  });
  if (relatedSet.size === 0) {
    wrap.innerHTML = '';
    return;
  }
  const items = Array.from(relatedSet.entries()).map(([id, name]) => `<span class="related-item" title="${name}">${name}</span>`).join(' ');
  wrap.innerHTML = `
    <h3>Также прокачиваются навыки</h3>
    <div class="related-list">${items}</div>
  `;
}

// ---------- Анализ развития ----------
let analysisData = null; // { dates: [..], skills: { name: [levels per date] } }

async function renderAnalysis() {
  // Если данных нет — попробуем подгрузить дефолтный файл (если есть в корне)
  if (!analysisData) {
    try {
      const resp = await fetch('HardSkills Review QA 4.0 Manual + Auto.csv', { cache: 'no-store' });
      if (resp.ok) {
        const text = await resp.text();
        analysisData = parseAnalysisCsv(text);
        populateAnalysisSkillSelect();
      }
    } catch (_) {}
  }
  const hasData = !!analysisData;
  const chartsWrap = document.getElementById('analysisCharts');
  const statusEl = document.getElementById('analysisStatus');
  const selectWrap = document.getElementById('analysisSelectWrap');
  if (!hasData) {
    if (chartsWrap) chartsWrap.style.display = 'none';
    if (selectWrap) selectWrap.style.display = 'none';
    if (statusEl) statusEl.style.display = 'inline-flex';
    return;
  }
  if (chartsWrap) chartsWrap.style.display = 'block';
  if (selectWrap) selectWrap.style.display = 'block';
  if (statusEl) statusEl.style.display = 'none';
  renderAnalysisAvg();
  renderAnalysisTopImproved();
  renderAnalysisSkill();
}

function renderPlanAnalysis() {
  // Используем только основные навыки плана (исключая плейсхолдеры связанных с нулём задач)
  const skills = Object.values(appState.developmentPlan || {}).filter(p => (p.activities || []).length > 0);
  // Заполняем селект
  const sel = document.getElementById('planAnalysisSkillSelect');
  if (sel) {
    const cur = sel.value;
    sel.innerHTML = '<option value="">Выберите навык для детального графика</option>' +
      skills.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
    if (cur) sel.value = cur;
    if (!sel.value) {
      const preferred = appState.ui?.preferredPlanAnalysisSkill;
      if (preferred && skills.some(p => p.name === preferred)) sel.value = preferred;
      if (!sel.value && sel.options.length > 1) sel.selectedIndex = 1;
    }
  }
  // Текущий vs целевой
  const lvCtx = document.getElementById('planAnalysisLevelsChart')?.getContext('2d');
  if (lvCtx) {
    const labels = skills.map(p => p.name.length > 24 ? p.name.slice(0,24) + '…' : p.name);
    const current = skills.map(p => p.currentLevel || 0);
    const target = skills.map(p => p.targetLevel || 0);
    window.__planAnalysisLevels && window.__planAnalysisLevels.destroy?.();
    window.__planAnalysisLevels = new Chart(lvCtx, {
      type: 'bar',
      data: { labels, datasets: [
        { label: 'Текущий', data: current, backgroundColor: '#93c5fd' },
        { label: 'Целевой', data: target, backgroundColor: '#99f6e4' }
      ]},
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, max: 4 } } }
    });
  }
  // Топ по приросту
  const tgCtx = document.getElementById('planAnalysisTopGrowth')?.getContext('2d');
  if (tgCtx) {
    const diffs = skills.map(p => ({ name: p.name, diff: (p.targetLevel || 0) - (p.currentLevel || 0) }));
    const top = diffs.sort((a,b) => b.diff - a.diff).slice(0, 10);
    window.__planAnalysisTop && window.__planAnalysisTop.destroy?.();
    window.__planAnalysisTop = new Chart(tgCtx, {
      type: 'bar',
      data: { labels: top.map(x => x.name), datasets: [{ label: 'Прирост', data: top.map(x => x.diff), backgroundColor: '#93c5fd' }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });
  }
  // Кривая по выбранному навыку — простая линейка от current к target с равными шагами по числу задач
  const curveCtx = document.getElementById('planAnalysisSkillCurve')?.getContext('2d');
  if (curveCtx) {
    const name = sel?.value;
    const plan = skills.find(p => p.name === name) || skills[0];
    if (name) { appState.ui = appState.ui || {}; appState.ui.preferredPlanAnalysisSkill = name; saveToLocalStorage(); }
    const labels = ['Start', 'Plan'];
    const data = plan ? [plan.currentLevel || 0, plan.targetLevel || 0] : [];
    window.__planAnalysisCurve && window.__planAnalysisCurve.destroy?.();
    window.__planAnalysisCurve = new Chart(curveCtx, {
      type: 'line',
      data: { labels, datasets: [{ label: plan ? plan.name : 'Навык', data, borderColor: '#99f6e4', backgroundColor: 'rgba(153, 246, 228, 0.35)', fill: true, tension: 0.25 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, max: 4 } } }
    });
  }
}

function handleAnalysisCsvLoad(ev) {
  const file = ev.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      analysisData = parseAnalysisCsv(String(reader.result || ''));
      populateAnalysisSkillSelect();
      renderAnalysis();
    } catch (e) {
      console.error('Ошибка анализа CSV:', e);
      alert('Не удалось разобрать CSV для анализа. Проверьте формат.');
    }
  };
  reader.readAsText(file);
}

function parseAnalysisCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  // Ищем строку с датами: начинается с "Скилл"
  const headerIdx = lines.findIndex(l => /Скилл|Skill/i.test(l));
  if (headerIdx < 0) throw new Error('Не найдена строка заголовка с датами');
  const header = csvSplit(lines[headerIdx]).map(s => s.trim());
  const dates = header.slice(1); // после первого столбца
  const skills = {};
  for (let i = headerIdx + 1; i < lines.length; i += 1) {
    const cols = csvSplit(lines[i]);
    if (cols.length < 2) continue;
    const name = cols[0].trim();
    if (!name) continue;
    const levels = cols.slice(1).map(v => parseFloat(v.replace(',', '.')) || 0);
    skills[name] = levels;
  }
  return { dates, skills };
}

function csvSplit(raw) {
  const cols = [];
  let cur = '';
  let inQ = false;
  for (let j = 0; j < raw.length; j += 1) {
    const ch = raw[j];
    if (ch === '"') { inQ = !inQ; cur += ch; continue; }
    if (ch === ',' && !inQ) { cols.push(cur.replace(/^\s*"|"\s*$/g,'').replace(/""/g,'"')); cur = ''; continue; }
    cur += ch;
  }
  cols.push(cur.replace(/^\s*"|"\s*$/g,'').replace(/""/g,'"'));
  return cols;
}

function populateAnalysisSkillSelect() {
  const sel = document.getElementById('analysisSkillSelect');
  if (!sel || !analysisData) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">Выберите навык для детального графика</option>' +
    Object.keys(analysisData.skills).map(n => `<option value="${n}">${n}</option>`).join('');
  if (cur && analysisData.skills[cur]) sel.value = cur;
  // Предвыбор по сохранённому UI состоянию или первый навык
  if (!sel.value) {
    const preferred = appState.ui?.preferredAnalysisSkill;
    if (preferred && analysisData.skills[preferred]) sel.value = preferred;
    if (!sel.value) sel.selectedIndex = sel.options.length > 1 ? 1 : 0;
  }
}

let analysisAvgChart, analysisTopChart, analysisSkillChart;
function renderAnalysisAvg() {
  if (!analysisData) return;
  const ctx = document.getElementById('analysisAvgChart')?.getContext('2d');
  if (!ctx) return;
  // Среднее по каждой дате
  const means = analysisData.dates.map((_, idx) => {
    let sum = 0, cnt = 0;
    Object.values(analysisData.skills).forEach(levels => { if (typeof levels[idx] === 'number') { sum += levels[idx]; cnt += 1; } });
    return cnt ? sum / cnt : 0;
  });
  analysisAvgChart && analysisAvgChart.destroy?.();
  analysisAvgChart = new Chart(ctx, {
    type: 'line',
    data: { labels: analysisData.dates, datasets: [{ label: 'Средний уровень', data: means, borderColor: '#93c5fd', backgroundColor: 'rgba(191, 219, 254, 0.35)', fill: true, tension: 0.25 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
  });
}

function renderAnalysisTopImproved() {
  if (!analysisData) return;
  const ctx = document.getElementById('analysisTopImproved')?.getContext('2d');
  if (!ctx) return;
  // Разница между последней и первой датой
  const diffs = Object.entries(analysisData.skills).map(([name, levels]) => ({ name, diff: (levels.at(-1) || 0) - (levels[0] || 0) }));
  const top = diffs.sort((a,b) => b.diff - a.diff).slice(0, 10);
  analysisTopChart && analysisTopChart.destroy?.();
  analysisTopChart = new Chart(ctx, {
    type: 'bar',
    data: { labels: top.map(x => x.name), datasets: [{ label: 'Прирост уровня', data: top.map(x => x.diff), backgroundColor: '#93c5fd' }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
  });
}

function renderAnalysisSkill() {
  if (!analysisData) return;
  const sel = document.getElementById('analysisSkillSelect');
  const name = sel?.value;
  if (name) { appState.ui = appState.ui || {}; appState.ui.preferredAnalysisSkill = name; saveToLocalStorage(); }
  const ctx = document.getElementById('analysisSkillChart')?.getContext('2d');
  if (!ctx) return;
  analysisSkillChart && analysisSkillChart.destroy?.();
  if (!name || !analysisData.skills[name]) {
    analysisSkillChart = new Chart(ctx, { type: 'line', data: { labels: [], datasets: [] }, options: { responsive: true, maintainAspectRatio: false } });
    return;
  }
  const levels = analysisData.skills[name];
  analysisSkillChart = new Chart(ctx, {
    type: 'line',
    data: { labels: analysisData.dates, datasets: [{ label: name, data: levels, borderColor: '#99f6e4', backgroundColor: 'rgba(153, 246, 228, 0.35)', fill: true, tension: 0.3 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, suggestedMax: 4 } } }
  });
}

function renderProgressCharts() {
  // Очищаем старые графики
  Chart.getChart('overallProgressChart')?.destroy();
  Chart.getChart('categoryProgressChart')?.destroy();
  
  // Общий прогресс: 3 статуса — Выполнено / В работе / Осталось
  const overallCtx = document.getElementById('overallProgressChart')?.getContext('2d');
  if (overallCtx) {
    const aggregate = Object.values(appState.progress).reduce((acc, skill) => {
      (skill.activities || []).forEach(a => {
        if (a.completed || a.status === 'done' || a.status === 'cancelled') acc.done += 1;
        else if (a.status === 'doing' || a.status === 'blocked') acc.doing += 1;
        else acc.planned += 1;
      });
      return acc;
    }, { done: 0, doing: 0, planned: 0 });
    
    new Chart(overallCtx, {
      type: 'doughnut',
      data: {
        labels: ['Выполнено', 'В работе', 'Осталось'],
        datasets: [{
          data: [aggregate.done, aggregate.doing, aggregate.planned],
          // Пастельные цвета: зелёный / жёлтый / синий
          backgroundColor: ['#bbf7d0', '#fde68a', '#bfdbfe'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom' }
        }
      }
    });
  }
  
  // Прогресс по категориям
  const categoryCtx = document.getElementById('categoryProgressChart')?.getContext('2d');
  if (categoryCtx) {
    const perSkill = Object.entries(appState.progress)
      // Исключаем "связанные" плейсхолдеры без собственных задач
      .filter(([_, skill]) => (skill.activities || []).length > 0)
      .map(([skillId, skill]) => {
      const total = (skill.activities || []).length;
      const done = (skill.activities || []).filter(a => a.completed || a.status === 'done' || a.status === 'cancelled').length;
      const doing = (skill.activities || []).filter(a => !a.completed && (a.status === 'doing' || a.status === 'blocked')).length;
      const planned = Math.max(0, total - done - doing);
      const label = skill.name.length > 20 ? skill.name.substring(0, 20) + '...' : skill.name;
      const toPct = (n) => total > 0 ? (n / total) * 100 : 0;
      return { label, done: toPct(done), doing: toPct(doing), planned: toPct(planned) };
    });
    
    new Chart(categoryCtx, {
      type: 'bar',
      data: {
        labels: perSkill.map(d => d.label),
        datasets: [
          { label: 'Выполнено', data: perSkill.map(d => d.done), backgroundColor: '#bbf7d0', stack: 'status' },
          { label: 'В работе', data: perSkill.map(d => d.doing), backgroundColor: '#fde68a', stack: 'status' },
          { label: 'Осталось', data: perSkill.map(d => d.planned), backgroundColor: '#bfdbfe', stack: 'status' }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { stacked: true },
          y: { stacked: true, beginAtZero: true, max: 100 }
        },
        plugins: {
          legend: { position: 'bottom' }
        }
      }
    });
  }
}

function renderProgressTracking() {
  const progressTracking = document.getElementById('progressTracking');
  if (!progressTracking) return;

  // детектор: навык используется только как связанный (нет своих задач), но встречается в relatedSkills других
  const isRelatedOnlySkill = (skillId) => {
    const plan = appState.progress?.[skillId];
    const hasOwn = (plan?.activities || []).length > 0;
    if (hasOwn) return false;
    let referenced = false;
    Object.entries(appState.progress || {}).forEach(([primaryId, p]) => {
      if (referenced) return;
      (p.activities || []).forEach(a => {
        if (Array.isArray(a.relatedSkills) && a.relatedSkills.includes(skillId)) referenced = true;
      });
    });
    return referenced;
  };
  
  const ordered = Object.entries(appState.progress || {})
    .map(([skillId, skill], idx) => ({ skillId, skill, idx, hasTasks: (skill?.activities || []).length > 0 }))
    .sort((a, b) => {
      if (a.hasTasks !== b.hasTasks) return a.hasTasks ? -1 : 1; // с задачами выше
      return a.idx - b.idx;
    });

  const hideDoneInList = !!(appState.ui && appState.ui.hideDoneInList);
  const controlsHtml = `
    <div class="progress-list-controls" style="display:flex; justify-content:flex-end; margin-bottom:8px;">
      <label class="checkbox" style="gap:8px; cursor:pointer;">
        <input type="checkbox" id="hideDoneTasksCheckbox" ${hideDoneInList ? 'checked' : ''} />
        <span>Не отображать сделанные</span>
      </label>
    </div>
  `;

  // optionally hide fully completed skills
  const filteredOrdered = hideDoneInList
    ? ordered.filter(({ skillId, skill }) => {
        const relatedOnly = isRelatedOnlySkill(skillId);
        const isAllDone = relatedOnly || (skill.activities.length > 0 && skill.activities.every(a => (getActivityCompletionRatio(a) >= 1)));
        return !isAllDone;
      })
    : ordered;

  // Собираем все задачи из всех навыков
  const allActivities = [];
  filteredOrdered.forEach(({ skillId, skill }) => {
    const relatedOnly = isRelatedOnlySkill(skillId);
    if (!relatedOnly) {
      skill.activities.forEach((activity, index) => {
        if (!hideDoneInList || !((getActivityCompletionRatio(activity) >= 1) || activity.status === 'done' || activity.status === 'cancelled')) {
          allActivities.push({
            skillId,
            skillName: skill.name,
            activity,
            originalIndex: index
          });
        }
      });
    }
  });

  // Сортируем все задачи согласно настройкам
  const settings = appState.sortSettings || { by: 'priority', direction: 'desc', crossSkills: true };
  
  if (settings.crossSkills) {
    // Сквозная сортировка всех задач
    sortTasks(allActivities);
  }

  // Группируем отсортированные задачи обратно по навыкам
  const groupedBySkill = {};
  
  if (settings.crossSkills) {
    // При сквозной сортировке сохраняем общий порядок
    allActivities.forEach(item => {
      if (!groupedBySkill[item.skillId]) {
        groupedBySkill[item.skillId] = {
          skillName: item.skillName,
          activities: []
        };
      }
      groupedBySkill[item.skillId].activities.push(item);
    });
  } else {
    // При сортировке внутри навыков сначала группируем, потом сортируем
    allActivities.forEach(item => {
      if (!groupedBySkill[item.skillId]) {
        groupedBySkill[item.skillId] = {
          skillName: item.skillName,
          activities: []
        };
      }
      groupedBySkill[item.skillId].activities.push(item);
    });
    // Сортируем внутри каждой группы
    Object.keys(groupedBySkill).forEach(skillId => {
      groupedBySkill[skillId].activities = sortTasks(groupedBySkill[skillId].activities);
    });
  }

  // Генерируем HTML для отсортированных задач
  const sortedSkillsHtml = Object.entries(groupedBySkill).map(([skillId, data]) => {
    const skill = filteredOrdered.find(s => s.skillId === skillId)?.skill;
    if (!skill) return '';

    const progressPercentage = Math.round(skill.overallProgress || 0);
    const allDone = skill.activities.length > 0 && skill.activities.every(a => (getActivityCompletionRatio(a) >= 1));
    const collapsed = !!(appState.ui && appState.ui.collapsedSkills && appState.ui.collapsedSkills[skillId]);
    
    return `
      <div class="progress-skill ${allDone ? 'bg-success' : 'progress-skill--remaining'}" data-skill-id="${skillId}">
        <div class="progress-skill-header">
          <h3 class="progress-skill-title">${data.skillName}</h3>
          <div style="display:flex; align-items:center; gap:8px;">
            <button type="button" class="btn btn--outline btn--sm progress-skill-toggle" data-skill-id="${skillId}" title="${collapsed ? 'Развернуть' : 'Свернуть'}">${collapsed ? '▸' : '▾'}</button>
          <span class="text-primary font-bold">${Math.round(progressPercentage)}%</span>
          </div>
        </div>
        <div class="skill-progress-bar">
          <div class="skill-progress-fill" style="width: ${progressPercentage}%"></div>
        </div>
        ${!collapsed ? `
        <div class="progress-activities">
          ${data.activities.map(({ activity, originalIndex: index }) => `
            <div class="progress-activity ${(getActivityCompletionRatio(activity) >= 1 || activity.status === 'done' || activity.status === 'cancelled') ? 'activity-completed activity-collapsed' : ''}">
              ${activity.priority ? `<span class="priority-badge ${activity.priority} ${(getActivityCompletionRatio(activity) >= 1 || activity.status === 'done' || activity.status === 'cancelled') ? 'muted' : ''} priority-badge-corner">${activity.priority === 'urgent' ? 'Срочный' : activity.priority === 'high' ? 'Высокий' : activity.priority === 'medium' ? 'Средний' : 'Низкий'}</span>` : ''}
              <div class="activity-checkbox-container">
                <input type="checkbox" class="activity-checkbox" 
                       ${activity.completed ? 'checked' : ''}
                       onchange="toggleActivity('${skillId}', ${index})">
                <div class="activity-info">
                  <h4 class="activity-name">${activity.name}</h4>
                  ${activity.description ? `<div class=\"activity-desc\">${linkify(activity.description)}</div>` : ''}
                  ${activity.expectedResult ? `<div class=\"activity-expected\"><strong>Ожидаемый результат:</strong> ${linkify(activity.expectedResult)}</strong></div>` : ''}
                  ${(activity.relatedSkills && activity.relatedSkills.length) ? `<div class=\"activity-related\">Связанные навыки: ${activity.relatedSkills.map(id => `<span class=\"tag\" title=\"${getPlanSkillName(id)}\">${getPlanSkillName(id)}</span>`).join(' ')}</div>` : ''}
                  <div class=\"activity-meta\">
                    <span>Уровень ${activity.level}</span>
                    <span>~${activity.duration} нед.</span>
                  </div>
                   ${Array.isArray(activity.subtasks) && activity.subtasks.length ? (() => {
                    const stats = computeSubtasksStats(activity);
                    const pct = Math.round((stats.done / Math.max(1, stats.total)) * 100);
                    return `
                       <div class=\"activity-meta\" style=\"margin-top:6px; display:flex; gap:8px; align-items:center;\">
                        <span>Подзадачи: ${stats.done}/${stats.total}</span>
                        <div class=\"skill-progress-bar\" style=\"flex:1; height:6px;\">
                          <div class=\"skill-progress-fill\" style=\"width:${pct}%\"></div>
                        </div>
                      </div>
                       <div class=\"subtasks-list\" style=\"margin-top:8px; display:grid; gap:6px;\">
                        ${activity.subtasks.map((s, i) => `
                          <label class=\"checkbox\" style=\"align-items:center; gap:8px;\">
                            <input type=\"checkbox\" ${s.done ? 'checked' : ''} onchange=\"toggleSubtask('${skillId}', ${index}, ${i})\" />
                            <span>${escapeHtml(s.title || 'Подзадача')}</span>
                          </label>
                        `).join('')}
                      </div>
                    `;
                  })() : ''}
              <div class=\"activity-actions\" style=\"margin:6px 0 0; display:flex; gap:6px; align-items:center; flex-wrap:wrap;\">
                    <button class=\"btn btn--outline btn--sm\" onclick=\"openTaskEdit('${skillId}', ${index})\">Редактировать</button>
                    <button class=\"btn btn--outline btn--sm\" style=\"margin-left:6px;\" onclick=\"progressParseDescToSubtasks('${skillId}', ${index})\">Сделать из описания подзадачи</button>
                  </div>
                  
                  <textarea class="form-control activity-comment" 
                           placeholder="Комментарии к выполнению..."
                           onchange="updateActivityComment('${skillId}', ${index}, this.value)"
                           oninput="document.getElementById('activityCommentPreview-${skillId}-${index}').innerHTML = linkifyLinksOnly(this.value)">${activity.comment}</textarea>
                  <div class="activity-comment-preview" id="activityCommentPreview-${skillId}-${index}">${activity.comment ? linkifyLinksOnly(activity.comment) : ''}</div>
                </div>
              </div>
            </div>
          `).join('')}
        </div>` : ''}
        </div>
    `;
  }).join('');

  // Добавляем навыки без задач (related-only навыки)
  const relatedOnlySkillsHtml = filteredOrdered
    .filter(({ skillId }) => isRelatedOnlySkill(skillId))
    .map(({ skillId, skill }) => {
      const progressPercentage = 100;
      const collapsed = !!(appState.ui && appState.ui.collapsedSkills && appState.ui.collapsedSkills[skillId]);
      
      return `
        <div class="progress-skill bg-success" data-skill-id="${skillId}">
          <div class="progress-skill-header">
            <h3 class="progress-skill-title">${skill.name}</h3>
            <div style="display:flex; align-items:center; gap:8px;">
              <button type="button" class="btn btn--outline btn--sm progress-skill-toggle" data-skill-id="${skillId}" title="${collapsed ? 'Развернуть' : 'Свернуть'}">${collapsed ? '▸' : '▾'}</button>
            <span class="text-primary font-bold">${Math.round(progressPercentage)}%</span>
            </div>
          </div>
          <div class="skill-progress-bar">
            <div class="skill-progress-fill" style="width: ${progressPercentage}%"></div>
          </div>
        </div>
      `;
    }).join('');

  progressTracking.innerHTML = controlsHtml + sortedSkillsHtml + relatedOnlySkillsHtml;

  // навесим обработчики на тогглеры
  progressTracking.querySelectorAll('.progress-skill-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-skill-id');
      if (!appState.ui) appState.ui = {};
      if (!appState.ui.collapsedSkills) appState.ui.collapsedSkills = {};
      appState.ui.collapsedSkills[id] = !appState.ui.collapsedSkills[id];
      try { saveToLocalStorage(); } catch (_) {}
      renderProgressTracking();
    });
  });

  // обработчик чекбокса "Не отображать сделанные"
  const hideCb = progressTracking.querySelector('#hideDoneTasksCheckbox');
  if (hideCb) {
    hideCb.addEventListener('change', () => {
      if (!appState.ui) appState.ui = {};
      appState.ui.hideDoneInList = !!hideCb.checked;
      try { saveToLocalStorage(); } catch (_) {}
      renderProgressTracking();
    });
  }

  // снято редактирование связанных навыков в режиме списка
}

// Преобразовать описание в подзадачи из режима Списка
window.progressParseDescToSubtasks = function(skillId, index) {
  const act = appState.progress?.[skillId]?.activities?.[index];
  if (!act) return;
  const items = parseChecklistToSubtasks(act.description || '');
  if (!items || items.length === 0) {
    alert('В описании не найден чек‑лист (строки, начинающиеся с -, *, 1., [ ] ...)');
    return;
  }
  act.subtasks = items;
  rollupActivityFromSubtasks(act);
  saveToLocalStorage();
  try { syncProgressTaskToPlan(skillId, index); } catch (_) {}
  recomputeAllProgress();
  renderProgress();
  try { autoCloudSaveDebounced('parse-desc-subtasks-list'); } catch (_) {}
};

function renderProgressKanban() {
  const mount = document.getElementById('progressKanban');
  if (!mount) return;

  const lanes = [
    { key: 'planned', title: 'Запланировано' },
    { key: 'doing', title: 'В работе' },
    { key: 'blocked', title: 'Заблокировано' },
    { key: 'done', title: 'Сделано' },
    { key: 'cancelled', title: 'Отменено' }
  ];

  // Собираем все задачи из всех навыков
  const allCards = [];
  Object.entries(appState.progress).forEach(([skillId, skill]) => {
    (skill.activities || []).forEach((a, idx) => {
      allCards.push({ skillId, index: idx, activity: a, skillName: skill.name });
    });
  });

  const laneHtml = (laneKey, laneTitle) => {
    const cards = allCards.filter(c => (c.activity.status || 'planned') === laneKey);
    
    const settings = appState.sortSettings || { by: 'priority', direction: 'desc', crossSkills: true };
    let byEpic = {};
    
    if (settings.crossSkills) {
      // Сквозная сортировка: сначала сортируем все карточки
      const sortedCards = sortTasks(cards);
      // Затем группируем по навыку (эпик), сохраняя порядок сортировки
      sortedCards.forEach(c => {
        if (!byEpic[c.skillId]) byEpic[c.skillId] = { name: c.skillName, items: [] };
        byEpic[c.skillId].items.push(c);
      });
    } else {
      // Сортировка внутри каждого навыка: сначала группируем, потом сортируем
      cards.forEach(c => {
        if (!byEpic[c.skillId]) byEpic[c.skillId] = { name: c.skillName, items: [] };
        byEpic[c.skillId].items.push(c);
      });
      // Сортируем внутри каждой группы
      Object.keys(byEpic).forEach(skillId => {
        byEpic[skillId].items = sortTasks(byEpic[skillId].items);
      });
    }
    const groupsHtml = Object.entries(byEpic).map(([skillId, grp]) => {
      const itemsHtml = grp.items.map(c => {
        const prio = c.activity.priority || '';
        const isCompleted = (c.activity.status === 'done' || c.activity.status === 'cancelled');
        const prClass = (!isCompleted && prio) ? ` priority-${prio}` : '';
        const prBadge = prio ? `<div class=\"meta\"><span class=\"priority-badge ${prio}${isCompleted ? ' muted' : ''}\">${prio === 'urgent' ? 'Срочный' : prio === 'high' ? 'Высокий' : prio === 'medium' ? 'Средний' : 'Низкий'}</span></div>` : '';
        return `
        <div class=\"kanban-card${prClass}${isCompleted ? ' kanban-card--completed' : ''}\" draggable=\"true\" data-skill-id=\"${c.skillId}\" data-idx=\"${c.index}\"> 
          <div class=\"title\">${c.activity.name}</div>
          ${prBadge}
        </div>`;
      }).join('');
      return `
        <div class="kanban-epic">
          <div class="kanban-epic-header">${grp.name}</div>
          <div class="kanban-epic-list">${itemsHtml}</div>
      </div>
    `;
  }).join('');
    return `
      <div class="kanban-section">
        ${laneTitle ? '<h4>' + laneTitle + '</h4>' : ''}
        <div class="kanban-dropzone" data-lane="${laneKey}">${groupsHtml}</div>
      </div>
    `;
  };

  // Трёхколоночная доска: [Запланировано] | [В работе / Заблокировано] | [Сделано / Отменено]
  mount.innerHTML = `
    <div class="kanban-column" data-col="planned">
      <h4>Запланировано</h4>
      ${laneHtml('planned', '')}
    </div>
    <div class="kanban-column" data-col="doing">
      ${laneHtml('doing', 'В работе')}
      ${laneHtml('blocked', 'Заблокировано')}
    </div>
    <div class="kanban-column" data-col="done">
      ${laneHtml('done', 'Сделано')}
      ${laneHtml('cancelled', 'Отменено')}
    </div>
  `;

  // DnD behavior
  const cardsEls = mount.querySelectorAll('.kanban-card');
  cardsEls.forEach(card => {
    // click to open modal
    card.addEventListener('click', () => {
      const skillId = card.getAttribute('data-skill-id');
      const index = parseInt(card.getAttribute('data-idx'));
      openKanbanTaskModal(skillId, index);
    });
    card.addEventListener('dragstart', (e) => {
      card.classList.add('dragging');
      e.dataTransfer.setData('text/plain', JSON.stringify({
        skillId: card.getAttribute('data-skill-id'),
        index: parseInt(card.getAttribute('data-idx'))
      }));
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
    });
  });

  const dropzones = mount.querySelectorAll('.kanban-dropzone');
  dropzones.forEach(zone => {
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('dragover');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
      const data = e.dataTransfer.getData('text/plain');
      if (!data) return;
      try {
        const payload = JSON.parse(data);
        const toLane = zone.getAttribute('data-lane');
        const activity = appState.progress[payload.skillId]?.activities?.[payload.index];
        if (!activity) return;
        // Явное ручное перемещение: уважаем статус пользователя
        if (toLane === 'done' || toLane === 'cancelled') {
          // Перенесли в завершённые — допускаем автозавершение подзадач
          if (Array.isArray(activity.subtasks) && activity.subtasks.length > 0) {
            activity.subtasks.forEach(s => { s.done = true; });
          }
          activity.status = toLane;
          activity.completed = true;
        } else {
          // Перенесли в planned/doing/blocked — не трогаем подзадачи и не руллапим
          activity.status = toLane;
          activity.completed = false;
        }
        saveToLocalStorage();
        recomputeAllProgress();
        renderProgress();
        try { autoCloudSaveDebounced('kanban-drop'); } catch (_) {}
      } catch (_) {}
    });
  });
}

// Универсальная функция для сортировки задач
function sortTasks(tasks, sortBy = null, direction = null) {
  if (!tasks || tasks.length === 0) return tasks;
  
  const settings = appState.sortSettings || { by: 'priority', direction: 'desc', crossSkills: true };
  const sortCriteria = sortBy || settings.by;
  const sortDirection = direction || settings.direction;
  
  if (sortCriteria === 'none') return tasks;
  
  return tasks.sort((a, b) => {
    const activityA = a.activity || a;
    const activityB = b.activity || b;
    
    let compareValue = 0;
    
    switch (sortCriteria) {
      case 'priority': {
        const priorityOrder = { 'urgent': 0, 'high': 1, 'medium': 2, 'low': 3, '': 4 };
        const aPriority = activityA.priority || '';
        const bPriority = activityB.priority || '';
        const aOrder = priorityOrder[aPriority] !== undefined ? priorityOrder[aPriority] : 4;
        const bOrder = priorityOrder[bPriority] !== undefined ? priorityOrder[bPriority] : 4;
        compareValue = aOrder - bOrder;
        break;
      }
      case 'name': {
        const aName = (activityA.name || '').toLowerCase();
        const bName = (activityB.name || '').toLowerCase();
        compareValue = aName.localeCompare(bName);
        break;
      }
      case 'level': {
        const aLevel = activityA.level || 0;
        const bLevel = activityB.level || 0;
        compareValue = aLevel - bLevel;
        break;
      }
      case 'duration': {
        const aDuration = activityA.duration || 0;
        const bDuration = activityB.duration || 0;
        compareValue = aDuration - bDuration;
        break;
      }
      default:
        compareValue = 0;
    }
    
    // Для направления 'asc' (по возрастанию) инвертируем результат для priority, чтобы он работал логично
    if (sortDirection === 'asc' && sortCriteria !== 'priority') {
      return compareValue;
    } else if (sortDirection === 'asc' && sortCriteria === 'priority') {
      return -compareValue; // инвертируем для приоритета
    } else {
      return sortCriteria === 'priority' ? compareValue : -compareValue;
    }
  });
}

// Функция для сортировки задач по приоритету (для обратной совместимости)
function sortByPriority(tasks) {
  return sortTasks(tasks, 'priority', 'desc');
}

function getEpicColors(skillId) {
  const id = String(skillId || 'x');
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return {
    accent: `hsl(${hue}, 70%, 45%)`,
    bg: `hsla(${hue}, 80%, 85%, 0.5)`
  };
}

// Kanban task modal logic
function openKanbanTaskModal(skillId, index) {
  const modal = document.getElementById('kanbanTaskModal');
  if (!modal) return;
  const activity = appState.progress?.[skillId]?.activities?.[index];
  if (!activity) return;

  modal.dataset.skillId = skillId;
  modal.dataset.index = String(index);
  document.getElementById('kanbanTaskTitle').value = activity.name || '';
  document.getElementById('kanbanTaskDesc').value = activity.description || '';
  document.getElementById('kanbanTaskExpected').value = activity.expectedResult || '';
  document.getElementById('kanbanTaskComment').value = activity.comment || '';
  const descPrev = document.getElementById('kanbanTaskDescPreview');
  const expPrev = document.getElementById('kanbanTaskExpectedPreview');
  const comPrev = document.getElementById('kanbanTaskCommentPreview');
  if (descPrev) descPrev.innerHTML = activity.description ? linkifyLinksOnly(activity.description) : '';
  if (expPrev) expPrev.innerHTML = activity.expectedResult ? linkifyLinksOnly(activity.expectedResult) : '';
  if (comPrev) comPrev.innerHTML = activity.comment ? linkifyLinksOnly(activity.comment) : '';
  const dur = document.getElementById('kanbanTaskDuration');
  if (dur) dur.value = activity.duration || 1;
  const prioSel = document.getElementById('kanbanTaskPriority');
  if (prioSel) prioSel.value = activity.priority || '';
  const relatedWrap = document.getElementById('kanbanTaskRelated');
  if (relatedWrap) {
    const rel = activity.relatedSkills || [];
    relatedWrap.innerHTML = rel.length ? rel.map(id => `<span class=\"tag\" title=\"${getPlanSkillName(id)}\">${getPlanSkillName(id)}</span>`).join(' ') : '<span class="text-secondary">Нет</span>';
  }

  // View/Edit mode wiring
  const viewMount = document.getElementById('kanbanTaskViewSection');
  const editWrap = document.getElementById('kanbanTaskEditSection');
  const saveBtn = document.getElementById('saveKanbanTaskBtn');
  const editBtn = document.getElementById('editKanbanTaskBtn');
  if (viewMount && editWrap && saveBtn && editBtn) {
    viewMount.innerHTML = `
      <div class="progress-activity">
        <div class="activity-info">
          <h4 class="activity-name">${escapeHtml(activity.name || '')}</h4>
          ${activity.description ? `<div class=\"activity-desc\">${linkify(activity.description)}</div>` : ''}
          ${activity.expectedResult ? `<div class=\"activity-expected\"><strong>Ожидаемый результат:</strong> ${linkify(activity.expectedResult)}</div>` : ''}
          ${(activity.relatedSkills && activity.relatedSkills.length) ? `<div class=\"activity-related\">Связанные навыки: ${activity.relatedSkills.map(id => `<span class=\"tag\" title=\"${getPlanSkillName(id)}\">${getPlanSkillName(id)}</span>`).join(' ')}</div>` : ''}
          <div class=\"activity-meta\">
            <span>Уровень ${activity.level}</span>
            <span>~${activity.duration} нед.</span>
            ${activity.priority ? `<span class=\\\"priority-badge ${activity.priority}\\\" title=\\\"Текущий приоритет\\\">${activity.priority === 'urgent' ? 'Срочный' : activity.priority === 'high' ? 'Высокий' : activity.priority === 'medium' ? 'Средний' : 'Низкий'}</span>` : ''}
          </div>
          <div style=\"margin:6px 0; display:flex; gap:8px; align-items:center; flex-wrap:wrap;\">
            <button class=\"btn btn--outline btn--sm\" id=\"btnParseDescToSubtasks\">Сделать из описания подзадачи</button>
            <select id=\"kanbanTaskPriorityView\" class=\"form-control\" style=\"max-width: 180px; height:28px; padding:2px 6px; font-size:12px;\">
              <option value=\"\">Нет приоритета</option>
              <option value=\"urgent\" ${activity.priority==='urgent' ? 'selected' : ''}>Срочный</option>
              <option value=\"high\" ${activity.priority==='high' ? 'selected' : ''}>Высокий</option>
              <option value=\"medium\" ${activity.priority==='medium' ? 'selected' : ''}>Средний</option>
              <option value=\"low\" ${activity.priority==='low' ? 'selected' : ''}>Низкий</option>
            </select>
          </div>
          ${Array.isArray(activity.subtasks) && activity.subtasks.length ? (() => {
            const stats = computeSubtasksStats(activity);
            const pct = Math.round((stats.done / Math.max(1, stats.total)) * 100);
            return `
              <div class="activity-meta" style="margin-top:6px; display:flex; gap:8px; align-items:center;">
                <span>Подзадачи: ${stats.done}/${stats.total}</span>
                <div class="skill-progress-bar" style="flex:1; height:6px;">
                  <div class="skill-progress-fill" style="width:${pct}%"></div>
                </div>
              </div>
              <div style="margin-top:8px; display:grid; gap:6px;">
                ${activity.subtasks.map((s, i) => `
                  <div class=\"card subtask-card\" style=\"padding:6px; display:grid; gap:4px;\">
                    <label class=\"checkbox\" style=\"align-items:center; gap:8px;\">
                      <input type=\"checkbox\" ${s.done ? 'checked' : ''} onchange=\"toggleSubtask('${skillId}', ${index}, ${i})\" />
                      <span>${escapeHtml(s.title || 'Подзадача')}</span>
                    </label>
                    ${s.description ? `<div class=\\"activity-desc\\">${linkify(s.description)}</div>` : ''}
                    ${s.expectedResult ? `<div class=\\"activity-expected\\"><strong>Ожидаемый результат:</strong> ${linkify(s.expectedResult)}</div>` : ''}
                  </div>
                `).join('')}
              </div>
            `;
          })() : ''}
          <div style="margin-top:8px; display:flex; gap:6px; align-items:flex-start;">
            <input id="kanbanQuickComment" class="form-control" placeholder="Быстрый комментарий" style="flex:1;" />
            <button class="btn btn--primary" id="kanbanQuickCommentBtn">Добавить</button>
          </div>
          <div id="kanbanQuickCommentStatus" class="status status--success" style="display:none; margin-top:6px;">Комментарий сохранён</div>
          <div id="kanbanTaskCommentsList" style="margin-top:6px; display:grid; gap:6px;"></div>
        </div>
      </div>`;
    // default to view
    viewMount.style.display = 'block';
    editWrap.style.display = 'none';
    saveBtn.style.display = 'none';
    editBtn.style.display = 'inline-flex';
    // Render existing comments history
    const listEl = document.getElementById('kanbanTaskCommentsList');
    const ensureCommentsArray = () => {
      if (!Array.isArray(activity.comments)) {
        activity.comments = [];
        if (activity.comment && String(activity.comment).trim().length > 0) {
          activity.comments.push({ text: activity.comment, at: activity.commentAt || Date.now() });
        }
      }
    };
    const renderComments = () => {
      if (!listEl) return;
      ensureCommentsArray();
      const comments = activity.comments.slice().sort((a,b) => (b.at||0) - (a.at||0));
      listEl.innerHTML = comments.map(c => {
        const dt = new Date(c.at || Date.now()).toLocaleString();
        return `<div class="card" style="padding:8px; display:flex; gap:8px; justify-content:space-between; align-items:flex-start;">
                  <div style="min-width:0;">
                    <div style="font-size:12px; color:var(--color-text-secondary); margin-bottom:4px;">${dt}${c.edited ? ' (изменено)' : ''}</div>
                    <div class="activity-desc">${linkify(c.text || '')}</div>
                  </div>
                  <div style="display:flex; gap:6px;">
                    <button class="btn btn--outline btn--xs" data-edit-comment-at="${c.at}" title="Редактировать">✏️</button>
                    <button class="btn btn--outline btn--xs" data-del-comment-at="${c.at}" title="Удалить">🗑️</button>
                  </div>
                </div>`;
      }).join('');
      // bind deletes
      listEl.querySelectorAll('[data-del-comment-at]').forEach(btn => {
        btn.addEventListener('click', () => {
          const at = parseInt(btn.getAttribute('data-del-comment-at'));
          ensureCommentsArray();
          activity.comments = (activity.comments || []).filter(c => c.at !== at);
          // если удалили «актуальный» одиночный комментарий — обновим legacy поля
          if (activity.commentAt === at) {
            const latest = activity.comments.slice().sort((a,b) => (b.at||0)-(a.at||0))[0];
            activity.comment = latest ? latest.text : '';
            activity.commentAt = latest ? latest.at : undefined;
          }
          saveToLocalStorage();
          try { syncProgressTaskToPlan(skillId, index); } catch(_) {}
          renderComments();
          try { autoCloudSaveDebounced('delete-comment'); } catch (_) {}
        });
      });
      // bind edits (inline editor)
      listEl.querySelectorAll('[data-edit-comment-at]').forEach(btn => {
        btn.addEventListener('click', () => {
          const at = parseInt(btn.getAttribute('data-edit-comment-at'));
          ensureCommentsArray();
          const item = (activity.comments || []).find(c => c.at === at);
          if (!item) return;
          const card = btn.closest('.card');
          if (!card) return;
          const editorHtml = `
            <div style="min-width:0; flex:1;">
              <div style="font-size:12px; color:var(--color-text-secondary); margin-bottom:4px;">${new Date(item.at||Date.now()).toLocaleString()}</div>
              <textarea class="form-control" style="min-height:72px;">${escapeHtml(item.text || '')}</textarea>
            </div>
            <div style="display:flex; flex-direction:column; gap:6px;">
              <button class="btn btn--primary btn--xs" data-save-edit="${at}">Сохранить</button>
              <button class="btn btn--outline btn--xs" data-cancel-edit="${at}">Отмена</button>
            </div>`;
          card.innerHTML = editorHtml;
          const saveBtn = card.querySelector(`[data-save-edit="${at}"]`);
          const cancelBtn = card.querySelector(`[data-cancel-edit="${at}"]`);
          const textarea = card.querySelector('textarea');
          const commitEdit = () => {
            const newText = (textarea.value || '').trim();
            const oldAt = item.at;
            item.text = newText;
            item.at = Date.now();
            item.edited = true;
            if (activity.commentAt === oldAt) {
              activity.comment = newText;
              activity.commentAt = item.at;
            }
            saveToLocalStorage();
            try { syncProgressTaskToPlan(skillId, index); } catch(_) {}
            renderComments();
            try {
              const status = document.getElementById('kanbanQuickCommentStatus');
              if (status) { status.style.display = 'block'; setTimeout(() => { status.style.display = 'none'; }, 1000); }
            } catch(_) {}
            try { autoCloudSaveDebounced('edit-comment'); } catch (_) {}
          };
          if (saveBtn) saveBtn.addEventListener('click', commitEdit);
          if (cancelBtn) cancelBtn.addEventListener('click', () => renderComments());
          if (textarea) textarea.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitEdit(); } });
        });
      });
    };
    if (listEl) renderComments();

    // Bind quick comment
    const quickBtn = document.getElementById('kanbanQuickCommentBtn');
    const quickInp = document.getElementById('kanbanQuickComment');
    if (quickBtn && quickInp) {
      const commit = () => {
        const val = (quickInp.value || '').trim();
        if (!val) return;
        // Append to history, keep legacy field for compatibility
        const act = appState.progress[skillId].activities[index];
        if (!Array.isArray(act.comments)) act.comments = [];
        const entry = { text: val, at: Date.now() };
        // newest first
        act.comments.unshift(entry);
        act.comment = val;
        act.commentAt = entry.at;
        saveToLocalStorage();
        // Обновим список комментариев (новые сверху) и статус
        try {
          renderComments();
          const status = document.getElementById('kanbanQuickCommentStatus');
          if (status) {
            status.style.display = 'block';
            setTimeout(() => { status.style.display = 'none'; }, 1200);
          }
          quickInp.value = '';
          quickBtn.disabled = true;
          setTimeout(() => { quickBtn.disabled = false; }, 400);
        } catch(_) {}
        try { syncProgressTaskToPlan(skillId, index); } catch(_) {}
        try { autoCloudSaveDebounced('quick-comment'); } catch (_) {}
      };
      quickBtn.addEventListener('click', commit);
      quickInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
    }

    // Bind priority change in view mode
    const prioView = document.getElementById('kanbanTaskPriorityView');
    if (prioView) {
      prioView.addEventListener('change', () => {
        const val = prioView.value || '';
        activity.priority = val;
        saveToLocalStorage();
        try { syncProgressTaskToPlan(skillId, index); } catch (_) {}
        renderProgress();
        refreshKanbanModalIfCurrent(skillId, index, 'view');
        try { autoCloudSaveDebounced('priority-change'); } catch (_) {}
      });
    }

    // Bind: parse description -> subtasks
    const parseBtn = document.getElementById('btnParseDescToSubtasks');
    if (parseBtn) {
      parseBtn.addEventListener('click', () => {
        const source = activity.description || '';
        const items = parseChecklistToSubtasks(source);
        if (!items || items.length === 0) {
          alert('В описании не найден чек‑лист (строки, начинающиеся с -, *, 1., [ ] ...)');
          return;
        }
        activity.subtasks = items;
        rollupActivityFromSubtasks(activity);
        saveToLocalStorage();
        try { syncProgressTaskToPlan(skillId, index); } catch (_) {}
        recomputeAllProgress();
        renderProgress();
        refreshKanbanModalIfCurrent(skillId, index, 'view');
        try { autoCloudSaveDebounced('parse-desc-subtasks'); } catch (_) {}
      });
    }
  }

  // Редактирование связей: чекбоксы по текущим навыкам плана + селект каталога
  const checksWrap = document.getElementById('kanbanTaskRelatedCheckboxes');
  const addSelect = document.getElementById('kanbanTaskRelatedAddSelect');
  const addBtn = document.getElementById('kanbanTaskRelatedAddBtn');
  if (checksWrap && addSelect && addBtn) {
    // чекбоксы по навыкам, присутствующим в плане (кроме текущего primary)
    const allPlanSkills = Object.entries(appState.progress || {}).map(([id, p]) => ({ id, name: p.name }));
    const relSet = new Set(activity.relatedSkills || []);
    checksWrap.innerHTML = `
      <details>
        <summary style="cursor:pointer;color:var(--color-text-secondary);">Связанные навыки (показать/скрыть)</summary>
        <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap:6px; margin-top:6px;">
          ${allPlanSkills
            .filter(s => s.id !== skillId)
            .map(s => `<label class="checkbox"><input type="checkbox" data-rel-id="${s.id}" ${relSet.has(s.id) ? 'checked' : ''}> <span>${s.name}</span></label>`)
            .join('')}
        </div>
      </details>`;
    checksWrap.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        const id = cb.getAttribute('data-rel-id');
        if (!Array.isArray(activity.relatedSkills)) activity.relatedSkills = [];
        if (cb.checked) {
          if (!activity.relatedSkills.includes(id)) activity.relatedSkills.push(id);
        } else {
          activity.relatedSkills = activity.relatedSkills.filter(x => x !== id);
        }
        saveToLocalStorage();
        // обновим Preview
        const rel = activity.relatedSkills || [];
        relatedWrap.innerHTML = rel.length ? rel.map(id => `<span class=\"tag\" title=\"${getPlanSkillName(id)}\">${getPlanSkillName(id)}</span>`).join(' ') : '<span class="text-secondary">Нет</span>';
        try { autoCloudSaveDebounced('related-change'); } catch (_) {}
      });
    });

    // селект каталога всех навыков из CSV
    const catalog = [];
    Object.values(skillsData.skills || {}).forEach(arr => (arr || []).forEach(s => catalog.push({ id: s.id, name: s.name })));
    addSelect.innerHTML = '<option value="">Выберите навык</option>' + catalog
      .filter(s => s.id !== skillId && !relSet.has(s.id))
      .map(s => `<option value="${s.id}">${s.name}</option>`)
      .join('');
    addBtn.onclick = () => {
      const id = addSelect.value;
      if (!id) return;
      if (!Array.isArray(activity.relatedSkills)) activity.relatedSkills = [];
      if (!activity.relatedSkills.includes(id)) {
        activity.relatedSkills.push(id);
        const skill = findSkillById(id) || { id, name: getPlanSkillName(id) };
        ensureSkillInPlanAndProgress(id, skill.name);
        saveToLocalStorage();
        // обновим UI
        const rel = activity.relatedSkills || [];
        relatedWrap.innerHTML = rel.length ? rel.map(id => `<span class=\"tag\" title=\"${getPlanSkillName(id)}\">${getPlanSkillName(id)}</span>`).join(' ') : '<span class="text-secondary">Нет</span>';
        // обновить чекбоксы (добавилось новое значение)
        const details = checksWrap.querySelector('details > div');
        if (details) details.innerHTML += `<label class=\"checkbox\"><input type=\"checkbox\" data-rel-id=\"${id}\" checked> <span>${getPlanSkillName(id)}</span></label>`;
        // пересчитать дропдаун (убрать добавленный)
        addSelect.querySelector(`option[value="${id}"]`)?.remove();
        addSelect.value = '';
        try { autoCloudSaveDebounced('related-add'); } catch (_) {}
      }
    };
  }

  // Редактор подзадач: пересобрать секцию (вынесено в ensureKanbanSubtasksEditor)
  try { ensureKanbanSubtasksEditor(skillId, index); } catch (_) {}

  modal.style.display = 'block';
  modal.setAttribute('aria-hidden', 'false');
}

// Open modal directly in edit mode from List view
window.openTaskEdit = function(skillId, index) {
  openKanbanTaskModal(skillId, index);
  try { switchKanbanTaskMode('edit'); } catch (_) {}
};

function closeKanbanTaskModal() {
  const modal = document.getElementById('kanbanTaskModal');
  if (!modal) return;
  modal.style.display = 'none';
  modal.setAttribute('aria-hidden', 'true');
}

function switchKanbanTaskMode(mode) {
  const viewMount = document.getElementById('kanbanTaskViewSection');
  const editWrap = document.getElementById('kanbanTaskEditSection');
  const saveBtn = document.getElementById('saveKanbanTaskBtn');
  const editBtn = document.getElementById('editKanbanTaskBtn');
  if (!viewMount || !editWrap || !saveBtn || !editBtn) return;
  const isEdit = mode === 'edit';
  const modal = document.getElementById('kanbanTaskModal');
  const skillId = modal?.dataset?.skillId;
  const index = modal?.dataset?.index ? parseInt(modal.dataset.index) : NaN;
  viewMount.style.display = isEdit ? 'none' : 'block';
  editWrap.style.display = isEdit ? 'grid' : 'none';
  saveBtn.style.display = isEdit ? 'inline-flex' : 'none';
  editBtn.style.display = isEdit ? 'none' : 'inline-flex';

  // Когда заходим в режим редактирования — актуализируем поля
  if (isEdit) {
    try {
      if (!modal) return;
      if (!skillId || !Number.isInteger(index)) return;
      const activity = appState.progress?.[skillId]?.activities?.[index];
      if (!activity) return;
      const titleEl = document.getElementById('kanbanTaskTitle');
      const descEl = document.getElementById('kanbanTaskDesc');
      const expEl = document.getElementById('kanbanTaskExpected');
      const comEl = document.getElementById('kanbanTaskComment');
      const durEl = document.getElementById('kanbanTaskDuration');
      if (titleEl) titleEl.value = activity.name || '';
      if (descEl) descEl.value = activity.description || '';
      if (expEl) expEl.value = activity.expectedResult || '';
      if (comEl) comEl.value = activity.comment || '';
      if (durEl) durEl.value = activity.duration || 1;
    } catch (_) {}
  } else {
    // Выходим из режима редактирования: пересоберём view, чтобы отобразить свежие данные
    if (skillId && Number.isInteger(index)) {
      try { openKanbanTaskModal(skillId, index); } catch (_) {}
    }
  }
}

function saveKanbanTaskModal() {
  const modal = document.getElementById('kanbanTaskModal');
  if (!modal) return;
  const skillId = modal.dataset.skillId;
  const index = parseInt(modal.dataset.index);
  const activity = appState.progress?.[skillId]?.activities?.[index];
  if (!activity) { closeKanbanTaskModal(); return; }

  activity.name = document.getElementById('kanbanTaskTitle').value;
  activity.description = document.getElementById('kanbanTaskDesc').value;
  activity.expectedResult = document.getElementById('kanbanTaskExpected').value;
  const commentVal = document.getElementById('kanbanTaskComment').value;
  // сохраняем и в историю
  if (commentVal && commentVal.trim().length > 0) {
    if (!Array.isArray(activity.comments)) activity.comments = [];
    activity.comments.push({ text: commentVal.trim(), at: Date.now() });
  }
  activity.comment = commentVal;
  const dur = parseInt(document.getElementById('kanbanTaskDuration').value) || activity.duration || 1;
  activity.duration = Math.max(1, dur);
  const pr = document.getElementById('kanbanTaskPriority').value;
  activity.priority = pr || '';
  saveToLocalStorage();
  // switch back to view mode and re-render view content
  try { switchKanbanTaskMode('view'); } catch (_) {}
  try { syncProgressTaskToPlan(skillId, index); } catch (_) {}
  renderProgress();
  try { autoCloudSaveDebounced('edit-task'); } catch (_) {}
}

// Тоггл подзадачи из модалки/списка
window.toggleSubtask = function(skillId, activityIndex, subIndex) {
  const act = appState.progress?.[skillId]?.activities?.[activityIndex];
  if (!act || !Array.isArray(act.subtasks) || !act.subtasks[subIndex]) return;
  act.subtasks[subIndex].done = !act.subtasks[subIndex].done;
  // Авто-руллап статуса родителя
  rollupActivityFromSubtasks(act);
  saveToLocalStorage();
  try { syncProgressTaskToPlan(skillId, activityIndex); } catch (_) {}
  recomputeAllProgress();
  renderProgress();
  refreshKanbanModalIfCurrent(skillId, activityIndex, 'view');
  try { autoCloudSaveDebounced('toggle-subtask'); } catch (_) {}
};

window.toggleActivity = function(skillId, activityIndex) {
  const activity = appState.progress[skillId].activities[activityIndex];
  activity.completed = !activity.completed;
  // Если вручную отмечаем выполненным — ставим done, если снимаем — planned
  if (activity.completed) {
    // Завершили вручную: отметим подзадачи выполненными и переведём в done
    if (Array.isArray(activity.subtasks) && activity.subtasks.length > 0) {
      activity.subtasks.forEach(s => { s.done = true; });
    }
    activity.status = 'done';
  } else {
    // Сняли выполнение: переводим в planned, подзадачи не трогаем
    activity.status = 'planned';
  }
  
  saveToLocalStorage();
  recomputeAllProgress();
  renderProgress();
  try { autoCloudSaveDebounced('toggle-completed'); } catch (_) {}
};

window.updateActivityComment = function(skillId, activityIndex, comment) {
  appState.progress[skillId].activities[activityIndex].comment = comment;
  saveToLocalStorage();
  try { autoCloudSaveDebounced('edit-comment'); } catch (_) {}
};

// План: редактирование задач в самом плане
window.updatePlanActivity = function(skillId, idx, patch) {
  const item = appState.developmentPlan[skillId]?.activities?.[idx];
  if (!item) return;
  Object.assign(item, patch);
  // Обновляем totalDuration = сумма длительностей
  const plan = appState.developmentPlan[skillId];
  if (plan) {
    plan.totalDuration = plan.activities.reduce((sum, a) => sum + (a.duration || 0), 0);
  }
  saveToLocalStorage();
};

// Подзадачи в Плане (редактор структуры)
window.addPlanSubtask = function(skillId, idx) {
  const item = appState.developmentPlan[skillId]?.activities?.[idx];
  if (!item) return;
  if (!Array.isArray(item.subtasks)) item.subtasks = [];
  item.subtasks.push({ title: 'Новая подзадача', description: '', expectedResult: '', done: false });
  saveToLocalStorage();
  renderPlan();
};

window.updatePlanSubtask = function(skillId, idx, subIdx, title) {
  const item = appState.developmentPlan[skillId]?.activities?.[idx];
  if (!item || !Array.isArray(item.subtasks) || !item.subtasks[subIdx]) return;
  item.subtasks[subIdx].title = title;
  saveToLocalStorage();
};

window.updatePlanSubtaskDesc = function(skillId, idx, subIdx, text) {
  const item = appState.developmentPlan[skillId]?.activities?.[idx];
  if (!item || !Array.isArray(item.subtasks) || !item.subtasks[subIdx]) return;
  item.subtasks[subIdx].description = text;
  saveToLocalStorage();
};

window.updatePlanSubtaskExpected = function(skillId, idx, subIdx, text) {
  const item = appState.developmentPlan[skillId]?.activities?.[idx];
  if (!item || !Array.isArray(item.subtasks) || !item.subtasks[subIdx]) return;
  item.subtasks[subIdx].expectedResult = text;
  saveToLocalStorage();
};

window.removePlanSubtask = function(skillId, idx, subIdx) {
  const item = appState.developmentPlan[skillId]?.activities?.[idx];
  if (!item || !Array.isArray(item.subtasks)) return;
  item.subtasks.splice(subIdx, 1);
  saveToLocalStorage();
  renderPlan();
};

window.addPlanActivity = function(skillId) {
  const plan = appState.developmentPlan[skillId];
  if (!plan) return;
  plan.activities.push({
      id: `${skillId}_${Date.now()}`,
    name: 'Новая задача',
    level: plan.currentLevel + 1,
    duration: 2,
      status: 'planned',
    completed: false,
    comment: '',
    relatedSkills: [],
    skillWeights: undefined
  });
  // Пересчитываем суммарную длительность как сумму длительностей задач
  plan.totalDuration = plan.activities.reduce((sum, a) => sum + (a.duration || 0), 0);
  saveToLocalStorage();
  renderPlan();
};

window.toggleRelatedSkill = function(primarySkillId, activityIndex, relatedSkillId, checked) {
  const act = appState.developmentPlan?.[primarySkillId]?.activities?.[activityIndex];
  if (!act) return;
  if (!Array.isArray(act.relatedSkills)) act.relatedSkills = [];
  if (checked) {
    if (!act.relatedSkills.includes(relatedSkillId)) act.relatedSkills.push(relatedSkillId);
  } else {
    act.relatedSkills = act.relatedSkills.filter(id => id !== relatedSkillId);
  }
  saveToLocalStorage();
};

window.removePlanActivity = function(skillId, idx) {
  const plan = appState.developmentPlan[skillId];
  if (!plan) return;
  plan.activities.splice(idx, 1);
  saveToLocalStorage();
  renderPlan();
};

// Полное удаление навыка из плана (и развыбор), с синхронизацией прогресса
window.removePlanSkill = function(skillId) {
  if (!skillId) return;
  // Удаляем из плана
  if (appState.developmentPlan && appState.developmentPlan[skillId]) {
    delete appState.developmentPlan[skillId];
  }
  // Удаляем из выбранных навыков
  if (appState.selectedSkills && appState.selectedSkills[skillId]) {
    delete appState.selectedSkills[skillId];
  }
  // Удаляем из прогресса (если хотим полностью убрать из трекинга)
  if (appState.progress && appState.progress[skillId]) {
    delete appState.progress[skillId];
  }
  saveToLocalStorage();
  renderPlan();
  // Обновим прогресс, если открыт
  try { renderProgress(); } catch (_) {}
};

// Добавить навык по id из каталога CSV в план, подготовить к добавлению задач
window.addSkillToPlan = function(skillId, opts) {
  if (!skillId) return;
  // Найти навык в каталоге
  const skill = findSkillById(skillId);
  if (!skill) { alert('Навык не найден в каталоге'); return; }
  // Если уже есть — ничего не делаем
  if (appState.developmentPlan && appState.developmentPlan[skillId]) return;
  if (!appState.developmentPlan) appState.developmentPlan = {};
  // Проставим дефолтные уровни 0→1 и пустые задачи
  let tgt = Math.max(1, parseInt(opts?.targetLevel ?? 1) || 1);
  let cur = Math.max(0, parseInt(opts?.currentLevel ?? (tgt - 1)) || (tgt - 1));
  // Ограничим по фактическому числу уровней навыка
  const maxLevel = getMaxAvailableLevelForSkill(skill);
  cur = Math.min(cur, maxLevel);
  tgt = Math.min(tgt, maxLevel);
  if (tgt <= cur) tgt = Math.min(cur + 1, maxLevel);
  appState.developmentPlan[skillId] = {
    name: skill.name,
    currentLevel: cur,
    targetLevel: tgt,
    activities: [],
    totalDuration: 2
  };
  // Отметим в selectedSkills, чтобы синхронизировалось и в UI навыков
  if (!appState.selectedSkills) appState.selectedSkills = {};
  appState.selectedSkills[skillId] = { current: cur, target: tgt };
  // Обновим прогресс/план (прогресс не трогаем до старта или merge)
  saveToLocalStorage();
  renderPlan();
};

// Добавить задачу по её названию. Источник описания/критериев — kb_tasks.json (если доступен)
window.addTaskToPlanByTitle = async function() {
  const titleInput = document.getElementById('planAddTaskTitle');
  const skillSelect = document.getElementById('planAddTaskSkillSelect');
  const rawTitle = (titleInput?.value || '').trim();
  const skillId = skillSelect?.value || '';
  if (!rawTitle) { alert('Введите название задачи'); return; }
  if (!skillId) { alert('Выберите навык для привязки'); return; }

  // Ensure skill exists in plan
  if (!appState.developmentPlan) appState.developmentPlan = {};
  if (!appState.developmentPlan[skillId]) {
    const s = findSkillById(skillId) || { id: skillId, name: getPlanSkillName(skillId) };
    appState.developmentPlan[skillId] = { name: s.name || skillId, currentLevel: 0, targetLevel: 1, activities: [], totalDuration: 2 };
  }
  const plan = appState.developmentPlan[skillId];

  // Try to enrich from kb_tasks.json
  let desc = '';
  let criteria = '';
  try {
    let resp = await fetch('kb_tasks.json', { cache: 'no-store' });
    if (!resp.ok) {
      resp = await fetch('База_знаний_ИПР/kb_tasks.json', { cache: 'no-store' });
    }
    if (resp.ok) {
      const arr = await resp.json();
      if (Array.isArray(arr)) {
        const found = arr.find(t => String(t.goal || t.title || '').trim().toLowerCase() === rawTitle.toLowerCase());
        if (found) {
          desc = found.description || '';
          criteria = found.criteria || '';
        }
      }
    }
  } catch (_) {}

  plan.activities.push({
    id: `${skillId}_${Date.now()}`,
    name: rawTitle,
    level: Math.min(Math.max(1, (plan.currentLevel || 0) + 1), Math.max(plan.currentLevel || 0, plan.targetLevel || 1)),
    duration: 2,
    status: 'planned',
    completed: false,
    comment: '',
    description: desc,
    expectedResult: criteria,
    relatedSkills: [],
    skillWeights: undefined
  });
  plan.totalDuration = plan.activities.reduce((s, a) => s + (a.duration || 0), 0);
  saveToLocalStorage();
  renderPlan();
  if (titleInput) titleInput.value = '';
};

// Заполнить селект задач из kb_tasks.json
async function populatePlanTaskCatalogSelect() {
  const select = document.getElementById('planAddTaskCatalogSelect');
  if (!select) return;
  select.innerHTML = '<option value="">Загрузка...</option>';
  let items = [];
  try {
    let resp = await fetch('kb_tasks.json', { cache: 'no-store' });
    if (!resp.ok) resp = await fetch('База_знаний_ИПР/kb_tasks.json', { cache: 'no-store' });
    if (resp.ok) items = await resp.json();
  } catch (_) {}
  if (!Array.isArray(items)) items = [];
  // value: JSON-stringified minimal payload to avoid later lookup, keep size reasonable
  const options = ['<option value="">Выберите задачу</option>']
    .concat(items.map((t, idx) => {
      const payload = {
        title: t.goal || t.title || '(без названия)',
        description: t.description || '',
        criteria: t.criteria || '',
        skillName: t.skillName || ''
      };
      const label = `${payload.title} ${t.skillName ? '— ' + t.skillName : ''}`;
      return `<option value='${JSON.stringify(payload).replace(/'/g, '&#39;')}'>${escapeHtml(label)}</option>`;
    }));
  select.innerHTML = options.join('');
}

// Добавить выбранную из каталога задачу
window.addTaskFromCatalogToPlan = function() {
  const select = document.getElementById('planAddTaskCatalogSelect');
  const raw = select?.value || '';
  if (!raw) { alert('Выберите задачу из каталога'); return; }
  let data = null;
  try { data = JSON.parse(raw); } catch (_) {}
  if (!data) { alert('Некорректные данные задачи'); return; }
  let skillId = '';
  // Автопривязка по skillName
  if (data.skillName) {
    const found = findSkillByName(String(data.skillName).split(',')[0].trim());
    if (found) skillId = found.id;
  }
  if (!skillId) { alert('Выберите навык для привязки'); return; }

  if (!appState.developmentPlan) appState.developmentPlan = {};
  if (!appState.developmentPlan[skillId]) {
    const s = findSkillById(skillId) || { id: skillId, name: getPlanSkillName(skillId) };
    appState.developmentPlan[skillId] = { name: s.name || skillId, currentLevel: 0, targetLevel: 1, activities: [], totalDuration: 0 };
  }
  const plan = appState.developmentPlan[skillId];
  plan.activities.push({
    id: `${skillId}_${Date.now()}`,
    name: data.title,
    level: Math.min(Math.max(1, (plan.currentLevel || 0) + 1), Math.max(plan.currentLevel || 0, plan.targetLevel || 1)),
    duration: 2,
    status: 'planned',
    completed: false,
    comment: '',
    description: data.description || '',
    expectedResult: data.criteria || '',
    relatedSkills: [],
    skillWeights: undefined
  });
  plan.totalDuration = plan.activities.reduce((s, a) => s + (a.duration || 0), 0);
  saveToLocalStorage();
  renderPlan();
}

function toggleTheme() {
  console.log('Переключение темы...');
  const current = document.documentElement.getAttribute('data-color-scheme');
  const newTheme = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-color-scheme', newTheme);
  
  const button = document.getElementById('darkModeToggle');
  if (button) {
    button.textContent = newTheme === 'dark' ? '☀️ Светлая тема' : '🌙 Тёмная тема';
  }
  // persist
  try {
    appState.ui = appState.ui || {};
    appState.ui.theme = newTheme;
    saveToLocalStorage();
  } catch (_) {}
}

function exportToPDF() {
  if (typeof window.jspdf === 'undefined') {
    alert('PDF библиотека не загружена');
    return;
  }
  
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  
  // Заголовок
  doc.setFontSize(20);
  doc.text('Individualniy plan razvitiya', 20, 30);
  
  // Информация о сотруднике
  doc.setFontSize(12);
  let yPos = 50;
  doc.text(`FIO: ${appState.profile.fullName || ''}`, 20, yPos);
  doc.text(`Position: ${appState.profile.position || ''}`, 20, yPos + 10);
  doc.text(`Grade: ${appState.profile.grade || ''}`, 20, yPos + 20);
  
  yPos += 40;
  
  // План развития
  Object.entries(appState.developmentPlan).forEach(([skillId, plan]) => {
    if (yPos > 250) {
      doc.addPage();
      yPos = 30;
    }
    
    doc.setFontSize(14);
    doc.text(`${plan.name} (${plan.currentLevel} -> ${plan.targetLevel})`, 20, yPos);
    yPos += 10;
    
    doc.setFontSize(10);
    plan.activities.forEach(activity => {
      if (yPos > 270) {
        doc.addPage();
        yPos = 30;
      }
      doc.text(`• ${activity.name} (~${activity.duration} mes.)`, 25, yPos);
      yPos += 7;
    });
    
    yPos += 10;
  });
  
  doc.save(`IPR_${appState.profile.fullName || 'export'}.pdf`);
}

function exportToCSV() {
  let csvContent = 'Skill,Current Level,Target Level,Activity,Duration (weeks),Status,Comment\n';
  
  const planData = appState.progress || appState.developmentPlan;
  
  Object.entries(planData).forEach(([skillId, plan]) => {
    plan.activities.forEach(activity => {
      const status = activity.completed ? 'Completed' : 'In Progress';
      const comment = (activity.comment || '').replace(/"/g, '""');
      csvContent += `"${plan.name}",${plan.currentLevel},${plan.targetLevel},"${activity.name}",${activity.duration},"${status}","${comment}"\n`;
    });
  });
  
  const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `IPR_${appState.profile.fullName || 'export'}.csv`;
  link.click();
}

function exportToXLSX() {
  const headers = ['Навык', 'Уровень', 'Цель задачи', 'Описание', 'Длительность', 'Ожидаемый результат', 'Комментарии', 'Приоритет'];
  const rows = [headers];
  const planData = appState.progress && Object.keys(appState.progress).length > 0 ? appState.progress : appState.developmentPlan;
  Object.values(planData || {}).forEach(plan => {
    const skillName = plan.name || '';
    const level = `${plan.currentLevel || 0} → ${plan.targetLevel || 0}`;
    (plan.activities || []).forEach(activity => {
      rows.push([
        skillName,
        level,
        String(activity.name || ''),
        String(activity.description || ''),
        Number(activity.duration || 0),
        String(activity.expectedResult || ''),
        String(activity.comment || ''),
        String(activity.priority || '')
      ]);
    });
  });
  const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const tableHtml = rows.map(r => `<tr>${r.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('');
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><table>${tableHtml}</table></body></html>`;
  const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `IPR_${appState.profile.fullName || 'export'}.xlsx`;
  link.click();
}

function exportProgressToCSV() {
  let csvContent = 'Skill,Current Level,Target Level,Task,Duration (weeks),Completed,Comment,Description,Expected Result,Status,RelatedSkills,SkillWeights\n';
  const planData = appState.progress && Object.keys(appState.progress).length > 0 ? appState.progress : appState.developmentPlan;
  Object.entries(planData).forEach(([skillId, plan]) => {
    plan.activities.forEach(activity => {
      const completed = activity.completed ? 'Yes' : 'No';
      const comment = (activity.comment || '').replace(/"/g, '""');
      const desc = (activity.description || '').replace(/\r?\n/g, ' | ').replace(/"/g, '""');
      const expected = (activity.expectedResult || '').replace(/\r?\n/g, ' | ').replace(/"/g, '""');
      const status = activity.status || (activity.completed ? 'done' : 'planned');
      const related = (activity.relatedSkills || []).join('|');
      const weights = activity.skillWeights ? JSON.stringify(activity.skillWeights) : '';
      csvContent += `"${plan.name}",${plan.currentLevel},${plan.targetLevel},"${activity.name}",${activity.duration},${completed},"${comment}","${desc}","${expected}",${status},"${related}","${weights}"\n`;
    });
  });
  const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `IPR_Progress_${appState.profile.fullName || 'export'}.csv`;
  link.click();
}

function exportProgressToXLSX() {
  const headers = ['Навык', 'Текущий уровень', 'Целевой уровень', 'Задача', 'Длительность (нед.)', 'Статус', 'Описание', 'Ожидаемый результат', 'Комментарий', 'Приоритет'];
  const rows = [headers];
  const planData = appState.progress && Object.keys(appState.progress).length > 0 ? appState.progress : appState.developmentPlan;
  Object.values(planData || {}).forEach(plan => {
    const skillName = plan.name || '';
    const current = plan.currentLevel ?? '';
    const target = plan.targetLevel ?? '';
    (plan.activities || []).forEach(activity => {
      const status = activity.status || (activity.completed ? 'done' : 'planned');
      rows.push([
        skillName,
        current,
        target,
        String(activity.name || ''),
        Number(activity.duration || 0),
        status,
        String(activity.description || ''),
        String(activity.expectedResult || ''),
        String(activity.comment || ''),
        String(activity.priority || '')
      ]);
    });
  });
  const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const tableHtml = rows.map(r => `<tr>${r.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('');
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><table>${tableHtml}</table></body></html>`;
  const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `IPR_Progress_${appState.profile.fullName || 'export'}.xlsx`;
  link.click();
}

function exportProgressToKBTasks() {
  const planData = appState.progress && Object.keys(appState.progress).length > 0 ? appState.progress : appState.developmentPlan;
  const kbTasks = [];
  
  Object.values(planData || {}).forEach(plan => {
    const skillName = plan.name || '';
    const currentLevel = plan.currentLevel || 1;
    const targetLevel = plan.targetLevel || currentLevel + 1;
    
    (plan.activities || []).forEach(activity => {
      // Создаем запись в формате kb_tasks.json
      const kbTask = {
        category: skillName, // Используем название навыка как категорию
        skillName: skillName,
        level: targetLevel, // Используем целевой уровень
        goal: activity.name || '',
        description: activity.description || '',
        criteria: activity.expectedResult || 'Плановый результат: освоены ключевые действия по теме и задокументированы результаты.\nОжидаемый результат: демонстрация на проекте/песочнице и наличие артефактов (доки, скриншоты, отчеты).\nПроверка корректности: ревью ментора/лида; критерии приемки пройдены без замечаний.',
        durationWeeks: activity.duration || 1
      };
      
      kbTasks.push(kbTask);
    });
  });
  
  // Создаем и скачиваем JSON файл
  const jsonContent = JSON.stringify(kbTasks, null, 2);
  const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `kb_tasks_from_progress_${appState.profile.fullName || 'export'}.json`;
  link.click();
}

function handleImportProgressCSV(ev) {
  const file = ev.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const text = String(reader.result || '');
      const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
      if (lines.length <= 1) return;
      // header detection: allow both with and without Status column
      const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g,''));
      const hasHeader = /skill/i.test(header[0]) || /current/i.test(header[1]);
      const startIdx = hasHeader ? 1 : 0;
      // Полная очистка и сбор нового прогресса
      const newProgress = {};

      for (let i = startIdx; i < lines.length; i += 1) {
        const raw = lines[i];
        if (!raw.trim()) continue;
        // naive CSV split respecting quotes
        const cols = [];
        let cur = '';
        let inQ = false;
        for (let j = 0; j < raw.length; j += 1) {
          const ch = raw[j];
          if (ch === '"') { inQ = !inQ; cur += ch; continue; }
          if (ch === ',' && !inQ) { cols.push(cur); cur = ''; continue; }
          cur += ch;
        }
        cols.push(cur);
        const unq = (s) => s.replace(/^\s*"|"\s*$/g,'').replace(/""/g,'"');
        const skillName = unq(cols[0] || '');
        const currentLevel = parseInt(cols[1] || '0') || 0;
        const targetLevel = parseInt(cols[2] || '0') || 0;
        const taskName = unq(cols[3] || '');
        const duration = parseInt(cols[4] || '1') || 1;
        const completed = /^(yes|true|1)$/i.test((cols[5] || '').trim());
        const comment = unq(cols[6] || '');
        const description = unq(cols[7] || '');
        const expected = unq(cols[8] || '');
        const status = ((cols[9] || '').trim()) || (completed ? 'done' : 'planned');
        const related = unq(cols[10] || '');
        const weightsRaw = unq(cols[11] || '');
        const relatedSkills = related ? related.split('|').map(s => slugify(s.trim())).filter(Boolean) : [];
        let skillWeights;
        try { skillWeights = weightsRaw ? JSON.parse(weightsRaw) : undefined; } catch (_) {}

        const skillId = slugify(skillName);
        if (!newProgress[skillId]) {
          newProgress[skillId] = {
            name: skillName,
            currentLevel,
            targetLevel,
            activities: [],
            completedActivities: 0,
            overallProgress: 0,
            totalDuration: 0
  };
  // Используем упрощённый HTML→Excel путь (Excel корректно откроет как XLSX)
  const tableHtml = rows.map(r => `<tr>${r.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('');
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><table>${tableHtml}</table></body></html>`;
  const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `IPR_${appState.profile.fullName || 'export'}.xlsx`;
  link.click();
        }
        newProgress[skillId].activities.push({
          id: `${skillId}_${newProgress[skillId].activities.length}`,
          name: taskName,
          level: Math.max(1, currentLevel + 1),
          duration,
          status,
          completed,
          comment,
          description,
          expectedResult: expected,
          relatedSkills,
          skillWeights
        });
      }

      // Recompute totals per skill
      Object.values(newProgress).forEach(plan => {
        plan.completedActivities = (plan.activities || []).filter(a => a.completed).length;
        plan.overallProgress = (plan.activities || []).length > 0
          ? (plan.completedActivities / plan.activities.length) * 100
          : 0;
        plan.totalDuration = (plan.activities || []).reduce((s, a) => s + (a.duration || 0), 0);
      });

      // Заменяем полностью progress и синхронизируем план под него
      appState.progress = newProgress;
      appState.developmentPlan = {};
      Object.entries(newProgress).forEach(([skillId, plan]) => {
        appState.developmentPlan[skillId] = {
          name: plan.name,
          currentLevel: plan.currentLevel,
          targetLevel: plan.targetLevel,
          activities: plan.activities.map(a => ({ ...a })),
          totalDuration: plan.totalDuration
        };
      });

      saveToLocalStorage();
      renderProgress();
      try { showSection('progressSection'); } catch (_) {}
    } catch (e) {
      console.error('Ошибка импорта CSV прогресса:', e);
      alert('Не удалось импортировать CSV. Проверьте формат.');
    }
  };
  reader.readAsText(file);
}