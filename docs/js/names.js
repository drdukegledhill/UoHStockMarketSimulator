// ---------------------------------------------------------------------------
// Trader names: a friendly generator plus a basic filter for custom names.
// The filter is deliberately simple. Extend BLOCKED if you enable custom names.
// ---------------------------------------------------------------------------

const ADJ = [
  'Bullish', 'Bearish', 'Savvy', 'Canny', 'Nifty', 'Plucky', 'Steady', 'Shrewd', 'Bold', 'Cautious',
  'Lucky', 'Swift', 'Golden', 'Thrifty', 'Mighty', 'Clever', 'Daring', 'Nimble', 'Brave', 'Calm',
  'Sharp', 'Keen', 'Wily', 'Zippy', 'Frugal', 'Gutsy', 'Chilled', 'Speedy', 'Wise', 'Jolly',
];
const ANIMAL = [
  'Badger', 'Heron', 'Otter', 'Fox', 'Hare', 'Owl', 'Falcon', 'Puffin', 'Stoat', 'Kestrel',
  'Hedgehog', 'Lynx', 'Bison', 'Panda', 'Raven', 'Walrus', 'Llama', 'Gecko', 'Beaver', 'Moose',
  'Magpie', 'Robin', 'Bull', 'Bear', 'Wolf', 'Seal', 'Swan', 'Tiger', 'Penguin', 'Koala',
];

export function randomName(taken = new Set()) {
  for (let i = 0; i < 50; i++) {
    const n = `${ADJ[Math.floor(Math.random() * ADJ.length)]} ${ANIMAL[Math.floor(Math.random() * ANIMAL.length)]}`;
    if (!taken.has(n)) return n;
  }
  return `Trader ${Math.floor(100 + Math.random() * 900)}`;
}

// Common English profanity and slurs, stored lightly obfuscated as reversed
// strings so the source file stays readable in a classroom.
const BLOCKED = [
  'kcuf', 'tihs', 'tnuc', 'hctib', 'dratsab', 'kcid', 'kcoc', 'ssip', 'esra', 'knaw', 'tawt',
  'tuls', 'erohw', 'nrop', 'xes', 'ynroh', 'sinep', 'anigav', 'reggin', 'aggin', 'toggaf', 'gaf',
  'drater', 'citsaps', 'ikap', 'knihc', 'nooc', 'izan', 'reltih', 'elohssa', 'skcollob', 'kcirp',
  'stit', 'boob', 'bonk', 'dnelleb', 'egnim', 'ekyd', 'ynnart', 'epar',
];
const blocked = BLOCKED.map((w) => w.split('').reverse().join('')).filter((w) => w.length >= 3);
// Words that contain a blocked fragment but are fine.
const ALLOW = ['scunthorpe', 'cockburn', 'hancock', 'peacock', 'cockatoo', 'cockerel', 'dickens', 'sussex', 'essex', 'middlesex',
  'grape', 'drape', 'scrape', 'trapeze', 'raccoon', 'cocoon', 'tycoon', 'sextant', 'knobbly', 'shitake', 'titsworth'];

function normalise(s) {
  return s.toLowerCase()
    .replace(/0/g, 'o').replace(/@/g, 'a').replace(/[1!|]/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a')
    .replace(/[5$]/g, 's').replace(/7/g, 't').replace(/8/g, 'b')
    .replace(/[^a-z]/g, '');
}

export function isGeneratedName(name) {
  const m = /^(\w+) (\w+)( \d+)?$/.exec(String(name || ''));
  return !!m && ADJ.includes(m[1]) && ANIMAL.includes(m[2]);
}

export function cleanName(raw) {
  const name = String(raw || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);
  if (name.length < 2) return { ok: false, msg: 'Name is too short.' };
  let flat = normalise(name);
  for (const a of ALLOW) flat = flat.split(a).join('');
  if (blocked.some((b) => flat.includes(b))) return { ok: false, msg: 'Please choose a different name.' };
  return { ok: true, name };
}
