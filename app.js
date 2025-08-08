// Источник навыков теперь берётся из CSV (HardSkills Review QA 4.0.csv)
let skillsData = { skills: {} };

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
  const lines = String(desc)
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);
  // Берём строки, начинающиеся с буллета или тире, иначе используем все строки кроме первой как активности
  const bulletLines = lines.filter(l => /^([•\-\*]|\u2022)/.test(l));
  const cleaned = (bulletLines.length > 0 ? bulletLines : lines.slice(1))
    .map(l => l.replace(/^([•\-\*]|\u2022)\s*/,'').trim())
    .filter(Boolean);
  // Если ничего не вышло — хотя бы одна активность = сама сводка
  return cleaned.length > 0 ? cleaned : [lines[0]];
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

// Состояние приложения
let appState = {
  profile: {},
  selectedSkills: {},
  developmentPlan: {},
  progress: {},
  ui: {}
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
  const baseDuration = 2; // базовая длительность в месяцах
  return Math.ceil(baseDuration * levelDiff);
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
  
  // Установка светлой темы по умолчанию
  document.documentElement.setAttribute('data-color-scheme', 'light');
  const button = document.getElementById('darkModeToggle');
  if (button) button.textContent = '🌙 Тёмная тема';
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
  
  if (createNewBtn) {
    createNewBtn.addEventListener('click', function() {
      console.log('Создание нового плана...');
      appState = { profile: {}, selectedSkills: {}, developmentPlan: {}, progress: {} };
      showSection('profileSection');
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
  if (generatePlanBtn) {
    generatePlanBtn.addEventListener('click', handleGeneratePlan);
  }
  if (generatePromptBtn) {
    generatePromptBtn.addEventListener('click', handleGeneratePrompt);
  }
  
  const backToSkillsBtn = document.getElementById('backToSkills');
  if (backToSkillsBtn) {
    backToSkillsBtn.addEventListener('click', () => showSection('skillsSection'));
  }

  // План
  const startProgressBtn = document.getElementById('startProgress');
  if (startProgressBtn) {
    startProgressBtn.addEventListener('click', function() {
      initializeProgress();
      showSection('progressSection');
      renderProgress();
    });
  }
  
  const exportPDFBtn = document.getElementById('exportPDF');
  const exportCSVBtn = document.getElementById('exportCSV');
  const exportCSVProgressBtn = document.getElementById('exportCSVProgress');
  const importCSVProgressBtn = document.getElementById('importCSVProgressBtn');
  const importCSVProgressFile = document.getElementById('importCSVProgressFile');
  const cloudSyncBtn = document.getElementById('cloudSyncBtn');
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
  if (importCSVProgressBtn && importCSVProgressFile) {
    importCSVProgressBtn.addEventListener('click', () => importCSVProgressFile.click());
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

  // Cloud modal
  const cloudModal = document.getElementById('cloudModal');
  const closeCloudModal = document.getElementById('closeCloudModal');
  // Хардкоднутый URL Apps Script
  const CLOUD_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwqOobmbWA97CN7cJUQ6sQ8pO63ITTVqEhrhkLA-90pzjfIlRTbUmaXPQF1oerLmxxnfA/exec';
  const cloudUrlInput = null;
  const cloudPlanTitleInput = document.getElementById('cloudPlanTitleInput');
  const cloudSaveNewBtn = document.getElementById('cloudSaveNewBtn');
  const cloudUpdateBtn = document.getElementById('cloudUpdateBtn');
  const cloudLoadLatestBtn = document.getElementById('cloudLoadLatestBtn');
  const cloudRefreshListBtn = document.getElementById('cloudRefreshListBtn');
  const cloudList = document.getElementById('cloudList');
  const cloudLoadIdInput = document.getElementById('cloudLoadIdInput');
  const cloudLoadByIdBtn = document.getElementById('cloudLoadByIdBtn');
  const cloudLog = document.getElementById('cloudLog');
  const cloudCurrentRecord = document.getElementById('cloudCurrentRecord');
  const cloudCurrentRecordInline = document.getElementById('cloudCurrentRecordInline');
  const cloudLoading = document.getElementById('cloudLoading');
  const cloudLoadingText = document.getElementById('cloudLoadingText');
  if (cloudSyncBtn && cloudModal && closeCloudModal && cloudSaveNewBtn && cloudUpdateBtn && cloudLoadLatestBtn && cloudLog) {
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
        if (ensureTitle()) payload.title = appState.ui.cloudPlanTitle;
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
        if (ensureTitle()) payload.title = appState.ui.cloudPlanTitle;
        form.set('payload', JSON.stringify(payload));
        const res = await fetch(url, { method: 'POST', body: form });
        const json = await res.json();
        setLog(json.ok ? 'Обновлено' : ('Ошибка: ' + JSON.stringify(json)));
      } catch (e) { setLog('Ошибка сети: ' + String(e)); }
      finally { setLoading(false); }
    });
    cloudLoadLatestBtn.addEventListener('click', async () => {
      const url = ensureUrl(); if (!url) return;
      try {
        setLoading(true, 'Загружаем последнюю запись…');
        const res = await fetch(url);
        const json = await res.json();
        if (json.ok && Array.isArray(json.data) && json.data.length) {
          const latest = json.data[json.data.length - 1];
          if (latest && latest.payload) {
            appState = latest.payload; saveToLocalStorage();
            renderSkills(); renderPlan(); renderProgress();
            if (cloudCurrentRecord) cloudCurrentRecord.textContent = latest.id ? `Текущая запись: ${latest.id}` : 'Текущая запись: неизвестна';
            if (cloudCurrentRecordInline) cloudCurrentRecordInline.textContent = latest.id ? `id = ${latest.id}` : '';
            // заполнение формы профиля, если секция активна
            try { populateProfileFormFromState(); } catch (_) {}
            if (latest.id) { appState.ui = appState.ui || {}; appState.ui.cloudRecordId = latest.id; saveToLocalStorage(); }
            setLog('Загружено');
          } else setLog('Нет данных payload у последней записи');
        } else setLog('Нет записей');
      } catch (e) { setLog('Ошибка сети: ' + String(e)); }
      finally { setLoading(false); }
    });

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
        appState.ui = appState.ui || {}; appState.ui.cloudRecordId = id; saveToLocalStorage();
        if (cloudCurrentRecord) cloudCurrentRecord.textContent = `Текущая запись: ${id}`;
        if (cloudCurrentRecordInline) cloudCurrentRecordInline.textContent = `id = ${id}`;
        try { populateProfileFormFromState(); } catch (_) {}
        setLog('Загружено');
      } catch (e) { setLog('Ошибка сети: ' + String(e)); }
      finally { setLoading(false); }
    }

    cloudRefreshListBtn?.addEventListener('click', refreshCloudList);
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
  const promptModal = document.getElementById('promptModal');
  const closePromptModalBtn = document.getElementById('closePromptModal');
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

  // Kanban task modal events
  const kanbanModal = document.getElementById('kanbanTaskModal');
  const closeKanbanBtn = document.getElementById('closeKanbanTaskModal');
  const saveKanbanBtn = document.getElementById('saveKanbanTaskBtn');
  if (kanbanModal && closeKanbanBtn && saveKanbanBtn) {
    closeKanbanBtn.addEventListener('click', closeKanbanTaskModal);
    kanbanModal.addEventListener('click', (e) => {
      if (e.target && e.target.hasAttribute('data-close-modal')) closeKanbanTaskModal();
    });
    saveKanbanBtn.addEventListener('click', saveKanbanTaskModal);
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
      const persist = () => {
        const cur = currentSelect.value ? parseInt(currentSelect.value) : 0;
        const tar = targetSelect.value ? parseInt(targetSelect.value) : 0;
        if (tar > cur) {
          appState.selectedSkills[skillId] = { current: cur, target: tar };
        } else {
          delete appState.selectedSkills[skillId];
        }
        saveToLocalStorage();
        updateSkillDescription(skillId);
          updateSelectedCounter();
          // Перерисуем список, чтобы кнопка "Снять выбор" появилась/скрылась сразу
          renderSkills();
      };
      currentSelect.addEventListener('change', persist);
      targetSelect.addEventListener('change', persist);
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
    const done = items.reduce((s, x) => s + ((x.act.completed || x.act.status === 'done' || x.act.status === 'cancelled') ? x.weight : 0), 0);
    plan.completedActivities = Math.round(done); // отображаем как целое; при желании можно хранить дробно
    plan.overallProgress = total > 0 ? (done / total) * 100 : 0;
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
      duration: Number.isFinite(t.duration) ? Math.max(1, Math.round(t.duration)) : 1,
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
          duration: getDurationForLevel(level - 1, level),
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
      totalDuration: getDurationForLevel(levels.current, levels.target)
    };
  });
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
          ${totals.map(t => `<li>${t.name}: ~${t.duration} мес.</li>`).join('')}
        </ul>
        <p style="margin-top:12px;"><strong>Итого по ИПР:</strong> ~${totalMonths} мес.</p>
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

  planContent.innerHTML = summaryHtml + Object.entries(appState.developmentPlan).map(([skillId, plan]) => `
    <div class="plan-skill" data-plan-skill-id="${skillId}">
      <div class="plan-skill-header">
        <h3 class="plan-skill-title">${plan.name}</h3>
        <div class="level-progression">
          Уровень ${plan.currentLevel} <span class="level-arrow">→</span> ${plan.targetLevel}
          <span class="activity-duration">(~${plan.totalDuration} мес.)</span>
        </div>
      </div>
      <div class="plan-activities">
        ${plan.activities.map((activity, idx) => `
          <div class="activity-item" data-activity-idx="${idx}">
            <div class="form-group" style="margin-bottom:8px;">
              <label class="form-label">Название задачи</label>
              <input class="form-control" type="text" value="${activity.name.replace(/\"/g, '&quot;')}" onchange="updatePlanActivity('${skillId}', ${idx}, { name: this.value })" />
            </div>
            <div class="form-group" style="margin-bottom:8px;">
              <label class="form-label">Описание задачи</label>
              <textarea class="form-control" rows="2" onchange="updatePlanActivity('${skillId}', ${idx}, { description: this.value })">${(activity.description || '').replace(/</g,'&lt;')}</textarea>
            </div>
            <div class="form-group" style="margin-bottom:8px;">
              <label class="form-label">Плановый результат</label>
              <textarea class="form-control" rows="2" onchange="updatePlanActivity('${skillId}', ${idx}, { expectedResult: this.value })">${(activity.expectedResult || '').replace(/</g,'&lt;')}</textarea>
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
                  <option value="">Выберите навык из каталога</option>
                  ${catalog
                    .filter(s => s.id !== skillId && !(activity.relatedSkills||[]).includes(s.id))
                    .map(s => `<option value="${s.id}">${s.name}</option>`)
                    .join('')}
                </select>
                <button type="button" class="btn btn--outline btn--sm" onclick="addRelatedSkillById('${skillId}', ${idx}, document.getElementById('relatedAdd-${skillId}-${idx}').value)">Добавить</button>
              </div>
            </div>
            <div style="display:flex; gap: 8px; align-items:center;">
              <label style="font-size:12px;color:var(--color-text-secondary)">Длительность (мес.)</label>
              <input class="form-control" type="number" min="1" style="width:100px" value="${activity.duration}" onchange="updatePlanActivity('${skillId}', ${idx}, { duration: parseInt(this.value)||1 })" />
              <button class="btn btn--outline btn--sm" onclick="removePlanActivity('${skillId}', ${idx})">Удалить</button>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="form-actions" style="justify-content:flex-start; gap:8px; margin-top:12px;">
        <button class="btn btn--secondary btn--sm" onclick="addPlanActivity('${skillId}')">Добавить задачу</button>
      </div>
    </div>
  `).join('');

  // Привяжем обработчики к кнопкам, т.к. они динамические
  const backToSkillsBtn = document.getElementById('backToSkills');
  if (backToSkillsBtn) {
    backToSkillsBtn.onclick = () => showSection('skillsSection');
  }
  const startProgressBtn = document.getElementById('startProgress');
  if (startProgressBtn) {
    startProgressBtn.onclick = () => {
      initializeProgress();
      showSection('progressSection');
      renderProgress();
    };
  }
}

function initializeProgress() {
  appState.progress = {};
  
  Object.entries(appState.developmentPlan).forEach(([skillId, plan]) => {
    appState.progress[skillId] = {
      ...plan,
      completedActivities: 0,
      overallProgress: 0,
      activities: plan.activities.map(activity => ({ ...activity, status: activity.status || (activity.completed ? 'done' : 'planned') }))
    };
  });
  
  saveToLocalStorage();
}

function renderProgress() {
  // Гарантируем пересчёт агрегатов с учётом связанных навыков
  recomputeAllProgress();
  if (typeof Chart !== 'undefined') {
    renderProgressCharts();
  }
  // Сначала список и канбан
  renderProgressTracking();
  renderProgressKanban();
  // Затем блок со связанными навыками (как отдельный список вне графиков)
  renderRelatedSkillsSummary();
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
  
  progressTracking.innerHTML = Object.entries(appState.progress).map(([skillId, skill]) => {
    const relatedOnly = isRelatedOnlySkill(skillId);
    const progressPercentage = relatedOnly
      ? 100
      : (skill.activities.length > 0 ? (skill.completedActivities / skill.activities.length) * 100 : 0);
    const allDone = relatedOnly || (skill.activities.length > 0 && skill.completedActivities === skill.activities.length);
    const collapsed = !!(appState.ui && appState.ui.collapsedSkills && appState.ui.collapsedSkills[skillId]);
    
    return `
      <div class="progress-skill ${allDone ? 'bg-success' : 'progress-skill--remaining'}" data-skill-id="${skillId}">
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
        ${(!relatedOnly && !collapsed) ? `
        <div class="progress-activities">
          ${skill.activities.map((activity, index) => `
            <div class="progress-activity ${activity.completed ? 'activity-completed' : ''}">
              <div class="activity-checkbox-container">
                <input type="checkbox" class="activity-checkbox" 
                       ${activity.completed ? 'checked' : ''}
                       onchange="toggleActivity('${skillId}', ${index})">
                <div class="activity-info">
                  <h4 class="activity-name">${activity.name}</h4>
                  ${activity.description ? `<div class="activity-desc">${activity.description}</div>` : ''}
                  ${activity.expectedResult ? `<div class="activity-expected"><strong>Ожидаемый результат:</strong> ${activity.expectedResult}</div>` : ''}
                  ${(activity.relatedSkills && activity.relatedSkills.length) ? `<div class=\"activity-related\">Связанные навыки: ${activity.relatedSkills.map(id => `<span class=\"tag\" title=\"${getPlanSkillName(id)}\">${getPlanSkillName(id)}</span>`).join(' ')}</div>` : ''}
                  <div class="activity-meta">
                    <span>Уровень ${activity.level}</span>
                    <span>~${activity.duration} мес.</span>
                  </div>
                  <div class="activity-related-edit" style="margin-top:6px;">
                    <details>
                      <summary style="cursor:pointer;color:var(--color-text-secondary);">Изменить связанные навыки</summary>
                      <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap:6px; margin-top:6px;">
                        ${Object.entries(appState.progress || {})
                          .filter(([id]) => id !== skillId)
                          .map(([id, p]) => `
                            <label class=\"checkbox\"><input type=\"checkbox\" data-skill=\"${skillId}\" data-idx=\"${index}\" data-rel-id=\"${id}\" ${Array.isArray(activity.relatedSkills) && activity.relatedSkills.includes(id) ? 'checked' : ''}> <span>${p.name}</span></label>
                          `).join('')}
                      </div>
                    </details>
                  </div>
                  <textarea class="form-control activity-comment" 
                           placeholder="Комментарии к выполнению..."
                           onchange="updateActivityComment('${skillId}', ${index}, this.value)">${activity.comment}</textarea>
                </div>
              </div>
            </div>
          `).join('')}
        </div>` : ''}
        </div>
    `;
  }).join('');

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

  // Обработчики чекбоксов "Изменить связанные навыки"
  progressTracking.querySelectorAll('input[data-rel-id]').forEach(cb => {
    cb.addEventListener('change', () => {
      const skillId = cb.getAttribute('data-skill');
      const idx = parseInt(cb.getAttribute('data-idx'));
      const relId = cb.getAttribute('data-rel-id');
      const act = appState.progress?.[skillId]?.activities?.[idx];
      if (!act) return;
      if (!Array.isArray(act.relatedSkills)) act.relatedSkills = [];
      if (cb.checked) {
        if (!act.relatedSkills.includes(relId)) act.relatedSkills.push(relId);
        const relSkill = findSkillById(relId) || { id: relId, name: getPlanSkillName(relId) };
        ensureSkillInPlanAndProgress(relId, relSkill.name);
      } else {
        act.relatedSkills = act.relatedSkills.filter(x => x !== relId);
      }
      saveToLocalStorage();
      // Перерисуем, чтобы пересчитались веса и отображение
      renderProgress();
    });
  });
}

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
    // Группировка по навыку (эпик)
    const byEpic = {};
    cards.forEach(c => {
      if (!byEpic[c.skillId]) byEpic[c.skillId] = { name: c.skillName, items: [] };
      byEpic[c.skillId].items.push(c);
    });
    const groupsHtml = Object.entries(byEpic).map(([skillId, grp]) => {
      const itemsHtml = grp.items.map(c => `
        <div class="kanban-card" draggable="true" data-skill-id="${c.skillId}" data-idx="${c.index}">
          <div class="title">${c.activity.name}</div>
        </div>
      `).join('');
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
        activity.status = toLane;
        activity.completed = (toLane === 'done' || toLane === 'cancelled');
        saveToLocalStorage();
        recomputeAllProgress();
        renderProgress();
      } catch (_) {}
    });
  });
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
  const dur = document.getElementById('kanbanTaskDuration');
  if (dur) dur.value = activity.duration || 1;
  const relatedWrap = document.getElementById('kanbanTaskRelated');
  if (relatedWrap) {
    const rel = activity.relatedSkills || [];
    relatedWrap.innerHTML = rel.length ? rel.map(id => `<span class=\"tag\" title=\"${getPlanSkillName(id)}\">${getPlanSkillName(id)}</span>`).join(' ') : '<span class="text-secondary">Нет</span>';
  }

  // Редактирование связей: чекбоксы по текущим навыкам плана + селект каталога
  const checksWrap = document.getElementById('kanbanTaskRelatedCheckboxes');
  const addSelect = document.getElementById('kanbanTaskRelatedAddSelect');
  const addBtn = document.getElementById('kanbanTaskRelatedAddBtn');
  if (checksWrap && addSelect && addBtn) {
    // чекбоксы по навыкам, присутствующим в плане (кроме текущего primary)
    const allPlanSkills = Object.entries(appState.progress || {}).map(([id, p]) => ({ id, name: p.name }));
    const relSet = new Set(activity.relatedSkills || []);
    checksWrap.innerHTML = allPlanSkills
      .filter(s => s.id !== skillId)
      .map(s => `<label class="checkbox"><input type="checkbox" data-rel-id="${s.id}" ${relSet.has(s.id) ? 'checked' : ''}> <span>${s.name}</span></label>`)
      .join('');
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
      });
    });

    // селект каталога всех навыков из CSV
    const catalog = [];
    Object.values(skillsData.skills || {}).forEach(arr => (arr || []).forEach(s => catalog.push({ id: s.id, name: s.name })));
    addSelect.innerHTML = '<option value="">Выберите навык из каталога</option>' + catalog
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
        checksWrap.innerHTML += `<label class=\"checkbox\"><input type=\"checkbox\" data-rel-id=\"${id}\" checked> <span>${getPlanSkillName(id)}</span></label>`;
        // пересчитать дропдаун (убрать добавленный)
        addSelect.querySelector(`option[value="${id}"]`)?.remove();
        addSelect.value = '';
      }
    };
  }

  modal.style.display = 'block';
  modal.setAttribute('aria-hidden', 'false');
}

function closeKanbanTaskModal() {
  const modal = document.getElementById('kanbanTaskModal');
  if (!modal) return;
  modal.style.display = 'none';
  modal.setAttribute('aria-hidden', 'true');
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
  activity.comment = document.getElementById('kanbanTaskComment').value;
  const dur = parseInt(document.getElementById('kanbanTaskDuration').value) || activity.duration || 1;
  activity.duration = Math.max(1, dur);
  saveToLocalStorage();
  closeKanbanTaskModal();
  renderProgress();
}

window.toggleActivity = function(skillId, activityIndex) {
  const activity = appState.progress[skillId].activities[activityIndex];
  activity.completed = !activity.completed;
  // Если вручную отмечаем выполненным — ставим done, если снимаем — planned
  activity.status = activity.completed ? 'done' : (activity.status === 'done' || activity.status === 'cancelled' ? 'planned' : activity.status);
  
  saveToLocalStorage();
  recomputeAllProgress();
  renderProgress();
};

window.updateActivityComment = function(skillId, activityIndex, comment) {
  appState.progress[skillId].activities[activityIndex].comment = comment;
  saveToLocalStorage();
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

window.addPlanActivity = function(skillId) {
  const plan = appState.developmentPlan[skillId];
  if (!plan) return;
  plan.activities.push({
      id: `${skillId}_${Date.now()}`,
    name: 'Новая задача',
    level: plan.currentLevel + 1,
    duration: 1,
      status: 'planned',
    completed: false,
    comment: '',
    relatedSkills: [],
    skillWeights: undefined
  });
  plan.totalDuration = getDurationForLevel(plan.currentLevel, plan.targetLevel);
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

function toggleTheme() {
  console.log('Переключение темы...');
  const current = document.documentElement.getAttribute('data-color-scheme');
  const newTheme = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-color-scheme', newTheme);
  
  const button = document.getElementById('darkModeToggle');
  if (button) {
    button.textContent = newTheme === 'dark' ? '☀️ Светлая тема' : '🌙 Тёмная тема';
  }
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
  let csvContent = 'Skill,Current Level,Target Level,Activity,Duration (months),Status,Comment\n';
  
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

function exportProgressToCSV() {
  let csvContent = 'Skill,Current Level,Target Level,Task,Duration (months),Completed,Comment,Description,Expected Result,Status,RelatedSkills,SkillWeights\n';
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
    } catch (e) {
      console.error('Ошибка импорта CSV прогресса:', e);
      alert('Не удалось импортировать CSV. Проверьте формат.');
    }
  };
  reader.readAsText(file);
}