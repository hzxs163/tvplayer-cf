// ============================================================
//  CONFIG
// ============================================================
const PROXY = (url) => '/api/proxy?url=' + encodeURIComponent(url);
const CONCURRENCY = 6;
const FETCH_TIMEOUT = 15000;
const STORAGE_KEY = 'tv_data';
const STORAGE_SOURCES_KEY = 'tv_sources';
const STORAGE_DISCLAIMER_KEY = 'tv_disclaimer_agreed';

// ============================================================
//  STATE
// ============================================================
const state = {
    sources: [],
    source: null,
    category: null,
    page: 1,
    totalPages: 1,
    categories: [],
    movies: [],
    searchResults: [],
    searchSeq: 0,
    currentVod: null,
    currentSource: null,
    currentLines: [],
    currentLineIndex: 0,
    currentEpisodes: [],
    currentUrl: '',
    favorites: [],
    history: [],
    isPlaying: false,
    isLoading: false,
    editingKey: null,
    hlsInstance: null,
};

// ============================================================
//  DOM REFS
// ============================================================
const $ = (id) => document.getElementById(id);
const dom = {
    sourceSelect: $('sourceSelect'),
    searchInput: $('searchInput'),
    searchBtn: $('searchBtn'),
    status: $('status'),

    pageBrowse: $('pageBrowse'),
    pageSearch: $('pageSearch'),

    categoryNav: $('categoryNav'),
    browseGrid: $('browseGrid'),
    browseTitle: $('browseTitle'),
    browseBadge: $('browseBadge'),
    browseInfo: $('browseInfo'),
    pageInfo: $('pageInfo'),
    pageInfo2: $('pageInfo2'),
    browseHeader: $('browseHeader'),
    browsePager: $('browsePager'),

    emptyState: $('emptyState'),
    searchGrid: $('searchGrid'),
    resultStats: $('resultStats'),

    playerSection: $('player-section'),
    player: $('player'),
    playerIframe: $('player-iframe'),
    nowPlaying: $('nowPlaying'),
    m3u8Link: $('m3u8Link'),
    lineSelect: $('lineSelect'),
    episodesPanel: $('episodes-panel'),
    episodesList: $('episodes-list'),
    playerControls: $('playerControls'),

    importModal: $('importModal'),
    importTextarea: $('importTextarea'),
    importCount: $('importCount'),
    sourceList: $('sourceList'),

    playerLoading: $('player-loading'),
};

// ============================================================
//  STORAGE
// ============================================================
function loadStorage() {
    try {
        const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        state.favorites = data.favorites || [];
        state.history = data.history || [];
    } catch { state.favorites = [];
        state.history = []; }
}

function saveStorage() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
        favorites: state.favorites,
        history: state.history,
    }));
}

function isFav(vodId, sourceKey) {
    return state.favorites.some(f => f.vodId === vodId && f.sourceKey === sourceKey);
}

function toggleFav() {
    if (!state.currentVod || !state.currentSource) return;
    const id = state.currentVod.vod_id;
    const key = state.currentSource.key;
    const idx = state.favorites.findIndex(f => f.vodId === id && f.sourceKey === key);
    if (idx > -1) {
        state.favorites.splice(idx, 1);
        toast('已取消收藏', 'info');
    } else {
        state.favorites.push({ vodId: id, sourceKey: key, name: state.currentVod.vod_name, poster: state.currentVod
                .vod_pic });
        toast('⭐ 已收藏', 'success');
    }
    saveStorage();
}

function addHistory(vod, source, episode) {
    const entry = {
        vodId: vod.vod_id,
        sourceKey: source.key,
        name: vod.vod_name,
        poster: vod.vod_pic,
        episode: episode || '',
        time: Date.now()
    };
    state.history = state.history.filter(h => !(h.vodId === entry.vodId && h.sourceKey === entry.sourceKey));
    state.history.unshift(entry);
    if (state.history.length > 100) state.history.pop();
    saveStorage();
}

// ============================================================
//  SOURCES 管理
// ============================================================
function getStoredSources() {
    try {
        const stored = localStorage.getItem(STORAGE_SOURCES_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed) && parsed.length) {
                return parsed;
            }
        }
    } catch (e) {}
    return null;
}

function setStoredSources(sources) {
    localStorage.setItem(STORAGE_SOURCES_KEY, JSON.stringify(sources));
}

async function loadSources() {
    const stored = getStoredSources();
    if (stored) {
        return stored;
    }
    return [];
}

function hasSources() {
    return state.sources && state.sources.length > 0;
}

// ============================================================
//  隐藏源切换
// ============================================================
let showHiddenSources = false;

function toggleShowHiddenSources() {
    showHiddenSources = !showHiddenSources;
    populateSelect();
}

// ============================================================
//  源列表渲染（弹窗内）
// ============================================================
function renderSourceList() {
    const container = dom.sourceList;
    const sources = getStoredSources() || [];

    if (!sources.length) {
        container.innerHTML = '<div class="empty-hint">📭 暂无源，请导入</div>';
        dom.importCount.textContent = '0 个';
        return;
    }

    const groups = { stable: [], normal: [], backup: [] };
    sources.forEach(s => {
        const g = s.group || 'normal';
        if (groups[g]) groups[g].push(s);
        else groups.normal.push(s);
    });
    const labels = { stable: '稳定', normal: '普通', backup: '备用' };
    const dots = { stable: 'stable', normal: 'normal', backup: 'backup' };

    let html = '';
    Object.keys(groups).forEach(g => {
        if (!groups[g].length) return;
        html += `<div class="group-label"><span class="dot ${dots[g] || 'normal'}"></span> ${labels[g] || g}</div>`;
        groups[g].forEach(s => {
            const isEditing = state.editingKey === s.key;
            const isHidden = s.enabled === false;
            html += `
                <div class="source-item" style="${isEditing ? 'border-color:var(--primary);' : ''}">
                    <div class="s-info">
                        <span class="s-name">${esc(s.name)}${isHidden ? ' 🔒' : ''}</span>
                        <span class="s-key">${esc(s.key)}</span>
                    </div>
                    <div class="s-actions">
                        <button class="edit-btn" onclick="editSource('${esc(s.key)}')">编辑</button>
                        <button class="del-btn" onclick="deleteSource('${esc(s.key)}')">删除</button>
                    </div>
                </div>
            `;
        });
    });

    container.innerHTML = html;
    dom.importCount.textContent = sources.length + ' 个';
}

// ============================================================
//  编辑源
// ============================================================
function editSource(key) {
    const sources = getStoredSources() || [];
    const item = sources.find(s => s.key === key);
    if (!item) {
        toast('未找到该源', 'error');
        return;
    }
    state.editingKey = key;
    dom.importTextarea.value = JSON.stringify(item, null, 2);
    renderSourceList();
    dom.importTextarea.focus();
    dom.importTextarea.scrollTop = 0;
    toast('已加载到编辑区，修改后点击「导入」保存', 'info');
}

// ============================================================
//  删除源
// ============================================================
function deleteSource(key) {
    if (!confirm(`确定要删除源 "${key}" 吗？`)) return;
    const sources = getStoredSources() || [];
    const filtered = sources.filter(s => s.key !== key);
    if (filtered.length === sources.length) {
        toast('未找到该源', 'error');
        return;
    }
    setStoredSources(filtered);
    state.sources = filtered;
    if (state.editingKey === key) {
        state.editingKey = null;
        dom.importTextarea.value = '';
    }
    renderSourceList();
    populateSelect();
    if (!filtered.length) {
        renderEmptyState();
    } else {
        const first = filtered.find(s => s.group === 'stable') || filtered[0];
        if (first) {
            dom.sourceSelect.value = first.key;
            // loadBrowse(first);  // ← 删掉这行
        }
    }
    toast('✅ 已删除', 'success');
}

// ============================================================
//  导入功能
// ============================================================
function showImportModal() {
    dom.importModal.classList.add('open');
    renderSourceList();
    if (!state.editingKey) {
        dom.importTextarea.value = '';
    }
}

function closeImportModal() {
    dom.importModal.classList.remove('open');
    state.editingKey = null;
    dom.importTextarea.value = '';
}

function importSources() {
    const raw = dom.importTextarea.value.trim();
    if (!raw) { toast('请粘贴 JSON 内容', 'error'); return; }

    try {
        const data = JSON.parse(raw);
        if (!Array.isArray(data) || !data.length) {
            throw new Error('格式错误：需要非空数组');
        }
        for (const item of data) {
            if (!item.key || !item.name || !item.api) {
                throw new Error('每个源必须包含 key, name, api 字段');
            }
        }

        let currentSources = getStoredSources() || [];
        if (state.editingKey) {
            const idx = currentSources.findIndex(s => s.key === state.editingKey);
            if (idx > -1) {
                currentSources[idx] = data[0];
            } else {
                currentSources.push(data[0]);
            }
            state.editingKey = null;
            setStoredSources(currentSources);
            toast('✅ 更新成功', 'success');
        } else {
            setStoredSources(data);
            toast('✅ 导入成功，' + data.length + ' 个源', 'success');
        }

        state.sources = getStoredSources() || [];
        closeImportModal();
        populateSelect();
        const first = state.sources.find(s => s.group === 'stable') || state.sources[0];
        if (first) {
            dom.sourceSelect.value = first.key;
            loadBrowse(first);
        } else {
            renderEmptyState();
        }
    } catch (e) {
        toast('JSON 格式错误: ' + e.message, 'error');
    }
}

function importFromFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (!Array.isArray(data) || !data.length) {
                throw new Error('格式错误：需要非空数组');
            }
            for (const item of data) {
                if (!item.key || !item.name || !item.api) {
                    throw new Error('每个源必须包含 key, name, api 字段');
                }
            }
            setStoredSources(data);
            state.sources = data;
            toast('✅ 导入成功，' + data.length + ' 个源', 'success');
            closeImportModal();
            populateSelect();
            const first = state.sources.find(s => s.group === 'stable') || state.sources[0];
            if (first) {
                dom.sourceSelect.value = first.key;
                loadBrowse(first);
            } else {
                renderEmptyState();
            }
        } catch (err) {
            toast('文件解析失败: ' + err.message, 'error');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

function loadExample() {
    const example = [
        { key: 'feifan', name: '非凡资源', api: 'http://ffzy5.tv/api.php/provide/vod', type: 0, searchable: 1,
            filterable: 1, playerType: 1, group: 'stable' },
        { key: 'wolong', name: '卧龙资源', api: 'https://wolongzyw.com/api.php/provide/vod', type: 0, searchable: 1,
            filterable: 1, playerType: 1, group: 'stable' },
        { key: 'zuida', name: '最大资源', api: 'https://api.zuidapi.com/api.php/provide/vod', type: 0, searchable: 1,
            filterable: 1, playerType: 1, group: 'stable' }
    ];
    dom.importTextarea.value = JSON.stringify(example, null, 2);
    state.editingKey = null;
    renderSourceList();
    dom.importTextarea.focus();
    dom.importTextarea.scrollTop = 0;
    toast('示例已填入，点击「导入」即可', 'info');
}

// ============================================================
//  TOAST & STATUS
// ============================================================
function toast(msg, type = 'info') {
    const c = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    c.appendChild(el);
    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateX(30px)';
        el.style.transition = '0.25s ease';
        setTimeout(() => el.remove(), 280);
    }, 2600);
}

function setStatus(msg, loading = false) {
    dom.status.innerHTML = loading ? '<span class="spinner"></span> ' + msg : msg;
}

function esc(s) {
    if (s == null) return '';
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
}

// ============================================================
//  API
// ============================================================
async function fetchProxy(url, timeout = FETCH_TIMEOUT) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    try {
        const resp = await fetch(PROXY(url), { signal: ctl.signal });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.msg || 'HTTP ' + resp.status);
        }
        return await resp.json();
    } finally {
        clearTimeout(timer);
    }
}

// ============================================================
//  ENABLE/DISABLE CONTROLS
// ============================================================
function setControlsEnabled(enabled) {
    dom.searchInput.disabled = !enabled;
    dom.searchBtn.disabled = !enabled;
    if (!enabled) {
        dom.searchInput.placeholder = '请先导入源';
    } else {
        dom.searchInput.placeholder = '搜索片名…';
    }
}

// ============================================================
//  RENDER EMPTY STATE
// ============================================================
function renderEmptyState() {
    const grid = dom.browseGrid;
    grid.innerHTML = `
                <div class="empty-grid" style="grid-column:1/-1;padding:80px 20px;text-align:center;">
                    <div style="font-size:56px;margin-bottom:16px;">📜</div>
                    <div style="font-size:20px;font-weight:700;margin-bottom:8px;color:var(--text);">藏源阁尚空</div>
                    <div style="color:var(--text2);margin-bottom:16px;font-size:15px;">点击右上角「📜」按钮，录入你的源列表</div>
                    <button class="btn-primary" onclick="showImportModal()" style="font-size:15px;padding:8px 24px;">📜 录入源</button>
                    <div style="margin-top:12px;font-size:13px;color:var(--text3);">
                        或 <a onclick="loadExample()" style="color:var(--primary);cursor:pointer;">批阅示例</a> 快速体验
                    </div>
                </div>
            `;
    dom.categoryNav.innerHTML = '';
    dom.browseTitle.textContent = '📥 请导入源';
    dom.browseBadge.textContent = '';
    dom.browseInfo.textContent = '';
    dom.pageInfo.textContent = '-';
    dom.pageInfo2.textContent = '-';
    dom.sourceSelect.innerHTML = '<option value="">请导入源</option>';
    dom.sourceSelect.disabled = true;
    setStatus('请导入源');
    setControlsEnabled(false);
}

// ============================================================
//  PLAYER LOADING 控制
// ============================================================
function showPlayerLoading() {
    dom.playerLoading.classList.remove('hidden');
    dom.playerLoading.classList.add('show');
}

function hidePlayerLoading() {
    dom.playerLoading.classList.add('hidden');
    setTimeout(() => {
        dom.playerLoading.classList.remove('show');
    }, 400);
}

// ============================================================
//  切换到浏览模式（点击 Logo 触发）
// ============================================================
function switchToBrowse() {
    if (state.isPlaying) closePlayer();
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    dom.pageBrowse.classList.add('active');
    if (state.source) loadBrowse(state.source);
}

// ============================================================
//  线路切换
// ============================================================
function switchPlayerLine(index) {
    index = parseInt(index);
    state.currentLineIndex = index;
    const lines = state.currentLines;
    if (!lines || !lines[index]) return;
    const episodes = parseEpisodes(lines[index].url);
    state.currentEpisodes = episodes;
    renderEpisodesPanel(episodes);
    if (episodes.length) {
        const first = episodes[0];
        startPlayer(first.url, (state.currentVod?.vod_name || '') + ' ' + first.name);
    }
    toast('已切换: ' + lines[index].name, 'info');
}

// ============================================================
//  INIT
// ============================================================
async function init() {
    loadStorage();

    try {
        state.sources = await loadSources();
    } catch (e) {
        state.sources = [];
    }

    if (!hasSources()) {
        renderEmptyState();
        setTimeout(showDisclaimer, 500);
        dom.importModal.addEventListener('click', (e) => {
            if (e.target === dom.importModal) closeImportModal();
        });
        document.addEventListener('keydown', handleKeydown);
        return;
    }

    populateSelect();
    setControlsEnabled(true);
    setStatus('就绪');

    const first = state.sources.find(s => s.group === 'stable') || state.sources[0];
    if (first) {
        dom.sourceSelect.value = first.key;
        dom.sourceSelect.disabled = false;
        await loadBrowse(first);
    }

    dom.pageBrowse.classList.add('active');

    dom.sourceSelect.addEventListener('change', function() {
        const key = this.value;
        if (!key) return;
        const s = state.sources.find(src => src.key === key);
        if (!s) {
            toast('未找到该源', 'error');
            return;
        }
        if (state.isPlaying) closePlayer();
        state.isLoading = false;
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        dom.pageBrowse.classList.add('active');
        loadBrowse(s);
    });

    dom.searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doSearch();
    });
    dom.searchBtn.addEventListener('click', doSearch);

    dom.importModal.addEventListener('click', (e) => {
        if (e.target === dom.importModal) closeImportModal();
    });

    document.addEventListener('keydown', handleKeydown);

    document.addEventListener('click', (e) => {
        const panel = dom.episodesPanel;
        if (panel.classList.contains('open')) {
            if (!panel.contains(e.target) && !e.target.closest('.ctrl-btn') && !e.target.closest('.close-btn')) {
                panel.classList.remove('open');
            }
        }
    });

    dom.player.addEventListener('loadedmetadata', () => {
        hidePlayerLoading();
    });
    dom.player.addEventListener('canplay', () => {
        hidePlayerLoading();
    });
    dom.player.addEventListener('error', () => {
        hidePlayerLoading();
    });

    // ===== 连续点击状态栏 8 次切换隐藏源显示 =====
    let statusClickCount = 0;
    let statusClickTimer = null;

    dom.status.addEventListener('click', () => {
        statusClickCount++;
        clearTimeout(statusClickTimer);
        statusClickTimer = setTimeout(() => {
            if (statusClickCount >= 8) {
                toggleShowHiddenSources();
                toast(showHiddenSources ? '🔓 已显示特殊源' : '🔒 已隐藏特殊源', 'info');
            }
            statusClickCount = 0;
        }, 500);
    });

    setTimeout(showDisclaimer, 500);
}

function getSelectedSource() {
    const key = dom.sourceSelect.value;
    return state.sources.find(s => s.key === key) || null;
}

function populateSelect() {
    const sel = dom.sourceSelect;
    sel.innerHTML = '';
    sel.disabled = false;

    if (!state.sources || !state.sources.length) {
        sel.innerHTML = '<option value="">请导入源</option>';
        sel.disabled = true;
        return;
    }

    // 根据 showHiddenSources 决定是否显示隐藏源
    let sources = state.sources;
    if (!showHiddenSources) {
        sources = sources.filter(s => s.enabled !== false);
    }

    if (!sources || !sources.length) {
        sel.innerHTML = '<option value="">请导入源</option>';
        sel.disabled = true;
        return;
    }

    const groups = { stable: [], normal: [], backup: [] };
    sources.forEach(s => {
        const g = s.group || 'normal';
        if (groups[g]) groups[g].push(s);
        else groups.normal.push(s);
    });
    const labels = { stable: '🟢 稳定', normal: '🔵 普通', backup: '🟡 备用' };

    let hasOptions = false;
    Object.keys(groups).forEach(g => {
        if (!groups[g].length) return;
        hasOptions = true;
        const og = document.createElement('optgroup');
        og.label = labels[g] || g;
        if (showHiddenSources) og.label += ' 🔓';
        groups[g].forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.key;
            const isHidden = s.enabled === false;
            opt.textContent = s.name + (isHidden ? ' 🔒' : '');
            og.appendChild(opt);
        });
        sel.appendChild(og);
    });

    if (!hasOptions) {
        sel.innerHTML = '<option value="">请导入源</option>';
        sel.disabled = true;
    }
}

// ============================================================
//  BROWSE
// ============================================================
async function loadBrowse(source) {
    if (!source || state.isLoading) return;
    state.isLoading = true;
    state.source = source;
    state.category = null;
    state.page = 1;
    setStatus('加载中…', true);
    dom.categoryNav.innerHTML = '<span style="color:var(--text3);padding:4px 0;">加载分类…</span>';

    await loadMovies();

    try {
        const data = await fetchProxy(source.api + '?ac=list');
        const classes = data.class || [];
        state.categories = classes;
        renderCategories(classes);
    } catch (e) {
        dom.categoryNav.innerHTML = '';
    }
    setStatus('就绪');
    state.isLoading = false;
}

async function loadMovies() {
    const s = state.source;
    if (!s) return;
    const url = state.category ?
        `${s.api}?ac=videolist&t=${state.category}&pg=${state.page}` :
        `${s.api}?ac=videolist&pg=${state.page}`;

    dom.browseGrid.innerHTML = '<div class="empty-grid"><span class="spinner"></span> 加载中…</div>';

    try {
        const data = await fetchProxy(url);
        const list = data.list || [];
        state.totalPages = Math.max(1, parseInt(data.pagecount) || 1);
        state.movies = list;
        renderMovies(list);
        updatePager();
        dom.browseInfo.textContent = `${list.length} 部`;
        dom.browseBadge.textContent = `共 ${state.totalPages} 页`;
    } catch (e) {
        dom.browseGrid.innerHTML = `<div class="empty-grid">❌ ${esc(e.message)}</div>`;
        toast('加载失败: ' + e.message, 'error');
    }
}

function renderMovies(list) {
    const grid = dom.browseGrid;
    if (!list.length) {
        grid.innerHTML = '<div class="empty-grid">📭 暂无内容</div>';
        return;
    }
    const frag = document.createDocumentFragment();
    list.forEach(v => {
        const el = document.createElement('div');
        el.className = 'card';
        const poster = v.vod_pic || '';
        const score = v.vod_score || '';
        const remark = v.vod_remarks || '';
        el.innerHTML = `
                    <div class="poster-wrap">
                        <img loading="lazy" src="${esc(poster)}" 
                             onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22260%22 height=%22390%22%3E%3Crect width=%22100%25%22 height=%22100%25%22 fill=%22%23181e2a%22/%3E%3C/svg%3E'" />
                        <div class="play-icon">▶</div>
                        ${score ? `<div class="badge-top score">${esc(score)}</div>` : ''}
                        ${remark && !score ? `<div class="badge-top">${esc(remark)}</div>` : ''}
                    </div>
                    <div class="info">
                        <div class="name">${esc(v.vod_name)}</div>
                        <div class="meta">
                            <span class="tag">${esc(v.type_name || '影视')}</span>
                            ${score ? `<span class="score">${esc(score)}</span>` : ''}
                        </div>
                    </div>
                `;
        el.onclick = () => playMovie(v, state.source);
        frag.appendChild(el);
    });
    grid.innerHTML = '';
    grid.appendChild(frag);
}

function renderCategories(classes) {
    const top = classes.filter(c => String(c.type_pid) === '0');
    const kids = classes.filter(c => String(c.type_pid) !== '0');
    const nav = dom.categoryNav;
    nav.innerHTML = '';

    const all = document.createElement('span');
    all.className = 'cat active';
    all.textContent = '全部';
    all.onclick = () => {
        document.querySelectorAll('.category-nav .cat').forEach(c => c.classList.remove('active'));
        all.classList.add('active');
        state.category = null;
        state.page = 1;
        loadMovies();
    };
    nav.appendChild(all);

    top.forEach(c => {
        const btn = document.createElement('span');
        btn.className = 'cat';
        btn.textContent = c.type_name;
        btn.onclick = () => {
            document.querySelectorAll('.category-nav .cat').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            state.category = c.type_id;
            state.page = 1;
            loadMovies();
        };
        nav.appendChild(btn);
        kids.filter(k => String(k.type_pid) === String(c.type_id)).forEach(k => {
            const kb = document.createElement('span');
            kb.className = 'cat kid';
            kb.textContent = '└ ' + k.type_name;
            kb.onclick = () => {
                document.querySelectorAll('.category-nav .cat').forEach(c => c.classList.remove('active'));
                kb.classList.add('active');
                state.category = k.type_id;
                state.page = 1;
                loadMovies();
            };
            nav.appendChild(kb);
        });
    });
    dom.browseTitle.textContent = state.source ? state.source.name : '热门推荐';
}

function updatePager() {
    const txt = `${state.page}/${state.totalPages}`;
    dom.pageInfo.textContent = txt;
    dom.pageInfo2.textContent = txt;
}

function pagePrev() { if (state.page > 1) { state.page--;
        loadMovies(); } }

function pageNext() { if (state.page < state.totalPages) { state.page++;
        loadMovies(); } }

// ============================================================
//  SEARCH
// ============================================================
async function doSearch() {
    if (!hasSources()) {
        toast('请先导入源', 'error');
        return;
    }

    const q = dom.searchInput.value.trim();
    if (!q) { toast('请输入片名', 'error'); return; }

    const sel = dom.sourceSelect;
    const targets = sel.value === '__all__' ?
        state.sources :
        state.sources.filter(s => s.key === sel.value);
    if (!targets.length) { toast('请选择有效源', 'error'); return; }

    // 切换到搜索页
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    dom.pageSearch.classList.add('active');

    dom.emptyState.style.display = 'none';
    dom.resultStats.style.display = 'block';
    dom.searchGrid.innerHTML = '';
    dom.resultStats.textContent = '搜索中…';

    const mySeq = ++state.searchSeq;
    const results = [];
    const pool = targets.slice();
    let done = 0;

    const render = () => {
        const frag = document.createDocumentFragment();
        results.forEach(({ v, s }) => {
            const el = document.createElement('div');
            el.className = 'card';
            const fav = isFav(v.vod_id, s.key);
            const poster = v.vod_pic || '';
            const score = v.vod_score || '';
            el.innerHTML = `
                        <div class="poster-wrap">
                            <img loading="lazy" src="${esc(poster)}" 
                                 onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22260%22 height=%22390%22%3E%3Crect width=%22100%25%22 height=%22100%25%22 fill=%22%23181e2a%22/%3E%3C/svg%3E'" />
                            <div class="play-icon">▶</div>
                            ${score ? `<div class="badge-top score">${esc(score)}</div>` : ''}
                        </div>
                        <div class="info">
                            <div class="name">${esc(v.vod_name)}${fav ? ' <span class="star">⭐</span>' : ''}</div>
                            <div class="meta">
                                <span class="tag">${esc(v.type_name || '影视')}</span>
                                <span class="tag source">${esc(s.name)}</span>
                                ${v.vod_remarks ? `<span>${esc(v.vod_remarks)}</span>` : ''}
                                ${score ? `<span class="score">${esc(score)}</span>` : ''}
                            </div>
                        </div>
                    `;
            el.onclick = () => playMovie(v, s);
            frag.appendChild(el);
        });
        dom.searchGrid.innerHTML = '';
        dom.searchGrid.appendChild(frag);
        dom.resultStats.textContent =
            `找到 ${results.length} 个结果 · 完成 ${done}/${targets.length} 个源`;
    };

    async function worker() {
        while (pool.length && mySeq === state.searchSeq) {
            const s = pool.shift();
            try {
                const url = s.api + '?ac=detail&wd=' + encodeURIComponent(q);
                const data = await fetchProxy(url);
                (data.list || []).forEach(v => {
                    if (v && v.vod_id && v.vod_name) {
                        if (!results.some(r => r.v.vod_id === v.vod_id && r.s.key === s.key)) {
                            results.push({ v, s });
                        }
                    }
                });
            } catch (e) { /* skip */ }
            done++;
            render();
        }
    }

    const workers = Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker);
    await Promise.all(workers);
    if (mySeq !== state.searchSeq) return;
    render();
    if (!results.length) {
        dom.resultStats.textContent = '未找到结果，试试其他关键词';
        toast('未找到结果', 'error');
    }
}

// ============================================================
//  核心播放逻辑
// ============================================================
function hideAllContent() {
    dom.browseGrid.style.display = 'none';
    dom.categoryNav.style.display = 'none';
    dom.browseHeader.style.display = 'none';
    dom.browsePager.style.display = 'none';
    dom.searchGrid.style.display = 'none';
    dom.resultStats.style.display = 'none';
    if (dom.emptyState) dom.emptyState.style.display = 'none';
}

function restoreAllContent() {
    dom.browseGrid.style.display = '';
    dom.categoryNav.style.display = '';
    dom.browseHeader.style.display = '';
    dom.browsePager.style.display = '';
    dom.searchGrid.style.display = '';
    dom.resultStats.style.display = '';
    if (dom.emptyState) dom.emptyState.style.display = '';
}

async function playMovie(vod, source) {
    state.currentVod = vod;
    state.currentSource = source;

    setStatus('加载播放地址…', true);

    hideAllContent();
    showPlayerLoading();

    try {
        const data = await fetchProxy(source.api + '?ac=detail&ids=' + vod.vod_id);
        const detail = data.list?.[0] || vod;

        let froms = [],
            urls = [];
        const playFrom = detail.vod_play_from || '';
        const playUrl = detail.vod_play_url || '';

        if (playFrom && playUrl) {
            froms = playFrom.split('$$$').filter(Boolean);
            urls = playUrl.split('$$$').filter(Boolean);
        }

        if (!froms.length) {
            const keys = Object.keys(detail).filter(k => k.startsWith('vod_play_from'));
            for (const k of keys) {
                const idx = k.replace('vod_play_from', '');
                const f = detail[k] || '';
                const u = detail['vod_play_url' + idx] || '';
                if (f && u) {
                    froms.push(f);
                    urls.push(u);
                }
            }
        }

        const lines = froms.map((f, i) => ({ name: f, url: urls[i] || '' }))
            .filter(l => l.url.trim());

        lines.sort((a, b) => (a.url.includes('.m3u8') ? 0 : 1) - (b.url.includes('.m3u8') ? 0 : 1));

        if (!lines.length) {
            toast('该源无可用播放地址', 'error');
            setStatus('无播放地址');
            hidePlayerLoading();
            restoreAllContent();
            return;
        }

        state.currentLines = lines;
        state.currentLineIndex = 0;

        showPlayer();

        const firstUrl = lines[0].url;
        const episodes = parseEpisodes(firstUrl);

        if (episodes.length) {
            state.currentEpisodes = episodes;
            const firstEp = episodes[0];
            const fullUrl = normalizeUrl(firstEp.url);
            startPlayer(fullUrl, vod.vod_name + ' ' + firstEp.name);
            renderEpisodesPanel(episodes);
        } else {
            const fullUrl = normalizeUrl(firstUrl);
            startPlayer(fullUrl, vod.vod_name);
            renderEpisodesPanel([]);
        }

        renderPlayerLines(lines);

        setStatus('播放中');
    } catch (e) {
        toast('获取播放地址失败: ' + e.message, 'error');
        setStatus('加载失败');
        hidePlayerLoading();
        restoreAllContent();
    }
}

function parseEpisodes(url) {
    const parts = url.split('#').filter(p => p.includes('$'));
    if (!parts.length) {
        const fullUrl = normalizeUrl(url);
        return [{ name: '播放', url: fullUrl }];
    }
    return parts.map(p => {
        const i = p.indexOf('$');
        const name = p.slice(0, i).trim() || '播放';
        let addr = p.slice(i + 1);
        return { name, url: normalizeUrl(addr) };
    });
}

function normalizeUrl(url) {
    let result = url.trim();
    if (result.startsWith('/')) {
        const source = state.currentSource;
        if (source) {
            const base = source.api.replace(/\/api\.php.*$/, '');
            result = base + result;
        }
    }
    return result;
}

// ============================================================
//  显示播放器
// ============================================================
function showPlayer() {
    state.isPlaying = true;
    dom.playerSection.classList.add('open');
    dom.playerControls.classList.add('open');
    dom.playerSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderPlayerLines(lines) {
    const select = dom.lineSelect;
    select.innerHTML = '';
    select.style.display = lines.length > 1 ? 'block' : 'none';

    lines.forEach((l, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = l.name;
        if (i === state.currentLineIndex) opt.selected = true;
        select.appendChild(opt);
    });
}

// ============================================================
//  选集面板
// ============================================================
function toggleEpisodesPanel() {
    dom.episodesPanel.classList.toggle('open');
    if (dom.episodesPanel.classList.contains('open')) {
        if (!state.currentEpisodes.length && state.currentLines.length) {
            const url = state.currentLines[state.currentLineIndex]?.url || '';
            const eps = parseEpisodes(url);
            state.currentEpisodes = eps;
            renderEpisodesPanel(eps);
        }
    }
}

function renderEpisodesPanel(episodes) {
    const list = dom.episodesList;
    list.innerHTML = '';
    if (!episodes || !episodes.length) {
        list.innerHTML = '<span class="ep-loading">暂无剧集</span>';
        return;
    }

    // 判断是否为直链播放（只有一集且名字叫"播放"）
    if (episodes.length === 1 && episodes[0].name === '播放') {
        const el = document.createElement('span');
        el.className = 'ep';
        el.textContent = '▶ 播放';
        el.onclick = () => {
            document.querySelectorAll('#episodes-list .ep').forEach(e => e.classList.remove('active'));
            el.classList.add('active');
            startPlayer(episodes[0].url, state.currentVod?.vod_name || '播放');
            dom.episodesPanel.classList.remove('open');
            if (state.currentVod && state.currentSource) {
                addHistory(state.currentVod, state.currentSource, '播放');
            }
        };
        list.appendChild(el);
        return;
    }

    // 多集正常显示
    episodes.forEach((ep, idx) => {
        const el = document.createElement('span');
        el.className = 'ep';
        el.textContent = ep.name;
        el.onclick = () => {
            document.querySelectorAll('#episodes-list .ep').forEach(e => e.classList.remove('active'));
            el.classList.add('active');
            startPlayer(ep.url, (state.currentVod?.vod_name || '') + ' ' + ep.name);
            dom.episodesPanel.classList.remove('open');
            if (state.currentVod && state.currentSource) {
                addHistory(state.currentVod, state.currentSource, ep.name);
            }
        };
        list.appendChild(el);
    });
}

// ============================================================
//  核心播放引擎（方案一优化版：防塌陷）
// ============================================================
function startPlayer(url, title) {
    if (!url || !url.trim()) {
        toast('播放地址为空', 'error');
        return;
    }

    url = url.trim();

    if (url.startsWith('/')) {
        const source = state.currentSource;
        if (source) {
            const base = source.api.replace(/\/api\.php.*$/, '');
            url = base + url;
        }
    }

    state.currentUrl = url;

    dom.nowPlaying.textContent = title || '正在播放';
    dom.m3u8Link.value = url;

    dom.playerIframe.style.display = 'none';
    dom.playerIframe.src = '';
    dom.player.style.display = 'block';

    // === 切换前：记住当前高度，防止塌陷 ===
    const video = dom.player;
    const currentHeight = video.offsetHeight;
    if (currentHeight > 50) {
        video.style.minHeight = currentHeight + 'px';
    }

    // === 销毁旧 HLS 实例 ===
    if (state.hlsInstance) {
        state.hlsInstance.destroy();
        state.hlsInstance = null;
    }

    const isHtml = url.includes('.html') ||
        url.includes('/play/') ||
        (!url.includes('.m3u8') && !url.includes('.mp4') && !url.includes('.ts') && !url.includes('.flv') && !url
            .includes('.mkv'));

    if (isHtml) {
        extractM3u8FromHtml(url, title);
        return;
    }

    if (url.includes('.m3u8') || url.includes('.m3u8?')) {
        if (window.Hls && Hls.isSupported()) {
            const hls = new Hls({ enableWorker: true });
            state.hlsInstance = hls;
            hls.loadSource(url);
            hls.attachMedia(video);

            // 加载完成后清除占位高度
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                video.style.minHeight = '';
                video.play().catch(() => {});
            });

            hls.on(Hls.Events.ERROR, (e, data) => {
                video.style.minHeight = '';
                if (data.fatal) {
                    toast('HLS 播放失败，尝试嵌入', 'error');
                    startPlayerInIframe(url, title);
                }
            });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = url;
            video.play().catch(() => {});
        } else {
            startPlayerInIframe(url, title);
        }
        return;
    }

    video.src = url;
    video.play().catch(() => {
        toast('无法直接播放，尝试嵌入', 'error');
        startPlayerInIframe(url, title);
    });
}

// ============================================================
//  从 HTML 提取 m3u8
// ============================================================
async function extractM3u8FromHtml(pageUrl, title) {
    setStatus('解析中…', true);

    try {
        if (pageUrl.startsWith('/')) {
            const source = state.currentSource;
            if (source) {
                const base = source.api.replace(/\/api\.php.*$/, '');
                pageUrl = base + pageUrl;
            }
        }

        const resp = await fetchProxy(pageUrl);
        const html = typeof resp === 'string' ? resp : JSON.stringify(resp);

        const patterns = [
            /["'](https?:[^"']+\.m3u8[^"']*)["']/,
            /["'](\/[^"']+\.m3u8[^"']*)["']/,
            /var\s+url\s*=\s*["']([^"']+\.m3u8[^"']*)["']/,
            /url\s*[:=]\s*["']([^"']+\.m3u8[^"']*)["']/i,
            /src\s*[:=]\s*["']([^"']+\.m3u8[^"']*)["']/i,
            /(https?:[^\s"']+\.m3u8[^\s"']*)/,
            /(\/[^\s"']+\.m3u8[^\s"']*)/,
        ];

        let m3u8Url = null;
        for (const pattern of patterns) {
            const match = html.match(pattern);
            if (match) {
                m3u8Url = match[1];
                break;
            }
        }

        if (m3u8Url) {
            if (m3u8Url.startsWith('/')) {
                const base = new URL(pageUrl).origin;
                m3u8Url = base + m3u8Url;
            }
            if (!m3u8Url.startsWith('http://') && !m3u8Url.startsWith('https://')) {
                const base = pageUrl.replace(/\/[^/]*$/, '/');
                m3u8Url = base + m3u8Url;
            }
            toast('✅ 解析成功', 'success');
            setStatus('就绪');
            startPlayer(m3u8Url, title || '解析播放');
        } else {
            toast('未能提取 m3u8，尝试嵌入页面', 'info');
            startPlayerInIframe(pageUrl, title);
        }
    } catch (e) {
        toast('解析失败: ' + e.message, 'error');
        setStatus('解析失败');
        startPlayerInIframe(pageUrl, title);
    }
}

// ============================================================
//  iframe 备选
// ============================================================
function startPlayerInIframe(url, title) {
    dom.playerSection.classList.add('open');
    dom.playerControls.classList.add('open');
    dom.nowPlaying.textContent = title || '嵌入播放';
    dom.m3u8Link.value = url;

    dom.player.style.display = 'none';
    dom.playerIframe.style.display = 'block';
    dom.playerIframe.src = url;

    toast('已切换到嵌入式播放', 'info');
    dom.playerSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============================================================
//  播放器控制
// ============================================================
function closePlayer() {
    state.isPlaying = false;
    dom.playerSection.classList.remove('open');
    dom.playerControls.classList.remove('open');
    dom.episodesPanel.classList.remove('open');

    if (state.hlsInstance) {
        state.hlsInstance.destroy();
        state.hlsInstance = null;
    }
    dom.player.removeAttribute('src');
    dom.player.load();
    dom.player.style.display = 'block';
    dom.playerIframe.style.display = 'none';
    dom.playerIframe.src = '';
    dom.nowPlaying.textContent = '—';
    dom.m3u8Link.value = '';

    state.currentLines = [];
    state.currentEpisodes = [];

    dom.lineSelect.style.display = 'none';

    hidePlayerLoading();
    restoreAllContent();
}

// ============================================================
//  KEYBOARD
// ============================================================
function handleKeydown(e) {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    const video = dom.player;
    if (dom.playerSection.classList.contains('open') && video) {
        switch (e.key) {
            case ' ':
                e.preventDefault();
                video.paused ? video.play() : video.pause();
                break;
            case 'ArrowRight':
                e.preventDefault();
                video.currentTime += 10;
                break;
            case 'ArrowLeft':
                e.preventDefault();
                video.currentTime -= 10;
                break;
            case 'Escape':
                if (document.fullscreenElement) document.exitFullscreen();
                break;
        }
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        dom.searchInput.focus();
        dom.searchInput.select();
    }
}

// ============================================================
//  DISCLAIMER
// ============================================================
let disclaimerShown = false;

function showDisclaimer() {
    // 检查是否已经同意过
    const agreed = localStorage.getItem(STORAGE_DISCLAIMER_KEY);
    if (agreed === 'true') return;

    if (disclaimerShown) return;
    disclaimerShown = true;

    const result = confirm(
        '📺 TVPlayer · 免责声明\n\n' +
        '1. 本工具为纯前端空壳播放器，不包含、不存储任何音视频内容。\n' +
        '2. 所有播放资源均来自第三方公开采集接口，由用户自行配置。\n' +
        '3. 仅供技术学习交流使用，请于 24 小时内删除缓存内容。\n' +
        '4. 尊重版权，支持正版影视平台。\n' +
        '5. 使用本工具产生的一切法律风险由使用者自行承担。\n\n' +
        '点击「确定」表示您同意上述条款。'
    );

    if (result) {
        localStorage.setItem(STORAGE_DISCLAIMER_KEY, 'true');
    }
}

// ============================================================
//  BOOT
// ============================================================
document.addEventListener('DOMContentLoaded', init);
