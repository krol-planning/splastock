/* SPLASTOCK V2
 * - Weapon master is weapons.json; no weapon is defined or overwritten in this file.
 * - Players: anonymous Supabase session, choose organizer-registered name, colored dot.
 * - Organizer: independent email/password session + server-side allowlist; existing sessions can set a password.
 * - Data updates use RPC / RLS; a hidden button never grants authorization.
 */
const el = document.getElementById('app');
const header = document.getElementById('header-right');
const ADMIN_MODE = new URLSearchParams(location.search).get('admin') === '1';
const COLORS = ['#111827','#64748b','#2563eb','#0891b2','#059669','#d97706','#dc2626','#db2777'];
const config = window.SPLASTOCK_CONFIG || {};
const configured = /^https:\/\/[a-z0-9.-]+\.supabase\.co\/?$/i.test(config.supabaseUrl||'') &&
  typeof config.supabasePublishableKey === 'string' && config.supabasePublishableKey.length > 12;
const store = {
  get(k){try{return localStorage.getItem(k)}catch{return null}},
  set(k,v){try{localStorage.setItem(k,v);return true}catch{return false}}
};
function getJSON(k,otherwise){try{return JSON.parse(store.get(k)) ?? otherwise}catch{return otherwise}}
const st = {
  weapons:[],weaponMap:new Map(),
  view:ADMIN_MODE?'admin-login':new URLSearchParams(location.search).has('help')?'help':'home',tab:'match',adminTab:'roster',
  playerClient:null,adminClient:null,user:null,adminUser:null,profile:null,isAdmin:false,
  tournaments:[],publicEvents:[],adminEvents:[],
  event:null,eventId:null,matchId:null,matchPlayers:[],roster:[],testSlotId:null,
  readyRows:[],resultHistory:[],helpReturn:'home',
  claimEventId:null,claimColor:COLORS[0],
  quick:getJSON('splastock_solo_v1',{weapon:'スプラシューター',deaths:0}),
  recent:getJSON('splastock_recent_weapons_v1',['スプラシューター','シャープマーカー','リッター4K']),
  pending:getJSON('splastock_pending_v1',[]),
  busy:false,loading:false,draining:false,channel:null,refreshTimer:null,realtime:'disconnected',
  wakeEnabled:false,wakeLock:null,bootError:null
};
const esc = v => String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{let r=Math.random()*16|0;return (c==='x'?r:(r&3|8)).toString(16)}));
const fmt = c => ({elimination:'トーナメント',round_robin:'総当たり',draft:'準備中',active:'開催中',completed:'終了',pending:'開始前',live:'進行中',finished:'確定済み'})[c] || c;
const badge = status => `<span class="badge ${status==='live'?'badge-live':status==='pending'?'badge-warn':''}">${esc(fmt(status))}</span>`;
const avatar = (color,extra='') => `<span class="avatar ${extra}" style="background:${COLORS.includes(color)?color:COLORS[1]}"></span>`;
const client = () => ADMIN_MODE?st.adminClient:st.playerClient;
const event = () => st.event;
const currMatch = () => st.event?.matches.find(m=>m.id===st.matchId);
const mySlot = () => st.event?.slots.find(s=>s.profile_id===st.user?.id);
const matchOfMe = m => Boolean(mySlot() && [m?.team_a_id,m?.team_b_id].includes(mySlot().team_id));
const teamName = id => st.event?.teams.find(t=>t.id===id)?.name || '未確定';
const pendingFor = mid => st.pending.filter(x=>x.matchId===mid && x.uid===st.user?.id);
const savePending = () => store.set('splastock_pending_v1',JSON.stringify(st.pending));
const saveQuick = () => store.set('splastock_solo_v1',JSON.stringify(st.quick));
function notify(s,error=false){const t=document.getElementById('toast');t.textContent=String(s);t.className='toast active'+(error?' error':'');clearTimeout(notify.timer);notify.timer=setTimeout(()=>t.className='toast',4100)}
function rememberWeapon(w){if(!st.weaponMap.has(w))return;st.recent=[w,...st.recent.filter(x=>x!==w)].slice(0,5);store.set('splastock_recent_weapons_v1',JSON.stringify(st.recent))}
function check(res){if(res.error)throw new Error(res.error.message||'接続に失敗しました');return res.data}
async function rpc(name,args={},use=client()){if(!use)throw new Error('オンライン接続がありません');return check(await use.rpc(name,args))}
async function run(fn){if(st.busy)return;st.busy=true;try{await fn()}catch(e){console.error(e);notify(e.message||e,true)}finally{st.busy=false}}
function fmtTinyId(id){return id ? `${id.slice(0,8)}…${id.slice(-4)}` : '未登録'}
function statusHeader(){
  const online = navigator.onLine && configured;
  const isHome=st.view==='home'||st.view==='admin-home';
  header.innerHTML=`<span class="connection"><span class="connection-dot ${online?'':'off'}"></span>${online?(st.realtime==='SUBSCRIBED'?'リアルタイム接続':'オンライン'):'簡易モード'}</span>`+
    (ADMIN_MODE
      ? `<span class="badge badge-dark">運営者</span>${st.isAdmin?'<button class="btn btn-secondary btn-small" data-action="admin-password">パスワード設定</button><button class="btn btn-secondary btn-small" data-action="admin-logout">ログアウト</button>':''}`
      : st.profile ? `<span class="profile-pill" title="個人ID: ${esc(st.user?.id)}">${avatar(st.profile.color)}<span class="text-clip">${esc(mySlot()?.display_name||st.profile.nickname)}</span></span>` : '')+
    (!ADMIN_MODE ? '<button class="btn btn-secondary btn-small" data-action="help">使い方</button>' : '')+
    (!isHome?`<button class="btn btn-secondary btn-small" data-action="home">ホーム</button>`:'');
}
function show(){statusHeader();if(st.bootError&&st.view!=='quick'&&st.view!=='help'){renderError();return}
  switch(st.view){
    case 'quick':return renderQuick();
    case 'help':return renderHelp();
    case 'claim':return renderClaim();
    case 'color':return renderColorEditor();
    case 'event':return renderEvent();
    case 'admin-login':return renderAdminLogin();
    case 'admin-password':return renderAdminPassword();
    case 'admin-home':return renderAdminHome();
    case 'admin-event':return renderAdminEvent();
    default:return renderHome();
  }
}
function renderError(){el.innerHTML=`<div class="shell main"><section class="panel panel-pad"><h2>接続できませんでした</h2><p class="sub">${esc(st.bootError)}</p><div class="actions"><button data-action="retry" class="btn btn-primary">再接続</button><button data-action="quick" class="btn btn-secondary">簡易計算を使う</button></div></section></div>`}
function renderHome(){
  const mine=st.tournaments.map(t=>`<button class="card-btn" data-action="open-event" data-id="${t.id}"><div class="between"><span class="kicker">MY TOURNAMENT</span>${badge(t.status)}</div><div class="card-title">${esc(t.name)}</div><div class="card-sub">${fmt(t.format)} · チームのストックを確認する</div></button>`).join('');
  const pub=st.publicEvents.filter(t=>!st.tournaments.some(x=>x.id===t.id)).map(t=>`<button class="card-btn" data-action="open-claim" data-id="${t.id}"><div class="between"><span class="kicker">参加受付中</span><span class="badge">${t.registered}/${Number(t.team_count)*4} 人</span></div><div class="card-title">${esc(t.name)}</div><div class="card-sub">${fmt(t.format)} · 登録された名前から自分を選ぶ</div></button>`).join('');
  el.innerHTML=`<div class="shell main"><section class="banner-hero"><div><div class="kicker">PLAYER / STOCK TRACKING</div><h1>一つの画面で、<br>8人のストックを。</h1><p class="lead">自分のブキを選んで、デスしたら1タップ。味方と相手の残りストックを同じ画面で確認できます。</p><div class="actions"><button class="btn btn-primary btn-large" data-action="quick">簡易ストック計算 →</button><button class="btn btn-secondary btn-large" data-action="help">使い方を見る</button>${st.publicEvents.length?'<button class="btn btn-secondary btn-large" data-action="scroll-events">大会に参加する</button>':''}</div></div><div class="hero-visual"><div class="hero-number">08</div><div class="hero-label">PLAYERS / MATCH</div></div></section>
    ${st.user?`<div class="notice margin-top"><div class="between"><span>${st.profile?avatar(st.profile.color,'avatar-sm'):''} 個人ID：<code>${esc(fmtTinyId(st.user?.id))}</code>　<span class="small">同じブラウザで次回から自動認識します。</span></span><button class="btn btn-secondary btn-small" data-action="copy-id" data-id="${esc(st.user.id)}">IDコピー</button></div></div>`:''}
    ${!configured?'<div class="warning margin-top">Supabaseが未設定です。簡易ストック計算は引き続き利用できます。</div>':''}
    <div id="events-section"><div class="section-head"><div><div class="section-caption">YOUR MATCHES</div><h2>参加中の大会</h2></div></div>${mine?`<div class="grid-2">${mine}</div>`:'<div class="empty">まだ参加中の大会はありません。</div>'}
    <div class="section-head"><div><div class="section-caption">JOIN</div><h2>登録済みの名前から参加</h2></div></div>${pub?`<div class="grid-2">${pub}</div>`:'<div class="empty">現在、参加受付中の大会はありません。主催者が登録を開始するとここに表示されます。</div>'}</div>
    <div class="section-head"><div class="section-caption">QUICK TOOL</div></div><section class="panel panel-pad between"><div><h3>簡易ストック計算</h3><p class="sub small mb0">大会参加なしで65種類のブキを検索・管理できます。</p></div><button class="btn btn-secondary" data-action="quick">開く →</button></section></div>`;
}
function tierFigure(){return `<div class="tier-card"><div class="kicker">WEAPON STOCK TIER</div><h3>ストック別ブキ一覧</h3><p class="sub small">元のティア表をそのまま掲載しています。</p><a href="./tierlist%20(4).png" target="_blank" rel="noopener" title="画像を拡大する"><img class="tier-image" src="./tierlist%20(4).png" alt="ストック数別に全ブキが並んだティア表。ストック5・4・3・2の各段" loading="lazy"></a><p class="hint">画像をタップすると大きく表示できます。</p></div>`}
function selectWeapons(id,current,changeAttr){return `<select id="${id}" class="field" data-change="${changeAttr}">${st.weapons.map(w=>`<option value="${esc(w.name)}" ${w.name===current?'selected':''}>${esc(w.name)} — ${w.stock}</option>`).join('')}</select>`}
function dots(n,max){return `<div class="stock-dots">${Array.from({length:max||0},(_,i)=>`<span class="stock-dot ${i<n?'on':''}"></span>`).join('')}</div>`}
function renderQuick(){const w=st.weaponMap.get(st.quick.weapon)||st.weapons[0];if(!w)return;const deaths=Math.min(w.stock,Math.max(0,Number(st.quick.deaths)||0));const remain=w.stock-deaths;
  el.innerHTML=`<div class="shell main"><div class="page-head"><div><div class="kicker">QUICK TOOL / OFFLINE READY</div><h1>簡易ストック計算</h1><p class="sub mb0">ブキを選んでデスを記録。会員登録も通信も必要ありません。</p></div><button class="btn btn-secondary" data-action="home">← 戻る</button></div><div class="quick-layout"><section class="panel panel-pad"><div class="form-group"><label class="field-label" for="quick-search">使用ブキ（全65種類）</label><input id="quick-search" class="field" type="search" data-weapon-filter="quick" placeholder="ブキ名で検索" aria-label="ブキ検索" style="margin-bottom:8px">${selectWeapons('quick-weapon',w.name,'quick-weapon')}</div><div class="stock-figure"><div class="sub small strong">残りストック</div><span class="stock-big ${remain===0?'danger':''} mono">${remain}</span><span class="stock-out"> / ${w.stock}</span>${dots(remain,w.stock)}<div class="sub">デス ${deaths}回</div></div>${remain===0?'<p class="error-note">ストック切れ：リスポーンから出ない</p>':''}<div class="stack"><button class="btn btn-death btn-block" data-action="quick-death" ${remain===0?'disabled':''}>＋ 1デス記録</button><button class="btn btn-secondary btn-block" data-action="quick-undo" ${deaths===0?'disabled':''}>↶ 取り消し</button><button class="btn btn-text" data-action="quick-reset">デス数をリセット</button></div><p class="detail-note">このページのブキとデス数は端末内に保存されます。大会での同期には影響しません。</p></section><div class="quick-tiers">${tierFigure()}</div></div></div>`;
}
function renderHelp(){
  el.innerHTML=`<div class="shell main help-page"><div class="page-head"><div><div class="kicker">PLAYER GUIDE / SPLASTOCK</div><h1>参加者向けの使い方</h1><p class="sub mb0">試合中も、この画面から確認できます。</p></div><button class="btn btn-secondary" data-action="help-back">← 戻る</button></div>
  <section class="panel panel-pad"><div class="kicker">BEFORE THE MATCH</div><h2>試合までの3ステップ</h2><ol class="help-steps"><li><strong>初回だけ自分の名前を選ぶ</strong><p>ホームの参加受付中の大会を開き、運営者が登録した名前を選択します。他人の名前を選ばないでください。</p></li><li><strong>ブキを選ぶ</strong><p>対戦画面で使用ブキを選びます。ブキは次の試合にも引き継がれます。変更があれば選び直してください。</p></li><li><strong>チームで「準備OK」</strong><p>4人のブキ登録と参加が揃ったら、チームの誰か1人が準備OKを押します。相手チームも準備OKになると自動で試合が開始されます。</p></li></ol><div class="warning">準備OK後にチーム内でブキが変更された場合、そのチームの準備OKは自動解除されます。再度押してください。</div><div class="notice margin-top">両チームが準備OKして試合開始となるまで、相手のブキ・個人ストック・チーム合計は「??」と表示されます。相手の準備OK状況だけは確認できます。</div></section>
  <section class="panel panel-pad margin-top"><div class="kicker">DURING THE MATCH</div><h2>デスしたら1タップ</h2><p>「1デス記録」を押すとストックが1減ります。押し間違えたら「取り消し」。残り0になったらリスポーン地点から出ないでください。</p><p>チーム合計と相手チームの残りストックは同じ画面で確認できます。<strong>勝敗を確定するのは運営者です。</strong></p><div class="notice">試合中にスマホを操作しやすい状態にしておいてください。「画面消灯防止」も利用できます（端末が対応している場合）。</div></section>
  <section class="panel panel-pad margin-top"><div class="kicker">IF SOMETHING GOES WRONG</div><h2>困ったとき</h2><dl class="help-faq"><dt>通信が切れた</dt><dd>端末に未送信の記録が残っている場合は再接続時に送信されます。「未同期」が消えるまで記録を削除しないでください。ほかの選手からはまだ最新の数字が見えない場合があります。</dd><dt>別の人の名前を選んだ</dt><dd>自分で新しく登録し直さず、運営者へ伝えてください。個人IDから割り当てを修正できます。</dd><dt>ブキが変えられない</dt><dd>デス記録がある試合ではブキの変更が制限されます。試合中の変更が必要なら運営者に相談してください。</dd><dt>残りストックがおかしい</dt><dd>まず未同期件数を確認し、デス記録の取り消しが必要なら操作してください。勝敗が確定してしまった場合は運営者へ連絡してください。</dd></dl></section>
  <div class="actions margin-top"><button class="btn btn-primary btn-large" data-action="help-back">元の画面に戻る</button><button class="btn btn-secondary" data-action="quick">簡易ストック計算</button></div></div>`;
}
function renderClaim(){
  const groups=[...new Map(st.roster.map(s=>[s.team_id,{id:s.team_id,name:s.team_name,seed:s.team_seed}])).values()];
  el.innerHTML=`<div class="shell main roster-claim"><div class="page-head"><div><div class="kicker">FIRST JOIN / NO PASSWORD</div><h1>あなたの名前を選択</h1><p class="sub mb0">主催者が登録した一覧から自分の名前を選んでください。本人確認はありません。</p></div><button data-action="home" class="btn btn-secondary">← 戻る</button></div><div class="warning">他人の名前を選ばないでください。間違えて登録した場合、主催者が管理画面から割り当てを修正できます。</div><div class="panel panel-pad margin-top"><div class="between"><h3>自分のアイコン色</h3>${avatar(st.claimColor,'avatar-lg')}</div><div class="actions margin-top">${COLORS.map(c=>`<button type="button" data-action="pick-color" data-color="${c}" class="pick-dot ${st.claimColor===c?'active':''}" style="background:${c}" aria-label="カラー ${c}" title="カラー ${c}"></button>`).join('')}</div><p class="hint">アイコンは色付きの丸だけ。いつでも変更できます。</p></div><div class="section-head"><div class="section-caption">SELECT PLAYER</div><span class="badge">${st.roster.filter(s=>s.is_claimed).length}/${st.roster.length} 登録済み</span></div><div class="grid-2">${groups.map(team=>`<section class="team-roster"><div class="between"><h3>${esc(team.name)}</h3><span class="badge">${team.seed}組</span></div><div class="stack">${st.roster.filter(s=>s.team_id===team.id).map(s=>`<button class="identity-option" data-action="claim-slot" data-id="${s.slot_id}" ${s.is_claimed||!s.display_name?'disabled':''}>${avatar(s.color||COLORS[1])}<div class="flex-fill"><strong>${esc(s.display_name||'名前未設定')}</strong><div class="small sub">${s.position}番の選手 · ${s.is_claimed?'登録済み':'選択可能'}</div></div>${s.is_claimed?'登録済み':'選択 →'}</button>`).join('')}</div></section>`).join('')}</div></div>`;
}
function renderColorEditor(){
  el.innerHTML=`<div class="shell main"><div class="page-head"><div><div class="kicker">PROFILE COLOR</div><h1>アイコンの色</h1><p class="sub mb0">シンプルな色付きの丸から選べます。</p></div><button data-action="back-event" class="btn btn-secondary">← 戻る</button></div><section class="panel panel-pad" style="max-width:480px"><div class="between"><h3>${esc(mySlot()?.display_name||st.profile?.nickname||'プレイヤー')}</h3>${avatar(st.claimColor,'avatar-lg')}</div><div class="actions margin-top">${COLORS.map(c=>`<button type="button" data-action="pick-color" data-color="${c}" class="pick-dot ${st.claimColor===c?'active':''}" style="background:${c}" aria-label="カラー ${c}" title="カラー ${c}"></button>`).join('')}</div><button class="btn btn-primary btn-block margin-top" data-action="save-color">この色で保存</button></section></div>`;
}
function pickEventDefault(data){const myTeam=data.slots.find(s=>s.profile_id===st.user?.id)?.team_id;return data.matches.find(m=>m.status==='live' && [m.team_a_id,m.team_b_id].includes(myTeam))||data.matches.find(m=>m.status==='live')||data.matches.find(m=>m.status==='pending'&&[m.team_a_id,m.team_b_id].includes(myTeam)&&m.team_a_id&&m.team_b_id)||data.matches.find(m=>m.status==='pending'&&m.team_a_id&&m.team_b_id)||data.matches[0]||null}
function matchScore(mp,slot,m){const weapon=mp?.weapon_name||slot?.preferred_weapon;const max=mp?.base_stock??st.weaponMap.get(weapon)?.stock??null;let deaths=mp?.deaths||0;const queued=(!ADMIN_MODE&&m?.status==='live'&&slot?.profile_id===st.user?.id)?pendingFor(m.id):[];deaths+=queued.reduce((n,e)=>n+e.delta,0);return {weapon,max,deaths,remain:max===null?null:Math.max(0,max-deaths),queued:queued.length}}
// Only the participant's own team may see its selections before the match begins.
// The SQL RPC also masks opponent preferred_weapon: this display gate is defense in depth.
function concealedTeam(teamId,m){return !ADMIN_MODE&&m?.status==='pending'&&mySlot()?.team_id!==teamId}
function teamScores(teamId,m){const slots=st.event.slots.filter(s=>s.team_id===teamId).sort((a,b)=>a.position-b.position);let total=0,max=0,known=0;
  const hidden=concealedTeam(teamId,m);
  const rows=slots.map(slot=>{const mp=m?.status==='pending'?null:st.matchPlayers.find(x=>x.slot_id===slot.id);const sc=hidden?{weapon:null,max:null,deaths:0,remain:null}:matchScore(mp,slot,m);if(!hidden&&sc.max!==null){max+=sc.max;total+=sc.remain;known++}return {slot,sc}});
  return {rows,total,max,complete:known===4,known,hidden};
}
function renderDuel(m){const a=teamScores(m.team_a_id,m),b=teamScores(m.team_b_id,m);
  const side=(teamId,s,rival)=>`<div class="duel-side ${rival?'rival':''}"><span class="duel-team">${esc(teamName(teamId))}</span><div class="duel-stock mono">${s.hidden?'??':s.complete?s.total:'—'} <small>/ ${s.hidden?'??':s.complete?s.max:'未確定'}</small></div></div>`;
  return `<div class="dual-board">${side(m.team_a_id,a,false)}<div class="duel-vs">VS</div>${side(m.team_b_id,b,true)}</div>`;
}
function teamBoard(teamId,m,rival){const s=teamScores(teamId,m);return `<div class="team-board ${rival?'rival':''}"><div class="team-board-head"><div class="between"><span class="team-board-name">${esc(teamName(teamId))}</span><span class="badge">${s.hidden?'ブキ非公開':`${s.known}/4 ブキ`}</span></div><div class="between margin-top"><span class="team-total mono">${s.hidden?'??':s.complete?s.total:'—'} <small class="sub">/ ${s.hidden?'??':s.complete?s.max:'未確定'}</small></span><span class="small sub">合計ストック</span></div><div class="bar">${s.hidden?'<span style="width:0%"></span>':`<span style="width:${s.complete&&s.max?Math.round(s.total/s.max*100):0}%"></span>`}</div></div>${s.rows.map(({slot,sc})=>`<div class="roster-row">${avatar(st.event.profiles.find(p=>p.id===slot.profile_id)?.color)}<div class="roster-info"><strong>${esc(slot.display_name||'名前未設定')}${slot.profile_id===st.user?.id&&!ADMIN_MODE?'（自分）':''}</strong><small>${s.hidden?'??':esc(sc.weapon||'ブキ未選択')}</small></div><div class="roster-value mono ${!s.hidden&&sc.remain===0?'red':''}">${s.hidden?'??':sc.remain===null?'—':sc.remain}${s.hidden?'':`<small>${sc.max===null?'':' / '+sc.max}</small>`}</div></div>`).join('')}</div>`}
function isTeamReady(matchId,teamId){return st.readyRows.some(r=>r.match_id===matchId&&r.team_id===teamId)}
function renderReadyBoard(m,admin=false){
  if(m.status!=='pending'||!m.team_a_id||!m.team_b_id)return '';
  const ids=[m.team_a_id,m.team_b_id];const slot=mySlot();const myTeam=slot?.team_id;
  const rows=ids.map(id=>{
    const slots=st.event.slots.filter(s=>s.team_id===id);
    const registered=slots.filter(s=>s.profile_id).length;
    const hidden=concealedTeam(id,m);
    const selected=hidden?0:slots.filter(s=>st.weaponMap.has(s.preferred_weapon)).length;
    const ready=isTeamReady(m.id,id);
    const canReady=slots.length===4&&selected===4&&(st.event.tournament.is_test||registered===4);
    const canEdit=!admin&&myTeam===id&&!st.event.tournament.is_test;
    return `<div class="ready-team ${ready?'is-ready':''}"><div class="between"><strong>${esc(teamName(id))}</strong><span class="badge ${ready?'badge-live':''}">${ready?'✓ 準備OK':'準備中'}</span></div><div class="ready-count">${hidden?'ブキ ??/4 · 参加 ??/4':`ブキ ${selected}/4${!st.event.tournament.is_test?` · 参加 ${registered}/4`:''}`}</div>${canEdit?`<button class="btn ${ready?'btn-secondary':'btn-primary'} btn-block" data-action="team-ready" data-ready="${ready?'0':'1'}" data-match="${m.id}" ${!ready&&!canReady?'disabled':''}>${ready?'準備OKを取り消す':'このチームは準備OK'}</button>`:''}${!ready&&!canReady?'<p class="hint">4人全員の参加とブキ登録が必要です。</p>':''}</div>`;
  }).join('');
  return `<section class="ready-panel margin-top" aria-label="試合準備状況"><div class="between ready-heading"><div><div class="kicker">TEAM CHECK-IN</div><h3>両チームの準備状況</h3></div><span class="badge">両チームOKで自動開始</span></div><div class="ready-grid">${rows}</div><p class="hint">準備OKはチームで1人が押せば完了。ブキを変更するとそのチームの準備OKは解除されます。勝敗は運営者が確定します。</p></section>`;
}
function personalControl(m){const slot=mySlot(),me=slot&&matchOfMe(m);if(!me)return `<section class="personal-card"><div class="kicker">SPECTATOR MODE</div><h3>この試合の状況を確認中</h3><p class="sub small">この試合の選手ではないため、ストック情報は閲覧のみ可能です。</p></section>`;
  const mp=st.matchPlayers.find(x=>x.slot_id===slot.id);const sc=matchScore(m.status==='pending'?null:mp,slot,m);const pending=pendingFor(m.id);const allowSelect=m.status==='pending'||(m.status==='live'&&(mp?.deaths||0)===0&&pending.length===0);const selectVal=m.status==='pending'?slot.preferred_weapon:(mp?.weapon_name||slot.preferred_weapon);const recent=st.recent.filter(w=>st.weaponMap.has(w)).slice(0,3);
  return `<section class="personal-card"><div class="kicker">MY STOCK / ${esc(slot.display_name)}</div><div class="form-group"><label class="field-label" for="match-search">使用ブキ ${allowSelect?'':'（変更不可）'}</label>${allowSelect?'<input id="match-search" class="field" type="search" data-weapon-filter="match" placeholder="ブキ名で検索" aria-label="ブキ検索" style="margin-bottom:8px">':''}<select id="match-weapon" data-change="match-weapon" class="field" ${allowSelect?'':'disabled'}><option value="">ブキを選択</option>${st.weapons.map(w=>`<option value="${esc(w.name)}" ${selectVal===w.name?'selected':''}>${esc(w.name)} — ${w.stock}</option>`).join('')}</select>${allowSelect?`<div class="actions margin-top">${recent.map(w=>`<button class="btn btn-secondary btn-small" data-action="recent-weapon" data-weapon="${esc(w)}">${esc(w)}</button>`).join('')}</div>`:''}</div><div class="stock-figure"><div class="sub small strong">残りストック</div><span class="stock-big ${sc.remain===0?'danger':''} mono">${sc.remain??'—'}</span><span class="stock-out"> / ${sc.max??'—'}</span>${dots(sc.remain||0,sc.max||0)}<div class="sub small">デス ${sc.deaths}回</div></div>${sc.remain===0?'<div class="error-note">ストック切れ。リスポーンから出ない。</div>':''}<div class="stack margin-top"><button class="btn btn-death" data-action="death" ${m.status!=='live'||sc.max===null||sc.remain<=0?'disabled':''}>＋ 1デス記録</button><button class="btn btn-secondary btn-block" data-action="undo" ${m.status!=='live'||sc.deaths<=0?'disabled':''}>↶ 直前の記録を取り消し</button></div><div class="between margin-top"><span class="sub small">${m.status==='pending'?'試合開始待ち':'操作は自動保存'}</span><button class="btn btn-text" data-action="wake">画面消灯防止 ${st.wakeEnabled?'ON':'OFF'}</button></div>${pending.length?`<div class="warning margin-top"><strong>未同期 ${pending.length}件</strong>：この端末内に保存中。<button class="btn btn-secondary btn-small" data-action="retry-sync">再送</button> <button class="btn btn-text" data-action="clear-pending">記録を破棄</button></div>`:m.status==='live'?'<p class="hint">同期済みのデス数は全員に共有されます。</p>':''}</section>`;
}
function matchSelector(m){return `<button class="card-btn ${m.id===st.matchId?'active':''}" data-action="pick-match" data-id="${m.id}"><div class="between"><span class="small sub">R${m.round_index} / #${m.match_index}</span>${badge(m.status)}</div><div class="card-title">${esc(teamName(m.team_a_id))} <span class="sub">vs</span> ${esc(teamName(m.team_b_id))}</div></button>`}
function renderMatches(admin){const d=event();if(!d.matches.length)return `<div class="empty">対戦表はまだありません。${admin?'主催者が対戦表を生成してください。':'主催者の設定をお待ちください。'}</div>`;
  const m=currMatch();return `<div class="grid-aside"><section><div class="section-head"><h2>対戦一覧</h2><span class="badge">${d.matches.length}試合</span></div><div class="matches-list">${d.matches.map(matchSelector).join('')}</div></section><section><div class="section-head"><h2>${m?`${esc(teamName(m.team_a_id))} vs ${esc(teamName(m.team_b_id))}`:'試合を選択'}</h2>${m?badge(m.status):''}</div>${m?`${renderReadyBoard(m,admin)}${renderDuel(m)}${admin?adminMatchControls(m):''}<div class="control-grid">${admin?`<section class="personal-card"><div class="kicker">ORGANIZER VIEW</div><h3>全選手のストックを確認</h3><p class="sub small">選手のデス記録は本人が操作します。ここからは勝敗と試合進行のみ管理できます。</p></section>`:personalControl(m)}<div class="scoreboard">${teamBoard(m.team_a_id,m,false)}${teamBoard(m.team_b_id,m,true)}</div></div><p class="detail-note">${!admin&&m.status==='pending'?'相手のブキ・個人ストック・チーム合計は、両チームの準備OKによる試合開始まで「??」で非公開です。 ':''}ブキ未選択の選手がいる間、チームの合計ストックは「未確定」と表示します。通信切断中の本人の操作は他端末には未反映です。</p>`:''}</section></div>`;
}
function adminMatchControls(m){if(m.status==='finished')return `<div class="success-note margin-top result-complete"><div><strong>勝者：${esc(teamName(m.winner_id))}</strong><p class="hint">誤確定は記録を残して訂正できます。次の試合が始まっている場合は訂正できません。</p></div><button class="btn btn-secondary btn-small" data-action="admin-revise-result" data-id="${m.id}">結果を訂正・再開</button></div>`;
  if(!m.team_a_id||!m.team_b_id)return '<div class="warning margin-top">両チームが確定していません。</div>';
  return `<div class="panel panel-pad margin-top"><div class="between"><div><strong>${m.status==='pending'?'両チームの準備待ち':'試合進行中'}</strong><div class="sub small">${m.status==='pending'?'2チームの準備OKで自動開始します。':'勝敗は運営者が確認して確定します。'}</div></div>${m.status==='live'?`<button class="btn btn-primary" data-action="admin-finish-match" data-id="${m.id}">勝敗を確定</button>`:st.event.tournament.is_test?`<button class="btn btn-secondary" data-action="admin-start-match" data-id="${m.id}">テスト手動開始</button>`:''}</div></div>`;
}
function renderSchedule(){const d=event();if(!d.matches.length)return '<div class="empty">対戦表は未作成です。</div>';
  const rounds=[...new Set(d.matches.map(m=>m.round_index))];
  if(d.tournament.format==='round_robin'){
    const standings=d.teams.map(t=>{const played=d.matches.filter(m=>m.status==='finished'&&[m.team_a_id,m.team_b_id].includes(t.id));return {team:t,played:played.length,wins:played.filter(m=>m.winner_id===t.id).length}}).sort((a,b)=>b.wins-a.wins);
    return `<div class="panel panel-pad"><h2>暫定成績</h2><div class="scroll-x"><table class="round-table"><thead><tr><th>チーム</th><th>試合</th><th>勝利</th><th>敗北</th></tr></thead><tbody>${standings.map(x=>`<tr><td>${esc(x.team.name)}</td><td>${x.played}</td><td><b>${x.wins}</b></td><td>${x.played-x.wins}</td></tr>`).join('')}</tbody></table></div></div><div class="rounds margin-top">${rounds.map(r=>`<section class="panel panel-pad"><h3>ROUND ${r}</h3><div class="stack">${d.matches.filter(m=>m.round_index===r).map(matchSelector).join('')}</div></section>`).join('')}</div>`;
  }
  return `<div class="section-head"><h2>トーナメント表</h2><span class="badge">横スクロールで全ラウンドを確認</span></div><div class="bracket">${rounds.map(r=>`<div class="bracket-col"><div class="kicker">ROUND ${r}</div>${d.matches.filter(m=>m.round_index===r).map(m=>`<button class="card-btn ${m.id===st.matchId?'active':''}" data-action="pick-match" data-id="${m.id}"><div class="between"><span class="small sub">MATCH ${m.match_index}</span>${badge(m.status)}</div><div class="card-title">${esc(teamName(m.team_a_id))}</div><div class="card-title">${esc(teamName(m.team_b_id))}</div></button>`).join('')}</div>`).join('')}</div>`;
}
function teamLists(){return `<div class="grid-2">${st.event.teams.map(team=>`<section class="team-roster"><div class="between"><h3>${esc(team.name)}</h3><span class="badge">TEAM ${team.seed}</span></div>${st.event.slots.filter(s=>s.team_id===team.id).sort((a,b)=>a.position-b.position).map(s=>{const p=st.event.profiles.find(x=>x.id===s.profile_id);const mine=ADMIN_MODE||mySlot()?.team_id===team.id;const started=currMatch()?.status!=='pending'&&st.matchPlayers.find(mp=>mp.slot_id===s.id);const weapon=mine?s.preferred_weapon:started?.weapon_name;return `<div class="roster-row">${avatar(p?.color)}<div class="roster-info"><strong>${esc(s.display_name||'名前未設定')}</strong><small>${weapon?esc(weapon):mine?'ブキ未選択':'??'}</small></div><span class="badge">${s.profile_id?'参加済み':s.position+'番'}</span></div>`}).join('')}</section>`).join('')}</div>`}
function eventHeader(admin=false){const e=st.event;if(!e)return '';return `<div class="page-head"><div><div class="kicker">${admin?'ORGANIZER / EVENT':'PLAYER / EVENT'}</div><h1>${esc(e.tournament.name)}</h1><div class="actions">${badge(e.tournament.status)}<span class="badge">${fmt(e.tournament.format)}</span><span class="badge">${e.teams.length}チーム</span>${admin?`<span class="badge ${e.tournament.is_test?'badge-dark':e.tournament.is_open?'badge-live':''}">${e.tournament.is_test?'テスト専用 / 非公開':e.tournament.is_open?'参加受付中':'受付停止'}</span>`:''}</div></div><button class="btn btn-secondary" data-action="home">← ホーム</button></div>`}
function renderEvent(){if(!st.event){el.innerHTML='<div class="shell loading">大会データを読み込み中…</div>';return}
  const slot=mySlot();const tabs=[['match','対戦・ストック'],['schedule','対戦表'],['teams','チーム一覧']];
  el.innerHTML=`<div class="shell main">${eventHeader()}${slot?`<div class="notice">あなたは <strong>${esc(teamName(slot.team_id))} / ${esc(slot.display_name)}</strong> として参加しています。ブキは前の試合から引き継がれます。</div>`:''}<nav class="tabs">${tabs.map(([v,t])=>`<button class="tab ${st.tab===v?'active':''}" data-action="player-tab" data-tab="${v}">${t}</button>`).join('')}</nav>${st.tab==='schedule'?renderSchedule():st.tab==='teams'?teamLists():renderMatches(false)}<section class="panel panel-pad margin-top between"><div class="row"><span class="sub small">アイコン色：</span>${avatar(st.profile?.color)}<span class="small">${esc(slot?.display_name||'プレイヤー')}</span></div><button class="btn btn-secondary btn-small" data-action="change-color">色を変更</button></section></div>`;
}
function renderAdminLogin(){el.innerHTML=`<div class="shell main"><section class="admin-login panel panel-pad"><div class="kicker">ORGANIZER / SECURE SIGN IN</div><h1 style="font-size:31px">運営者ログイン</h1><p class="sub">メールリンクは送信しません。運営者のメールアドレスと設定済みのパスワードで、PC・スマホのどちらからでもログインできます。</p><form id="admin-login-form"><div class="form-group"><label class="field-label" for="admin-email">メールアドレス</label><input id="admin-email" name="email" type="email" class="field" autocomplete="username" placeholder="you@example.com" required></div><div class="form-group"><label class="field-label" for="admin-password">パスワード</label><input id="admin-password" name="password" type="password" class="field" autocomplete="current-password" required minlength="1" maxlength="128" placeholder="管理者パスワード"></div><button class="btn btn-primary btn-block btn-large" type="submit">ログインする →</button></form><div class="notice margin-top"><strong>初回だけ設定が必要です。</strong><br>以前のメールリンクでスマホにログインできている場合、スマホの運営者画面で「パスワード設定」を押してください。設定後、PCでも同じメールアドレスとパスワードで入れます。</div><p class="hint">ここでは新規アカウント登録やメール送信を行いません。管理権限はSupabase側で確認します。</p><hr class="divider"><button class="btn btn-secondary btn-block" data-action="quick">簡易計算に戻る</button></section></div>`}
function renderAdminPassword(){
  if(!st.isAdmin||!st.adminUser){st.view='admin-login';renderAdminLogin();return}
  el.innerHTML=`<div class="shell main"><section class="admin-login panel panel-pad"><div class="kicker">ORGANIZER / ACCOUNT</div><h1 style="font-size:31px">管理者パスワード設定</h1><p class="sub">現在ログイン中の <strong>${esc(st.adminUser.email||'運営者')}</strong> にパスワードを設定・変更します。ここで設定すると、PCとスマホのどちらからでもメール送信なしでログインできます。</p><form id="admin-password-form"><div class="form-group"><label class="field-label" for="new-admin-password">新しいパスワード（12文字以上）</label><input id="new-admin-password" name="password" type="password" class="field" autocomplete="new-password" minlength="12" maxlength="128" required></div><div class="form-group"><label class="field-label" for="confirm-admin-password">新しいパスワード（確認）</label><input id="confirm-admin-password" name="confirm" type="password" class="field" autocomplete="new-password" minlength="12" maxlength="128" required></div><button type="submit" class="btn btn-primary btn-block btn-large">パスワードを設定する</button></form><div class="warning margin-top">パスワードはこの画面から直接Supabase Authへ送信され、サイトのデータベースやソースコードには保存しません。端末の保存機能は各自で管理してください。</div><p class="hint">Supabase側で「パスワード変更時の再認証」を必須にしている場合は、追加認証を求められることがあります。</p><button class="btn btn-secondary btn-block margin-top" data-action="home">大会管理に戻る</button></section></div>`
}
function renderAdminHome(){const rows=st.adminEvents.map(t=>`<button class="card-btn" data-action="admin-open-event" data-id="${t.id}"><div class="between"><span class="kicker">${t.is_test?'TEST SANDBOX':'EVENT'} / ${esc(fmt(t.format))}</span>${badge(t.status)}</div><div class="card-title">${esc(t.name)}</div><div class="card-sub">${t.is_test?'非公開・8人代理操作可能':(t.is_open?'受付中':'受付停止')} · ${t.organizer_id===st.adminUser?.id?'管理対象':'旧イベント・管理者への移管が必要'}</div></button>`).join('');
  el.innerHTML=`<div class="shell main"><div class="page-head"><div><div class="kicker">ADMIN CONSOLE</div><h1>大会管理</h1><p class="sub mb0">プレイヤー名とチームを先に登録。参加者は一覧から自分の名前を選択します。</p></div><span class="badge badge-dark">認証済み運営者</span></div><div class="notice margin-top"><div class="between"><span>PCでもログインできるよう、現在の管理者アカウントにパスワードを設定できます。</span><button type="button" class="btn btn-secondary btn-small" data-action="admin-password">パスワード設定</button></div></div><div class="grid-aside margin-top"><section class="panel panel-pad"><div class="kicker">CREATE EVENT</div><h2>新しい大会</h2><form id="admin-create-form"><div class="form-group"><label class="field-label" for="event-name">大会名</label><input id="event-name" name="name" class="field" maxlength="60" required placeholder="例：ストック杯"></div><div class="form-group"><label class="field-label" for="event-format">形式</label><select id="event-format" name="format" class="field"><option value="elimination">トーナメント</option><option value="round_robin">総当たり</option></select></div><div class="form-group"><label class="field-label" for="event-teams">チーム名（2～16、1行1チーム）</label><textarea id="event-teams" name="teams" class="field textarea" required>チーム A\nチーム B\nチーム C\nチーム D</textarea></div><label class="test-check"><input type="checkbox" name="test_mode" value="1"><span><strong>1台で検証するテスト大会として作成</strong><small>8人分の名前を自動設定・プレイヤーのログイン不要・本番大会とは完全に分離</small></span></label><button type="submit" class="btn btn-primary btn-block">大会の枠を作る</button></form><p class="hint">通常大会はこれまで通り、名前登録→参加受付。テスト大会は非公開のまま運営者が全員を操作できます。</p></section><section><div class="section-head"><h2>作成済みの大会</h2><span class="badge">${st.adminEvents.length}件</span></div>${rows?`<div class="stack">${rows}</div>`:'<div class="empty">大会がありません。</div>'}</section></div></div>`;
}
function adminRoster(){const e=st.event;return `<div class="section-head"><div><div class="kicker">ROSTER / ORGANIZER ONLY</div><h2>選手名を事前登録</h2></div>${e.tournament.is_test?'<span class="badge badge-dark">テスト大会：受付不要</span>':`<button class="btn ${e.tournament.is_open?'btn-danger':'btn-primary'}" data-action="admin-toggle-open">${e.tournament.is_open?'参加受付を停止':'参加受付を開始'}</button>`}</div><div class="notice">${e.tournament.is_test?'これは非公開のテスト大会です。仮の8選手を管理画面で操作できます。名前の編集は任意です。':'参加者には名前を選ぶだけにしてもらいます。名前が誤って取得された場合、下の「移動・入替」または「登録解除」で直せます。'}</div><div class="grid-2 margin-top">${e.teams.map(team=>{const slots=e.slots.filter(s=>s.team_id===team.id).sort((a,b)=>a.position-b.position);return `<section class="team-roster"><form data-form="roster" data-team="${team.id}"><div class="between"><h3>TEAM ${team.seed}</h3><button type="submit" class="btn btn-primary btn-small">このチームを保存</button></div><div class="form-group"><label class="field-label">チーム名</label><input class="field" name="teamName" maxlength="36" value="${esc(team.name)}" required></div><div class="roster-edit-grid">${slots.map(s=>`<div><label class="field-label">${s.position}番 ${s.profile_id?'●':''}</label><input class="field" name="player${s.position}" maxlength="24" value="${esc(s.display_name||'')}" placeholder="選手名" required></div>`).join('')}</div></form></section>`}).join('')}</div><div class="section-head"><h2>プレイヤーの割り当て修正</h2><span class="badge">${e.slots.filter(s=>s.profile_id).length}/${e.slots.length} 登録</span></div><section class="panel panel-pad"><p class="sub small">登録された端末の個人IDを確認できます。間違って選んだ選手を移動するときは、移動先の名前を選んでください。移動先にも登録者がいる場合は入れ替えます。</p><div class="stack">${e.slots.filter(s=>s.profile_id).map(s=>{const options=e.slots.filter(x=>x.id!==s.id).map(x=>`<option value="${x.id}">${esc(teamName(x.team_id))} / ${esc(x.display_name||'未設定')}${x.profile_id?'（登録済み）':''}</option>`).join('');return `<div class="admin-slot"><span>${avatar(e.profiles.find(p=>p.id===s.profile_id)?.color)}</span><div style="flex:1;min-width:145px"><div class="admin-slot-name">${esc(s.display_name||'名前未設定')} <span class="sub small">(${esc(teamName(s.team_id))})</span></div><div class="admin-slot-id">ID: ${esc(s.profile_id)}</div></div><div class="actions"><button class="btn btn-secondary btn-small" data-action="copy-id" data-id="${s.profile_id}">IDコピー</button><select class="field" id="move-${s.id}" aria-label="移動先">${options}</select><button class="btn btn-secondary btn-small" data-action="admin-move" data-id="${s.id}">移動・入替</button><button class="btn btn-danger btn-small" data-action="admin-release" data-id="${s.id}">解除</button></div></div>`}).join('')||'<div class="sub">まだ誰も参加していません。</div>'}</div><div class="warning margin-top">試合のストック記録が作成された後は、履歴を壊さないよう選手の移動・解除を禁止しています。表示名の修正は可能です。</div><div class="divider-soft"></div><h3>端末紛失・再接続用のID付け替え</h3><p class="sub small">端末が変わり匿名IDが失われた場合に使います。本人の新しい端末に表示される「個人ID」を入力してください。元のストック記録はそのまま保持します。</p><form id="admin-rebind-form"><div class="form-group"><label class="field-label" for="rebind-slot">対象の選手</label><select id="rebind-slot" name="slot" class="field" required>${e.slots.filter(x=>x.profile_id).map(x=>`<option value="${x.id}">${esc(teamName(x.team_id))} / ${esc(x.display_name||'')}</option>`).join('')}</select></div><div class="form-group"><label class="field-label" for="rebind-user">新端末の個人ID（UUID）</label><input id="rebind-user" class="field" name="user" required placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" pattern="[a-fA-F0-9-]{36}"></div><button type="submit" class="btn btn-secondary">この選手を新しいIDに付け替える</button></form></section>`}
function adminSchedule(){return `<div class="section-head"><div><div class="kicker">MATCH CONTROL</div><h2>対戦の進行</h2></div>${st.event.matches.length?'':`<button class="btn btn-primary" data-action="admin-generate">対戦表を自動生成</button>`}</div><div class="notice">${st.event.tournament.is_test?'テスト大会です。「8人テスト」タブで選手8人を1台から操作できます。試合開始・勝敗確定は「8人テスト」タブからも操作できます。':'勝敗は実際の対戦結果を確認して運営者が確定します。進行中は選手本人だけがデス数を更新できます。'}</div><div class="margin-top">${renderMatches(true)}</div>${st.resultHistory.length?`<section class="panel panel-pad margin-top"><h3>勝敗の訂正履歴</h3><div class="stack">${st.resultHistory.map(h=>`<div class="audit-row"><strong>${h.action==='correct'?'勝者訂正':'試合再開'}</strong> · ${esc(new Date(h.changed_at).toLocaleString('ja-JP'))}<div class="sub small">${esc(teamName(h.previous_winner))} → ${h.new_winner?esc(teamName(h.new_winner)):'未確定'} / ${esc(h.reason)}</div></div>`).join('')}</div></section>`:''}`}
// 8人テストは通常の匿名セッションに成り代わらず、テスト大会でのみ運営者RPCを使う。
function renderTestPanel(){
  const d=st.event,m=currMatch();
  if(!d?.tournament.is_test)return '<div class="warning">通常大会ではテスト操作できません。</div>';
  if(!d.matches.length)return '<div class="empty"><h3>対戦表がまだありません</h3><p>先に対戦表を作成すると、テスト開始ボタンと8人の操作欄が表示されます。8人分のログインは不要です。</p><button type="button" class="btn btn-primary" data-action="admin-generate">対戦表を生成</button></div>';
  if(!m || !m.team_a_id || !m.team_b_id)return `<div class="empty">対戦する2チームが確定した試合を選んでください。<div class="margin-top">${d.matches.map(matchSelector).join('')}</div></div>`;
  const slots=d.slots.filter(s=>[m.team_a_id,m.team_b_id].includes(s.team_id))
    .sort((a,b)=>(d.teams.find(t=>t.id===a.team_id)?.seed||0)-(d.teams.find(t=>t.id===b.team_id)?.seed||0)||a.position-b.position);
  const mine=slots.find(s=>s.id===st.testSlotId)||slots[0];
  const mp=mine?st.matchPlayers.find(x=>x.slot_id===mine.id):null;
  const score=mine?matchScore(m.status==='pending'?null:mp,mine,m):null;
  const editable=m.status!=='finished';
  const canWeapon=editable&&(m.status==='pending'||(mp?.deaths||0)===0);
  const currentWeapon=m.status==='pending'?mine?.preferred_weapon:(mp?.weapon_name||mine?.preferred_weapon);
  const playerBtns=slots.map(slot=>{
    const snapshot=m.status==='pending'?null:st.matchPlayers.find(x=>x.slot_id===slot.id);
    const sc=matchScore(snapshot,slot,m);
    const chosen=slot.id===mine?.id;
    return `<button type="button" class="test-person ${chosen?'active':''}" data-action="admin-test-select" data-id="${slot.id}" aria-pressed="${chosen}"><span class="test-person-head"><span class="test-person-label">${esc(teamName(slot.team_id))}</span><strong>${esc(slot.display_name||'選手 '+slot.position)}</strong></span><span class="test-person-stock mono">${sc.remain??'—'}<small> / ${sc.max??'—'}</small></span><small class="test-person-weapon">${esc(sc.weapon||'未選択')}</small></button>`;
  }).join('');
  return `<div class="test-heading"><div><div class="kicker">CONTROLLED TEST / ORGANIZER ONLY</div><h2>8人プレイヤーテスト</h2><p class="sub small">本物の選手IDを切り替えず、テスト専用の8枠を代理操作します。操作結果はテスト大会のDBに保存されます。</p></div><span class="badge badge-dark">本番大会へは反映しません</span></div>
  <div class="test-match-switch"><strong>操作対象の試合</strong><div class="test-match-list">${d.matches.filter(x=>x.team_a_id&&x.team_b_id).map(matchSelector).join('')}</div></div>
  <section class="panel panel-pad test-match-actions" aria-label="テスト試合の進行操作">
    <div class="between"><div><div class="kicker">MATCH CONTROL</div><strong>${m.status==='pending'?'試合開始待ち':m.status==='live'?'試合進行中':'試合終了'}</strong><p class="sub small mb0">${m.status==='pending'?'参加者のログインなしで開始できます。ブキ未選択でも試合開始は可能です。':m.status==='live'?'8人のデス数を試して、最後に結果を確定してください。':'試合は確定済みです。別の試合を選択できます。'}</p></div>
    ${m.status==='pending'?`<button type="button" class="btn btn-primary" data-action="admin-start-match" data-id="${m.id}">▶ 試合を開始</button>`:m.status==='live'?`<button type="button" class="btn btn-primary" data-action="admin-finish-match" data-id="${m.id}">勝敗を確定</button>`:`<span class="badge">終了済み</span>`}</div>
  </section>
  ${renderDuel(m)}
  ${m.status==='pending'?`<section class="ready-panel margin-top"><div class="kicker">TEST TEAM READY</div><h3>テスト：チームごとの準備OK</h3><div class="ready-grid">${[m.team_a_id,m.team_b_id].map(t=>{const n=slots.filter(s=>s.team_id===t&&st.weaponMap.has(s.preferred_weapon)).length;const done=isTeamReady(m.id,t);return `<div class="ready-team ${done?'is-ready':''}"><div class="between"><strong>${esc(teamName(t))}</strong><span class="badge">${n}/4 ブキ</span></div><button class="btn ${done?'btn-secondary':'btn-primary'} btn-block" data-action="admin-test-ready" data-team="${t}" data-ready="${done?'0':'1'}" ${!done&&n<4?'disabled':''}>${done?'準備OKを解除':'チーム準備OK'}</button></div>`}).join('')}</div><p class="hint">2チームが準備OKになると自動開始。手動開始は既存機能の検証用に残しています。</p></section>`:''}
  <div class="test-layout margin-top"><section class="panel panel-pad"><div class="between"><div><div class="kicker">SELECT PLAYER</div><h3>操作する選手を選択</h3></div><span class="badge">${slots.length}枠</span></div><div class="test-person-grid margin-top">${playerBtns}</div></section>
  <section class="panel panel-pad test-controller"><div class="between"><div><div class="kicker">PLAYER CONTROL</div><h2>${esc(mine?.display_name||'選手')} <span class="sub small">(${esc(teamName(mine?.team_id))})</span></h2></div>${badge(m.status)}</div>
  <div class="form-group"><label class="field-label" for="test-weapon">この選手の使用ブキ ${canWeapon?'':'（変更不可）'}</label><input class="field" id="test-search" type="search" data-weapon-filter="test" placeholder="65ブキから検索" ${canWeapon?'':'disabled'} style="margin-bottom:8px"><select class="field" id="test-weapon" data-change="test-weapon" ${canWeapon?'':'disabled'}><option value="">ブキを選択</option>${st.weapons.map(w=>`<option value="${esc(w.name)}" ${currentWeapon===w.name?'selected':''}>${esc(w.name)} — ${w.stock}</option>`).join('')}</select></div>
  <div class="stock-figure"><div class="sub small strong">残りストック</div><span class="stock-big ${score?.remain===0?'danger':''} mono">${score?.remain??'—'}</span><span class="stock-out"> / ${score?.max??'—'}</span>${dots(score?.remain||0,score?.max||0)}<div class="sub small">デス ${score?.deaths||0}回</div></div>
  <button type="button" class="btn btn-death btn-block margin-top" data-action="admin-test-death" ${m.status!=='live'||score?.remain===null||score.remain<=0?'disabled':''}>＋ 1デス記録</button>
  <button type="button" class="btn btn-secondary btn-block margin-top" data-action="admin-test-undo" ${m.status!=='live'||!score?.deaths?'disabled':''}>↶ デスを取り消す</button>
  ${m.status==='pending'?`<div class="test-tools"><button type="button" class="btn btn-secondary btn-block" data-action="admin-test-fill">未設定の8人にスプラシューターを一括設定</button><p class="hint">ブキは試合開始前、または初デス前に変更可能。上部の「試合を開始」を押してテストを始められます。</p></div>`:''}
  ${m.status==='finished'?`<p class="hint">この試合は終了しました。デス履歴は保持されます。</p><button class="btn btn-secondary btn-block" data-action="admin-revise-result" data-id="${m.id}">結果を訂正・再開</button>`:''}</section></div>
  <div class="section-head"><div><div class="kicker">LIVE SCORE</div><h2>8人全員のストック</h2></div><span class="badge">${esc(fmt(m.status))}</span></div><div class="scoreboard">${teamBoard(m.team_a_id,m,false)}${teamBoard(m.team_b_id,m,true)}</div>
  <div class="notice margin-top">このモードは「テストとして作成」した大会にのみ表示されます。通常の選手のログイン情報・登録状況・デス履歴には触れません。</div>`;
}
function renderAdminEvent(){if(!st.event){el.innerHTML='<div class="shell loading">大会データを読み込み中…</div>';return}
  const e=st.event;const owned=e.tournament.organizer_id===st.adminUser?.id;
  el.innerHTML=`<div class="shell main">${eventHeader(true)}${!owned?'<div class="warning">この大会は旧バージョンの主催者IDに紐づいています。続行するには現在の運営者へ移管してください。<button class="btn btn-primary btn-small" data-action="admin-adopt">管理対象に移す</button></div>':''}<div class="stats"><div class="metric"><div class="metric-label">チーム</div><div class="metric-value">${e.teams.length}</div></div><div class="metric"><div class="metric-label">${e.tournament.is_test?'操作可能なテスト選手枠':'参加者'}</div><div class="metric-value">${e.tournament.is_test?e.slots.length:e.slots.filter(s=>s.profile_id).length}<span class="sub" style="font-size:14px">${e.tournament.is_test?' 人':' / '+e.slots.length}</span></div></div><div class="metric"><div class="metric-label">進行中</div><div class="metric-value">${e.matches.filter(m=>m.status==='live').length}</div></div></div><nav class="tabs">${[['roster','チーム・選手'],['matches','対戦・ストック'],...(e.tournament.is_test?[['test','8人テスト']]:[]),['schedule','対戦表']].map(([k,t])=>`<button class="tab ${st.adminTab===k?'active':''}" data-action="admin-tab" data-tab="${k}">${t}</button>`).join('')}</nav>${st.adminTab==='roster'?adminRoster():st.adminTab==='matches'?adminSchedule():st.adminTab==='test'&&e.tournament.is_test?renderTestPanel():renderSchedule()}</div>`;
}
async function loadPlayerHome(){unsubscribe();st.view='home';st.event=null;st.eventId=null;st.matchId=null;
  const c=st.playerClient;
  if(!c){st.tournaments=[];st.publicEvents=[];show();return}
  const [mine,pub]=await Promise.all([
    c.from('tournaments').select('id,name,format,status,created_at').order('created_at',{ascending:false}),
    c.rpc('list_open_tournaments')
  ]);
  st.tournaments=check(mine)||[];st.publicEvents=check(pub)||[];show();
}
async function loadClaimRoster(eventId){st.claimEventId=eventId;st.roster=await rpc('list_open_roster',{p_tournament:eventId},st.playerClient);st.view='claim';show()}
async function loadAdminHome(){unsubscribe();st.view='admin-home';st.event=null;st.eventId=null;st.matchId=null;
  const [all, flags]=await Promise.all([rpc('admin_list_all_tournaments',{},st.adminClient),st.adminClient.from('tournaments').select('id,is_test')]);
  const tests=new Set((check(flags)||[]).filter(x=>x.is_test).map(x=>x.id));
  st.adminEvents=(all||[]).map(t=>({...t,is_test:tests.has(t.id)}));show();
}
async function loadEvent(id,first=false){const c=client();if(!c)return;if(st.loading)return;
  if(first){unsubscribe();st.eventId=id;st.event=null;st.matchId=null;st.testSlotId=null;st.tab='match';st.adminTab='roster';st.view=ADMIN_MODE?'admin-event':'event';show()}
  st.loading=true;
  try{
    const [t,teams,slots,matches,ready]=await Promise.all([
      c.from('tournaments').select('id,organizer_id,name,format,status,created_at,is_open,is_test').eq('id',id).single(),
      c.from('teams').select('id,tournament_id,seed,name').eq('tournament_id',id).order('seed'),
      c.rpc('list_visible_slots',{p_tournament:id}),
      c.from('matches').select('id,tournament_id,round_index,match_index,team_a_id,team_b_id,status,winner_id,next_match_id,advance_to_side').eq('tournament_id',id).order('round_index').order('match_index'),
      c.from('match_team_ready').select('match_id,team_id,ready_at').eq('tournament_id',id)
    ]);
    for(const v of [t,teams,slots,matches,ready])check(v);
    const data={tournament:t.data,teams:teams.data||[],slots:slots.data||[],matches:matches.data||[],profiles:[]};
    const pids=[...new Set(data.slots.map(s=>s.profile_id).filter(Boolean))];
    if(pids.length)data.profiles=check(await c.from('profiles').select('id,nickname,color').in('id',pids))||[];
    if(!ADMIN_MODE&&st.pending.length){
      const events=st.pending.filter(x=>x.uid===st.user?.id).map(x=>x.eventId).slice(0,200);
      if(events.length){const ack=check(await c.from('death_events').select('event_id').in('event_id',events));const done=new Set((ack||[]).map(x=>x.event_id));if(done.size){st.pending=st.pending.filter(x=>!done.has(x.eventId));savePending()}}
    }
    if(st.eventId!==id)return;
    st.readyRows=ready.data||[];
    if(ADMIN_MODE&&t.data.organizer_id===st.adminUser?.id){
      try{st.resultHistory=await rpc('admin_match_result_history',{p_tournament:id},st.adminClient)||[]}
      catch(err){st.resultHistory=[];console.warn('訂正履歴を取得できません',err)}
    }else st.resultHistory=[];
    st.event=data;let selected=data.matches.find(m=>m.id===st.matchId);if(!selected)selected=pickEventDefault(data);st.matchId=selected?.id||null;
    st.matchPlayers=[];
    if(selected&&selected.status!=='pending')st.matchPlayers=check(await c.from('match_players').select('match_id,slot_id,weapon_name,base_stock,deaths,updated_at').eq('match_id',selected.id))||[];
    show();if(first)subscribe(id);
  }catch(e){console.error(e);notify('大会を読み込めません：'+e.message,true);if(first){if(ADMIN_MODE)await loadAdminHome();else await loadPlayerHome()}}
  finally{st.loading=false}
  if(!ADMIN_MODE)await drain();
}
function unsubscribe(){if(st.channel){client()?.removeChannel(st.channel);st.channel=null}if(st.refreshTimer){clearTimeout(st.refreshTimer);st.refreshTimer=null}st.realtime='disconnected'}
function refreshSoon(){if(!st.eventId||!['event','admin-event'].includes(st.view))return;
  // Do not destroy admin's unsubmitted roster edits while a background update arrives.
  if(ADMIN_MODE&&st.adminTab==='roster')return;
  clearTimeout(st.refreshTimer);st.refreshTimer=setTimeout(()=>{if(st.loading)refreshSoon();else loadEvent(st.eventId)},350)
}
function subscribe(id){unsubscribe();const c=client();const ch=c.channel('splastock-v2-'+id+'-'+uuid().slice(0,8));
  for(const table of ['matches','match_players','teams','match_team_ready'])ch.on('postgres_changes',{event:'*',schema:'public',table,filter:`tournament_id=eq.${id}`},refreshSoon);
  ch.on('postgres_changes',{event:'*',schema:'public',table:'tournaments',filter:`id=eq.${id}`},refreshSoon);
  ch.on('postgres_changes',{event:'*',schema:'public',table:'profiles'},refreshSoon);
  ch.subscribe(status=>{st.realtime=status;statusHeader();if(status==='SUBSCRIBED')refreshSoon()});st.channel=ch;
}
async function playerInit(){if(!configured){st.view='home';show();return}
  const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  st.playerClient=createClient(config.supabaseUrl,config.supabasePublishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  let session=check(await st.playerClient.auth.getSession()).session;
  if(!session)session=check(await st.playerClient.auth.signInAnonymously()).session;
  if(!session?.user)throw new Error('匿名セッションを作成できません。Supabase Authで匿名認証を有効にしてください。');
  st.user=session.user;
  st.profile=check(await st.playerClient.from('profiles').select('id,nickname,color').eq('id',st.user.id).maybeSingle());
  await loadPlayerHome();
}
async function adminInit(){if(!configured){st.view='admin-login';st.bootError='config.jsのSupabase公開設定がありません';show();return}
  const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  st.adminClient=createClient(config.supabaseUrl,config.supabasePublishableKey,{auth:{storageKey:'splastock_admin_auth_v2',persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  const session=check(await st.adminClient.auth.getSession()).session;
  st.adminUser=session?.user||null;
  if(!st.adminUser){st.view='admin-login';show();return}
  st.isAdmin=await rpc('is_app_admin',{},st.adminClient);
  if(!st.isAdmin){st.view='admin-login';show();notify('このメールアドレスは運営者に許可されていません。管理者設定を確認してください。',true);return}
  await loadAdminHome();
}
async function boot(){try{
  const r=await fetch('./weapons.json',{cache:'no-cache'});if(!r.ok)throw new Error('weapons.json を読み込めません');
  const arr=await r.json();if(!Array.isArray(arr)||arr.length!==65||new Set(arr.map(x=>x.name)).size!==65||arr.some(x=>!Number.isInteger(x.stock)||x.stock<1||x.stock>9))throw new Error('65種類のブキマスターに欠損・重複があります');
  st.weapons=arr;st.weaponMap=new Map(arr.map(x=>[x.name,x]));if(!st.weaponMap.has(st.quick.weapon))st.quick.weapon=arr[0].name;
  show();if(ADMIN_MODE)await adminInit();else await playerInit();
  }catch(e){console.error(e);st.bootError=e.message;show()}}
async function saveColor(){if(!st.profile)return;const color=st.claimColor;check(await st.playerClient.from('profiles').update({color,updated_at:new Date().toISOString()}).eq('id',st.user.id));st.profile.color=color;notify('カラーを変更しました');show()}
async function setWeapon(name){if(!name||!st.weaponMap.has(name))throw new Error('ブキ一覧から選択してください');await rpc('set_player_weapon',{p_tournament:st.eventId,p_weapon:name},st.playerClient);rememberWeapon(name);notify('ブキを保存しました');await loadEvent(st.eventId)}
function canDeath(delta){const m=currMatch(),slot=mySlot();if(!m||m.status!=='live'||!matchOfMe(m))throw new Error('試合中のみ記録できます');const mp=st.matchPlayers.find(x=>x.slot_id===slot.id);if(!mp||mp.base_stock===null)throw new Error('ブキを登録してください');const count=matchScore(mp,slot,m).deaths;if(count+delta<0||count+delta>mp.base_stock)throw new Error('デス数の範囲外です');return m}
async function addDeath(delta){const m=canDeath(delta);st.pending.push({eventId:uuid(),matchId:m.id,uid:st.user.id,delta,createdAt:Date.now()});savePending();show();await drain()}
async function drain(){if(ADMIN_MODE||!st.playerClient||!st.user||st.draining||!navigator.onLine)return;st.draining=true;const blocked=new Set();
  try{while(true){const item=st.pending.find(x=>x.uid===st.user.id&&!blocked.has(x.matchId));if(!item)break;
    let saved;try{saved=await rpc('record_death',{p_match:item.matchId,p_event:item.eventId,p_delta:item.delta},st.playerClient)}catch(e){blocked.add(item.matchId);console.warn('未同期のデスを保持',e);if(st.matchId===item.matchId)notify('未同期の記録を保持中：'+e.message,true);continue}
    const mp=st.matchPlayers.find(x=>x.match_id===item.matchId&&st.event?.slots.some(s=>s.id===x.slot_id&&s.profile_id===st.user.id));if(mp)mp.deaths=Number(saved);
    st.pending=st.pending.filter(x=>x.eventId!==item.eventId);savePending();if(st.view==='event')show();
  }}finally{st.draining=false;if(st.view==='event')refreshSoon()}}
async function ensureWake(){if(!st.wakeEnabled||!('wakeLock' in navigator)||document.visibilityState!=='visible'||st.wakeLock)return;try{st.wakeLock=await navigator.wakeLock.request('screen');st.wakeLock.addEventListener('release',()=>st.wakeLock=null)}catch(e){st.wakeEnabled=false;notify('画面消灯防止が利用できません',true)}}
async function toggleWake(){if(st.wakeEnabled){st.wakeEnabled=false;try{await st.wakeLock?.release()}catch{}st.wakeLock=null}else{if(!('wakeLock' in navigator)){notify('この端末では利用できません',true);return}st.wakeEnabled=true;await ensureWake()}show()}
// V2の #dialog-body と旧index.htmlの #confirm-body の両方に対応。
// 別版のHTMLが混在しても null.innerHTML で止まらないようにする。
function getDialogParts(){
  const dialog=document.getElementById('confirm-dialog');
  const body=document.getElementById('dialog-body')||document.getElementById('confirm-body');
  if(!dialog||!body)throw new Error('確認画面のHTMLが見つかりません。V2のindex.htmlを配置してください。');
  return {dialog,body};
}
function confirmBox(title,message,cb){const {dialog,body}=getDialogParts();body.innerHTML=`<h2 id="dialog-title">${esc(title)}</h2><p class="sub">${esc(message)}</p>`;const f=()=>{dialog.removeEventListener('close',f);if(dialog.returnValue==='confirm')run(cb)};dialog.addEventListener('close',f);dialog.showModal()}
function chooseWinner(m){const {dialog,body}=getDialogParts();body.innerHTML=`<h2 id="dialog-title">勝者を選択</h2><p class="sub">実際の試合結果を確認してから確定してください。必要に応じて運営者が結果を訂正できます。</p><div class="stack">${[m.team_a_id,m.team_b_id].map(t=>`<button type="button" class="btn btn-secondary btn-block" data-action="admin-confirm-winner" data-id="${m.id}" data-team="${t}">${esc(teamName(t))} が勝利</button>`).join('')}</div>`;dialog.showModal()}
function reviseResultDialog(m){
  if(!ADMIN_MODE||!st.isAdmin||m.status!=='finished')throw new Error('確定済みの試合だけ訂正できます');
  const {dialog,body}=getDialogParts();
  body.innerHTML=`<h2 id="dialog-title">勝敗の訂正・試合の再開</h2><p class="sub">次の試合が始まっている場合はデータベースが訂正を拒否します。デス履歴は削除されません。</p><div class="form-group"><label class="field-label" for="revision-action">訂正方法</label><select class="field" id="revision-action"><option value="correct">勝者を訂正する</option><option value="reopen">結果確定を取り消して試合を再開</option></select></div><div class="form-group"><label class="field-label" for="revision-winner">正しい勝者（勝者訂正の場合）</label><select class="field" id="revision-winner">${[m.team_a_id,m.team_b_id].map(id=>`<option value="${id}" ${id!==m.winner_id?'selected':''}>${esc(teamName(id))}</option>`).join('')}</select></div><div class="form-group"><label class="field-label" for="revision-reason">訂正理由（3文字以上、履歴に保存）</label><textarea id="revision-reason" class="field" rows="3" maxlength="300" placeholder="例：試合結果の入力を間違えたため"></textarea></div>`;
  const handler=()=>{dialog.removeEventListener('close',handler);if(dialog.returnValue!=='confirm')return;
    const action=document.getElementById('revision-action')?.value;
    const winner=document.getElementById('revision-winner')?.value;
    const reason=document.getElementById('revision-reason')?.value.trim()||'';
    if(reason.length<3){notify('訂正理由は3文字以上で入力してください',true);return}
    confirmBox('最終確認',action==='correct'?`「${teamName(winner)}」に勝者を変更します。訂正記録が残ります。`:'結果確定を取り消し、同じストック履歴を保持したまま試合を再開します。',async()=>{
      await rpc('admin_revise_match_result',{p_match:m.id,p_action:action,p_winner:action==='correct'?winner:null,p_reason:reason});
      notify(action==='correct'?'勝利チームを訂正しました':'試合を再開しました');
      await loadEvent(st.eventId);
    });
  };dialog.addEventListener('close',handler);dialog.showModal();
}
function clearPending(){const count=pendingFor(st.matchId).length;confirmBox('未同期デスを破棄',`${count}件の未同期記録を削除します。未送信のデスは共有されなくなります。運営者に伝えてから行ってください。`,async()=>{st.pending=st.pending.filter(x=>x.uid!==st.user.id||x.matchId!==st.matchId);savePending();show()})}
async function copy(text){try{await navigator.clipboard.writeText(text);notify('IDをコピーしました')}catch{notify('コピーに失敗しました',true)}}
async function goHome(){unsubscribe();if(ADMIN_MODE){if(st.isAdmin)await loadAdminHome();else{st.view='admin-login';show()}}else await loadPlayerHome()}
document.addEventListener('click',async e=>{const b=e.target.closest('[data-action]');if(!b||b.disabled)return;const a=b.dataset.action;
  try{switch(a){
    case 'home':await run(goHome);break;
    case 'help':st.helpReturn=st.view==='help'?'home':st.view;st.view='help';show();break;
    case 'help-back':{const target=st.helpReturn||'home';st.view=target;if(target==='event'&&st.eventId)await run(()=>loadEvent(st.eventId));else show();break;}
    case 'quick':st.view='quick';show();break;
    case 'scroll-events':document.getElementById('events-section')?.scrollIntoView({behavior:'smooth'});break;
    case 'retry':st.bootError=null;await boot();break;
    case 'quick-death':{const w=st.weaponMap.get(st.quick.weapon);st.quick.deaths=Math.min(w.stock,st.quick.deaths+1);saveQuick();show();break}
    case 'quick-undo':st.quick.deaths=Math.max(0,st.quick.deaths-1);saveQuick();show();break;
    case 'quick-reset':st.quick.deaths=0;saveQuick();show();break;
    case 'open-claim':await run(()=>loadClaimRoster(b.dataset.id));break;
    case 'pick-color':st.claimColor=b.dataset.color;show();break;
    case 'claim-slot':await run(async()=>{const tid=await rpc('claim_named_slot',{p_slot:b.dataset.id,p_color:st.claimColor},st.playerClient);st.profile=check(await st.playerClient.from('profiles').select('id,nickname,color').eq('id',st.user.id).single());notify('参加登録が完了しました');await loadEvent(tid,true)});break;
    case 'open-event':await run(()=>loadEvent(b.dataset.id,true));break;
    case 'pick-match':st.matchId=b.dataset.id;st.testSlotId=null;if(!ADMIN_MODE)st.tab='match';else if(st.adminTab!=='test')st.adminTab='matches';await run(()=>loadEvent(st.eventId));break;
    case 'player-tab':st.tab=b.dataset.tab;show();break;
    case 'admin-tab':st.adminTab=b.dataset.tab;show();if(st.adminTab!=='roster')refreshSoon();break;
    case 'admin-test-select':if(!st.event?.tournament.is_test)throw new Error('テスト大会だけ操作できます');st.testSlotId=b.dataset.id;show();break;
    case 'admin-test-fill':await run(async()=>{if(!st.event?.tournament.is_test)throw new Error('テスト大会だけ操作できます');
      const n=await rpc('admin_test_fill_weapons',{p_match:st.matchId,p_weapon:'スプラシューター'});
      await loadEvent(st.eventId);notify(`${n}人にブキを一括設定しました`)});break;
    case 'admin-test-death':case 'admin-test-undo':await run(async()=>{
      if(!st.event?.tournament.is_test)throw new Error('テスト大会だけ操作できます');
      const slot=st.testSlotId||st.event.slots.find(s=>[currMatch()?.team_a_id,currMatch()?.team_b_id].includes(s.team_id))?.id;
      if(!slot)throw new Error('選手を選択してください');
      const saved=await rpc('admin_test_record_death',{p_match:st.matchId,p_slot:slot,p_event:uuid(),p_delta:a==='admin-test-death'?1:-1});
      await loadEvent(st.eventId);notify(`デス記録を更新しました（${saved}回）`);
    });break;
    case 'recent-weapon':await run(()=>setWeapon(b.dataset.weapon));break;
    case 'team-ready':await run(async()=>{const started=await rpc('team_set_ready',{p_match:b.dataset.match,p_ready:b.dataset.ready==='1'},st.playerClient);await loadEvent(st.eventId);notify(started?'両チーム準備OK！試合が開始されました':'チームの準備状態を更新しました')});break;
    case 'admin-test-ready':await run(async()=>{if(!st.event?.tournament.is_test)throw new Error('テスト大会だけ操作できます');const started=await rpc('admin_test_set_ready',{p_match:st.matchId,p_team:b.dataset.team,p_ready:b.dataset.ready==='1'});await loadEvent(st.eventId);notify(started?'両チームの準備完了で試合開始':'テストチームの準備状態を更新しました')});break;
    case 'death':await addDeath(1);break;
    case 'undo':await addDeath(-1);break;
    case 'wake':await toggleWake();break;
    case 'retry-sync':await drain();break;
    case 'clear-pending':clearPending();break;
    case 'change-color':st.claimColor=st.profile?.color||COLORS[0];st.view='color';show();break;
    case 'save-color':await run(async()=>{await saveColor();st.view='event';show()});break;
    case 'back-event':st.view='event';show();break;
    case 'admin-password':if(!ADMIN_MODE||!st.isAdmin)throw new Error('管理者ログインが必要です');st.view='admin-password';show();break;
    case 'admin-logout':await run(async()=>{check(await st.adminClient.auth.signOut());st.adminUser=null;st.isAdmin=false;st.view='admin-login';show()});break;
    case 'admin-open-event':{
      const summary=st.adminEvents.find(x=>x.id===b.dataset.id);
      if(summary?.organizer_id!==st.adminUser?.id){
        confirmBox('旧大会を引き継ぐ','旧主催者の大会をこの運営者アカウントに移管します。大会・選手・勝敗データは残ります。',async()=>{await rpc('admin_adopt_tournament',{p_tournament:b.dataset.id});await loadEvent(b.dataset.id,true);notify('旧大会を引き継ぎました')});
      }else await run(()=>loadEvent(b.dataset.id,true));
      break;
    }
    case 'admin-adopt':confirmBox('旧大会を移管','この大会の運営者を現在ログイン中の管理者に変更します。',async()=>{await rpc('admin_adopt_tournament',{p_tournament:st.eventId});await loadEvent(st.eventId);notify('移管しました')});break;
    case 'admin-toggle-open':confirmBox('参加受付の変更',st.event.tournament.is_open?'参加受付を停止します。既存の参加者の試合データは維持されます。':'全選手の名前が入力されている必要があります。受付を開始しますか？',async()=>{await rpc('admin_set_open',{p_tournament:st.eventId,p_open:!st.event.tournament.is_open});await loadEvent(st.eventId);notify('受付状態を変更しました')});break;
    case 'admin-generate':confirmBox('対戦表を生成','作成後は大会形式を変更できません。選手の割り当ては試合開始前なら修正可能です。',async()=>{const n=await rpc('admin_generate_schedule',{p_tournament:st.eventId});notify(`${n}試合の対戦表を作成しました`);if(st.adminTab!=='test')st.adminTab='matches';await loadEvent(st.eventId)});break;
    case 'admin-start-match':confirmBox('試合開始','使用ブキと初期ストックを保存して試合を開始します。未選択の選手は初デス前までブキを選べます。',async()=>{await rpc('admin_start_match',{p_match:b.dataset.id});await loadEvent(st.eventId);notify('試合を開始しました')});break;
    case 'admin-revise-result':{const m=st.event.matches.find(x=>x.id===b.dataset.id);if(m)reviseResultDialog(m);break}
    case 'admin-finish-match':{const m=st.event.matches.find(x=>x.id===b.dataset.id);if(m)chooseWinner(m);break}
    case 'admin-confirm-winner':{document.getElementById('confirm-dialog').close();const team=b.dataset.team,match=b.dataset.id;confirmBox('勝敗を確定',`${teamName(team)}の勝利として確定します。誤りがあれば運営者の訂正機能で修正できます。`,async()=>{await rpc('admin_finish_match',{p_match:match,p_winner:team});notify('勝敗を確定しました');st.matchId=null;await loadEvent(st.eventId)});break}
    case 'copy-id':await copy(b.dataset.id);break;
    case 'admin-move':{const from=b.dataset.id,to=document.getElementById('move-'+from)?.value;const s=st.event.slots.find(x=>x.id===from),dest=st.event.slots.find(x=>x.id===to);if(!dest)return;confirmBox('選手の割り当て修正',`${s.display_name} のアカウントを ${dest.display_name} に移動します。移動先が登録済みなら2人のアカウントを交換します。`,async()=>{await rpc('admin_move_player',{p_from:from,p_to:to});notify('割り当てを修正しました');await loadEvent(st.eventId)});break}
    case 'admin-release':{const s=st.event.slots.find(x=>x.id===b.dataset.id);confirmBox('登録を解除',`${s.display_name} の登録を解除します。同じ人は再度名前を選んで参加できます。`,async()=>{await rpc('admin_release_player',{p_slot:b.dataset.id});notify('登録を解除しました');await loadEvent(st.eventId)});break}
  }}catch(ex){console.error(ex);notify(ex.message||ex,true)}
});
document.addEventListener('input',e=>{
  const type=e.target.dataset.weaponFilter;
  if(!type)return;
  const target=document.getElementById(type==='quick'?'quick-weapon':type==='test'?'test-weapon':'match-weapon');
  if(!target)return;
  const before=target.value;
  const q=e.target.value.trim().toLocaleLowerCase('ja-JP');
  const options=st.weapons.filter(w=>w.name.toLocaleLowerCase('ja-JP').includes(q)||w.name===before);
  target.innerHTML=(type==='quick'?'':'<option value="">ブキを選択</option>')+options.map(w=>`<option value="${esc(w.name)}">${esc(w.name)} — ${w.stock}</option>`).join('');
  target.value=before;
});
document.addEventListener('change',async e=>{const x=e.target;
  if(x.dataset.change==='quick-weapon'){if(!st.weaponMap.has(x.value))return;st.quick.weapon=x.value;st.quick.deaths=0;rememberWeapon(x.value);saveQuick();show()}
  if(x.dataset.change==='match-weapon')await run(()=>setWeapon(x.value));
  if(x.dataset.change==='test-weapon')await run(async()=>{
    if(!st.event?.tournament.is_test)throw new Error('テスト大会だけ操作できます');
    const chosen=st.testSlotId||st.event.slots.find(s=>[currMatch()?.team_a_id,currMatch()?.team_b_id].includes(s.team_id))?.id;
    if(!chosen)throw new Error('選手を選択してください');
    if(!st.weaponMap.has(x.value))throw new Error('ブキマスターから選択してください');
    await rpc('admin_test_set_weapon',{p_match:st.matchId,p_slot:chosen,p_weapon:x.value});
    rememberWeapon(x.value);await loadEvent(st.eventId);notify('テストブキを保存しました');
  });
});
document.addEventListener('submit',async e=>{const f=e.target;if(!['admin-login-form','admin-password-form','admin-create-form','admin-rebind-form'].includes(f.id) && f.dataset.form!=='roster')return;e.preventDefault();
  if(f.id==='admin-login-form')await run(async()=>{
    const form=new FormData(f),email=String(form.get('email')||'').trim(),password=String(form.get('password')||'');
    if(!email||!password)throw new Error('メールアドレスとパスワードを入力してください');
    const result=check(await st.adminClient.auth.signInWithPassword({email,password}));
    if(!result?.user)throw new Error('ログイン情報を確認できませんでした');
    st.adminUser=result.user;
    try{st.isAdmin=Boolean(await rpc('is_app_admin',{},st.adminClient));}catch(err){st.isAdmin=false;await st.adminClient.auth.signOut();st.adminUser=null;throw err}
    if(!st.isAdmin){await st.adminClient.auth.signOut();st.adminUser=null;throw new Error('このアカウントには運営者権限がありません。Supabaseの管理者許可リストを確認してください。')}
    await loadAdminHome();notify('運営者としてログインしました');
  });
  if(f.id==='admin-password-form')await run(async()=>{
    if(!ADMIN_MODE||!st.isAdmin||!st.adminUser)throw new Error('管理者としてログインしてください');
    const form=new FormData(f),password=String(form.get('password')||''),confirmation=String(form.get('confirm')||'');
    if(password.length<12||password.length>128)throw new Error('パスワードは12～128文字で設定してください');
    if(password!==confirmation)throw new Error('確認用パスワードが一致しません');
    check(await st.adminClient.auth.updateUser({password}));
    // updateUser does not change the user's database ID or organizer_id.
    await loadAdminHome();notify('パスワードを設定しました。PCからもログインできます');
  });
  if(f.id==='admin-create-form')await run(async()=>{const p=new FormData(f),teams=String(p.get('teams')||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);if(teams.length<2||teams.length>16)throw new Error('チーム数は2～16です');if(new Set(teams.map(x=>x.toLowerCase())).size!==teams.length)throw new Error('同じチーム名があります');const isTest=p.get('test_mode')==='1';const id=await rpc(isTest?'admin_create_test_tournament':'admin_create_tournament',{p_name:String(p.get('name')||''),p_format:String(p.get('format')),p_team_names:teams});notify(isTest?'非公開のテスト大会を作成しました':'大会を作成しました');await loadEvent(id,true);if(isTest){st.adminTab='test';show()}});
  if(f.id==='admin-rebind-form'){
    const values=new FormData(f),slot=String(values.get('slot')||''),user=String(values.get('user')||'').trim();
    if(!/^[a-f0-9-]{36}$/i.test(user)){notify('個人IDの形式が正しくありません',true);return}
    const slotData=st.event.slots.find(x=>x.id===slot);
    confirmBox('端末IDを再接続',`${slotData?.display_name||'選手'} の操作権限を新しい個人IDへ変更します。元の端末に残る未同期デスがある場合、反映できなくなるので先に確認してください。`,async()=>{
      await rpc('admin_rebind_player',{p_slot:slot,p_new_user:user});notify('新しいIDへ再接続しました');await loadEvent(st.eventId)
    });
  }
  if(f.dataset.form==='roster')await run(async()=>{const p=new FormData(f),tid=f.dataset.team,names=[1,2,3,4].map(n=>String(p.get('player'+n)||'').trim());if(names.some(n=>!n||n.length>24))throw new Error('4名全員の名前を1～24文字で入力してください');const teamNameInput=String(p.get('teamName')||'').trim();await rpc('admin_save_team',{p_team:tid,p_name:teamNameInput,p_names:names});notify('このチームを保存しました');await loadEvent(st.eventId)});
});
window.addEventListener('online',()=>{statusHeader();drain();refreshSoon()});
window.addEventListener('offline',()=>{statusHeader();if(st.view==='event')show()});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){ensureWake();drain();refreshSoon()}});
// player_slots is removed from the Realtime publication for secrecy.
// Refresh the ready lobby every 6 seconds; use a slower safety poll after match start.
let lastSafetyPoll=0;
setInterval(()=>{if(!navigator.onLine||st.loading)return;
  const isPlayer=st.view==='event',isAdminEvent=st.view==='admin-event'&&st.adminTab!=='roster';
  if(!isPlayer&&!isAdminEvent)return;
  const interval=currMatch()?.status==='pending'?6000:15000;
  if(Date.now()-lastSafetyPoll<interval)return;
  lastSafetyPoll=Date.now();refreshSoon();
},3000);
boot();
