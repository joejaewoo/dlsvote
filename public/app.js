const app = document.querySelector('#app');
const mode = location.pathname === '/vote' ? 'vote' : location.pathname === '/admin' ? 'admin' : 'display';
const query = new URLSearchParams(location.search);
const selectedPoll = query.get('poll');
let state, choices = [], draftRound, sending = false, failed = false, refreshing;
let adminPassword = '', busy = false;
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const icon = (name, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${({
  check: '<path d="m5 12 4 4L19 6"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M5 16v5h14v-5"/>',
  chart: '<path d="M5 20V10m7 10V4m7 16v-7"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/>',
  down: '<path d="M12 4v16m-6-6 6 6 6-6"/>'
})[name] || ''}</svg>`;
const brandMark = () => `<div class="brand"><span class="brand-symbol">즐</span><div><strong>즐거움 Live</strong><small>Delightful Experiences Education</small></div></div>`;

function voterToken() {
  let token;
  try { token = localStorage.getItem('live-voter') || localStorage.getItem('joy-voter'); } catch {}
  token ||= document.cookie.match(/(?:^|; )(?:live_voter|joy_voter)=([a-f0-9-]+)/i)?.[1];
  if (!token) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
    token = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }
  try { localStorage.setItem('live-voter', token); } catch {}
  document.cookie = `live_voter=${token};path=/;max-age=31536000;SameSite=Lax${location.protocol === 'https:' ? ';Secure' : ''}`;
  return token;
}
const voter = mode === 'vote' ? voterToken() : null;
const currentPoll = () => state?.polls.find(poll => poll.id === selectedPoll);
const voteUrl = poll => `${location.origin}/vote?poll=${poll.id}&round=${poll.round}`;
async function api(path, data) {
  const response = await fetch(path, {
    method: data ? 'POST' : 'GET', cache: 'no-store', signal: AbortSignal.timeout(12000),
    headers: { ...(voter ? { 'X-Live-Voter': voter } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) },
    ...(data ? { body: JSON.stringify(data) } : {})
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '연결을 확인해주세요.');
  return result;
}
async function refresh() {
  if (refreshing) return refreshing;
  refreshing = performRefresh();
  try { return await refreshing; } finally { refreshing = null; }
}
async function performRefresh() {
  try {
    const previous = currentPoll();
    const first = !state;
    state = await api('/api/state');
    const poll = currentPoll();
    failed = false;
    if (mode === 'display') {
      if (first || !document.querySelector('.poll-section')) renderBoard();
      else updateBoard();
    } else if (mode === 'vote') {
      if (!sending && (first || poll?.round !== previous?.round || poll?.closed !== previous?.closed || JSON.stringify(poll?.own) !== JSON.stringify(previous?.own) || document.querySelector('.error-page'))) renderVote();
    } else if (first || !adminPassword) {
      if (first) renderAdmin();
    } else if (!busy) updateAdmin();
    setConnection(true);
  } catch (error) {
    failed = true;
    if (!state) {
      app.innerHTML = `<main class="error-page"><span class="brand-symbol">즐</span><h1>투표를 연결하고 있어요</h1><p>${escape(error.message)}</p><button class="primary" id="retry">다시 연결하기</button></main>`;
      document.querySelector('#retry').onclick = refresh;
    } else setConnection(false);
  }
}
function setConnection(ok) {
  const target = document.querySelector('#connection');
  if (target) { target.classList.toggle('offline', !ok); target.innerHTML = `<span class="live-dot"></span>${ok ? '실시간 집계' : '연결 확인 중'}`; }
  const banner = document.querySelector('#offline-banner');
  if (banner) { banner.hidden = ok; banner.textContent = '연결이 지연되고 있어요. 마지막으로 받은 결과를 표시합니다.'; }
}
function qrMarkup(poll) {
  if (typeof window.qrcode !== 'function') return '<p>QR을 불러오지 못했어요.</p>';
  const qr = window.qrcode(0, 'M');
  qr.addData(voteUrl(poll)); qr.make();
  return qr.createSvgTag({ cellSize: 6, margin: 24, scalable: true });
}
function renderBoard() {
  document.body.className = 'display-body';
  app.innerHTML = `<main class="display-shell">
    <header class="display-header">${brandMark()}<span class="event-name">${escape(state.eventTitle)}</span><div class="header-actions"><span class="connection" id="connection"></span><button class="icon-button" id="fullscreen" aria-label="전체 화면">${icon('expand')}</button></div></header>
    <div id="offline-banner" class="offline-banner" hidden></div>
    ${state.polls.map((poll, index) => `<section class="poll-section ${poll.color}" id="section-${poll.id}" aria-labelledby="heading-${poll.id}">
      <div class="stage-heading"><div><span class="eyebrow">투표 0${index + 1}</span><h${index === 0 ? '1' : '2'} id="heading-${poll.id}">${escape(poll.shortTitle)}<span class="title-dot">.</span></h${index === 0 ? '1' : '2'}></div><div class="participant-total"><strong id="participants-${poll.id}">0</strong><span>명 참여</span></div></div>
      <div class="poll-layout"><article class="result-panel" aria-label="${escape(poll.shortTitle)} 실시간 순위">
        <div class="current-first"><span class="first-label">지금의 1위</span><strong id="winner-${poll.id}">첫 선택을 기다려요</strong><span class="first-count"><b id="topcount-${poll.id}">0</b> 표</span></div>
        <div class="rank-list" id="list-${poll.id}" role="list" aria-label="득표 순위">${poll.options.map((label, optionIndex) => `<div class="rank-row" data-index="${optionIndex}" role="listitem" style="transform:translateY(${optionIndex * 100}%)"><span class="rank-number">—</span><div class="rank-main"><div class="rank-label">${escape(label)}</div><div class="bar-track"><div class="bar-fill" style="width:0%"></div></div></div><div class="rank-value"><strong>0</strong><small>0%</small></div></div>`).join('')}</div>
        <div class="panel-bottom"><span>3개 선택 · 동점은 공동 순위</span><span id="total-${poll.id}">0표</span></div>
      </article><aside class="join-panel"><span class="join-kicker">투표 0${index + 1} 전용 QR</span><h3>${escape(poll.shortTitle)}</h3><p>QR을 찍고<br>3개를 골라주세요.</p><div class="qr-box" id="qr-${poll.id}" data-round="${poll.round}">${qrMarkup(poll)}</div><span class="poll-status" id="status-${poll.id}"></span><div class="join-note">로그인·이름 입력 없이 참여</div><a class="participant-link" id="link-${poll.id}" href="${voteUrl(poll)}" target="_blank" rel="noopener">이 투표 참여하기</a><button class="text-button" data-qr="${poll.id}">${icon('download', 16)} QR 저장</button></aside></div>
      ${index === 0 ? `<div class="scroll-hint">${icon('down', 18)}<span>스크롤을 내려 학원 선택 기준 투표를 확인하세요</span></div>` : '<div class="section-note">각 항목의 비율은 이 투표의 참여 인원을 기준으로 표시됩니다.</div>'}
    </section>`).join('')}
    <footer class="display-footer"><span>${escape(state.eventTitle)}</span><a href="/admin">진행자 화면</a></footer>
  </main>`;
  document.querySelector('#fullscreen').onclick = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch {}
  };
  for (const button of document.querySelectorAll('[data-qr]')) button.onclick = () => downloadQR(button.dataset.qr);
  updateBoard();
}
const animationFrames = new WeakMap();
function countTo(node, target) {
  if (!node || Number(node.dataset.target || 0) === target) return;
  cancelAnimationFrame(animationFrames.get(node));
  const from = Number(node.textContent.replaceAll(',', '')) || 0;
  node.dataset.target = target;
  const start = performance.now();
  const frame = now => {
    const progress = matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : Math.min((now - start) / 650, 1);
    node.textContent = Math.round(from + (target - from) * (1 - (1 - progress) ** 3)).toLocaleString('ko-KR');
    if (progress < 1) animationFrames.set(node, requestAnimationFrame(frame));
  };
  animationFrames.set(node, requestAnimationFrame(frame));
}
function updateBoard() {
  for (const poll of state.polls) {
    countTo(document.querySelector(`#participants-${poll.id}`), poll.participants);
    const top = poll.results[0].votes;
    const leaders = poll.results.filter(row => row.votes === top);
    document.querySelector(`#winner-${poll.id}`).textContent = top ? leaders.length > 1 ? `${leaders[0].label} 외 ${leaders.length - 1}개 공동 1위` : leaders[0].label : '첫 선택을 기다려요';
    countTo(document.querySelector(`#topcount-${poll.id}`), top);
    document.querySelector(`#total-${poll.id}`).textContent = `${poll.total.toLocaleString('ko-KR')}표`;
    document.querySelector(`#status-${poll.id}`).textContent = poll.closed ? '투표 마감' : '투표 진행 중';
    const qr = document.querySelector(`#qr-${poll.id}`);
    if (qr.dataset.round !== poll.round) { qr.innerHTML = qrMarkup(poll); qr.dataset.round = poll.round; }
    document.querySelector(`#link-${poll.id}`).href = voteUrl(poll);
    let rank = 0, prev;
    poll.results.forEach((result, order) => {
      if (result.votes !== prev) rank = order + 1;
      prev = result.votes;
      const row = document.querySelector(`#list-${poll.id} [data-index="${result.index}"]`);
      row.style.transform = `translateY(${order * 100}%)`;
      row.classList.toggle('top-ranked', !!result.votes && rank <= 3);
      row.classList.toggle('rank-one', !!result.votes && rank === 1);
      const percent = poll.participants ? Math.round(result.votes / poll.participants * 100) : 0;
      row.querySelector('.rank-number').textContent = result.votes ? String(rank).padStart(2, '0') : '—';
      row.querySelector('.bar-fill').style.width = `${percent}%`;
      row.querySelector('.rank-value small').textContent = `${percent}%`;
      countTo(row.querySelector('.rank-value strong'), result.votes);
      row.setAttribute('aria-label', `${result.votes ? `${rank}위` : '아직 투표 없음'}, ${result.label}, ${result.votes}표, ${percent}%`);
    });
  }
}
function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function downloadQR(id) {
  const svg = document.querySelector(`#qr-${id} svg`);
  if (svg) download(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }), `즐거움-Live-${id}-QR.svg`);
}
function restoreDraft(poll) {
  if (draftRound === poll.round) return;
  draftRound = poll.round; choices = [];
  try { choices = JSON.parse(localStorage.getItem(`live-draft-${poll.id}-${poll.round}`) || '[]').filter(value => poll.options.includes(value)).slice(0, 3); } catch {}
}
function saveDraft(poll) { try { localStorage.setItem(`live-draft-${poll.id}-${poll.round}`, JSON.stringify(choices)); } catch {} }
function renderVote() {
  document.body.className = 'vote-body';
  const poll = currentPoll();
  if (!poll) {
    app.innerHTML = `<main class="completion">${brandMark()}<div class="completion-mark">${icon('chart', 36)}</div><h1>참여할 투표를 선택하세요</h1><p>두 투표는 각각 따로 제출합니다.</p>${state.polls.map(item => `<a class="primary" href="${voteUrl(item)}">${escape(item.shortTitle)}</a>`).join('')}</main>`;
    return;
  }
  const requestedRound = query.get('round');
  if (requestedRound && requestedRound !== poll.round) {
    app.innerHTML = `<main class="completion">${brandMark()}<div class="completion-mark">${icon('chart', 36)}</div><h1>새 투표가 시작됐어요</h1><p>${escape(poll.shortTitle)}의 새 QR을 찍거나 아래 버튼을 눌러주세요.</p><a href="${voteUrl(poll)}" class="primary">현재 투표 참여하기</a></main>`;
    return;
  }
  if (poll.own) { renderComplete(poll); return; }
  if (poll.closed) {
    app.innerHTML = `<main class="completion">${brandMark()}<div class="completion-mark">${icon('lock', 36)}</div><h1>이 투표가 마감되었어요</h1><p>${escape(poll.shortTitle)}의 최종 순위를 확인해주세요.</p><a class="primary" href="/display#section-${poll.id}">결과 보기</a></main>`;
    return;
  }
  restoreDraft(poll);
  app.innerHTML = `<main class="vote-shell ${poll.color}"><header class="vote-header">${brandMark()}<span class="vote-tag">익명 투표</span></header><section class="vote-question"><span class="eyebrow">${escape(poll.shortTitle)}</span><h1>${escape(poll.title)}</h1><p>${poll.id === 'dinner' ? '먹고 싶은 메뉴를' : '가장 중요하게 생각하는 기준을'} <strong>3개</strong> 골라주세요.</p><div class="selection-summary"><span>복수 선택</span><b id="selected-count">${choices.length} / 3 선택</b></div><div class="options-grid">${poll.options.map((label, index) => `<button class="vote-option ${choices.includes(label) ? 'selected' : ''}" data-choice="${index}" aria-pressed="${choices.includes(label)}"><span class="food-emoji">${poll.emoji[index]}</span><span>${escape(label)}</span><span class="option-check">${icon('check', 17)}</span></button>`).join('')}</div><p class="vote-message" id="vote-message" role="status"></p><div class="vote-privacy">이 질문의 답변만 제출됩니다.</div></section><footer class="vote-bottom"><button class="primary" id="submit-vote" ${choices.length !== 3 ? 'disabled' : ''}>투표 제출하기</button><small>제출 후에는 선택을 변경할 수 없습니다.</small></footer></main>`;
  for (const button of document.querySelectorAll('[data-choice]')) button.onclick = () => toggleChoice(poll, button);
  document.querySelector('#submit-vote').onclick = () => sendVote(poll);
}
function toggleChoice(poll, button) {
  if (sending) return;
  const label = poll.options[Number(button.dataset.choice)];
  const index = choices.indexOf(label);
  const message = document.querySelector('#vote-message');
  if (index >= 0) choices.splice(index, 1);
  else if (choices.length < 3) choices.push(label);
  else { message.textContent = '3개까지 선택할 수 있어요. 선택한 항목을 다시 누르면 해제됩니다.'; return; }
  saveDraft(poll);
  button.classList.toggle('selected', choices.includes(label));
  button.setAttribute('aria-pressed', String(choices.includes(label)));
  document.querySelector('#selected-count').textContent = `${choices.length} / 3 선택`;
  document.querySelector('#submit-vote').disabled = choices.length !== 3;
  message.textContent = choices.length === 3 ? '3개를 모두 골랐어요.' : '';
}
async function sendVote(poll) {
  if (sending || choices.length !== 3) return;
  sending = true;
  const button = document.querySelector('#submit-vote');
  button.disabled = true; button.textContent = '제출 중…';
  try {
    const result = await api('/api/vote', { voter, poll: poll.id, round: poll.round, choices });
    poll.own = result.choices; renderComplete(poll);
  } catch (error) {
    const message = document.querySelector('#vote-message');
    if (message) message.textContent = error.message;
    if (button.isConnected) { button.disabled = false; button.textContent = '다시 제출하기'; }
  } finally { sending = false; }
}
function renderComplete(poll) {
  app.innerHTML = `<main class="completion">${brandMark()}<div class="completion-mark success">${icon('check', 36)}</div><h1>투표가 완료되었어요!</h1><p>${escape(poll.shortTitle)}에 반영되었어요.<br>발표 화면에서 실시간 순위를 확인해주세요.</p><div class="receipt"><section><small>${escape(poll.shortTitle)}</small><div>${poll.own.map(label => `<span>${escape(label)}</span>`).join('')}</div></section></div><a class="secondary" href="/display#section-${poll.id}">실시간 결과 보기</a><small class="completion-footnote">다른 질문은 그 질문의 QR로 따로 참여해주세요.</small></main>`;
}
function renderAdmin() {
  document.body.className = 'admin-body';
  if (!adminPassword) {
    app.innerHTML = `<main class="admin-shell">${brandMark()}<span class="eyebrow">EVENT CONTROL</span><h1>진행자 화면</h1><p>두 투표를 각각 마감하거나 새로 시작합니다.</p><form id="admin-login"><label for="admin-password">관리자 비밀번호</label><input id="admin-password" type="password" autocomplete="current-password" required minlength="4"><button class="primary" type="submit">진행자 화면 열기</button><p class="vote-message" id="admin-message" role="status"></p></form><a class="text-button" href="/display">발표 화면으로</a></main>`;
    document.querySelector('#admin-login').onsubmit = async event => {
      event.preventDefault();
      const password = document.querySelector('#admin-password').value;
      const button = document.querySelector('#admin-login button'); button.disabled = true;
      try { await api('/api/admin', { password, action: 'verify' }); adminPassword = password; renderAdmin(); }
      catch (error) { document.querySelector('#admin-message').textContent = error.message; button.disabled = false; }
    };
    return;
  }
  app.innerHTML = `<main class="admin-shell">${brandMark()}<span class="eyebrow">EVENT CONTROL</span><h1>진행자 화면</h1><a href="/display" target="_blank" rel="noopener" class="primary">발표 화면 열기 ${icon('expand', 18)}</a>${state.polls.map(poll => `<section class="admin-poll" id="admin-${poll.id}"><h2>${escape(poll.shortTitle)}</h2><div class="admin-status"><span id="admin-state-${poll.id}">${poll.closed ? '투표 마감' : '투표 진행 중'}</span><strong><b id="admin-total-${poll.id}">${poll.participants}</b>명 참여</strong></div><div class="admin-buttons"><button class="secondary" data-toggle="${poll.id}">${poll.closed ? '다시 열기' : '투표 마감'}</button><button class="secondary" data-csv="${poll.id}">결과 CSV 저장</button></div><div class="new-round-panel"><p>이 질문만 0명부터 새로 시작하고 새 QR을 만듭니다. 이전 기록은 보관됩니다.</p><button class="text-button" data-prepare="${poll.id}">이 투표 새 회차 준비</button><div id="confirm-${poll.id}" hidden><p>${escape(poll.shortTitle)}를 새 회차로 시작할까요?</p><button class="primary" data-confirm="${poll.id}">새 회차 시작</button><button class="text-button" data-cancel="${poll.id}">취소</button></div></div></section>`).join('')}<p class="vote-message" id="admin-message" role="status"></p><button class="text-button" id="logout">진행자 화면 닫기</button></main>`;
  for (const button of document.querySelectorAll('[data-toggle]')) button.onclick = () => {
    const poll = state.polls.find(item => item.id === button.dataset.toggle);
    adminAction(poll.closed ? 'open' : 'close', poll);
  };
  for (const button of document.querySelectorAll('[data-csv]')) button.onclick = () => downloadCSV(state.polls.find(item => item.id === button.dataset.csv));
  for (const button of document.querySelectorAll('[data-prepare]')) button.onclick = () => { document.querySelector(`#confirm-${button.dataset.prepare}`).hidden = false; };
  for (const button of document.querySelectorAll('[data-cancel]')) button.onclick = () => { document.querySelector(`#confirm-${button.dataset.cancel}`).hidden = true; };
  for (const button of document.querySelectorAll('[data-confirm]')) button.onclick = () => adminAction('new-round', state.polls.find(item => item.id === button.dataset.confirm));
  document.querySelector('#logout').onclick = () => { adminPassword = ''; renderAdmin(); };
}
function updateAdmin() {
  if (!document.querySelector('.admin-poll')) return;
  for (const poll of state.polls) {
    document.querySelector(`#admin-total-${poll.id}`).textContent = poll.participants;
    document.querySelector(`#admin-state-${poll.id}`).textContent = poll.closed ? '투표 마감' : '투표 진행 중';
    document.querySelector(`[data-toggle="${poll.id}"]`).textContent = poll.closed ? '다시 열기' : '투표 마감';
  }
}
async function adminAction(action, poll) {
  if (busy) return;
  busy = true;
  for (const button of document.querySelectorAll('.admin-poll button')) button.disabled = true;
  try {
    await api('/api/admin', { action, poll: poll.id, round: poll.round, password: adminPassword });
    await refresh(); renderAdmin();
  } catch (error) { document.querySelector('#admin-message').textContent = error.message; }
  finally { busy = false; for (const button of document.querySelectorAll('.admin-poll button')) button.disabled = false; }
}
function downloadCSV(poll) {
  const quote = value => '"' + String(value).replaceAll('"', '""') + '"';
  const rows = [['질문', '회차', '항목', '득표수', '참여인원', '선택비율(%)'], ...poll.results.map(row => [poll.shortTitle, poll.round, row.label, row.votes, poll.participants, poll.participants ? Math.round(row.votes / poll.participants * 100) : 0])];
  download(new Blob(['\ufeff' + rows.map(row => row.map(quote).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }), `즐거움-Live-${poll.id}-${new Date().toISOString().slice(0,10)}.csv`);
}
refresh();
setInterval(() => { if (!document.hidden) refresh(); }, mode === 'display' ? 2000 : 8000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
