/*
 * SPLASTOCK — static GitHub Pages client.
 * weapons.json is the immutable source of the original 65 weapons and stock counts.
 * Sync requires config.js + schema.sql on Supabase. Only PUBLIC publishable keys here.
 */
const app = document.getElementById('app');
const header = document.getElementById('header-right');
const safeStorage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key,value) { try { localStorage.setItem(key,value); return true; } catch { return false; } },
};
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const AVR = ['🦑','🐙','🐟','⚡','🌊','🌀','🎯','🐡','🦈','✨'];
const COLORS = ['#c5ff65','#bba4fa','#73dce8','#ff99b9','#ffcd7a'];
const cfg = window.SPLASTOCK_CONFIG || {};
const configured = /^https:\/\/[a-z0-9.-]+\.supabase\.co\/?$/i.test((cfg.supabaseUrl || '').replace(/\/$/,'')) &&
  typeof cfg.supabasePublishableKey === 'string' && cfg.supabasePublishableKey.trim().length > 12;
const state = {
  weapons: [], weaponMap: new Map(), client: null, user: null, profile: null,
  view: 'home', tab: 'match', tournaments: [], tournamentId: null,
  detail: null, matchId: null, matchPlayers: [], invites: null,
  avatar: '🦑', color: COLORS[0], nameDraft: '',
  solo: readJSON('splastock_solo_v1',{weapon:'スプラシューター',deaths:0}),
  recentWeapons: readJSON('splastock_recent_weapons_v1',['スプラシューター','シャープマーカー','リッター4K']),
  pending: readJSON('splastock_pending_v1',[]),
  busy: false, refreshing: false, draining: false, realtimeStatus:'disconnected',
  channel: null, refreshTimer: null, wakeLock: null, wakeEnabled:false, error:null,
};
function readJSON(key,fallback){ try { const x=JSON.parse(safeStorage.get(key)); return x ?? fallback; }catch{return fallback;} }
function savePending(){ safeStorage.set('splastock_pending_v1',JSON.stringify(state.pending)); }
function saveSolo(){ safeStorage.set('splastock_solo_v1',JSON.stringify(state.solo)); }
function rememberWeapon(name){if(!state.weaponMap.has(name))return;state.recentWeapons=[name,...state.recentWeapons.filter(w=>w!==name)].slice(0,5);safeStorage.set('splastock_recent_weapons_v1',JSON.stringify(state.recentWeapons));}
function UUID(){return (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return (c==='x'?r:((r&3)|8)).toString(16);}));}
function toast(message,isError=false){ const node=document.getElementById('toast'); node.textContent=message; node.className='toast active'+(isError?' error':''); clearTimeout(toast.timer); toast.timer=setTimeout(()=>node.className='toast',3700); }
function formatName(code){return ({elimination:'トーナメント',round_robin:'総当たり'})[code]||code;}
function fmtStatus(status){return ({draft:'準備中',active:'開催中',completed:'終了',pending:'開始前',live:'試合中',finished:'確定'})[status]||status;}
function badge(status){return `<span class="pill ${status==='live'||status==='active'?'pill-lime':status==='finished'||status==='completed'?'pill-purple':''}">${esc(fmtStatus(status))}</span>`;}
function playerSlotFor(tournamentId){return (state.detail?.slots || []).find(s=>s.tournament_id===tournamentId && s.profile_id===state.user?.id);}
function nameOfTeam(id){return state.detail?.teams.find(t=>t.id===id)?.name || (id?'チーム不明':'未確定');}
function chosenMatch(){return state.detail?.matches.find(m=>m.id===state.matchId) || null;}
function scoreOf(mp,slot){const weapon=mp?.weapon_name || slot?.preferred_weapon;const max=mp?.base_stock ?? state.weaponMap.get(weapon)?.stock ?? null;const deaths=mp?.deaths ?? 0;return {weapon,max,deaths,remain:max===null?null:Math.max(0,max-deaths)};}
function pendingFor(matchId){return state.pending.filter(e=>e.matchId===matchId&&e.uid===state.user?.id);}
function currentDeaths(mp,slot,match){const base=scoreOf(mp,slot);const extra=pendingFor(match.id).reduce((n,e)=>n+e.delta,0);return {...base,deaths:base.deaths+extra,remain:base.max===null?null:Math.max(0,base.max-base.deaths-extra),queued:pendingFor(match.id).length};}
function isOrganizer(){return state.detail?.tournament.organizer_id===state.user?.id;}
function getInviteFromUrl(){let q=new URLSearchParams(location.search).get('invite'); return /^[a-f0-9-]{36}$/i.test(q||'')?q:null;}
function removeInviteFromUrl(){const u=new URL(location.href);u.searchParams.delete('invite');history.replaceState(null,'',u.pathname+u.search+u.hash);}
function homeButton(text='← ホーム'){return `<button class="btn btn-ghost btn-small" data-action="home">${esc(text)}</button>`;}
function renderHeader(){
  const connected=configured && state.user && navigator.onLine;
  header.innerHTML=`<span class="status-chip"><span class="pulse ${navigator.onLine?'':'off'}"></span>${configured?(connected?(state.realtimeStatus==='SUBSCRIBED'?'同期接続':'オンライン'):'オフライン'):'簡易モード'}</span>${state.profile?`<button data-action="edit-profile" class="profile-chip"><span class="profile-avatar" style="background:${esc(state.profile.color)}">${esc(state.profile.avatar)}</span>${esc(state.profile.nickname)}</button>`:''}`;
}
function render(){renderHeader();
  if(state.view==='profile')return renderProfile();
  if(state.view==='solo')return renderSolo();
  if(!configured)return renderDisconnected();
  if(state.error)return renderError();
  if(state.view==='tournament')return renderTournament();
  renderHome();
}
function renderError(){app.innerHTML=`<div class="main"><div class="panel panel-pad"><h2>接続に問題が発生しました</h2><p class="muted">${esc(state.error)}</p><div class="actions"><button class="btn btn-accent" data-action="retry">再接続する</button><button class="btn btn-outline" data-action="solo">簡易モード</button></div></div></div>`;}
function renderDisconnected(){
 app.innerHTML=`<div class="main standalone"><div class="eyebrow">LOCAL TOOL AVAILABLE</div><h1>ストック管理は、<br><span class="accent">このまま使えます。</span></h1><p class="subline">現在はSupabase未設定のため、大会のオンライン共有だけが無効です。65種類のブキ・デス記録を使える簡易モードは動きます。</p><div class="banner warn">同期・アバター・大会管理を有効にするには <code>schema.sql</code> をSupabaseで実行し、<code>config.js</code> にProject URLと公開可能キーを設定してください。詳しくは README.md。</div>${soloUI()}<div class="panel panel-pad mt-4"><h3>クラウド版で使える機能</h3><div class="pills"><span class="pill">🦑 アバター</span><span class="pill">🏆 トーナメント</span><span class="pill">🔄 総当たり</span><span class="pill">⚡ 8人同期</span><span class="pill">📱 オフライン記録</span></div></div></div>`;
}
function renderProfile(){
 const editing=Boolean(state.profile),name=state.nameDraft||state.profile?.nickname||'';
 app.innerHTML=`<div class="main"><div class="profile-wrap"><div class="eyebrow">PLAYER IDENTITY</div><h1>${editing?'アバター編集':'プレイヤーを作ろう。'}</h1><p class="subline">メールアドレスもパスワードも不要。サイト内だけで使うあなただけのアバターです。${editing?'':'同じブラウザでは次回から引き継がれます。'}</p><section class="panel panel-pad mt-4"><div class="avatar-preview"><div class="avatar-large" style="background:${esc(state.color)}">${esc(state.avatar)}</div><div><div class="muted small">YOUR PLAYER</div><h2 style="margin:4px 0 0">${esc(name||'名前を入力')}</h2></div></div><form id="profile-form"><div class="form-group"><label class="form-label" for="nickname">プレイヤー名（最大24文字）</label><input id="nickname" name="nickname" class="field" maxlength="24" required autocomplete="off" placeholder="プレイヤー名" value="${esc(name)}"></div><div class="form-group"><div class="form-label">アバターを選択</div><div class="avatar-picker">${AVR.map(a=>`<button type="button" data-action="avatar" data-value="${esc(a)}" class="avatar-option ${a===state.avatar?'active':''}" aria-label="${esc(a)}を選ぶ">${esc(a)}</button>`).join('')}</div></div><div class="form-group"><div class="form-label">アバターカラー</div><div class="colors">${COLORS.map(c=>`<button type="button" data-action="color" data-value="${c}" class="color-option ${c===state.color?'active':''}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div></div><button class="btn btn-accent btn-block btn-lg" type="submit">${editing?'変更を保存':'このアバターで始める →'}</button>${editing?'<button type="button" class="btn btn-ghost btn-block mt-2" data-action="home">戻る</button>':''}</form></section><p class="small muted mt-3">匿名アカウントはブラウザデータを削除すると失われます。端末変更・引き継ぎは本バージョンでは未対応です。</p></div></div>`;
}
function renderHome(){
 const items=state.tournaments.map(t=>`<button class="event-card" data-action="open-event" data-id="${t.id}" style="text-align:left;color:inherit"><span class="section-label">${t.organizer_id===state.user?.id?'ORGANIZER':'PLAYER'}</span><h3>${esc(t.name)}</h3><div class="pills">${badge(t.status)}<span class="pill">${esc(formatName(t.format))}</span></div><div class="row-between mt-3"><span class="small muted">${new Date(t.created_at).toLocaleDateString('ja-JP')}</span><strong class="accent">開く →</strong></div></button>`).join('');
 app.innerHTML=`<div class="main"><section class="hero"><div class="hero-content"><div class="eyebrow">COMMUNITY TOURNAMENT SYSTEM</div><h1>ストックを共有して、<br><span class="accent">勝負をもっと面白く。</span></h1><p class="subline">ブキを選んで、デスを記録するだけ。チーム全員と対戦相手の残りストックがリアルタイムでわかる。</p><div class="hero-actions"><button class="btn btn-accent btn-lg" data-action="solo">⚡ 簡易ストック管理</button><button class="btn btn-outline btn-lg" data-action="scroll-create">＋ 大会を作成</button></div></div></section><div class="section-head"><div><span class="section-label">YOUR EVENTS</span><h2>参加中の大会</h2></div><span class="pill">${state.tournaments.length} 件</span></div>${items?`<div class="grid-3">${items}</div>`:`<div class="empty"><span class="big-emoji">🏆</span>まだ大会がありません。<br>主催者から招待リンクをもらうか、自分で大会を作成してください。</div>`}<div class="grid-2 mt-4"><section class="panel panel-pad" id="create-section"><div class="eyebrow">FOR ORGANIZERS</div><h2>大会を作成</h2><p class="tagline">チーム名は改行で区切って入力。上から順番にシード番号が付きます。</p><form id="create-form"><div class="form-group"><label class="form-label" for="eventname">大会名</label><input class="field" id="eventname" name="eventname" required maxlength="60" placeholder="例：ストック杯 vol.1"></div><div class="form-group"><label class="form-label" for="format">大会形式</label><select class="field" id="format" name="format"><option value="elimination">トーナメント（BYE対応）</option><option value="round_robin">総当たり（1回戦総当たり）</option></select></div><div class="form-group"><label class="form-label" for="teams">参加チーム（2～16チーム / 各4人）</label><textarea class="field" id="teams" name="teams" required placeholder="チーム A&#10;チーム B&#10;チーム C&#10;チーム D">チーム A\nチーム B\nチーム C\nチーム D</textarea><p class="form-hint">生成後はチーム数と形式を変更できません。確定前に確認してください。</p></div><button class="btn btn-accent btn-block" type="submit">大会・チーム枠を作成 →</button></form></section><section class="panel panel-pad"><div class="eyebrow">JOIN A TEAM</div><h2>招待リンクで参加</h2><p class="subline small">主催者が発行した選手枠専用のURLを開くと、現在のアバターがその枠に登録されます。</p><form id="claim-form"><div class="form-group"><label class="form-label" for="inviteCode">招待コード（URL末尾のUUID）</label><input id="inviteCode" name="inviteCode" class="field" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" pattern="[0-9a-fA-F-]{36}"></div><button class="btn btn-outline btn-block" type="submit">招待コードで参加 →</button></form><div class="separator"></div><div class="pills"><span class="pill">登録作業は初回だけ</span><span class="pill">ブキは次回へ引き継ぎ</span><span class="pill">同じブラウザで継続利用</span></div><p class="small muted mt-4">※ 1人が同じ大会で複数の選手枠を取得することはできません。</p></section></div></div>`;
}
function renderSolo(){app.innerHTML=`<div class="main standalone"><div class="back-row">${configured?homeButton():''}<span class="pill pill-cyan">外部連携なし</span></div><div class="eyebrow">QUICK STOCK COUNTER</div><h1>簡易ストック管理</h1><p class="subline">大会アカウントや通信がなくても使用可能。デス数とブキはこの端末に保存されます。</p>${soloUI()}</div>`;}
function soloUI(){const s=state.solo;const w=state.weaponMap.get(s.weapon)||state.weapons[0];if(!w)return'';const max=w.stock;const deaths=Math.max(0,Math.min(max,Number(s.deaths)||0));const remain=max-deaths;
return `<section class="panel panel-pad mt-4"><div class="form-group"><label class="form-label" for="soloWeapon">使用ブキ</label><select class="field" id="soloWeapon" data-change="solo-weapon">${state.weapons.map(x=>`<option value="${esc(x.name)}" ${x.name===w.name?'selected':''}>${esc(x.name)} （${x.stock}ストック）</option>`).join('')}</select></div><div class="panel-soft" style="padding:23px"><div class="solo-desc">残りストック / 初期 ${max}</div><div class="solo-count ${remain===0?'danger':''}">${remain}</div><div class="dots">${Array.from({length:max},(_,i)=>`<span class="stock-dot ${i<remain?'on':''}"></span>`).join('')}</div><div class="solo-desc">デス数：${deaths}</div>${remain===0?'<p class="danger bold" style="text-align:center;margin:13px 0 0">ストック切れ：リスポーンから出ない</p>':''}</div><div class="solo-actions mt-3"><button class="btn btn-death" data-action="solo-death" ${remain===0?'disabled':''}>☠ 1デス記録</button><button class="btn btn-outline" data-action="solo-undo" ${deaths===0?'disabled':''}>↶ 戻す</button></div><button class="btn btn-ghost btn-block mt-2" data-action="solo-reset">デス数をリセット</button><details class="details"><summary>ブキのストック別ティア表を見る（画像は別途配置）</summary><img src="./tierlist%20(4).png" loading="lazy" alt="元のティア表" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><p hidden>画像 <code>tierlist (4).png</code> を同じ階層に配置すると表示されます。</p></details></section>`;}
function renderTournament(){
 if(!state.detail){app.innerHTML=`<div class="main"><section class="center-loading"><div class="spinner"></div><p>大会データ読み込み中</p></section></div>`;return;}
 const d=state.detail,t=d.tournament,admin=isOrganizer(),mySlot=playerSlotFor(t.id), claimed=d.slots.filter(s=>s.profile_id).length,total=d.slots.length, live=d.matches.filter(m=>m.status==='live').length;
 const nav=`<div class="nav-tabs"><button class="tab ${state.tab==='match'?'active':''}" data-action="tab" data-value="match">⚡ 対戦・ストック</button><button class="tab ${state.tab==='schedule'?'active':''}" data-action="tab" data-value="schedule">🏆 対戦表</button><button class="tab ${state.tab==='teams'?'active':''}" data-action="tab" data-value="teams">👥 チーム・選手</button>${admin?`<button class="tab ${state.tab==='admin'?'active':''}" data-action="tab" data-value="admin">⚙ 主催者管理</button>`:''}</div>`;
 app.innerHTML=`<div class="main"><div class="back-row">${homeButton()}<div class="pills">${badge(t.status)}<span class="pill">${esc(formatName(t.format))}</span>${admin?'<span class="pill pill-cyan">主催者</span>':''}</div></div><div class="eyebrow">TOURNAMENT / ${esc(t.id.slice(0,8).toUpperCase())}</div><h1>${esc(t.name)}</h1><div class="tourn-overview"><div class="metric"><small>チーム数</small><strong>${d.teams.length}</strong></div><div class="metric"><small>登録人数</small><strong>${claimed}<span class="tiny muted"> / ${total}</span></strong></div><div class="metric"><small>進行中</small><strong>${live}</strong></div></div>${mySlot?`<div class="banner">あなたは <strong>${esc(nameOfTeam(mySlot.team_id))}</strong> の ${mySlot.position}番目の選手です。ブキを変更しなければ前回の選択を引き継ぎます。</div>`:''}${nav}${state.tab==='match'?renderMatchTab(admin,mySlot):state.tab==='schedule'?renderSchedule():state.tab==='teams'?renderTeams():renderAdmin()}</div>`;
}
function renderMatchTab(admin,mySlot){const d=state.detail,match=chosenMatch();
 if(!d.matches.length)return `<div class="panel panel-pad"><h2>まだ対戦表がありません</h2><p class="muted">主催者がチームと参加枠を確認し、「対戦表を作成」を押すと試合を表示します。</p>${admin?'<button data-action="tab" data-value="admin" class="btn btn-accent">主催者管理へ →</button>':''}</div>`;
 const matchItems=d.matches.map(m=>`<button class="match-entry ${m.id===state.matchId?'active':''}" data-action="select-match" data-id="${m.id}"><span><span class="meta">R${m.round_index} • MATCH ${m.match_index}</span><span class="names">${esc(nameOfTeam(m.team_a_id))} <span class="muted">vs</span> ${esc(nameOfTeam(m.team_b_id))}</span></span>${badge(m.status)}</button>`).join('');
 return `<div class="grid-2"><div><div class="section-head"><div><span class="section-label">MATCH LIST</span><h2>試合を選択</h2></div></div><div class="match-list">${matchItems}</div></div><div><div class="section-head"><div><span class="section-label">CURRENT GAME</span><h2>${match?`${esc(nameOfTeam(match.team_a_id))} vs ${esc(nameOfTeam(match.team_b_id))}`:'試合を選択してください'}</h2></div></div>${match?`<div class="panel panel-pad"><div class="row-between">${badge(match.status)}<span class="small muted">第${match.round_index}ラウンド / 第${match.match_index}試合</span></div>${match.status==='pending'?'<p class="small muted mt-3">ブキは準備中に選択できます。主催者が開始するとストック記録が有効になります。</p>':match.status==='finished'?`<p class="accent bold mt-3">勝者：${esc(nameOfTeam(match.winner_id))}</p>`:'<p class="small muted mt-3">試合進行中。自分のデスだけ記録できます。</p>'}${admin?renderMatchAdmin(match):''}</div>`:''}</div></div>${match?renderLiveArea(match,mySlot):''}`;
}
function renderMatchAdmin(match){if(match.status==='finished')return'';if(!match.team_a_id||!match.team_b_id)return'<p class="small muted mt-3">前のラウンドの結果待ちです。</p>';
 return `<div class="match-action-card"><div class="row">${match.status==='pending'?`<button class="btn btn-accent" data-action="start-match" data-id="${match.id}">▶ 試合開始</button>`:`<button class="btn btn-outline" data-action="finish-dialog" data-id="${match.id}">🏆 勝敗を確定</button>`}</div></div>`;
}
function teamTotals(teamId,match){
 const slots=state.detail.slots.filter(s=>s.team_id===teamId);
 let total=0,max=0,count=0;
 for(const slot of slots){
   const mp=state.matchPlayers.find(x=>x.slot_id===slot.id);
   const v=scoreOf(match.status==='pending'?null:mp,slot);
   const isMe=slot.profile_id===state.user?.id&&match.status==='live';
   const score=isMe&&mp?currentDeaths(mp,slot,match):v;
   if(score.max!==null){count++;total+=score.remain;max+=score.max;}
 }
 return {total,max,complete:count===4};
}
function compactDuel(match){
 const a=teamTotals(match.team_a_id,match),b=teamTotals(match.team_b_id,match);
 const label=(tot,side)=>`<div class="duel-side ${side==='b'?'rival':''}"><strong>${esc(nameOfTeam(side==='a'?match.team_a_id:match.team_b_id))}</strong><span class="duel-num">${tot.complete?tot.total:'—'}<small> / ${tot.complete?tot.max:'未確定'}</small></span></div>`;
 return `<div class="duel-strip">${label(a,'a')}<div class="duel-vs">VS</div>${label(b,'b')}</div>`;
}
function renderLiveArea(match,mySlot){
 const d=state.detail, containsMySlot=Boolean(mySlot && [match.team_a_id,match.team_b_id].includes(mySlot.team_id));const mine=d.slots.find(s=>s.id===mySlot?.id);
 const mp=state.matchPlayers.find(x=>x.slot_id===mine?.id), scoring=containsMySlot&&match.status==='live';
 const label=match.status==='live'?'LIVE STOCK BOARD':match.status==='pending'?'PREVIEW / WEAPON PICK':'FINAL SCORE';
 return `<div class="section-head"><div><span class="section-label">${label}</span><h2>チームストック</h2></div>${match.status==='live'?'<span class="pill pill-lime">● REALTIME</span>':''}</div>${compactDuel(match)}<div class="controls-grid">${containsMySlot&&match.status!=='finished'?renderPersonalControl(match,mine,mp,scoring):`<section class="my-control"><div class="own-label">${isOrganizer()?'🏆 主催者ビュー':'👀 観戦モード'}</div><h2 style="margin:15px 0 5px">${isOrganizer()?'全員の残りストックを確認':'自分の対戦ではありません'}</h2><p class="small muted">試合の状況を表示しています。各選手のデス記録は、本人のみ変更できます。</p></section>`}<div class="scoreboard-wrap"><div class="scoreboard">${teamScoreboard(match.team_a_id,match,false)}${teamScoreboard(match.team_b_id,match,true)}</div><p class="small muted mt-2">未登録のブキは「—」と表示し、チーム合計には含めません。全員のブキが登録されるまで正確なチーム合計は出しません。</p></div></div>`;
}
function renderPersonalControl(match,slot,mp,scoring){const base=scoring?currentDeaths(mp,slot,match):scoreOf(null,slot),pending=pendingFor(match.id);const remain=base.remain,max=base.max;const missing=max===null;const currentWeapon=scoring?(mp?.weapon_name||slot.preferred_weapon):slot.preferred_weapon;
 const allowSelect=match.status==='pending'||(scoring&&(mp?.deaths||0)===0 && pending.length===0);
 return `<section class="my-control"><div class="own-label">◉ MY STOCK / 自分のストック</div><div class="select-weapon"><label class="form-label" for="weapon-choice">使用ブキ ${!allowSelect?'🔒':''}</label><select class="field" id="weapon-choice" data-change="set-weapon" ${!allowSelect?'disabled':''}><option value="">ブキを選択してください</option>${state.weapons.map(w=>`<option value="${esc(w.name)}" ${currentWeapon===w.name?'selected':''}>${esc(w.name)}（${w.stock}）</option>`).join('')}</select>${allowSelect?`<div class="row mt-2">${state.recentWeapons.filter(n=>state.weaponMap.has(n)).slice(0,3).map(n=>`<button class="btn btn-outline btn-small" data-action="quick-weapon" data-value="${esc(n)}">${esc(n)}</button>`).join('')}</div><p class="tiny muted mt-2">最近使ったブキはワンタップで選択</p>`:''}</div><div class="my-stocks"><div class="small muted">残りストック</div><span class="count ${remain===0?'dead':''}">${remain??'—'}</span><span class="outof"> / ${max??'—'}</span><div class="dots">${Array.from({length:max||0},(_,i)=>`<i class="stock-dot ${i<remain?'on':''}"></i>`).join('')}</div><div class="small muted">デス記録 ${base.deaths??0} 回</div>${remain===0?'<div class="pill pill-red mt-2">ストック切れ • リスポーンから出ない</div>':''}</div><button class="btn btn-death btn-block" data-action="death" ${!scoring||missing||remain<=0?'disabled':''}>☠ 1デス記録</button><button class="btn btn-outline btn-block mt-2" data-action="undo" ${!scoring||base.deaths<=0?'disabled':''}>↶ 1デス取り消し</button><div class="row-between mt-3"><span class="small muted">操作は自動保存</span><button class="btn btn-ghost btn-small" data-action="wake">${state.wakeEnabled?'☀ 画面消灯防止 ON':'☀ 画面消灯防止 OFF'}</button></div>${pending.length?`<div class="network-alert"><strong>未同期 ${pending.length}件</strong>（この端末に保存）<br>再接続時に自動送信します。<button class="btn btn-ghost btn-small" data-action="retry-sync">再送</button><button class="btn btn-ghost btn-small danger" data-action="clear-pending">未同期を破棄</button></div>`:scoring?'<div class="network-ok">✓ サーバー保存後に全員の画面へ反映されます</div>':''}</section>`;
}
function teamScoreboard(teamId,match,enemy){const d=state.detail,slots=d.slots.filter(s=>s.team_id===teamId).sort((a,b)=>a.position-b.position),me=state.user?.id;
 let known=0,total=0,possible=0;const rows=slots.map(s=>{const mp=state.matchPlayers.find(x=>x.slot_id===s.id);const p=d.profiles.find(x=>x.id===s.profile_id);const v=scoreOf(match.status==='live'||match.status==='finished'?mp:null,s);if(v.max!==null){known++;total+=v.remain;possible+=v.max;}
 const isMe=me&&s.profile_id===me,up=match.status==='live'&&isMe?currentDeaths(mp,s,match):null;const remain=up?up.remain:v.remain;const nm=p?.nickname||`選手枠 ${s.position}`;return `<div class="roster-row"><div class="roster-avatar" style="background:${esc(p?.color||'#516078')}">${esc(p?.avatar||'•')}</div><div class="roster-info"><strong>${esc(nm)}${isMe?' <span class="cyan tiny">(あなた)</span>':''}</strong><small>${esc(v.weapon||'ブキ未選択')}</small></div><div class="roster-stock ${remain===0?'danger':''}">${remain===null?'—':remain}<small>${v.max===null?'':' / '+v.max}</small></div></div>`;}).join('');
 const all=known===4;return `<div class="team-block ${enemy?'enemy':''}"><div class="team-header"><div class="row-between"><h3>${esc(nameOfTeam(teamId))}</h3><span class="pill">${known}/4 登録</span></div><div class="row-between mt-2"><div><span class="team-total">${all?total:'—'}</span><span class="small muted"> / ${all?possible:'合計未確定'}</span></div><span class="small muted">合計ストック</span></div><div class="team-bar"><span style="width:${all&&possible?100*total/possible:0}%"></span></div></div>${rows}</div>`;
}
function renderSchedule(){const d=state.detail;
 if(!d.matches.length)return `<div class="panel panel-pad"><h2>対戦表は未生成です</h2><p class="muted">チーム設定ができたら、主催者画面で対戦表を生成してください。</p></div>`;
 if(d.tournament.format==='round_robin'){
 const rounds=[...new Set(d.matches.map(m=>m.round_index))];
 const standings=d.teams.map(team=>{const played=d.matches.filter(m=>m.status==='finished'&&(m.team_a_id===team.id||m.team_b_id===team.id));return {team,wins:played.filter(m=>m.winner_id===team.id).length,losses:played.filter(m=>m.winner_id!==team.id).length,played:played.length};}).sort((a,b)=>b.wins-a.wins||a.losses-b.losses);
 const table=`<section class="panel panel-pad mb-2"><h3>暫定成績（勝利数順）</h3><div style="overflow-x:auto"><table class="roundtable"><thead><tr><th>チーム</th><th>試合</th><th>勝利</th><th>敗北</th></tr></thead><tbody>${standings.map(s=>`<tr><td>${esc(s.team.name)}</td><td>${s.played}</td><td class="accent bold">${s.wins}</td><td>${s.losses}</td></tr>`).join('')}</tbody></table></div><p class="small muted mt-2">同率時の順位決定ルールは含みません。必要なら主催者が別途決定してください。</p></section>`;
 return `<div class="section-head"><h2>総当たり対戦表</h2><span class="pill">全${d.matches.length}試合</span></div>${table}${rounds.map(r=>`<section class="panel panel-pad mb-2"><h3>ROUND ${r}</h3><div class="match-list">${d.matches.filter(m=>m.round_index===r).map(m=>`<button class="match-entry" data-action="select-match" data-id="${m.id}"><span class="names">${esc(nameOfTeam(m.team_a_id))} vs ${esc(nameOfTeam(m.team_b_id))}${m.winner_id?` <span class="winner">優勝:${esc(nameOfTeam(m.winner_id))}</span>`:''}</span>${badge(m.status)}</button>`).join('')}</div></section>`).join('')}`;
 }
 const rounds=[...new Set(d.matches.map(m=>m.round_index))];return `<div class="section-head"><h2>トーナメント表</h2><span class="pill">全${d.matches.length}枠（不戦勝含む）</span></div><div class="bracket">${rounds.map(r=>`<div class="bracket-column"><div class="bracket-title">ROUND ${r}</div>${d.matches.filter(m=>m.round_index===r).map(m=>`<button class="bracket-match ${state.matchId===m.id?'active':''}" data-action="select-match" data-id="${m.id}" style="display:block;width:100%;text-align:left;color:inherit"><div class="line ${m.winner_id===m.team_a_id?'won':''}">${esc(nameOfTeam(m.team_a_id))}${m.winner_id===m.team_a_id?' ✓':''}</div><div class="line ${m.winner_id===m.team_b_id?'won':''}">${esc(nameOfTeam(m.team_b_id))}${m.winner_id===m.team_b_id?' ✓':''}</div>${badge(m.status)}</button>`).join('')}</div>`).join('')}</div>`;
}
function renderTeams(){const d=state.detail;return `<div class="section-head"><h2>チームと選手</h2><span class="pill">登録 ${d.slots.filter(s=>s.profile_id).length}/${d.slots.length}</span></div><div class="grid-2">${d.teams.map(t=>`<section class="panel panel-pad"><div class="row-between"><div><div class="section-label">SEED ${t.seed}</div><h3>${esc(t.name)}</h3></div><span class="pill">4名</span></div><div class="mini-roster">${d.slots.filter(s=>s.team_id===t.id).sort((a,b)=>a.position-b.position).map(s=>{const p=d.profiles.find(x=>x.id===s.profile_id);return `<div class="mini-slot"><span>${esc(p?.avatar||'○')}</span><b>${esc(p?.nickname||'未登録')}</b><span class="muted">${esc(s.preferred_weapon||'ブキ未登録')}</span></div>`;}).join('')}</div></section>`).join('')}</div>`;}
function renderAdmin(){if(!isOrganizer())return'';const d=state.detail,t=d.tournament,free=d.slots.filter(s=>!s.profile_id).length;
 const invitePanel=state.invites?`<div class="highlight-box"><strong>招待リンクを発行しました（未登録 ${state.invites.length}枠）</strong><p class="small muted">この一覧は画面を離れると消えます。再発行すると前の未使用リンクは使えなくなります。各リンクは1人1回の利用です。</p>${state.invites.map((i,n)=>`<div class="invite-row"><div><strong>${esc(i.team_name)} / ${i.slot_position}番</strong><div class="code">${esc(inviteLink(i.invite_token))}</div></div><button class="btn btn-outline btn-small" data-action="copy-invite" data-index="${n}">コピー</button></div>`).join('')}<button class="btn btn-outline btn-small mt-3" data-action="copy-all-invites">全リンクをコピー</button></div>`:'';
 return `<div class="section-head"><h2>主催者コントロール</h2><span class="pill pill-cyan">主催者のみ編集可能</span></div><div class="grid-2"><section class="panel panel-pad"><div class="eyebrow">INVITATION</div><h3>選手の招待・登録</h3><p class="small muted">チームと4人分の選手枠は作成済み。招待URLは各枠に固有です。</p><p class="muted">未登録 ${free} / ${d.slots.length} 枠</p><button class="btn btn-accent btn-block" data-action="issue-invites" ${free?'':'disabled'}>🔗 未登録枠の招待リンクを発行</button><p class="small muted mt-2">※ このボタンを再度押すと未使用リンクがすべて更新されます。</p></section><section class="panel panel-pad"><div class="eyebrow">MATCH SCHEDULE</div><h3>対戦表の作成</h3><p class="small muted">${formatName(t.format)} / ${d.teams.length}チーム。${d.matches.length?'対戦表はすでに生成されています。':'試合と組み合わせをまとめて生成します。'}</p><button class="btn btn-accent btn-block" data-action="generate" ${d.matches.length?'disabled':''}>🏆 対戦表を自動生成</button><p class="small muted mt-2">トーナメントはシード順とBYEに対応。総当たりはラウンドごとの組合せを生成します。</p></section></div>${invitePanel}<section class="panel panel-pad mt-4"><h3>運用上の注意</h3><p class="small muted">試合開始ボタンでブキと初期ストックを確定します。ただし未選択の選手は初デス前までブキを選択できます。勝敗はサイトが自動判定せず、主催者が実際の試合結果を確認して確定してください。</p><p class="small muted">デス数は本人だけが変更できます。主催者によるデス数直接修正・敗者復活・途中でのチーム再編成は本MVPには含みません。</p></section>`;
}
function inviteLink(token){return `${location.origin}${location.pathname}?invite=${encodeURIComponent(token)}`;}
async function runBusy(fn){if(state.busy)return;state.busy=true;try{await fn();}catch(err){console.error(err);toast(err?.message||String(err),true);}finally{state.busy=false;}}
function check(data,error){if(error)throw new Error(error.message||'通信に失敗しました');return data;}
async function callRpc(name,params={}){const {data,error}=await state.client.rpc(name,params);return check(data,error);}
async function boot(){
 try{
  const response=await fetch('./weapons.json',{cache:'no-cache'});
  if(!response.ok)throw new Error('weapons.jsonが見つかりません');
  const catalog=await response.json();
  if(!Array.isArray(catalog)||catalog.length!==65||new Set(catalog.map(x=>x.name)).size!==65||catalog.some(x=>!Number.isInteger(x.stock)))throw new Error('ブキデータが変更・欠損しています（65件が必要）');
  state.weapons=catalog;state.weaponMap=new Map(catalog.map(x=>[x.name,x]));
  if(!state.weaponMap.has(state.solo.weapon))state.solo.weapon=catalog[0].name;
  if(!configured){render();return;}
  const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  state.client=createClient(cfg.supabaseUrl.replace(/\/$/,''),cfg.supabasePublishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  await initializeSession();
 }catch(e){console.error(e);state.error=e.message||'起動に失敗しました';renderError();}
}
async function initializeSession(){
 state.error=null;
 const {data,error}=await state.client.auth.getSession();check(data,error);
 let session=data.session;
 if(!session){const res=await state.client.auth.signInAnonymously();check(res.data,res.error);session=res.data.session;}
 if(!session?.user)throw new Error('匿名アカウントを作成できませんでした。Supabaseで匿名認証をONにしてください。');
 state.user=session.user;
 const res=await state.client.from('profiles').select('id,nickname,avatar,color').eq('id',state.user.id).maybeSingle();check(res.data,res.error);
 state.profile=res.data;
 if(!state.profile){state.view='profile';render();return;}
 if(getInviteFromUrl()){const tid=await claimInvite(getInviteFromUrl(),true);if(tid){await loadTournament(tid,true);return;}}
 await loadHome();
}
async function loadHome(){
 unsubscribe();state.view='home';state.tournamentId=null;state.detail=null;state.matchId=null;
 const res=await state.client.from('tournaments').select('id,organizer_id,name,format,status,created_at').order('created_at',{ascending:false});check(res.data,res.error);
 state.tournaments=res.data||[];render();
}
async function claimInvite(token,fromUrl=false){
 try{const tid=await callRpc('claim_invite',{p_token:token});if(fromUrl)removeInviteFromUrl();toast('チームに参加しました！');state.tournamentId=tid;return tid;}
 catch(err){if(fromUrl){removeInviteFromUrl();toast('招待リンクを使えません：'+err.message,true);}else throw err;return null;}
}
async function loadTournament(id,first=false){
 if(first){unsubscribe();state.tab='match';state.invites=null;state.view='tournament';state.tournamentId=id;state.detail=null;state.matchId=null;render();}
 if(state.refreshing)return;
 state.refreshing=true;
 try{
 const c=state.client;
 const [t,teams,slots,matches]=await Promise.all([
  c.from('tournaments').select('id,organizer_id,name,format,status,created_at').eq('id',id).single(),
  c.from('teams').select('id,tournament_id,seed,name').eq('tournament_id',id).order('seed'),
  c.from('player_slots').select('id,tournament_id,team_id,position,profile_id,preferred_weapon').eq('tournament_id',id),
  c.from('matches').select('id,tournament_id,round_index,match_index,team_a_id,team_b_id,status,winner_id,next_match_id,advance_to_side,started_at,finished_at').eq('tournament_id',id).order('round_index').order('match_index')
 ]);
 for(const r of [t,teams,slots,matches])check(r.data,r.error);
 const profileIds=[...new Set((slots.data||[]).map(x=>x.profile_id).filter(Boolean))];
 let profiles=[];
 if(profileIds.length){const r=await c.from('profiles').select('id,nickname,avatar,color').in('id',profileIds);profiles=check(r.data,r.error)||[];}
 let allMatches=matches.data||[], selected=allMatches.find(m=>m.id===state.matchId);
 if(!selected){const ownTeam=(slots.data||[]).find(s=>s.profile_id===state.user.id)?.team_id;
 selected=allMatches.find(m=>m.status==='live'&&(m.team_a_id===ownTeam||m.team_b_id===ownTeam))
 || allMatches.find(m=>m.status==='live')
 || allMatches.find(m=>m.status==='pending' && m.team_a_id&&m.team_b_id && (m.team_a_id===ownTeam||m.team_b_id===ownTeam))
 || allMatches.find(m=>m.status==='pending'&&m.team_a_id&&m.team_b_id)
 || allMatches[0];
 }
 // サーバーに確定済みのイベントは、通信応答を失った場合でもキューから除外。
 const unconfirmed=state.pending.filter(x=>x.uid===state.user?.id).map(x=>x.eventId);
 if(unconfirmed.length){
   const acknowledgements=await c.from('death_events').select('event_id').in('event_id',unconfirmed.slice(0,200));
   check(acknowledgements.data,acknowledgements.error);
   const applied=new Set((acknowledgements.data||[]).map(e=>e.event_id));
   if(applied.size){state.pending=state.pending.filter(e=>!applied.has(e.eventId));savePending();}
 }
 let matchPlayers=[];
 if(selected&&selected.status!=='pending'){
  const r=await c.from('match_players').select('match_id,slot_id,tournament_id,weapon_name,base_stock,deaths,updated_at').eq('match_id',selected.id);
  matchPlayers=check(r.data,r.error)||[];
 }
 if(state.tournamentId!==id)return;
 state.detail={tournament:t.data,teams:teams.data||[],slots:slots.data||[],matches:allMatches,profiles};
 state.matchId=selected?.id||null;
 state.matchPlayers=matchPlayers;
 state.view='tournament';render();
 if(first)subscribe(id);
 await drainQueue();
 }catch(err){console.error(err);toast('大会を読み込めません：'+err.message,true);if(first){state.view='home';await loadHome();}}
 finally{state.refreshing=false;}
}
function unsubscribe(){if(state.channel){state.client?.removeChannel(state.channel);state.channel=null;}state.realtimeStatus='disconnected';if(state.refreshTimer){clearTimeout(state.refreshTimer);state.refreshTimer=null;}}
function scheduleRefresh(){if(state.view!=='tournament'||!state.tournamentId)return;clearTimeout(state.refreshTimer);state.refreshTimer=setTimeout(()=>{if(!state.refreshing)loadTournament(state.tournamentId);else scheduleRefresh();},320);}
function subscribe(id){unsubscribe();const c=state.client,ch=c.channel('splastock-'+id+'-'+UUID().slice(0,8));
 for(const tbl of ['matches','player_slots','match_players']){
   ch.on('postgres_changes',{event:'*',schema:'public',table:tbl,filter:`tournament_id=eq.${id}`},scheduleRefresh);
 }
 ch.on('postgres_changes',{event:'*',schema:'public',table:'tournaments',filter:`id=eq.${id}`},scheduleRefresh);
 // プロフィール変更は稀なので、対戦画面を開き直したときにも取得する。
 ch.subscribe(status=>{state.realtimeStatus=status;renderHeader();if(status==='SUBSCRIBED')scheduleRefresh();});state.channel=ch;
}
async function updateProfile(form){
 const name=(new FormData(form).get('nickname')||'').trim();if(name.length<1||name.length>24)throw new Error('名前は1～24文字にしてください');
 const obj={id:state.user.id,nickname:name,avatar:state.avatar,color:state.color,updated_at:new Date().toISOString()};
 const {data,error}=await state.client.from('profiles').upsert(obj).select('id,nickname,avatar,color').single();check(data,error);
 state.profile=data;state.nameDraft='';toast('アバターを保存しました');
 if(getInviteFromUrl()){const tid=await claimInvite(getInviteFromUrl(),true);if(tid){await loadTournament(tid,true);return;}}
 await loadHome();
}
async function createEvent(form){const f=new FormData(form),teams=String(f.get('teams')||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
 if(teams.length<2||teams.length>16)throw new Error('2～16チームの名前を改行して入力してください');
 if(new Set(teams).size!==teams.length)throw new Error('同じチーム名が重複しています');
 const id=await callRpc('create_tournament',{p_name:String(f.get('eventname')),p_format:String(f.get('format')),p_team_names:teams});toast('大会と選手枠を作成しました！');await loadTournament(id,true);state.tab='admin';render();}
async function changeWeapon(name){if(!name)return;const t=state.detail?.tournament;if(!t)return;
 const old=state.detail.slots.find(s=>s.profile_id===state.user.id)?.preferred_weapon;
 try{await callRpc('set_player_weapon',{p_tournament:t.id,p_weapon:name});rememberWeapon(name);toast(`${name}に変更しました`);await loadTournament(t.id);}
 catch(e){toast('ブキ変更不可：'+e.message,true);await loadTournament(t.id);}}
function canAddDeath(delta){const match=chosenMatch(),slot=playerSlotFor(state.tournamentId);if(!match||!slot||match.status!=='live')throw new Error('試合中のみデスを記録できます');
 const mp=state.matchPlayers.find(x=>x.slot_id===slot.id);if(!mp||!mp.base_stock)throw new Error('使用ブキを選択してください');
 const existing=currentDeaths(mp,slot,match).deaths;const after=existing+delta;
 if(after<0||after>mp.base_stock)throw new Error('デス数の範囲外です');return match;}
async function addDeath(delta){const match=canAddDeath(delta);
 const item={eventId:UUID(),matchId:match.id,uid:state.user.id,delta,createdAt:Date.now()};
 state.pending.push(item);savePending();render();await drainQueue();}
async function drainQueue(){
 if(!configured||!state.client||!state.user||state.draining||!navigator.onLine)return;
 state.draining=true;
 const blockedMatches=new Set();
 try{
   while(true){const action=state.pending.find(e=>e.uid===state.user.id&&!blockedMatches.has(e.matchId));
     if(!action)break;
     let saved;
     try{saved=await callRpc('record_death',{p_match:action.matchId,p_event:action.eventId,p_delta:action.delta});}
     catch(e){console.warn('Unsent action retained',action,e);blockedMatches.add(action.matchId);if(state.view==='tournament'&&state.matchId===action.matchId)toast('未同期の記録があります。接続と試合状態を確認してください：'+e.message,true);continue;}
     const mp=state.matchPlayers.find(x=>x.match_id===action.matchId&&state.detail?.slots.some(s=>s.id===x.slot_id&&s.profile_id===state.user.id));
     if(mp)mp.deaths=Number(saved);
     state.pending=state.pending.filter(e=>e.eventId!==action.eventId);savePending();render();
   }
 }finally{state.draining=false;if(state.tournamentId&&state.view==='tournament')scheduleRefresh();}
}
async function ensureWake(){if(!state.wakeEnabled)return;try{if('wakeLock' in navigator&&document.visibilityState==='visible'&&!state.wakeLock){state.wakeLock=await navigator.wakeLock.request('screen');state.wakeLock.addEventListener('release',()=>state.wakeLock=null);}}catch(e){toast('画面消灯防止が使えません：'+e.message,true);state.wakeEnabled=false;}}
async function toggleWake(){if(state.wakeEnabled){state.wakeEnabled=false;try{await state.wakeLock?.release();}catch{}state.wakeLock=null;toast('画面消灯防止を解除');}
 else{if(!('wakeLock' in navigator)){toast('このブラウザは画面消灯防止に対応していません',true);return;}state.wakeEnabled=true;await ensureWake();if(state.wakeEnabled)toast('画面消灯防止を有効化');}
 render();}
function confirmAction(message,callback,title='確認'){const dlg=document.getElementById('confirm-dialog');document.getElementById('confirm-body').innerHTML=`<h2>${esc(title)}</h2><p class="subline">${esc(message)}</p>`;
 const handler=()=>{dlg.removeEventListener('close',handler);if(dlg.returnValue==='confirm')runBusy(callback);};dlg.addEventListener('close',handler);dlg.showModal();}
async function copyText(value){try{await navigator.clipboard.writeText(value);toast('コピーしました');}catch{toast('コピーできませんでした。HTTPS環境でお試しください',true);}}
function showScheduleConfirm(){confirmAction('対戦表を生成すると形式やチーム数は変更できなくなります。よろしいですか？',async()=>{const count=await callRpc('generate_schedule',{p_tournament:state.tournamentId});toast(`${count}試合分の対戦表を生成しました`);state.tab='schedule';await loadTournament(state.tournamentId);},'対戦表を作成');}
async function beginMatch(id){const m=state.detail.matches.find(m=>m.id===id);if(!m)return;confirmAction(`${nameOfTeam(m.team_a_id)} vs ${nameOfTeam(m.team_b_id)} の試合を開始します。未選択の選手は初デス前までブキを選べます。`,async()=>{await callRpc('start_match',{p_match:id});toast('試合を開始しました！');await loadTournament(state.tournamentId);},'試合を開始');}
function finishDialog(id){const m=state.detail.matches.find(x=>x.id===id);if(!m)return;const dlg=document.getElementById('confirm-dialog'),body=document.getElementById('confirm-body');body.innerHTML=`<h2>勝利チームを選択</h2><p class="small muted">実際の試合結果を確認してください。確定すると勝者が次ラウンドへ進みます。元に戻す機能はありません。</p><div class="winner-buttons"><button type="button" class="btn btn-outline" data-action="commit-winner" data-match="${m.id}" data-team="${m.team_a_id}">${esc(nameOfTeam(m.team_a_id))}</button><button type="button" class="btn btn-outline" data-action="commit-winner" data-match="${m.id}" data-team="${m.team_b_id}">${esc(nameOfTeam(m.team_b_id))}</button></div>`;dlg.showModal();}
function handleSolo(action){const w=state.weaponMap.get(state.solo.weapon)||state.weapons[0];if(action==='solo-death')state.solo.deaths=Math.min(w.stock,state.solo.deaths+1);if(action==='solo-undo')state.solo.deaths=Math.max(0,state.solo.deaths-1);if(action==='solo-reset')state.solo.deaths=0;saveSolo();render();}
document.addEventListener('click',async e=>{
 const btn=e.target.closest('[data-action]');if(!btn||btn.disabled)return;
 const action=btn.dataset.action;
 try{
 switch(action){
 case 'home':if(state.profile){await runBusy(loadHome);}else{state.view=configured?'profile':'solo';render();}break;
 case 'solo':state.view='solo';render();break;
 case 'retry':await runBusy(initializeSession);break;
 case 'edit-profile':state.avatar=state.profile.avatar;state.color=state.profile.color;state.nameDraft=state.profile.nickname;state.view='profile';render();break;
 case 'avatar':state.nameDraft=document.getElementById('nickname')?.value||'';state.avatar=btn.dataset.value;render();break;
 case 'color':state.nameDraft=document.getElementById('nickname')?.value||'';state.color=btn.dataset.value;render();break;
 case 'scroll-create':document.getElementById('create-section')?.scrollIntoView({behavior:'smooth',block:'start'});break;
 case 'open-event':await runBusy(()=>loadTournament(btn.dataset.id,true));break;
 case 'tab':state.tab=btn.dataset.value;render();break;
 case 'select-match':state.matchId=btn.dataset.id;state.tab='match';await runBusy(()=>loadTournament(state.tournamentId));break;
 case 'solo-death':case 'solo-undo':case 'solo-reset':handleSolo(action);break;
 case 'quick-weapon':await runBusy(()=>changeWeapon(btn.dataset.value));break;
 case 'death':case 'undo':await addDeath(action==='death'?1:-1);break;
 case 'wake':await toggleWake();break;
 case 'retry-sync':await drainQueue();break;
 case 'clear-pending':{
   const count=pendingFor(state.matchId).length;
   confirmAction(`${count}件の未同期の操作を破棄します。同期されなかったデスはサーバーに反映されません。主催者に申告してから操作してください。`,async()=>{state.pending=state.pending.filter(x=>x.matchId!==state.matchId||x.uid!==state.user.id);savePending();toast('未同期の操作を破棄しました');render();},'未同期の記録を破棄');break;
 }
 case 'issue-invites':await runBusy(async()=>{state.invites=await callRpc('issue_invites',{p_tournament:state.tournamentId});render();toast('未登録枠のリンクを発行しました');});break;
 case 'copy-invite':if(state.invites?.[Number(btn.dataset.index)])await copyText(inviteLink(state.invites[Number(btn.dataset.index)].invite_token));break;
 case 'copy-all-invites':if(state.invites)await copyText(state.invites.map(i=>`${i.team_name} ${i.slot_position}番: ${inviteLink(i.invite_token)}`).join('\n'));break;
 case 'generate':showScheduleConfirm();break;
 case 'start-match':beginMatch(btn.dataset.id);break;
 case 'finish-dialog':finishDialog(btn.dataset.id);break;
 case 'commit-winner':{
   const matchId=btn.dataset.match,teamId=btn.dataset.team;document.getElementById('confirm-dialog').close();
   confirmAction(`${nameOfTeam(teamId)} の勝利を確定します。取り消しできません。`,async()=>{await callRpc('finish_match',{p_match:matchId,p_winner:teamId});toast('試合結果を確定しました');state.matchId=null;await loadTournament(state.tournamentId);},'結果を確定');break;
 }
 }
 }catch(err){console.error(err);toast(err.message||String(err),true);}
});
document.addEventListener('submit',async e=>{const form=e.target;if(!['profile-form','create-form','claim-form'].includes(form.id))return;e.preventDefault();
 await runBusy(async()=>{if(form.id==='profile-form')return updateProfile(form);if(form.id==='create-form')return createEvent(form);if(form.id==='claim-form'){
  const token=String(new FormData(form).get('inviteCode')||'').trim();if(!/^[0-9a-fA-F-]{36}$/.test(token))throw new Error('正しい招待コードを入力してください');const tid=await claimInvite(token);if(tid)await loadTournament(tid,true);
 }});
});
document.addEventListener('change',async e=>{const target=e.target;
 if(target.dataset.change==='solo-weapon'){state.solo.weapon=target.value;state.solo.deaths=0;rememberWeapon(target.value);saveSolo();render();}
 if(target.dataset.change==='set-weapon')await runBusy(()=>changeWeapon(target.value));
});
window.addEventListener('online',()=>{renderHeader();drainQueue();scheduleRefresh();});
window.addEventListener('offline',()=>{renderHeader();if(state.view==='tournament')render();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){ensureWake();if(state.view==='tournament')scheduleRefresh();drainQueue();}});
// Realtime が一時的に途切れても15秒ごとに整合性を再確認。
setInterval(()=>{if(state.view==='tournament'&&navigator.onLine&&!state.refreshing)scheduleRefresh();},15000);
boot();
