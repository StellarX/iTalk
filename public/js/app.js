/* =========================================================
   iTalk 前端主控制器
   ========================================================= */
(function () {
  'use strict';

  // ---------- 工具 ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) =>
    String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  // 弹框层级管理：最后打开的弹框始终位于最上层（解决嵌套弹框被列表遮挡的问题）
  let modalZ = 1000;
  function raiseModal(mask) {
    if (!mask) return;
    modalZ += 1;
    mask.style.zIndex = String(modalZ);
  }

  // 语音合成（发音）
  let voices = [];
  function loadVoices() {
    if (!('speechSynthesis' in window)) return;
    voices = window.speechSynthesis.getVoices() || [];
  }
  if ('speechSynthesis' in window) {
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }
  // Web Speech 兜底（修 Chrome 首调被吞 + cancel 竞态）
  function speechFallback(text) {
    if (!('speechSynthesis' in window) || !text) return;
    try {
      if (window.speechSynthesis.speaking) window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      const v = voices.find((x) => /en[-_]US/i.test(x.lang)) || voices.find((x) => /^en/i.test(x.lang));
      if (v) u.voice = v;
      u.rate = 0.95;
      // 延迟一帧规避 Chrome 第一次 speak 被丢弃的已知 bug
      setTimeout(() => { try { window.speechSynthesis.speak(u); } catch (e) {} }, 60);
    } catch (e) { /* ignore */ }
  }
  // 优先播放真实音频文件，失败回退语音合成
  function speak(word, audioUrl) {
    if (!word) return;
    const url = (audioUrl && String(audioUrl).trim())
      ? audioUrl
      : `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=2`;
    try {
      const a = new Audio(url);
      a.onerror = () => speechFallback(word);
      const p = a.play();
      if (p && typeof p.catch === 'function') p.catch(() => speechFallback(word));
    } catch (e) {
      speechFallback(word);
    }
  }

  // 音标渲染：英 /.../ 美 /.../，带标签；兼容旧格式
  function renderPhonetic(ph) {
    if (!ph) return '';
    const raw = String(ph).trim();
    const segs = raw.match(/\/[^/]+\//g) || [];
    const hasUk = raw.includes('英');
    const hasUs = raw.includes('美');
    if (hasUs && hasUk && segs.length >= 2) {
      return `<span class="ph-badge uk">英</span> ${esc(segs[0])}　<span class="ph-badge us">美</span> ${esc(segs[1])}`;
    }
    if (hasUs && !hasUk && segs.length >= 2) {
      // 旧格式：/uk/ 美 /us/
      return `<span class="ph-badge uk">英</span> ${esc(segs[0])}　<span class="ph-badge us">美</span> ${esc(segs[1])}`;
    }
    if (hasUk && segs.length >= 1) return `<span class="ph-badge uk">英</span> ${esc(segs[0])}`;
    if (hasUs && segs.length >= 1) return `<span class="ph-badge us">美</span> ${esc(segs[0])}`;
    if (segs.length >= 1) return `<span class="ph-badge">音标</span> ${esc(segs[0])}`;
    return esc(raw);
  }

  const FAM = [
    { key: 'unknown', label: '不认识', tip: '完全没印象', cls: 'f0', level: 0 },
    { key: 'fuzzy', label: '模糊', tip: '有点眼熟', cls: 'f1', level: 1 },
    { key: 'familiar', label: '熟悉', tip: '能想起意思', cls: 'f2', level: 2 },
    { key: 'mastered', label: '掌握', tip: '脱口而出', cls: 'f3', level: 3 },
  ];
  const famKeyToLevel = (key) => { const f = FAM.find((x) => x.key === key); return f ? f.level : -1; };
  function strengthCls(s) {
    return s < 60 ? 'strength-weak' : s < 85 ? 'strength-mid' : 'strength-strong';
  }

  // ---------- 主题 ----------
  const THEMES = ['system', 'light', 'dark'];
  const THEME_ICON = { system: '🌗', light: '☀️', dark: '🌙' };
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('italk_theme', t);
    $('#theme-toggle').textContent = THEME_ICON[t] || '🌗';
  }
  function initTheme() {
    const saved = localStorage.getItem('italk_theme') || 'system';
    applyTheme(saved);
    $('#theme-toggle').addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme');
      const next = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
      applyTheme(next);
      toast('主题：' + (next === 'system' ? '跟随系统' : next === 'light' ? '明亮' : '暗色'));
    });
  }

  // ---------- 发音方式：自动 / 手动（纯前端设置，存 localStorage，不落库） ----------
  let autoPlayAudio = localStorage.getItem('italk_autoplay') === '1';
  function updateAudioToggleUI() {
    const btn = $('#audio-toggle');
    if (!btn) return;
    btn.innerHTML = autoPlayAudio ? '🔊 自动' : '🔈 手动';
    btn.setAttribute('title', autoPlayAudio
      ? '发音方式：自动（每显示新单词自动朗读）'
      : '发音方式：手动（点击 🔊 按钮朗读）');
    btn.classList.toggle('on', autoPlayAudio);
  }
  function setAutoPlay(v) {
    autoPlayAudio = !!v;
    localStorage.setItem('italk_autoplay', autoPlayAudio ? '1' : '0');
    updateAudioToggleUI();
    toast(autoPlayAudio ? '已开启自动发音' : '已切换为手动发音');
  }
  function initAudioToggle() {
    updateAudioToggleUI();
    const btn = $('#audio-toggle');
    if (btn) btn.addEventListener('click', () => setAutoPlay(!autoPlayAudio));
  }

  // ---------- 视图切换 ----------
  function showView(name) {
    // 学习/复习进行中切换保护：提示结束当前会话
    if (activeSession && name !== activeSession) {
      const label = activeSession === 'learn' ? '学习' : '复习';
      const ok = confirm(`当前${label}正在进行，切换页面将结束本次${label}进度（已学的单词不会丢失）。确定离开吗？`);
      if (!ok) return; // 留在当前页
      endActiveSession();
    }
    $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    $$('.view').forEach((v) => v.classList.add('hidden'));
    $('#view-' + name).classList.remove('hidden');
    if (name === 'search') { const si = $('#search-input'); if (si) si.focus(); }
    if (name === 'browse' && browseState.libraryId && !browseState.loading) loadBrowsePage();
    const titles = { learn: '背单词', review: '智能复习', wordbooks: '我的单词本', search: '单词搜索', browse: '浏览词库' };
    $('#view-title').textContent = titles[name] || '';
    // 离开单词本视图时复位详情页（隐藏详情，恢复列表头部与网格）
    if (name !== 'wordbooks') resetWbDetail();
  }

  // 复位单词本详情页：隐藏详情、恢复列表页头部（含「新建单词本」入口）与卡片网格
  function resetWbDetail() {
    const d = $('#wb-detail');
    if (d) d.classList.add('hidden');
    const head = $('.wb-head');
    if (head) head.classList.remove('hidden');
    const grid = $('#wb-grid');
    if (grid) grid.classList.remove('hidden');
  }

  // ---------- 认证 ----------
  let authMode = 'login';
  function initAuth() {
    $$('.tab').forEach((t) =>
      t.addEventListener('click', () => {
        $$('.tab').forEach((x) => x.classList.remove('active'));
        t.classList.add('active');
        authMode = t.dataset.tab;
        $('#auth-submit').textContent = authMode === 'login' ? '登录' : '注册';
        $('#auth-msg').textContent = '';
      })
    );
    $('#auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const username = f.username.value.trim();
      const password = f.password.value;
      $('#auth-msg').textContent = '';
      try {
        const data = authMode === 'login'
          ? await API.post('/auth/login', { username, password })
          : await API.post('/auth/register', { username, password });
        API.setToken(data.token);
        enterApp(data.user);
        toast('欢迎，' + data.user.username);
      } catch (err) {
        $('#auth-msg').textContent = err.message;
      }
    });
    $('#logout-btn').addEventListener('click', () => {
      API.setToken(null);
      location.reload();
    });
  }

  function enterApp(user) {
    $('#auth-view').classList.add('hidden');
    $('#app-view').classList.remove('hidden');
    $('#user-name').textContent = user.username;
    $('#user-avatar').textContent = (user.username[0] || 'U').toUpperCase();
    initLearn();
    initReview();
    initSearch();
    initBrowse();
    loadWordbooks();
    initAccount();
  }

  // ---------- 账号设置（修改用户名/密码） ----------
  function initAccount() {
    const modal = $('#account-modal');
    $('#user-chip').addEventListener('click', () => {
      $('#acc-username').value = ($('#user-name').textContent || '').trim();
      $('#acc-cur').value = '';
      $('#acc-new').value = '';
      $('#acc-new2').value = '';
      $('#acc-msg').textContent = '';
      modal.classList.remove('hidden');
      raiseModal(modal);
      $('#acc-username').focus();
    });
    const close = () => modal.classList.add('hidden');
    $('#acc-cancel').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target.id === 'account-modal') close(); });
    $('#acc-save').addEventListener('click', async () => {
      const username = $('#acc-username').value.trim();
      const cur = $('#acc-cur').value;
      const nw = $('#acc-new').value;
      const nw2 = $('#acc-new2').value;
      $('#acc-msg').textContent = '';
      if (!username) { $('#acc-msg').textContent = '用户名不能为空'; return; }
      if (nw && nw.length < 6) { $('#acc-msg').textContent = '新密码至少 6 位'; return; }
      if (nw && nw !== nw2) { $('#acc-msg').textContent = '两次输入的新密码不一致'; return; }
      try {
        const data = await API.patch('/auth/me', {
          username,
          ...(nw ? { currentPassword: cur, newPassword: nw } : {}),
        });
        API.setToken(data.token);
        $('#user-name').textContent = data.user.username;
        $('#user-avatar').textContent = (data.user.username[0] || 'U').toUpperCase();
        close();
        toast('账号已更新');
      } catch (e) { $('#acc-msg').textContent = e.message; }
    });
  }

  // ---------- 卡片渲染 ----------
  function cardHTML(w) {
    return `
    <div class="flip-card" data-word-id="${w.id}">
      <div class="flip-inner">
        <div class="face front">
          <div class="card-front-center">
            <div>
              <div class="card-word">${esc(w.word)}</div>
              <div class="card-phonetic">${renderPhonetic(w.phonetic)} <button class="speak-btn" data-speak="${esc(w.word)}" data-audio="${esc(w.audio_url || '')}" title="发音">🔊</button></div>
              <div class="card-hint">点击卡片查看释义 →</div>
            </div>
          </div>
        </div>
        <div class="face back">
          <div class="card-word">${esc(w.word)} <button class="speak-btn" data-speak="${esc(w.word)}" data-audio="${esc(w.audio_url || '')}" title="发音">🔊</button></div>
          <div class="card-phonetic">${renderPhonetic(w.phonetic)}</div>
          <div class="detail-block"><div class="label">释义</div><div class="value">${esc(w.definition)}</div></div>
          <div class="detail-block"><div class="label">例句</div><div class="value">${esc(w.example || '—')}</div></div>
          <div class="detail-block"><div class="label">短语</div><div class="value"><span class="phrase-chip">${esc(w.phrase || '—')}</span></div></div>
          <div class="familiarity">
            ${FAM.map((f) => `<button class="fam-btn ${f.cls}" data-fam="${f.key}">${f.label}<small>${f.tip}</small></button>`).join('')}
          </div>
          <div class="card-actions">
            <button class="btn-ghost" data-add="${w.id}">＋ 加入单词本</button>
            <button class="btn-ghost" data-flip>返回正面</button>
          </div>
        </div>
      </div>
    </div>`;
  }

  function bindCard(container, word, onGrade) {
    const card = $('.flip-card', container);
    // 仅正面点击翻转（背面任意位置不翻转，只有「返回正面」按钮可翻回）
    const front = $('.face.front', card);
    if (front) {
      front.addEventListener('click', (e) => {
        if (e.target.closest('button')) return; // 发音等按钮自行处理
        card.classList.add('flipped');
      });
    }
    $$('[data-flip]', card).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); card.classList.remove('flipped'); }));
    $$('[data-speak]', card).forEach((b) =>
      b.addEventListener('click', (e) => { e.stopPropagation(); speak(b.dataset.speak, b.dataset.audio); })
    );
    $$('.fam-btn', card).forEach((b) =>
      b.addEventListener('click', async () => {
        const fam = b.dataset.fam;
        b.disabled = true;
        try {
          await gradeWord(word.id, fam);
          onGrade();
        } catch (err) {
          toast('提交失败：' + err.message);
          b.disabled = false;
        }
      })
    );
    const addBtn = $('[data-add]', card);
    if (addBtn) addBtn.addEventListener('click', (e) => { e.stopPropagation(); openWbModal(addBtn.dataset.add); });
  }

  // 单个卡片评分（学习/复习共用反馈接口）
  async function gradeWord(wordId, familiarity) {
    const path = currentMode === 'review' ? '/review/feedback' : '/learn/feedback';
    await API.post(path, { wordId: Number(wordId), familiarity });
  }

  // 浏览 / 详情场景的反馈提交（不依赖会话），可选 sessionType 便于记忆日志区分来源
  async function submitFeedbackApi(wordId, familiarity, sessionType = 'browse') {
    return API.post('/learn/feedback', {
      wordId: Number(wordId),
      familiarity,
      sessionType,
    });
  }

  let currentMode = 'learn';
  let activeSession = null; // 'learn' | 'review' | null：是否有正在进行的会话

  function endActiveSession() {
    if (!activeSession) return;
    const setup = $('#' + activeSession + '-setup');
    const session = $('#' + activeSession + '-session');
    if (session) { session.classList.add('hidden'); session.innerHTML = ''; }
    if (setup) setup.classList.remove('hidden');
    activeSession = null;
  }

  function runSession(container, mode, loader, feedbackHint) {
    currentMode = mode;
    activeSession = mode;
    container.innerHTML = '<div class="muted">加载中…</div>';
    loader()
      .then((words) => {
        if (!words.length) {
          container.innerHTML = `<div class="panel luxury-glass" style="text-align:center">
            <p class="muted">没有可用的单词。${mode === 'learn' ? '请确认词库已导入数据。' : '先去学习一些单词，系统才能评估你的记忆薄弱项。'}</p>
            <button class="btn-primary magnetic" id="session-back">← 返回</button>
          </div>`;
          $('session-back', container).addEventListener('click', () => {
            container.classList.add('hidden'); container.innerHTML = '';
            $('#' + mode + '-setup').classList.remove('hidden');
            activeSession = null;
          });
          return;
        }
        let i = 0;
        const total = words.length;
        const render = () => {
          container.innerHTML = `
            <div class="progress"><i style="width:${Math.round((i / total) * 100)}%"></i></div>
            <div class="session-meta"><span>第 ${i + 1} / ${total} 个</span><span>${mode === 'learn' ? '📚 学习' : '🔁 复习'}模式</span></div>
            ${cardHTML(words[i])}`;
          bindCard(container, words[i], () => {
            i++;
            if (i < total) render();
            else finishSession(container, mode, total);
          });
          // 自动发音：展示新单词时朗读（手动模式下仅点击 🔊 触发）
          if (autoPlayAudio) speak(words[i].word, words[i].audio_url);
        };
        render();
      })
      .catch((err) => {
        container.innerHTML = `<div class="panel luxury-glass" style="text-align:center"><p class="muted">加载失败：${esc(err.message)}</p><button class="btn-primary magnetic" id="session-back">← 返回</button></div>`;
        const b = $('session-back', container);
        if (b) b.addEventListener('click', () => { container.classList.add('hidden'); container.innerHTML = ''; $('#' + mode + '-setup').classList.remove('hidden'); activeSession = null; });
        activeSession = null;
      });
  }

  // 学/复习结束后刷新统计（已学数量、各词库进度），免去手动刷新
  async function refreshStats() {
    try { await refreshReviewStats(); } catch (e) { /* ignore */ }
    try { await refreshLibStats(); } catch (e) { /* ignore */ }
  }

  function finishSession(container, mode, total) {
    container.innerHTML = `
      <div class="panel luxury-glass" style="text-align:center">
        <h2>🎉 本轮完成！</h2>
        <p class="muted">共处理 <strong>${total}</strong> 个单词。<br/>
        ${mode === 'learn'
          ? '继续学习可巩固新词，或前往「智能复习」专攻薄弱项。'
          : '薄弱单词的记忆数据已更新，下次复习会重新排列优先级。'}</p>
        <button class="btn-primary magnetic" onclick="location.reload()">返回首页</button>
      </div>`;
    activeSession = null;
    refreshStats();
  }

  // ---------- 学习模块 ----------
  let currentLibraries = [];

  function updateLibStat() {
    const sel = $('#learn-library');
    const el = $('#learn-lib-stat');
    if (!sel || !el) return;
    const lib = currentLibraries.find((l) => String(l.id) === String(sel.value));
    if (!lib) { el.innerHTML = ''; return; }
    const total = Number(lib.word_count || 0);
    const learned = Number(lib.learned_count || 0);
    const pct = total ? Math.round((learned / total) * 100) : 0;
    el.innerHTML = `已学习 <strong>${learned}</strong> / ${total} 词（<strong>${pct}%</strong>）`;
  }

  // 重新拉取词库统计（已学数量 + 各词库进度），供学/复习结束后刷新
  async function refreshLibStats() {
    try {
      const { libraries } = await API.get('/libraries');
      currentLibraries = libraries;
      renderLibProgress($('#review-lib-progress'), libraries);
      updateLibStat();
    } catch (e) { /* ignore */ }
  }

  async function initLearn() {
    const sel = $('#learn-library');
    try {
      const { libraries } = await API.get('/libraries');
      currentLibraries = libraries;
      sel.innerHTML = libraries.map((l) => `<option value="${l.id}">${esc(l.name)}（${l.word_count} 词）</option>`).join('');
    } catch (e) { /* ignore */ }

    sel.addEventListener('change', updateLibStat);
    updateLibStat();

    $('#learn-start').addEventListener('click', () => {
      const libraryId = sel.value;
      const count = $('#learn-count').value;
      if (!libraryId) return toast('请先选择词库');
      $('#learn-setup').classList.add('hidden');
      const session = $('#learn-session');
      session.classList.remove('hidden');
      runSession(session, 'learn', () =>
        API.post('/learn/start', { libraryId: Number(libraryId), count: Number(count) }).then((d) => d.words)
      );
    });
  }

  // 词库学习进度（已学数量 + 百分比）
  function renderLibProgress(el, libraries) {
    if (!el) return;
    if (!libraries || !libraries.length) { el.innerHTML = ''; return; }
    el.innerHTML = '<div class="lib-progress-title">各词库学习进度</div>' + libraries.map((l) => {
      const total = Number(l.word_count || 0);
      const learned = Number(l.learned_count || 0);
      const pct = total ? Math.round((learned / total) * 100) : 0;
      return `<div class="lib-row">
        <span class="lib-name">${esc(l.name)}</span>
        <div class="lib-bar"><i style="width:${pct}%"></i></div>
        <span class="lib-num">${learned}/${total} · ${pct}%</span>
      </div>`;
    }).join('');
  }

  // ---------- 复习模块 ----------
  async function initReview() {
    try {
      const { libraries } = await API.get('/libraries');
      currentLibraries = libraries;
      $('#review-library').innerHTML = '<option value="">不限</option>' +
        libraries.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
      renderLibProgress($('#review-lib-progress'), libraries);
    } catch (e) { /* ignore */ }
    await refreshWbSelect();
    await refreshReviewStats();

    $('#review-start').addEventListener('click', () => {
      const limit = $('#review-limit').value;
      const libraryId = $('#review-library').value;
      const wordbookId = $('#review-wordbook').value;
      $('#review-setup').classList.add('hidden');
      const session = $('#review-session');
      session.classList.remove('hidden');
      const qs = new URLSearchParams();
      qs.set('limit', limit);
      if (libraryId) qs.set('libraryId', libraryId);
      if (wordbookId) qs.set('wordbookId', wordbookId);
      runSession(session, 'review', () =>
        API.get('/review/weak?' + qs.toString()).then((d) => d.words)
      );
    });
  }

  async function refreshReviewStats() {
    try {
      const s = await API.get('/review/stats');
      $('#stat-learned-num').textContent = s.total_studied;
      $('#stat-strength').textContent = s.average_strength;
      $('#stat-due').textContent = s.due_count;
      $('#stat-due-cap').textContent = `待复习（<${s.due_threshold}）`;
      // 绑定「已学单词」点击 → 列表
      const el = $('#stat-learned');
      if (el && !el.dataset.bound) {
        el.dataset.bound = '1';
        el.addEventListener('click', () => openLearnedModal());
      }
      // 绑定「牢固度说明」折叠
      const hb = $('#strength-help-btn');
      if (hb && !hb.dataset.bound) {
        hb.dataset.bound = '1';
        hb.addEventListener('click', () => $('#strength-help').classList.toggle('hidden'));
      }
    } catch (e) { /* ignore */ }
  }

  async function refreshWbSelect() {
    try {
      const { wordbooks } = await API.get('/wordbooks');
      $('#review-wordbook').innerHTML = '<option value="">不限</option>' +
        wordbooks.map((w) => `<option value="${w.id}">${esc(w.name)}</option>`).join('');
    } catch (e) { /* ignore */ }
  }

  // ---------- 单词本 ----------
  async function loadWordbooks() {
    try {
      const { wordbooks } = await API.get('/wordbooks');
      const grid = $('#wb-grid');
      if (!wordbooks.length) {
        grid.innerHTML = '<p class="muted">还没有单词本，新建一个开始整理你的生词吧。</p>';
        return;
      }
      grid.innerHTML = wordbooks.map((w) => `
        <div class="wb-card" data-id="${w.id}">
          <h3>${esc(w.name)}</h3>
          <span class="cat">${esc(w.category || '默认')}</span>
          <div class="cnt">${w.word_count} 个单词</div>
          <div class="wb-ops">
            <button class="btn-ghost" data-rename="${w.id}">重命名</button>
            <button class="btn-ghost" data-del="${w.id}">删除</button>
          </div>
        </div>`).join('');
      $$('.wb-card', grid).forEach((card) => {
        card.addEventListener('click', (e) => {
          if (e.target.closest('button')) return;
          openWbDetail(card.dataset.id);
        });
        const rid = card.querySelector('[data-rename]');
        if (rid) rid.addEventListener('click', () => renameWb(rid.dataset.rename));
        const del = card.querySelector('[data-del]');
        if (del) del.addEventListener('click', () => deleteWb(del.dataset.del));
      });
    } catch (e) { toast('加载单词本失败：' + e.message); }
  }

  // 新建单词本（弹窗）
  $('#wb-new-btn').addEventListener('click', () => {
    $('#wb-new-name').value = '';
    $('#wb-new-cat').value = '';
    $('#wb-new-msg').textContent = '';
    const m = $('#wb-create-modal');
    m.classList.remove('hidden');
    raiseModal(m);
    $('#wb-new-name').focus();
  });
  $('#wb-new-cancel').addEventListener('click', () => $('#wb-create-modal').classList.add('hidden'));
  $('#wb-create-modal').addEventListener('click', (e) => { if (e.target.id === 'wb-create-modal') $('#wb-create-modal').classList.add('hidden'); });
  $('#wb-new-confirm').addEventListener('click', async () => {
    const name = $('#wb-new-name').value.trim();
    const category = $('#wb-new-cat').value.trim();
    if (!name) { $('#wb-new-msg').textContent = '请输入单词本名称'; return; }
    try {
      await API.post('/wordbooks', { name, category: category || '默认' });
      $('#wb-create-modal').classList.add('hidden');
      toast('已创建单词本');
      await loadWordbooks();
      await refreshWbSelect();
    } catch (e) { $('#wb-new-msg').textContent = '创建失败：' + e.message; }
  });

  async function renameWb(id) {
    const name = prompt('输入新的单词本名称：');
    if (!name) return;
    const category = prompt('输入新的分类（可留空）：');
    try {
      await API.patch('/wordbooks/' + id, { name, ...(category ? { category } : {}) });
      toast('已更新');
      await loadWordbooks();
      await refreshWbSelect();
    } catch (e) { toast('更新失败：' + e.message); }
  }

  async function deleteWb(id) {
    if (!confirm('确定删除该单词本？其中的单词关联也会移除（不影响全局词库）。')) return;
    try {
      await API.del('/wordbooks/' + id);
      toast('已删除');
      $('#wb-detail').classList.add('hidden');
      await loadWordbooks();
      await refreshWbSelect();
    } catch (e) { toast('删除失败：' + e.message); }
  }

  async function openWbDetail(id) {
    const wbHead = $('.wb-head');
    const wbGrid = $('#wb-grid');
    try {
      const { words } = await API.get('/wordbooks/' + id + '/words');
      const head = await API.get('/wordbooks').then((d) => d.wordbooks.find((w) => String(w.id) === String(id)));
      const detail = $('#wb-detail');
      // 进入详情：隐藏列表页头部（含「新建单词本」入口）与卡片网格，仅保留详情（顶部返回按钮 + 单词列表主体）
      if (wbHead) wbHead.classList.add('hidden');
      if (wbGrid) wbGrid.classList.add('hidden');
      detail.classList.remove('hidden');
      detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
      detail.innerHTML = `
        <div class="wb-detail-head">
          <button class="btn-ghost" id="wb-back">← 返回</button>
          <h2>${esc(head ? head.name : '单词本')}</h2>
          <span class="cat">${esc(head ? head.category : '')}</span>
        </div>
        <div class="word-list">
          ${words.length ? words.map((w) => `
            <div class="word-row" data-wid="${w.id}">
              <div class="w-main">
                <div class="w-word">${esc(w.word)} <span class="w-phon">${renderPhonetic(w.phonetic)}</span></div>
                <div class="w-def">${esc(w.definition)}</div>
              </div>
              <button class="speak-btn" data-speak="${esc(w.word)}" data-audio="${esc(w.audio_url || '')}">🔊</button>
              <button class="btn-ghost" data-rm="${w.id}">移除</button>
            </div>`).join('') : '<p class="muted">这个单词本还是空的，去学习时把单词加进来吧。</p>'}
        </div>`;
      $('#wb-back').addEventListener('click', () => {
        detail.classList.add('hidden');
        if (wbHead) wbHead.classList.remove('hidden');
        if (wbGrid) wbGrid.classList.remove('hidden');
      });
      $$('[data-speak]', detail).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); speak(b.dataset.speak, b.dataset.audio); }));
      $$('.word-row', detail).forEach((row) => {
        const w = words.find((x) => String(x.id) === row.dataset.wid);
        if (w) row.addEventListener('click', (e) => { if (e.target.closest('button')) return; openWordDetail(w); });
      });
      $$('[data-rm]', detail).forEach((b) =>
        b.addEventListener('click', async () => {
          try {
            await API.del('/wordbooks/' + id + '/words/' + b.dataset.rm);
            toast('已移除');
            openWbDetail(id);
          } catch (e) { toast('移除失败：' + e.message); }
        })
      );
    } catch (e) { toast('打开失败：' + e.message); }
  }

  // ---------- 加入单词本 弹窗 ----------
  let pendingWordId = null;
  function openWbModal(wordId) {
    pendingWordId = wordId;
    const mask = $('#wb-modal');
    mask.classList.remove('hidden');
    raiseModal(mask);
    API.get('/wordbooks')
      .then(({ wordbooks }) => {
        const list = $('#modal-wb-list');
        if (!wordbooks.length) {
          list.innerHTML = '<div class="modal-empty">还没有单词本，请先到「单词本」页创建。</div>';
          return;
        }
        list.innerHTML = wordbooks.map((w) =>
          `<div class="modal-item" data-wb="${w.id}"><span>${esc(w.name)}</span><span class="muted">${w.word_count} 词</span></div>`
        ).join('');
        $$('.modal-item', list).forEach((it) =>
          it.addEventListener('click', async () => {
            try {
              await API.post('/wordbooks/' + it.dataset.wb + '/words', { wordId: Number(pendingWordId) });
              toast('已加入单词本');
              mask.classList.add('hidden');
            } catch (e) { toast('添加失败：' + e.message); }
          })
        );
      })
      .catch(() => { $('#modal-wb-list').innerHTML = '<div class="modal-empty">加载失败</div>'; });
  }
  $('#modal-cancel').addEventListener('click', () => $('#wb-modal').classList.add('hidden'));
  $('#wb-modal').addEventListener('click', (e) => { if (e.target.id === 'wb-modal') $('#wb-modal').classList.add('hidden'); });

  // ---------- 单词详情 弹窗（含实时评级 + 加入单词本） ----------
  function openWordDetail(w) {
    const modal = $('#word-detail-modal');
    const box = $('#word-detail');
    raiseModal(modal);
    const strHtml =
      w.memory && w.memory.studied
        ? `<div class="wd-strength">当前牢固度：<span class="strength-tag ${strengthCls(w.memory.strength)}">${w.memory.strength}</span></div>`
        : '';
    box.innerHTML = `
      <button class="modal-close" id="wd-close">✕</button>
      <div class="wd-word">${esc(w.word)} <button class="speak-btn" id="wd-speak" data-speak="${esc(w.word)}" data-audio="${esc(w.audio_url || '')}" title="发音">🔊</button></div>
      <div class="wd-phon">${renderPhonetic(w.phonetic)}</div>
      <div class="wd-lib"><span class="lib-tag">${esc(w.library_name || '')}</span></div>
      ${strHtml}
      <div class="detail-block"><div class="label">释义</div><div class="value">${esc(w.definition)}</div></div>
      <div class="detail-block"><div class="label">例句</div><div class="value">${esc(w.example || '—')}</div></div>
      <div class="detail-block"><div class="label">短语</div><div class="value"><span class="phrase-chip">${esc(w.phrase || '—')}</span></div></div>
      <div class="familiarity" id="wd-fam">
        ${FAM.map((f) => `<button class="fam-btn ${f.cls}" data-fam="${f.key}">${f.label}<small>${f.tip}</small></button>`).join('')}
      </div>
      <div class="wd-actions">
        <button class="btn-ghost" id="wd-add">＋ 加入单词本</button>
      </div>`;
    modal.classList.remove('hidden');
    const sp = $('#wd-speak');
    if (sp) sp.addEventListener('click', () => speak(sp.dataset.speak, sp.dataset.audio));
    $('#wd-close').addEventListener('click', () => modal.classList.add('hidden'));
    // 实时评级（与学习/复习共用记忆算法）
    $$('#wd-fam .fam-btn', box).forEach((b) =>
      b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          const res = await submitFeedbackApi(w.id, b.dataset.fam, 'browse');
          const lvl = famKeyToLevel(b.dataset.fam);
          toast('已记录：' + FAM.find((f) => f.key === b.dataset.fam).label);
          // 同步更新浏览列表对应行（若可见）
          const bw = browseState.words.find((x) => String(x.id) === String(w.id));
          if (bw) {
            bw.memory = { studied: true, strength: res.strength, last_familiarity: lvl, review_count: res.review_count };
            updateBrowseRow(bw);
          }
        } catch (e) {
          toast('提交失败：' + e.message);
          b.disabled = false;
        }
      })
    );
    $('#wd-add').addEventListener('click', () => openWbModal(w.id));
  }

  // ---------- 已学单词列表 弹窗（支持分页） ----------
  let learnedState = { offset: 0, limit: 20, total: 0, loading: false, words: [] };

  // ---------- 浏览词库 状态 ----------
  let browseState = { libraryId: null, q: '', offset: 0, limit: 50, total: 0, loading: false, words: [] };
  async function openLearnedModal() {
    const modal = $('#learned-modal');
    raiseModal(modal);
    modal.classList.remove('hidden');
    learnedState = { offset: 0, limit: 20, total: 0, loading: false, words: [] };
    $('#learned-list').innerHTML = '<div class="muted">加载中…</div>';
    $('#learned-meta').textContent = '';
    const foot = $('#learned-foot');
    foot.classList.add('hidden');
    foot.innerHTML = '';
    await fetchLearnedPage();
  }

  async function fetchLearnedPage() {
    if (learnedState.loading) return;
    learnedState.loading = true;
    const list = $('#learned-list');
    const meta = $('#learned-meta');
    const foot = $('#learned-foot');
    list.innerHTML = '<div class="muted">加载中…</div>';
    try {
      const { words, total } = await API.get(`/review/learned?limit=${learnedState.limit}&offset=${learnedState.offset}`);
      learnedState.words = words;
      learnedState.total = total;
      const pageTotal = Math.max(1, Math.ceil(total / learnedState.limit));
      const pageNo = Math.floor(learnedState.offset / learnedState.limit) + 1;
      meta.textContent = total ? `共 ${total} 个已学单词（按最近学习排序）` : '还没有已学单词';
      if (!words.length) {
        list.innerHTML = '<div class="muted">去学习或复习一些单词后，这里会列出你已掌握的词汇。</div>';
        foot.classList.add('hidden');
        return;
      }
      list.innerHTML = words.map((w) => `
        <div class="learned-item" data-id="${w.id}">
          <div class="li-main">
            <div class="li-word">${esc(w.word)} <span class="li-phon">${renderPhonetic(w.phonetic)}</span></div>
            <div class="li-def">${esc(w.definition)}</div>
          </div>
          <div class="li-right">
            <span class="lib-tag">${esc(w.library_name || '')}</span>
            <span class="strength-tag ${w.strength < 60 ? 'strength-weak' : w.strength < 85 ? 'strength-mid' : 'strength-strong'}">牢固度 ${w.strength}</span>
          </div>
        </div>`).join('');
      $$('.learned-item', list).forEach((it) =>
        it.addEventListener('click', () => {
          const w = words.find((x) => String(x.id) === it.dataset.id);
          if (w) openWordDetail(w);
        })
      );
      const hasPrev = learnedState.offset > 0;
      const hasNext = learnedState.offset + learnedState.limit < total;
      foot.classList.remove('hidden');
      foot.innerHTML = `
        <button class="btn-ghost" id="learned-prev" ${hasPrev ? '' : 'disabled'}>← 上一页</button>
        <span class="muted">第 ${pageNo} / ${pageTotal} 页</span>
        <button class="btn-ghost" id="learned-next" ${hasNext ? '' : 'disabled'}>下一页 →</button>`;
      const prev = $('#learned-prev', foot);
      const next = $('#learned-next', foot);
      if (prev && hasPrev) prev.addEventListener('click', () => { learnedState.offset = Math.max(0, learnedState.offset - learnedState.limit); fetchLearnedPage(); });
      if (next && hasNext) next.addEventListener('click', () => { learnedState.offset += learnedState.limit; fetchLearnedPage(); });
    } catch (e) {
      list.innerHTML = '<div class="muted">加载失败：' + esc(e.message) + '</div>';
      foot.classList.add('hidden');
    } finally {
      learnedState.loading = false;
    }
  }
  $('#learned-close').addEventListener('click', () => $('#learned-modal').classList.add('hidden'));
  $('#learned-modal').addEventListener('click', (e) => { if (e.target.id === 'learned-modal') $('#learned-modal').classList.add('hidden'); });

  // ---------- 浏览词库 ----------
  function initBrowse() {
    const sel = $('#browse-library');
    if (!sel) return;
    API.get('/libraries')
      .then(({ libraries }) => {
        sel.innerHTML = libraries
          .map((l) => `<option value="${l.id}">${esc(l.name)}（${l.word_count} 词）</option>`)
          .join('');
        if (libraries.length) {
          browseState.libraryId = libraries[0].id;
          loadBrowsePage();
        }
      })
      .catch(() => {});

    sel.addEventListener('change', () => {
      browseState.libraryId = sel.value;
      browseState.q = '';
      browseState.offset = 0;
      $('#browse-search').value = '';
      loadBrowsePage();
    });

    let timer;
    $('#browse-search').addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        browseState.q = $('#browse-search').value.trim();
        browseState.offset = 0;
        loadBrowsePage();
      }, 220);
    });
  }

  async function loadBrowsePage() {
    if (browseState.loading || !browseState.libraryId) return;
    browseState.loading = true;
    $('#browse-list').innerHTML = '<div class="muted" style="padding:18px">加载中…</div>';
    try {
      const { words, total } = await API.get(
        `/libraries/${browseState.libraryId}/words?q=${encodeURIComponent(browseState.q)}&limit=${browseState.limit}&offset=${browseState.offset}`
      );
      browseState.words = words;
      browseState.total = total;
      renderBrowseList();
    } catch (e) {
      $('#browse-list').innerHTML = '<div class="muted" style="padding:18px">加载失败：' + esc(e.message) + '</div>';
    } finally {
      browseState.loading = false;
    }
  }

  function browseRowHTML(w) {
    const lvl = w.memory && w.memory.studied ? w.memory.last_familiarity : null;
    const famBtns = FAM.map(
      (f) =>
        `<button class="b-fam ${f.cls}${lvl === f.level ? ' active' : ''}" data-fam="${f.key}" title="${f.label}">${f.label}</button>`
    ).join('');
    const strTag =
      w.memory && w.memory.studied
        ? `<span class="b-strength ${strengthCls(w.memory.strength)}">牢固度 ${w.memory.strength}</span>`
        : `<span class="b-strength muted">未学习</span>`;
    const def = (w.definition || '').length > 90 ? (w.definition || '').slice(0, 90) + '…' : (w.definition || '');
    return `
      <div class="browse-row" data-wid="${w.id}">
        <div class="b-main">
          <div class="b-word">${esc(w.word)} <span class="b-phon">${renderPhonetic(w.phonetic)}</span></div>
          <div class="b-def">${esc(def)}</div>
        </div>
        <div class="b-grade">${famBtns}${strTag}</div>
      </div>`;
  }

  function updateBrowseRow(word) {
    const row = $(`.browse-row[data-wid="${word.id}"]`);
    if (!row) return;
    const lvl = word.memory.last_familiarity;
    $$('.b-fam', row).forEach((b) => b.classList.toggle('active', famKeyToLevel(b.dataset.fam) === lvl));
    const st = $('.b-strength', row);
    if (st) {
      st.textContent = '牢固度 ' + word.memory.strength;
      st.className = 'b-strength ' + strengthCls(word.memory.strength);
    }
  }

  async function gradeBrowseWord(word, fam, rowEl) {
    const btns = $$('.b-fam', rowEl);
    btns.forEach((b) => (b.disabled = true));
    try {
      const res = await submitFeedbackApi(word.id, fam, 'browse');
      const lvl = famKeyToLevel(fam);
      word.memory = { studied: true, strength: res.strength, last_familiarity: lvl, review_count: res.review_count };
      updateBrowseRow(word);
      toast('已记录：' + FAM.find((f) => f.key === fam).label);
    } catch (e) {
      toast('提交失败：' + e.message);
      btns.forEach((b) => (b.disabled = false));
    }
  }

  function renderBrowseList() {
    const list = $('#browse-list');
    const meta = $('#browse-meta');
    const foot = $('#browse-foot');
    const panel = $('#browse-panel');
    panel.classList.remove('hidden');
    const { words, total, offset, limit } = browseState;
    const from = total ? offset + 1 : 0;
    const to = Math.min(offset + limit, total);
    meta.innerHTML = total
      ? `共 <strong>${total}</strong> 个单词　|　显示第 <strong>${from}–${to}</strong> 个`
      : '该词库没有匹配的单词';
    if (!words.length) {
      list.innerHTML = '<div class="muted" style="padding:18px">没有匹配的单词。</div>';
      foot.classList.add('hidden');
      return;
    }
    list.innerHTML = words.map(browseRowHTML).join('');
    words.forEach((w) => {
      const row = $(`.browse-row[data-wid="${w.id}"]`, list);
      if (!row) return;
      $('.b-main', row).addEventListener('click', () => {
        const lib = currentLibraries.find((l) => String(l.id) === String(browseState.libraryId));
        openWordDetail({ ...w, library_name: (lib && lib.name) || '' });
      });
      $$('.b-fam', row).forEach((b) => b.addEventListener('click', () => gradeBrowseWord(w, b.dataset.fam, row)));
    });
    const pageTotal = Math.max(1, Math.ceil(total / limit));
    const pageNo = Math.floor(offset / limit) + 1;
    const hasPrev = offset > 0;
    const hasNext = offset + limit < total;
    foot.classList.remove('hidden');
    foot.innerHTML = `
      <button class="btn-ghost" id="browse-prev" ${hasPrev ? '' : 'disabled'}>← 上一页</button>
      <span class="muted">第 ${pageNo} / ${pageTotal} 页</span>
      <button class="btn-ghost" id="browse-next" ${hasNext ? '' : 'disabled'}>下一页 →</button>`;
    const prev = $('#browse-prev', foot);
    const next = $('#browse-next', foot);
    if (prev && hasPrev) prev.addEventListener('click', () => { browseState.offset = Math.max(0, offset - limit); loadBrowsePage(); });
    if (next && hasNext) next.addEventListener('click', () => { browseState.offset += limit; loadBrowsePage(); });
  }

  // ---------- 搜索 ----------
  function initSearch() {
    const input = $('#search-input');
    const results = $('#search-results');
    const meta = $('#search-meta');
    if (!input) return;
    let timer;
    const doSearch = async () => {
      const q = input.value.trim();
      if (!q) { results.innerHTML = ''; meta.textContent = ''; return; }
      meta.textContent = '搜索中…';
      try {
        const { words, total } = await API.get('/words/search?q=' + encodeURIComponent(q) + '&limit=50');
        meta.textContent = total ? `找到 ${total} 个结果` : '没有匹配的单词';
        if (!words.length) { results.innerHTML = ''; return; }
        results.innerHTML = words.map((w) => `
          <div class="search-item" data-id="${w.id}">
            <div class="si-main">
              <div class="si-word">${esc(w.word)} <span class="si-phon">${renderPhonetic(w.phonetic)}</span></div>
              <div class="si-def">${esc(w.definition)}</div>
            </div>
            <div class="si-lib">${esc(w.library_name || '')}</div>
          </div>`).join('');
        $$('.search-item', results).forEach((it) =>
          it.addEventListener('click', () => {
            const w = words.find((x) => String(x.id) === it.dataset.id);
            if (w) openWordDetail(w);
          })
        );
      } catch (e) {
        meta.textContent = '搜索失败：' + e.message;
      }
    };
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(doSearch, 220); });
    $('#search-clear').addEventListener('click', () => { input.value = ''; results.innerHTML = ''; meta.textContent = ''; input.focus(); });
    $('#word-detail-modal').addEventListener('click', (e) => { if (e.target.id === 'word-detail-modal') $('#word-detail-modal').classList.add('hidden'); });
  }

  // ---------- 导航绑定 ----------
  $$('.nav-item').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

  // ---------- 启动 ----------
  function boot() {
    initTheme();
    initAudioToggle();
    initAuth();
    if (API.getToken()) {
      API.get('/auth/me')
        .then(({ user }) => enterApp(user))
        .catch(() => { API.setToken(null); });
    }
  }

  boot();
})();
