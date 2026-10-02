// Adds the version number (bottom left) and copyright (bottom right) to a page.
import { VERSION, RELEASED, CREDIT } from './version.js';

export function mountFooter(variant = 'page') {
  if (document.querySelector('.credit')) return;
  const f = document.createElement('footer');
  f.className = `credit credit-${variant}`;
  const ver = document.createElement('span');
  ver.className = 'credit-ver';
  ver.textContent = `v${VERSION}`;
  ver.title = `Market Challenge v${VERSION}, released ${RELEASED}`;
  const copy = document.createElement('span');
  copy.className = 'credit-copy';
  const a = document.createElement('a');
  a.href = CREDIT.url;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = CREDIT.name;
  copy.append(`Concept by ${CREDIT.concept} · Developed by `, a, ` © ${CREDIT.year}`);
  f.append(ver, copy);
  document.body.appendChild(f);
  return f;
}
