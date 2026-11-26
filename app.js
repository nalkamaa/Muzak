{
const RB = ['https://de1.api.radio-browser.info', 'https://de2.api.radio-browser.info', 'https://all.api.radio-browser.info'];
const IA = 'https://archive.org';
const PAGE = 36;

const CATS = [
  {id:'suomi', name:'Suomi', src:'rb', by:{countrycode:'FI'}, sub:'Suomalaiset radioasemat, suosituimmat ensin.'},
  {id:'pop', name:'Pop', src:'rb', by:{tag:'pop'}, sub:'Pop-radioasemia ympäri maailmaa.'},
  {id:'rock', name:'Rock', src:'rb', by:{tag:'rock'}, sub:'Rock-radioasemia ympäri maailmaa.'},
  {id:'metalli', name:'Metalli', src:'rb', by:{tag:'metal'}, sub:'Metalliradioita ympäri maailmaa.'},
  {id:'jazz', name:'Jazz', src:'rb', by:{tag:'jazz'}, sub:'Jazz-radioasemia ympäri maailmaa.'},
  {id:'elektroninen', name:'Elektroninen', src:'rb', by:{tag:'electronic'}, sub:'Elektronista musiikkia soittavia asemia.'},
  {id:'blues', name:'Blues', src:'rb', by:{tag:'blues'}, sub:'Blues-radioasemia ympäri maailmaa.'},
  {id:'klassinen', name:'Klassinen', src:'rb', by:{tag:'classical'}, sub:'Klassisen musiikin radioasemia.'},
  {id:'joulu', name:'Joulu', src:'rb', by:{multi:[{tag:'joulumusiikki'}, {name:'joulu'}, {tag:'christmas'}, {tag:'christmas music'}, {tag:'xmas'}, {tag:'weihnachten'}]}, sub:'Joulumusiikkia soittavia asemia, suomalaiset ensin.'},
  {id:'albumit', name:'Albumit', src:'ia', sub:'Vapaasti jaettavia albumeita Internet Archiven netlabel-kokoelmasta, suosituimmat ensin.'},
  {id:'suosikit', name:'Suosikit', src:'fav', sub:'Tallentamasi asemat ja albumit. Ne säilyvät tässä laitteessa ja selaimessa.'},
  {id:'linkit', name:'Muut palvelut', src:'links'}
];

// Hengellinen ja uskonnollinen sisältö sekä puhekanavat suodatetaan pois nimen ja tagien perusteella.
const SPIRITUAL = /christ(?!mas)|kristi|gospel|worship|church|kirkko|seurakun|bible|raamat|catholic|katoli|evangel|evankel|lutheran|luterilai|jesus|jeesus|\bgod\b|\bgud\b|jumala|praise|prayer|rukous|sermon|saarna|hymn|virsi|virret|psalm|messiah|herätys|hengelli|relig|spiritu|islam|quran|koran|sunnah|allah|nasheed|hindu|bhajan|bhakti|devotion|mantra|krishna|buddh|dharma|torah|jewish|chabad|adventist|pentecost|helluntai|baptist|ministr|faith|\bpray|gurbani|kirtan/i;
// Venäläiset asemat: maa, kieli, tagit tai nimi.
const RUSSIAN = /russia|russian|русск|росси|\bрф\b/i;
const TALK = /\b(talk|news|uutiset|sports?|urheilu|podcast)\b/i;
const canHls = !!document.createElement('audio').canPlayType('application/vnd.apple.mpegurl');

const $ = s => document.querySelector(s);
const grid = $('#grid'), statusEl = $('#status'), moreBtn = $('#more');
let state = {cat:null, page:0, q:'', done:false, busy:false, token:0};
const items = new Map();

const store = {
  get(){ try { return JSON.parse(localStorage.getItem('muzak-fav') || '[]'); } catch { return []; } },
  set(v){ try { localStorage.setItem('muzak-fav', JSON.stringify(v)); } catch {} }
};
const isFav = key => store.get().some(f => f.key === key);
const toggleFav = it => {
  let f = store.get();
  if (isFav(it.key)) f = f.filter(x => x.key !== it.key); else f.unshift(it);
  store.set(f);
  if (state.cat?.src === 'fav') show('suosikit');
};

const plain = html => {
  if (!html) return '';
  const d = new DOMParser().parseFromString(String(Array.isArray(html) ? html.join(', ') : html), 'text/html');
  return (d.body.textContent || '').trim();
};
const terms = q => q.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').trim().split(/\s+/).filter(Boolean);
const https = u => (u && u.startsWith('https://')) ? u : '';

// ---------- Radio Browser ----------
async function rb(path, params) {
  const p = new URLSearchParams(params);
  let err;
  for (const host of RB) {
    try {
      const r = await fetch(`${host}${path}?${p}`);
      if (r.ok) return await r.json();
      err = new Error(r.status);
    } catch (e) { err = e; }
  }
  throw err || new Error('Radio Browser ei vastannut');
}

function okStation(s) {
  const text = `${s.name} ${s.tags}`;
  if (s.name.length > 60 || (s.name.match(/[-|,*]/g) || []).length > 4) return false;  // avainsanoilla täytetyt roskanimet
  if (!https(s.url_resolved)) return false;
  if (s.countrycode === 'RU' || RUSSIAN.test(`${s.name} ${s.tags} ${s.language} ${s.country}`)) return false;           // http-streamit eivät soi https-sivulla
  if (s.hls === 1 && !canHls) return false;
  if (SPIRITUAL.test(text) || TALK.test(s.tags)) return false;
  return true;
}

async function rbMulti(multi) {
  const res = await Promise.allSettled(multi.map(m => rbSearch({by: m.tag ? {tag: m.tag} : {}, q: m.name, page: 0})));
  const seen = new Set(), list = [];
  res.forEach(r => r.status === 'fulfilled' && r.value.list.forEach(it => {
    const k = it.title.toLowerCase(); if (seen.has(it.key) || seen.has(k)) return;
    seen.add(it.key); seen.add(k); list.push(it);
  }));
  if (!list.length && res.every(r => r.status === 'rejected')) throw res[0].reason;
  return {list, done: true};
}

async function rbSearch({by, q, page}) {
  if (by?.multi) return rbMulti(by.multi);
  const fetchN = 100;
  const params = {hidebroken:'true', order:'clickcount', reverse:'true', limit:fetchN, offset:page * fetchN};
  if (by?.countrycode) params.countrycode = by.countrycode;
  if (by?.tag) { params.tag = by.tag; params.tagExact = 'true'; }
  if (q) params.name = q;
  const list = await rb('/json/stations/search', params);
  const seen = new Set();
  return {
    list: list.filter(okStation).filter(s => {
      const k = s.name.trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true;
    }).map(s => ({
      key: 'rb:' + s.stationuuid, src: 'rb', id: s.stationuuid, title: s.name.trim(),
      thumb: https(s.favicon), url: s.url_resolved,
      meta: [s.country, s.tags.split(',').slice(0, 3).join(', ')].filter(Boolean).join(' · ')
    })),
    done: list.length < fetchN
  };
}

// ---------- Internet Archive ----------
function okAlbum(d) {
  return !SPIRITUAL.test(`${plain(d.title)} ${plain(d.subject)} ${plain(d.creator)}`);
}

const quote = v => '"' + v.replace(/["\\]/g, ' ') + '"';
async function iaSearch({q, page, creator}) {
  let query = 'mediatype:audio AND collection:netlabels';
  if (creator) query += ` AND creator:(${quote(creator)})`;
  const t = terms(q);
  if (t.length) query += ` AND (${t.map(w => `(title:(${w}) OR subject:(${w}) OR creator:(${w}))`).join(' AND ')})`;
  const p = new URLSearchParams({q: query, rows: PAGE, page: page + 1, output: 'json'});
  ['identifier','title','year','creator','subject'].forEach(f => p.append('fl[]', f));
  p.append('sort[]', 'downloads desc');
  const r = await fetch(`${IA}/advancedsearch.php?${p}`);
  if (!r.ok) throw new Error('Internet Archive ei vastannut');
  const j = await r.json();
  const docs = j.response?.docs || [];
  return {
    list: docs.filter(okAlbum).map(d => ({
      key: 'ia:' + d.identifier, src: 'ia', id: d.identifier,
      title: plain(d.title) || d.identifier, artist: plain([].concat(d.creator || [])[0]),
      thumb: `${IA}/services/img/${encodeURIComponent(d.identifier)}`,
      meta: [plain(d.creator), d.year ? String(d.year).slice(0, 4) : ''].filter(Boolean).join(' · ')
    })),
    done: (page + 1) * PAGE >= (j.response?.numFound || 0)
  };
}

// Esittäjälista kootaan 3000 suosituimman albumin tekijöistä.
const VARIOUS = /^(various( artists)?|va|v\/a|v\.a\.|split|compilation|unknown|tuntematon)$/i;
let artistCache = null;
async function iaArtists() {
  if (artistCache) return artistCache;
  const p = new URLSearchParams({q: 'mediatype:audio AND collection:netlabels', rows: 3000, page: 1, output: 'json'});
  ['creator','title','subject'].forEach(f => p.append('fl[]', f));
  p.append('sort[]', 'downloads desc');
  const r = await fetch(`${IA}/advancedsearch.php?${p}`);
  if (!r.ok) throw new Error('Internet Archive ei vastannut');
  const docs = (await r.json()).response?.docs || [];
  const map = new Map();
  for (const d of docs.filter(okAlbum)) {
    for (const raw of [].concat(d.creator || [])) {
      const name = plain(raw).replace(/\s+/g, ' ').trim();
      if (!name || VARIOUS.test(name) || name.length > 60) continue;
      const k = name.toLowerCase();
      const a = map.get(k) || {name, n: 0}; a.n++; map.set(k, a);
    }
  }
  artistCache = [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'fi', {sensitivity: 'base'}));
  return artistCache;
}

function showArtists() {
  const box = $('#artists'); box.hidden = false; grid.hidden = true;
  statusEl.textContent = 'Ladataan esittäjiä…';
  const tok = state.token;
  iaArtists().then(list => {
    if (tok !== state.token) return;
    statusEl.textContent = '';
    const first = n => { const c = n.name[0].toLocaleUpperCase('fi'); return /^[A-ZÅÄÖ]$/.test(c) ? c : '#'; };
    const groups = new Map();
    list.forEach(a => { const f = first(a); if (!groups.has(f)) groups.set(f, []); groups.get(f).push(a); });
    const letters = [...groups.keys()].sort((a, b) => (a === '#') - (b === '#') || a.localeCompare(b, 'fi'));
    const filter = document.createElement('input');
    filter.type = 'search'; filter.placeholder = 'Suodata esittäjiä'; filter.className = 'afilter';
    filter.setAttribute('aria-label', 'Suodata esittäjiä');
    const jump = document.createElement('nav'); jump.className = 'letters'; jump.setAttribute('aria-label', 'Kirjaimet');
    jump.innerHTML = letters.map(l => `<a href="#" data-l="${l}">${l}</a>`).join('');
    const body = document.createElement('div');
    body.innerHTML = letters.map(l => `<section class="agroup" id="kirjain-${encodeURIComponent(l)}"><h2>${l}</h2><ul class="alist">${
      groups.get(l).map(a => `<li><a href="#esittaja=${encodeURIComponent(a.name)}"></a></li>`).join('')}</ul></section>`).join('');
    // nimet tekstinä, ei HTML:nä
    const flat = letters.flatMap(l => groups.get(l));
    body.querySelectorAll('.alist a').forEach((el, i) => {
      el.textContent = flat[i].name;
      const n = document.createElement('span'); n.textContent = flat[i].n; el.append(n);
    });
    jump.addEventListener('click', e => {
      const l = e.target.dataset.l; if (!l) return; e.preventDefault();
      document.getElementById('kirjain-' + encodeURIComponent(l))?.scrollIntoView({behavior: 'smooth'});
    });
    filter.addEventListener('input', () => {
      const f = filter.value.trim().toLowerCase();
      body.querySelectorAll('.alist li').forEach(li => { li.hidden = f && !li.textContent.toLowerCase().includes(f); });
      body.querySelectorAll('.agroup').forEach(g => { g.hidden = !g.querySelector('li:not([hidden])'); });
    });
    box.replaceChildren(filter, jump, body);
  }).catch(() => { if (tok === state.token) statusEl.textContent = 'Esittäjien lataus epäonnistui. Yritä uudelleen.'; });
}

async function iaTracks(id) {
  const r = await fetch(`${IA}/metadata/${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error('Internet Archive ei vastannut');
  const j = await r.json();
  const files = j.files || [];
  let mp3 = files.filter(f => /mp3/i.test(f.format || '') && f.source === 'original');
  if (!mp3.length) mp3 = files.filter(f => /mp3/i.test(f.format || ''));
  return {
    meta: j.metadata || {},
    tracks: mp3.sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true})).map(f => ({
      title: f.title || f.name.replace(/\.mp3$/i, '').replace(/_/g, ' '),
      len: +f.length || 0,
      url: `${IA}/download/${encodeURIComponent(id)}/${f.name.split('/').map(encodeURIComponent).join('/')}`
    }))
  };
}

// ---------- rendering ----------
function card(it) {
  items.set(it.key, it);
  const b = document.createElement('button');
  b.className = 'card' + (it.src === 'rb' ? ' station' : ''); b.type = 'button'; b.dataset.key = it.key;
  const ph = document.createElement('span'); ph.className = 'cover';
  if (it.thumb) {
    const img = document.createElement('img');
    img.loading = 'lazy'; img.alt = ''; img.src = it.thumb; img.referrerPolicy = 'no-referrer';
    img.onerror = () => img.remove();
    ph.append(img);
  }
  const t = document.createElement('span'); t.className = 't'; t.textContent = it.title;
  const y = document.createElement('span'); y.className = 'y';
  y.textContent = it.meta || (it.src === 'ia' ? 'Albumi' : 'Radio');
  b.append(ph, t, y);
  return b;
}
const addCards = list => grid.append(...list.map(card));

async function load() {
  const c = state.cat, tok = state.token;
  if (state.busy || state.done) return;
  state.busy = true; moreBtn.hidden = true; statusEl.textContent = 'Ladataan…';
  try {
    let list = [];
    if (c.id === 'haku') {
      const [a, b] = await Promise.allSettled([
        state.rbDone ? Promise.resolve({list: [], done: true}) : rbSearch({q: state.q, page: state.page}),
        state.iaDone ? Promise.resolve({list: [], done: true}) : iaSearch({q: state.q, page: state.page})
      ]);
      if (a.status === 'fulfilled') { list.push(...a.value.list); state.rbDone = a.value.done; } else state.rbDone = true;
      if (b.status === 'fulfilled') { list.push(...b.value.list); state.iaDone = b.value.done; } else state.iaDone = true;
      if (a.status === 'rejected' && b.status === 'rejected') throw a.reason;
      state.done = state.rbDone && state.iaDone;
    } else {
      const r = c.src === 'rb' ? await rbSearch({by: c.by, page: state.page}) : await iaSearch({q: '', page: state.page, creator: c.creator});
      list = r.list; state.done = r.done;
    }
    if (tok !== state.token) return;
    state.page++;
    addCards(list.filter(it => !grid.querySelector(`[data-key="${CSS.escape(it.key)}"]`)));
    statusEl.textContent = grid.children.length ? '' : 'Ei tuloksia. Kokeile toista hakusanaa.';
    moreBtn.hidden = state.done;
  } catch (e) {
    if (tok !== state.token) return;
    statusEl.textContent = 'Lataus epäonnistui. Tarkista nettiyhteys ja yritä uudelleen.';
    moreBtn.hidden = false;
  } finally {
    if (tok === state.token) state.busy = false;
  }
}

function show(catId) {
  let c;
  if (catId === 'haku') c = {id:'haku', name:`Haku: ${state.q}`, sub:'Radioasemat nimen mukaan ja albumit Internet Archivesta.'};
  else if (catId === 'esittajat') c = {id:'esittajat', tab:'albumit', sub2:'esittajat', src:'artists', name:'Esittäjät', sub:'Albumien esittäjät aakkosjärjestyksessä. Numero kertoo albumien määrän.'};
  else if (catId.startsWith('esittaja=')) {
    const name = decodeURIComponent(catId.slice(9));
    c = {id:catId, tab:'albumit', sub2:'esittajat', src:'ia', creator:name, name, sub:'Esittäjän albumit Internet Archivesta.'};
  } else c = CATS.find(x => x.id === catId) || CATS[0];
  if (c.id === 'albumit') c = {...c, sub2:'albumit'};
  state = {...state, cat: c, page: 0, done: false, busy: false, rbDone: false, iaDone: false, token: state.token + 1};
  document.querySelectorAll('#tabs a').forEach(a => {
    if (a.dataset.id === (c.tab || c.id)) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const links = c.src === 'links';
  $('#view').hidden = links; $('#linkit').hidden = !links;
  if (links) return;
  $('#heading').textContent = c.name; $('#sub').textContent = c.sub || '';
  const sn = $('#subnav'); sn.hidden = !c.sub2;
  sn.querySelectorAll('a').forEach(a => { if (a.dataset.id === c.sub2) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  $('#artists').hidden = true; grid.hidden = false;
  if (c.src === 'artists') { grid.replaceChildren(); moreBtn.hidden = true; showArtists(); return; }
  grid.replaceChildren(); statusEl.textContent = ''; moreBtn.hidden = true;
  if (c.src === 'fav') {
    const f = store.get();
    addCards(f); state.done = true;
    statusEl.textContent = f.length ? '' : 'Ei vielä suosikkeja. Paina tähteä soittimessa tai albumin Suosikiksi-painiketta.';
    return;
  }
  load();
}

// ---------- player ----------
const audio = $('#audio'), bar = $('#player'), toggle = $('#ptoggle'), pfav = $('#pfav');
let now = null, queue = [], qi = 0;

function setPlayFav() {
  if (!now) return;
  const on = isFav(now.item.key);
  pfav.textContent = on ? '★' : '☆';
  pfav.setAttribute('aria-pressed', on);
  pfav.setAttribute('aria-label', on ? 'Poista suosikeista' : 'Suosikiksi');
}
function setState(t) { $('#pstate').textContent = t; }

function play(item, title, url, sub) {
  now = {item};
  bar.hidden = false; document.body.classList.add('playing');
  $('#pname').textContent = title;
  const img = $('#pimg');
  if (item.thumb) { img.src = item.thumb; img.hidden = false; } else img.hidden = true;
  img.onerror = () => { img.hidden = true; };
  audio.src = url;
  setState('Yhdistetään…');
  audio.play().catch(() => setState('Ei toistu. Paina toistopainiketta tai kokeile toista asemaa.'));
  now.sub = sub;
  setPlayFav();
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({title, artist: sub || 'Muzak', artwork: item.thumb ? [{src: item.thumb}] : []});
  }
}

function playStation(it) {
  queue = []; play(it, it.title, it.url, 'Radio');
  rb(`/json/url/${it.id}`, {}).catch(() => {});      // Radio Browserin kuuntelulaskuri
}
function playTrack(album, i) {
  qi = i; const t = queue[i];
  play(album, t.title, t.url, album.title);
  document.querySelectorAll('#tracks li').forEach((li, n) => li.classList.toggle('on', n === i));
}

audio.addEventListener('playing', () => { setState(queue.length ? now.sub : 'Suorana'); toggle.textContent = '❚❚'; toggle.setAttribute('aria-label', 'Tauko'); });
audio.addEventListener('pause', () => { toggle.textContent = '▶'; toggle.setAttribute('aria-label', 'Toista'); });
audio.addEventListener('waiting', () => setState('Puskuroidaan…'));
audio.addEventListener('error', () => { if (audio.src) setState('Lähetys ei toistu nyt. Kokeile toista asemaa.'); });
audio.addEventListener('ended', () => { if (queue.length && qi + 1 < queue.length) playTrack(now.item, qi + 1); });
toggle.addEventListener('click', () => {
  if (audio.paused) {
    if (!queue.length && now) audio.src = now.item.url;   // radio: palaa suoraan lähetykseen
    audio.play().catch(() => setState('Ei toistu.'));
  } else audio.pause();
});
pfav.addEventListener('click', () => { if (now) { toggleFav(now.item); setPlayFav(); } });

// ---------- album sheet ----------
const dlg = $('#album'), afav = $('#afav');
let openAlbum = null, albumTracks = [];
function setAlbumFav() {
  const on = isFav(openAlbum.key);
  afav.textContent = on ? 'Suosikeissa' : 'Suosikiksi'; afav.setAttribute('aria-pressed', on);
}
const fmt = s => s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '';
async function showAlbum(it) {
  openAlbum = it;
  $('#atitle').textContent = it.title; $('#ameta').textContent = it.meta || '';
  const ol = $('#tracks'); ol.replaceChildren();
  const wait = document.createElement('li'); wait.textContent = 'Ladataan kappaleita…'; ol.append(wait);
  setAlbumFav(); dlg.showModal();
  try {
    const {meta, tracks} = await iaTracks(it.id);
    if (openAlbum !== it) return;
    albumTracks = tracks;
    const lic = meta.licenseurl ? ` · Lisenssi: ${meta.licenseurl.replace(/^https?:\/\/(www\.)?/, '')}` : '';
    $('#ameta').textContent = (it.meta || '') + lic;
    if (it.artist && !VARIOUS.test(it.artist)) {
      const a = document.createElement('a');
      a.href = '#esittaja=' + encodeURIComponent(it.artist); a.textContent = 'Kaikki esittäjän albumit';
      $('#ameta').append(' · ', a);
    }
    ol.replaceChildren(...tracks.map((t, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button'); b.type = 'button'; b.className = 'track';
      b.innerHTML = '<span class="tt"></span><span class="tl"></span>';
      b.querySelector('.tt').textContent = t.title; b.querySelector('.tl').textContent = fmt(t.len);
      b.addEventListener('click', () => { queue = albumTracks; playTrack(it, i); });
      li.append(b); return li;
    }));
    if (!tracks.length) ol.innerHTML = '<li>Tästä albumista ei löytynyt soitettavia kappaleita.</li>';
  } catch { ol.innerHTML = '<li>Kappaleiden lataus epäonnistui. Yritä uudelleen.</li>'; }
}
$('#aclose').addEventListener('click', () => dlg.close());
afav.addEventListener('click', () => { toggleFav(openAlbum); setAlbumFav(); setPlayFav(); });

grid.addEventListener('click', e => {
  const b = e.target.closest('.card'); if (!b) return;
  const it = items.get(b.dataset.key); if (!it) return;
  if (it.src === 'rb') playStation(it); else showAlbum(it);
});
moreBtn.addEventListener('click', load);

// ---------- navigation ----------
$('#tabs').innerHTML = CATS.map(c => `<a href="#${c.id}" data-id="${c.id}">${c.name}</a>`).join('');
$('#search').addEventListener('submit', e => {
  e.preventDefault();
  const q = $('#q').value.trim(); if (!terms(q).length) return;
  state.q = q;
  if (location.hash === '#haku') show('haku'); else location.hash = 'haku';
});
const route = () => {
  const h = location.hash.slice(1);
  if (h === 'haku' && !state.q) { location.hash = 'suomi'; return; }
  show(h || 'suomi');
};
window.addEventListener('hashchange', () => { if (dlg.open) dlg.close(); route(); });
route();

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
