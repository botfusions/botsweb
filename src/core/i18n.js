// TR is the default; EN is chosen via the header toggle and remembered in localStorage.
let l = 'tr';
try { if (localStorage.getItem('lang') === 'en') l = 'en'; } catch {}
export const lang = l;
document.documentElement.lang = lang;

export function setLang(next) {
  try { localStorage.setItem('lang', next); } catch {}
  location.reload();
}
