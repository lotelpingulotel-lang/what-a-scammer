'use strict';
/* WHAT A SCAMMER – Server (Node.js >= 18, keine Abhängigkeiten).
   Der Server ist die einzige Wahrheit: Rollen & Produkte werden nur an den jeweiligen Spieler geschickt. */
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = process.env.PORT || 3000;
const K = process.env.FAST ? 0.1 : 1;              // Testmodus: kürzere Pausen
const LOBBY_ALONE_MS = process.env.FAST ? 3000 : 180000; // Lobby mit nur 1 Mensch wird nach 3 Min gelöscht
const PR_N = 24, MAX_P = 8;

/* ---------- HTTP ---------- */
const srv = http.createServer((q, s) => {
  if (q.url === '/health') return s.end('ok');
  fs.readFile(path.join(__dirname, 'public', 'index.html'), (e, d) => {
    if (e) { s.writeHead(500); return s.end('public/index.html fehlt'); }
    s.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); s.end(d);
  });
});

/* ---------- Minimaler WebSocket-Server ---------- */
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
srv.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key'];
  if (req.url !== '/ws' || !key) return sock.destroy();
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' +
    crypto.createHash('sha1').update(key + GUID).digest('base64') + '\r\n\r\n');
  const c = { sock, buf: Buffer.alloc(0), pid: null };
  sock.on('data', d => {
    c.buf = Buffer.concat([c.buf, d]);
    if (c.buf.length > 1 << 20) return sock.destroy();
    let f;
    while ((f = frame(c))) {
      if (f.op === 8) { sock.end(); return; }
      if (f.op === 9) raw(c, 10, f.data);
      else if (f.op === 1) { let m; try { m = JSON.parse(f.data.toString()); } catch (e) { continue; } try { onMsg(c, m); } catch (e) { console.error(e); } }
    }
  });
  sock.on('close', () => onClose(c)); sock.on('error', () => {});
});
function frame(c) {
  const b = c.buf; if (b.length < 2) return null;
  const op = b[0] & 15; let len = b[1] & 127, o = 2;
  if (len === 126) { if (b.length < 4) return null; len = b.readUInt16BE(2); o = 4; }
  else if (len === 127) { if (b.length < 10) return null; len = Number(b.readBigUInt64BE(2)); o = 10; }
  if (len > 1 << 20) { c.sock.destroy(); return null; }
  const mk = (b[1] & 128) ? 4 : 0; if (b.length < o + mk + len) return null;
  const d = Buffer.from(b.subarray(o + mk, o + mk + len));
  if (mk) { const m = b.subarray(o, o + 4); for (let i = 0; i < d.length; i++) d[i] ^= m[i & 3]; }
  c.buf = b.subarray(o + mk + len); return { op, data: d };
}
function raw(c, op, data) {
  if (c.sock.destroyed) return; const l = data.length; let h;
  if (l < 126) h = Buffer.from([128 | op, l]);
  else if (l < 65536) { h = Buffer.alloc(4); h[0] = 128 | op; h[1] = 126; h.writeUInt16BE(l, 2); }
  else { h = Buffer.alloc(10); h[0] = 128 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(l), 2); }
  c.sock.write(Buffer.concat([h, data]));
}
const send = (c, o) => { if (c) raw(c, 1, Buffer.from(JSON.stringify(o))); };

/* ---------- Hilfsfunktionen ---------- */
const rnd = n => Math.floor(Math.random() * n);
const shuf = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
const BN = ['Kevin', 'Chantal', 'Dieter', 'Gisela', 'Ramon', 'Fritzi', 'Bubi', 'Mandy'], BE = ['🤖', '👾', '🎃', '🐲', '🧌', '🦾'];
const HON = [p => `Mein ${p} ist top in Schuss – ehrlicher Preis, kein Schnickschnack!`, p => `${p}? Gebraucht, aber gepflegt. Ich schwöre!`, p => `Ein faires Angebot für ${p}. Ihr könnt mich alles fragen!`];
const SCM = [p => `${p}! Nur heute, Schnäppchen deines Lebens – nicht lange überlegen!`, p => `Dieses ${p} ist praktisch neu. Vertrau mir, ich bin Profi!`, p => `Kein Kratzer, kein Defekt, TÜV-geprüft: mein ${p}!`];
const PRN = ['iPhone', 'Gaming-PC', 'PlayStation', 'Nintendo Switch', 'Fernseher', 'Laptop', 'Mystery-Box', 'Luxus-Uhr', 'VR-Headset', 'E-Bike', 'Kamera', 'Kopfhörer', 'Riesen-Teddy', 'Sofa', 'E-Gitarre', 'Drohne', 'Kühlschrank', 'Sneaker', 'Staubsauger-Roboter', 'Drucker', 'Gummiente XXL', 'E-Scooter', 'Kaffeemaschine', 'Kristallkugel'];
const WHY = ['Der wirkt vertrauenswürdig!', 'Bauchgefühl!', 'Die Stimme klingt ehrlich.', 'Der Preis stimmt.'];

/* ---------- Zustand ---------- */
const PL = new Map(), RM = new Map();
function newCode() { let c; do { c = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[rnd(24)]).join(''); } while (RM.has(c)); return c; }
const humans = r => [...r.ps.values()].filter(p => !p.bot && !p.gone);
function mkRoom(host, pub) {
  const r = { code: newCode(), pub, host: host.id, ps: new Map(), phase: 'lobby', tp: 30, round: 0, chat: [], end: 0, alone: 0, roles: null, alive: null, order: null, si: 0, picks: {}, prod: {} };
  RM.set(r.code, r); addP(r, host); return r;
}
function addP(r, p) { r.ps.set(p.id, p); p.room = r.code; p.gone = false; p.off = 0; }
function getRoom(p) { return p.room ? RM.get(p.room) : null; }

function view(r, pid) {
  const me = r.ps.get(pid), ph = r.phase;
  const pitched = ph === 'pitch' ? r.order.slice(0, r.si + 1) : (['buy', 'result', 'end'].includes(ph) && r.order ? r.order : []);
  const pts = {}, pk = {}; pitched.forEach(i => { pts[i] = r.ps.get(i).pt || ''; pk[i] = r.picks[i]; });
  return {
    t: 'state', now: Date.now(), code: r.code, pub: r.pub, host: r.host, phase: ph, tp: r.tp, round: r.round, end: r.end, me: pid,
    role: (r.roles && r.roles[pid]) || null, buyer: r.buyer || null,
    players: [...r.ps.values()].map(p => ({ id: p.id, name: p.name, em: p.em, bot: !!p.bot, off: !!p.off, gone: !!p.gone })),
    alive: r.alive, prod: ph === 'pick' && r.prod[pid] ? r.prod[pid] : null, myPick: me ? me.pick : null,
    order: r.order, si: r.si, picks: pk, pts, last: r.last || null, winner: r.winner || null,
    roles: ph === 'end' ? r.roles : null, chat: r.chat.slice(-40)
  };
}
function bc(r) { r.ps.forEach(p => { if (p.c && !p.gone) send(p.c, view(r, p.id)); }); }
function setPhase(r, ph, ms) { r.phase = ph; r.end = ms ? Date.now() + ms : 0; bc(r); }
function pubList() { return [...RM.values()].filter(r => r.pub && r.phase === 'lobby').map(r => ({ code: r.code, n: r.ps.size, host: (r.ps.get(r.host) || {}).name })); }
function closeRoom(r, msg) { humans(r).forEach(p => { p.room = null; send(p.c, { t: 'left', m: msg || '' }); }); RM.delete(r.code); }
function leaveRoom(p, msg) {
  const r = getRoom(p); p.room = null; if (!r) return;
  if (r.phase === 'lobby') {
    r.ps.delete(p.id);
    if (!humans(r).length) { RM.delete(r.code); return; }
    if (r.host === p.id) r.host = humans(r)[0].id;
  } else { p.gone = true; if (!humans(r).length) { RM.delete(r.code); return; } if (r.host === p.id) r.host = humans(r)[0].id; }
  bc(r);
}

/* ---------- Spiellogik ---------- */
function deal(r) {
  const pool = shuf([...Array(PR_N).keys()]); r.prod = {}; r.picks = {}; r.order = null; r.last = null;
  r.alive.forEach(i => { r.prod[i] = pool.splice(0, 3); });
  r.ps.forEach(p => { p.pick = null; p.pt = ''; p.done = false; p.bt = 0; });
}
function startGame(r) {
  const ids = shuf([...r.ps.keys()]), buyer = ids[0], sl = ids.slice(1);
  r.roles = {}; ids.forEach(i => { r.roles[i] = 'seller'; }); r.roles[buyer] = 'buyer'; r.roles[sl[0]] = 'scammer';
  r.buyer = buyer; r.alive = shuf(sl); r.round = 1; r.winner = null; r.bbt = 0; deal(r); setPhase(r, 'roles', 7000 * K);
}
function resolve(r, ch, why) {
  if (r.phase !== 'buy' || !r.alive.includes(ch)) return;
  const role = r.roles[ch]; r.last = { ch, role, why: why || '' }; r.bbt = 0;
  if (role === 'scammer') { r.winner = 'scammer'; return setPhase(r, 'end', 0); }
  r.alive = r.alive.filter(x => x !== ch);
  if (r.alive.length <= 1) { r.winner = 'buyer'; return setPhase(r, 'end', 0); }
  setPhase(r, 'result', 15000 * K);          // Zwischenrunde: Chat offen, der Scammer darf lügen
}
function botAct(r, n) {
  const ph = r.phase;
  if (ph === 'pick') r.alive.forEach(i => { const p = r.ps.get(i); if (p.bot && p.pick == null) { if (!p.bt) p.bt = n + 800 + rnd(3000); else if (n > p.bt) { p.pick = r.prod[i][rnd(3)]; p.bt = 0; } } });
  else if (ph === 'pitch') {
    const p = r.ps.get(r.order[r.si]);
    if (p.bot) {
      if (!p.bt) p.bt = n + 1200;
      else if (!p.pt && n > p.bt) { p.pt = (r.roles[p.id] === 'scammer' ? SCM : HON)[rnd(3)](PRN[r.picks[p.id]]); p.bt = n + 3500; bc(r); }
      else if (p.pt && !p.done && n > p.bt) p.done = true;
    }
  } else if (ph === 'buy' && r.ps.get(r.buyer).bot) {
    if (!r.bbt) r.bbt = n + 3000; else if (n > r.bbt) resolve(r, r.alive[rnd(r.alive.length)], WHY[rnd(WHY.length)]);
  }
}
function tick(r) {
  const n = Date.now(), ph = r.phase;
  if (ph === 'lobby') {
    for (const p of [...r.ps.values()]) if (!p.bot && p.off && n - p.off > 30000) { leaveRoom(p); if (!RM.has(r.code)) return; }
    if (humans(r).length > 1) r.alone = 0; else if (!r.alone) r.alone = n;
    if (r.alone && n - r.alone > LOBBY_ALONE_MS) closeRoom(r, 'Deine Lobby wurde nach 3 Minuten gelöscht, weil niemand beigetreten ist.');
    return;
  }
  if (humans(r).every(p => p.off && n - p.off > 60000)) { RM.delete(r.code); return; }
  botAct(r, n);
  if (ph === 'roles' && n > r.end) setPhase(r, 'pick', 25000);
  else if (ph === 'pick') {
    if (r.alive.every(i => { const p = r.ps.get(i); return p.pick != null || p.gone; }) || n > r.end) {
      r.alive.forEach(i => { const p = r.ps.get(i); r.picks[i] = r.prod[i].includes(p.pick) ? p.pick : r.prod[i][0]; });
      r.order = shuf(r.alive); r.si = 0; setPhase(r, 'pitch', r.tp * 1000);
    }
  } else if (ph === 'pitch') {
    const sp = r.ps.get(r.order[r.si]);
    if (n > r.end || sp.done || sp.gone) { if (r.si + 1 >= r.order.length) setPhase(r, 'buy', 30000); else { r.si++; r.end = n + r.tp * 1000; bc(r); } }
  } else if (ph === 'buy') { if (n > r.end || r.ps.get(r.buyer).gone) resolve(r, r.alive[rnd(r.alive.length)], 'Hmm… Bauchgefühl!'); }
  else if (ph === 'result' && n > r.end) { r.round++; deal(r); setPhase(r, 'pick', 25000); }
}
setInterval(() => { for (const r of [...RM.values()]) tick(r); const n = Date.now(); for (const [id, p] of PL) if (!p.room && p.off && n - p.off > 36e5) PL.delete(id); }, 400);

/* ---------- Nachrichten ---------- */
function onClose(c) { const p = c.pid && PL.get(c.pid); if (p && p.c === c) { p.c = null; p.off = Date.now(); const r = getRoom(p); if (r) bc(r); } }
function setProfile(p, m) { if (m.name != null) p.name = clean(m.name, 14) || p.name || 'Spieler'; if (m.em != null) p.em = clean(m.em, 4) || p.em || '🦊'; }
function joinRoom(p, r) {
  if (p.room === r.code) return;
  if (p.room) leaveRoom(p);
  if (r.phase !== 'lobby') return send(p.c, { t: 'err', m: 'Das Spiel läuft schon.' });
  if (r.ps.size >= MAX_P) return send(p.c, { t: 'err', m: 'Raum ist voll (max. 8).' });
  addP(r, p); bc(r);
}
function addBot(r) {
  if (r.ps.size >= MAX_P) return;
  const used = new Set([...r.ps.values()].map(p => p.name)), name = BN.find(x => !used.has(x)) || 'Bot' + rnd(99);
  const id = 'bot_' + crypto.randomBytes(4).toString('hex'); r.ps.set(id, { id, name, em: BE[rnd(BE.length)], bot: true, room: r.code });
}
function onMsg(c, m) {
  if (m.t === 'hello') {
    const id = clean(m.id, 40); if (!/^[a-z0-9]{8,40}$/i.test(id)) return;
    const p = PL.get(id) || { id, name: 'Spieler', em: '🦊' }; PL.set(id, p);
    if (p.c && p.c !== c) { try { p.c.sock.end(); } catch (e) {} }
    p.c = c; c.pid = id; p.off = 0; setProfile(p, m);
    const r = getRoom(p); if (r && r.ps.has(id)) { p.gone = false; bc(r); } else p.room = null;
    return send(c, { t: 'pubs', list: pubList() });
  }
  const p = c.pid && PL.get(c.pid); if (!p) return;
  if (m.t === 'ping') return send(c, { t: 'pong' });
  if (m.t === 'list') return send(c, { t: 'pubs', list: pubList() });
  if (m.t === 'create' || m.t === 'solo') {
    setProfile(p, m); if (p.room) leaveRoom(p);
    const r = mkRoom(p, m.t === 'create' && !!m.pub);
    if (m.t === 'solo') { const n = Math.max(3, Math.min(6, +m.n || 4)); for (let i = 0; i < n; i++) addBot(r); startGame(r); } else bc(r);
    return;
  }
  if (m.t === 'join') {
    setProfile(p, m); const r = RM.get(clean(m.code, 4).toUpperCase());
    return r ? joinRoom(p, r) : send(c, { t: 'err', m: 'Raum nicht gefunden.' });
  }
  if (m.t === 'leave') { leaveRoom(p); return send(c, { t: 'left', m: '' }); }
  const r = getRoom(p); if (!r || !r.ps.has(p.id)) return;
  const isHost = r.host === p.id, ph = r.phase;
  switch (m.t) {
    case 'chat': {
      const x = clean(m.x, 120); if (!x || Date.now() - (p.lc || 0) < 300) return; p.lc = Date.now();
      r.chat.push({ u: p.id, name: p.name, em: p.em, t: Date.now(), x }); if (r.chat.length > 80) r.chat.shift(); return bc(r);
    }
    case 'tp': if (isHost && ph === 'lobby' && [20, 30, 45].includes(+m.v)) { r.tp = +m.v; bc(r); } return;
    case 'addbot': if (isHost && ph === 'lobby') { addBot(r); bc(r); } return;
    case 'kick': {
      const t = r.ps.get(m.id); if (!isHost || ph !== 'lobby' || !t || t.id === p.id) return;
      if (t.bot) { r.ps.delete(t.id); bc(r); } else { send(t.c, { t: 'left', m: 'Du wurdest vom Host entfernt.' }); leaveRoom(t); } return;
    }
    case 'start': if (isHost && ph === 'lobby' && r.ps.size >= 3) startGame(r); return;
    case 'again': if (isHost && ph === 'end') {
      for (const q of [...r.ps.values()]) if (q.gone || (!q.bot && !q.c)) r.ps.delete(q.id);
      r.phase = 'lobby'; r.roles = null; r.alive = null; r.order = null; r.last = null; r.winner = null; r.buyer = null; r.round = 0; r.alone = 0; r.end = 0;
      if (!r.ps.has(r.host)) r.host = humans(r)[0].id; bc(r);
    } return;
    case 'pick': if (ph === 'pick' && r.alive.includes(p.id) && r.prod[p.id].includes(+m.i)) { p.pick = +m.i; bc(r); } return;
    case 'pitch': if (ph === 'pitch' && r.order[r.si] === p.id) { p.pt = clean(m.x, 140); bc(r); } return;
    case 'done': if (ph === 'pitch' && r.order[r.si] === p.id) p.done = true; return;
    case 'buy': if (ph === 'buy' && r.buyer === p.id) resolve(r, m.id, ''); return;
  }
}
srv.listen(PORT, () => console.log('What a Scammer läuft auf Port ' + PORT));
module.exports = { srv };
