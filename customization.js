const app = document.getElementById('app');
const brand = document.querySelector('.brand');
const ADMIN_MODE_KEY = 'splastock_admin_mode_v1';
let adminMode = false;
let logoClicks = [];
let lastView = '';
let replacingScreen = false;

function notify(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = 'toast active';
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => { toast.className = 'toast'; }, 3600);
}

// Deliberate UI gesture: click the SPLASTOCK wordmark five times within 2.5s.
// This is an interface gate, not a substitute for Supabase RLS authorization.
brand?.addEventListener('click', event => {
  event.preventDefault();
  const now = Date.now();
  logoClicks = logoClicks.filter(time => now - time < 2500);
  logoClicks.push(now);
  if (logoClicks.length >= 5) {
    logoClicks = [];
    adminMode = true;
    sessionStorage.setItem(ADMIN_MODE_KEY, '1');
    notify('管理モードを有効にしました。大会主催者の画面のみ開けます。');
    document.querySelector('[data-action="home"]')?.click();
  } else if (logoClicks.length === 1) {
    notify('管理モードを開くにはロゴを5回クリックしてください');
  }
});

// Keep the gate for this tab only; don't silently unlock a fresh browser session.
adminMode = sessionStorage.getItem(ADMIN_MODE_KEY) === '1';

function polishAvatarChoices() {
  // Use one simple circle glyph as the player mark. Its selected profile color
  // supplies the color, so the choices are clean colored dots rather than emoji.
  document.querySelectorAll('button[data-action="avatar"]').forEach(button => {
    button.dataset.value = '●';
    button.textContent = '●';
    button.setAttribute('aria-label', '丸アイコン');
    button.classList.add('avatar-dot');
    const color = button.parentElement?.querySelector('[data-action="color"]')?.dataset.value;
    if (color) button.style.backgroundColor = color;
  });
  document.querySelectorAll('[data-action="color"]').forEach(button => {
    const color = button.dataset.value;
    if (!color) return;
    button.textContent = '';
    button.setAttribute('aria-label', `アイコン色 ${color}`);
    button.classList.add('avatar-dot');
    button.style.backgroundColor = color;
  });
}

function addTierlist() {
  const hero = app.querySelector('.hero');
  if (!hero || app.querySelector('.tierlist-card')) return;
  const figure = document.createElement('figure');
  figure.className = 'tierlist-card';
  figure.innerHTML = '<figcaption><span class="section-label">WEAPON TIER LIST</span><h2>ブキ Tierlist 4</h2><p class="muted">現在のブキ評価一覧</p></figcaption><img src="./tierlist%20(4).png" alt="ブキ Tierlist 4" loading="lazy">';
  hero.insertAdjacentElement('afterend', figure);
}

function enforceTournamentGate() {
  const tournamentScreen = app.querySelector('.nav-tabs');
  if (!tournamentScreen || replacingScreen || lastView === 'tournament') return;
  lastView = 'tournament';
  const organizerBadge = [...app.querySelectorAll('.pill-cyan')].some(node => /主催者/.test(node.textContent || ''));
  if (!adminMode || !organizerBadge) {
    replacingScreen = true;
    // Return through the app's own navigation so its subscriptions are cleaned up.
    document.querySelector('[data-action="home"]')?.click();
    setTimeout(() => {
      replacingScreen = false;
      lastView = '';
      notify(!adminMode ? '大会画面は管理モードから開いてください（ロゴを5回クリック）' : '大会主催者のみ管理画面に入れます');
    }, 80);
  }
}

const observer = new MutationObserver(() => {
  polishAvatarChoices();
  addTierlist();
  enforceTournamentGate();
});
observer.observe(app, { childList: true, subtree: true, characterData: true });
polishAvatarChoices();
