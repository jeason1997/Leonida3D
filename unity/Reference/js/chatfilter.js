// Chat safety, shared by the page (chat.js, ui.js) and the worker (worker/index.js imports this file,
// so the server's copy is the one that counts): censor() stars out the f-slur and the hard-R n-word,
// however they're dressed up - capitals, accents, look-alike letters (Cyrillic, fullwidth, maths
// alphabets), leetspeak (n1gg3r, f@g), repeated letters, letters split by dots / dashes / spaces /
// emoji / invisible characters. Words that only look close stay: snigger, Niger, niggardly, FAQ, flag.

// look-alikes and leetspeak -> the letter they stand for (after accents are stripped and lowercased)
const SAME = {
  0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 6: 'g', 7: 't', 9: 'g',
  'ı': 'i', 'ł': 'l', 'ø': 'o', 'ð': 'd', 'ŋ': 'n', 'ƒ': 'f',
  'а': 'a', 'е': 'e', 'ё': 'e', 'о': 'o', 'і': 'i', 'ї': 'i', 'ӏ': 'i', 'п': 'n', 'т': 't', 'ғ': 'f',
  'н': 'n', 'и': 'i', 'г': 'g', 'р': 'r', 'ф': 'f',   // Cyrillic spelled out (н и г г е р)
  'ԍ': 'g', 'ց': 'g', 'ո': 'n', 'ɡ': 'g', 'ɢ': 'g', 'ɴ': 'n', 'ʀ': 'r', 'ꜰ': 'f', 'ᴀ': 'a', 'ɪ': 'i', 'ᴇ': 'e', 'ᴏ': 'o', 'ᴛ': 't',
  'α': 'a', 'ε': 'e', 'ι': 'i', 'ο': 'o', 'τ': 't', 'η': 'n', 'ϝ': 'f',
};
// symbols that stand for a letter only inside a word ("n!gger", "f@g"), not as punctuation ("you!")
const SYM = { '@': 'a', '^': 'a', '!': 'i', '|': 'i', '¡': 'i', '€': 'e', '£': 'e', '$': 's', '+': 't' };

// the patterns, on letters only (l and y pass for i, q for g)
const I = '[ily]', G = '[gq]';
const NWORD = new RegExp(`n+${I}+${G}{2,}(?:e+|u+)r+`, 'g');           // also across split words
const FAGGOT = new RegExp(`f+a+${G}{2,}(?:o+|${I}+|e+|u+)t+`, 'g');    // also across split words
const IN_WORD = [new RegExp(`f+a+g+(?:o+|${I}+|e+)t+`, 'g'), new RegExp(`f+a+${G}{2,}`, 'g')];   // fagot, fagg...
const WHOLE_WORD = /^f+a+g+[sz]*$/;                                     // fag, fags (not faq)
const SPELLED = /f+a+g+/g;                                              // f a g, f.a.g

// one code point -> the plain lowercase letters it reads as ('' for invisible characters)
function plain(c) {
  if (/[\p{Cf}\p{Mn}͏ᅟᅠㅤﾠ]/u.test(c)) return '';
  const p = c.normalize('NFKD').toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');
  return [...p].map((ch) => SAME[ch] ?? ch).join('');
}
const isWordChar = (ch) => /[\p{L}\p{N}]/u.test(ch);

// The words of a message: [{ s: letters, at: [code point index of each letter] }]. Anything that isn't
// a letter or digit splits words; invisible characters don't.
function words(cps) {
  const flat = [];   // { ch, at } with invisible characters gone
  cps.forEach((c, i) => { for (const ch of plain(c)) flat.push({ ch, at: i }); });
  const out = [];
  let cur = null;
  flat.forEach(({ ch, at }, k) => {
    let w = isWordChar(ch) ? ch : null;
    if (!w && SYM[ch] && isWordChar(flat[k - 1]?.ch ?? '') && isWordChar(flat[k + 1]?.ch ?? '')) w = SYM[ch];
    if (w) {
      if (!cur) out.push(cur = { s: '', at: [] });
      cur.s += w;
      cur.at.push(at);
    } else cur = null;
  });
  return out;
}

// the message with every slur word starred out (the whole word, so no "******s")
export function censor(text) {
  const cps = Array.from(String(text ?? ''));
  const ws = words(cps);
  if (!ws.length) return cps.join('');
  const bad = new Set();   // indexes into ws
  // every word run together, with which word each letter came from
  let all = '';
  const of = [];
  ws.forEach((w, n) => { all += w.s; for (let k = 0; k < w.s.length; k++) of.push(n); });
  const hit = (re, s, base, ok = () => true) => {
    re.lastIndex = 0;
    for (let m; (m = re.exec(s));) {
      if (ok(m, base)) for (let k = m.index; k < m.index + m[0].length; k++) bad.add(of[base + k]);
      if (!m[0].length) re.lastIndex++;
    }
  };
  // "snigger" is a word: an s in the same word right before the n lets it through
  hit(NWORD, all, 0, (m) => !(m.index > 0 && all[m.index - 1] === 's' && of[m.index - 1] === of[m.index]));
  hit(FAGGOT, all, 0);
  let base = 0;
  ws.forEach((w, n) => {
    for (const re of IN_WORD) hit(re, w.s, base);
    if (WHOLE_WORD.test(w.s)) bad.add(n);
    base += w.s.length;
  });
  // single letters with gaps between them ("f a g"): run together and searched
  for (let n = 0, start = 0; n <= ws.length; n++) {
    if (n < ws.length && ws[n].s.length === 1) continue;
    if (n - start >= 2) {
      const run = ws.slice(start, n).map((w) => w.s).join('');
      SPELLED.lastIndex = 0;
      for (let m; (m = SPELLED.exec(run));) for (let k = m.index; k < m.index + m[0].length; k++) bad.add(start + k);
    }
    start = n + 1;
  }
  if (!bad.size) return cps.join('');
  for (const n of bad) {
    const at = ws[n].at;
    for (let i = at[0]; i <= at[at.length - 1]; i++) if (!/\s/u.test(cps[i])) cps[i] = '*';
  }
  return cps.join('');
}

export const hasSlur = (text) => censor(text) !== String(text ?? '');
