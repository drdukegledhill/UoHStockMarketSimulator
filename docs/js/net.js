// ---------------------------------------------------------------------------
// Networking. Two interchangeable transports with the same interface:
//
//   peer  - real devices. PeerJS (WebRTC data channels) via the free public
//           PeerJS signalling server. Needs /vendor/peerjs.min.js loaded.
//   local - rehearsal/testing. BroadcastChannel between tabs of ONE browser.
//
// A connection object looks like:
//   { id, send(obj), onMessage(fn), onClose(fn), close() }
// ---------------------------------------------------------------------------

import { NETWORK } from './config.js';

const params = new URLSearchParams(location.search);

export function netMode() {
  return params.get('net') === 'local' ? 'local' : 'peer';
}

function peerOptions() {
  const opts = structuredClone(NETWORK.peerOptions);
  // ?peer=host:port lets you point at your own PeerJS server (handy for testing).
  const custom = params.get('peer');
  if (custom) {
    const [host, port] = custom.split(':');
    Object.assign(opts, { host, port: +(port || 443), path: '/', secure: location.protocol === 'https:' && host !== 'localhost' });
  }
  return opts;
}

export const hostPeerId = (room) => NETWORK.peerIdPrefix + room.toLowerCase();

function makeConn(id, sendRaw, closeRaw) {
  const msgFns = [], closeFns = [];
  let closed = false;
  return {
    id,
    send(obj) { if (!closed) { try { sendRaw(obj); } catch (e) { /* ignore */ } } },
    onMessage(fn) { msgFns.push(fn); },
    onClose(fn) { closeFns.push(fn); },
    close() { if (!closed) { try { closeRaw(); } catch (e) { /* ignore */ } this._closed(); } },
    _msg(obj) { if (!closed) msgFns.forEach((f) => f(obj)); },
    _closed() { if (!closed) { closed = true; closeFns.forEach((f) => f()); } },
    get closed() { return closed; },
  };
}

// ============================================================ HOST
// onConnection(conn) is called for each new client. Returns { ready, close }.
// onStatus(text, level) reports signalling status for the UI.
export function createHost(room, { onConnection, onStatus = () => {} }) {
  return netMode() === 'local' ? localHost(room, onConnection, onStatus) : peerHost(room, onConnection, onStatus);
}

function peerHost(room, onConnection, onStatus) {
  let peer = null, stopped = false, retryTimer = null;
  let resolveReady, rejectReady;
  const ready = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });
  let attempts = 0;

  const start = () => {
    if (stopped) return;
    attempts++;
    onStatus('Connecting to signalling server...', 'wait');
    peer = new window.Peer(hostPeerId(room), peerOptions());
    peer.on('open', () => { attempts = 0; onStatus('Online: phones can join', 'ok'); resolveReady(); });
    peer.on('connection', (dc) => {
      const conn = makeConn(dc.peer, (o) => dc.send(o), () => dc.close());
      dc.on('data', (d) => conn._msg(d));
      dc.on('close', () => conn._closed());
      dc.on('error', () => conn._closed());
      // PeerJS can emit 'open' more than once; only hand the connection over once.
      let handed = false;
      const go = () => { if (!handed) { handed = true; onConnection(conn); } };
      if (dc.open) go(); else dc.on('open', go);
    });
    peer.on('disconnected', () => {
      // Lost the signalling server. Existing phones stay connected; new ones cannot join until we reconnect.
      if (stopped) return;
      onStatus('Signalling server lost, reconnecting...', 'warn');
      setTimeout(() => { try { if (!peer.destroyed) peer.reconnect(); } catch (e) { /* ignore */ } }, 1500);
    });
    peer.on('error', (err) => {
      if (stopped) return;
      if (err.type === 'unavailable-id') {
        // Usually a previous tab still holds the room ID for a few seconds after a refresh.
        onStatus('Room code still in use, retrying...', 'warn');
        try { peer.destroy(); } catch (e) { /* ignore */ }
        if (attempts > 20) { rejectReady(new Error('Room code is in use by another session.')); return; }
        retryTimer = setTimeout(start, 3000);
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
        onStatus('Cannot reach signalling server, retrying...', 'warn');
        try { peer.destroy(); } catch (e) { /* ignore */ }
        retryTimer = setTimeout(start, 4000);
      } else {
        console.warn('PeerJS error', err.type, err);
      }
    });
  };
  start();
  return {
    ready,
    close() { stopped = true; clearTimeout(retryTimer); try { peer?.destroy(); } catch (e) { /* ignore */ } },
  };
}

function localHost(room, onConnection, onStatus) {
  const bc = new BroadcastChannel('uoh-market-' + room);
  const conns = new Map();
  bc.onmessage = ({ data: m }) => {
    if (!m || m.to !== 'host') return;
    if (m.type === 'connect') {
      const conn = makeConn(m.from, (o) => bc.postMessage({ to: m.from, type: 'msg', data: o }), () => bc.postMessage({ to: m.from, type: 'close' }));
      conns.set(m.from, conn);
      conn.onClose(() => conns.delete(m.from));
      bc.postMessage({ to: m.from, type: 'accept' });
      onConnection(conn);
    } else if (m.type === 'msg') conns.get(m.from)?._msg(m.data);
    else if (m.type === 'close') conns.get(m.from)?._closed();
  };
  // Tell any test phones left over from a previous host tab to reconnect.
  bc.postMessage({ to: '*', type: 'restart' });
  onStatus('Rehearsal mode: same-browser tabs only', 'ok');
  return {
    ready: Promise.resolve(),
    close() { conns.forEach((c) => c.close()); bc.close(); },
  };
}

// ============================================================ CLIENT
// Resolves with a connection, rejects with Error('not-found') if no host.
export function connectToHost(room) {
  return netMode() === 'local' ? localClient(room) : peerClient(room);
}

function peerClient(room) {
  return new Promise((resolve, reject) => {
    const peer = new window.Peer(peerOptions());
    let settled = false;
    const fail = (e) => { if (!settled) { settled = true; try { peer.destroy(); } catch (x) { /* ignore */ } reject(e); } };
    const timer = setTimeout(() => fail(new Error('timeout')), 20000);
    peer.on('open', () => {
      const dc = peer.connect(hostPeerId(room), { serialization: 'json', reliable: true });
      const conn = makeConn(peer.id, (o) => dc.send(o), () => { dc.close(); peer.destroy(); });
      dc.on('open', () => { if (settled) return; settled = true; clearTimeout(timer); resolve(conn); }); // guarded: may fire twice
      dc.on('data', (d) => conn._msg(d));
      dc.on('close', () => { conn._closed(); try { peer.destroy(); } catch (x) { /* ignore */ } });
      dc.on('error', () => conn._closed());
    });
    peer.on('error', (err) => {
      if (err.type === 'peer-unavailable') fail(new Error('not-found'));
      else if (!settled) fail(new Error(err.type || 'error'));
    });
    peer.on('disconnected', () => { /* data channel may still be alive; ignore */ });
  });
}

function localClient(room) {
  return new Promise((resolve, reject) => {
    const id = 'c-' + Math.random().toString(36).slice(2, 10);
    const bc = new BroadcastChannel('uoh-market-' + room);
    const conn = makeConn(id, (o) => bc.postMessage({ to: 'host', from: id, type: 'msg', data: o }),
      () => { bc.postMessage({ to: 'host', from: id, type: 'close' }); bc.close(); });
    const timer = setTimeout(() => { bc.close(); reject(new Error('not-found')); }, 3000);
    bc.onmessage = ({ data: m }) => {
      if (m?.to === '*' && m.type === 'restart') { conn._closed(); bc.close(); return; }
      if (!m || m.to !== id) return;
      if (m.type === 'accept') { clearTimeout(timer); resolve(conn); }
      else if (m.type === 'msg') conn._msg(m.data);
      else if (m.type === 'close') { conn._closed(); bc.close(); }
    };
    addEventListener('pagehide', () => conn.close());
    bc.postMessage({ to: 'host', from: id, type: 'connect' });
  });
}
