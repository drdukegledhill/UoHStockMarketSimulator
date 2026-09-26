// Stand-alone control panel: a second window on the presenter's laptop
// (same=1, talks over BroadcastChannel) or the presenter's phone (PeerJS).
import { mountControls } from './controls.js';
import { connectToHost } from './net.js';
import { $, toast } from './ui.js';
import { mountFooter } from './footer.js';

mountFooter('control');

const q = new URLSearchParams(location.search);
const room = (q.get('room') || '').toUpperCase();
const key = q.get('key') || '';
const same = q.get('same') === '1';
const statusEl = $('#conn');

if (!room || !key) {
  $('#panel').innerHTML = '<div class="ctl"><h2>Control panel</h2><p>Open this page from the big screen\'s control panel so it carries the room code and key.</p></div>';
} else if (same) {
  const id = 'ctl-' + Math.random().toString(36).slice(2, 8);
  const bc = new BroadcastChannel(`uoh-market-ctl-${room}`);
  const render = mountControls($('#panel'), (cmd) => bc.postMessage({ type: 'cmd', key, from: id, cmd }));
  let last = 0;
  bc.onmessage = ({ data: m }) => {
    if (m?.type === 'state') { last = Date.now(); render(m.state); statusEl.textContent = 'Connected to the big screen'; }
    if (m?.type === 'result' && m.to === id && m.res?.msg) toast(m.res.msg);
  };
  setInterval(() => { if (Date.now() - last > 4000) statusEl.textContent = 'Waiting for the big screen tab...'; }, 2000);
} else {
  let render = null, conn = null;
  const send = (cmd) => conn ? conn.send({ t: 'cmd', cmd }) : toast('Not connected');
  const go = async () => {
    statusEl.textContent = 'Connecting...';
    try {
      conn = await connectToHost(room);
      conn.onMessage((m) => {
        if (m.t === 'ctl-ok' || m.t === 'ctl-state') {
          if (!render) render = mountControls($('#panel'), send);
          render(m.state);
          statusEl.textContent = 'Connected';
        } else if (m.t === 'ctl-deny') {
          statusEl.textContent = 'Wrong key: open the latest remote QR code from the big screen.';
        } else if (m.t === 'ctl-result' && m.res?.msg) toast(m.res.msg);
      });
      conn.onClose(() => { conn = null; statusEl.textContent = 'Disconnected, retrying...'; setTimeout(go, 2000); });
      conn.send({ t: 'ctl-hello', key });
    } catch (e) {
      statusEl.textContent = e.message === 'not-found' ? `Room ${room} not found, retrying...` : 'Cannot connect, retrying...';
      setTimeout(go, 3000);
    }
  };
  go();
}
