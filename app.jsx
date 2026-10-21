const { useState, useMemo, useEffect, useRef } = React;

/* ---------- constants & helpers ---------- */
const STANDARD = ['Reading', 'Math', 'Algebra', 'Math (Spanish)'];
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const cmp = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
let _uid = 0;
const uid = () => 't' + (++_uid);

const normId = (s) => String(s ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase().replace(/^0+(?=.)/, '');
const nameKey = (n) => {
  let s = String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[.']/g, '').trim();
  if (s.includes(',')) { const [l, ...r] = s.split(','); s = r.join(' ') + ' ' + l; }
  return s.split(/[^a-z0-9]+/).filter(Boolean).sort().join(' ');
};

const ROSTER_FIELDS = [
  { key: 'id', label: 'Student ID', aliases: ['studentid', 'studentidnumber', 'osis', 'osisnumber', 'studentnumber', 'studentno', 'idnumber', 'id', 'nycid'], roots: ['studentid', 'osis', 'idnumber', 'studentnum'] },
  { key: 'first', label: 'First name', aliases: ['firstname', 'first', 'studentfirstname', 'givenname', 'fname'], roots: ['firstname'] },
  { key: 'last', label: 'Last name', aliases: ['lastname', 'last', 'studentlastname', 'surname', 'familyname', 'lname'], roots: ['lastname', 'surname'] },
  { key: 'name', label: 'Full name', aliases: ['studentname', 'fullname', 'name', 'student', 'pupilname'], roots: ['name'], excl: ['teacher', 'class', 'first', 'last', 'parent', 'guardian', 'course'] },
  { key: 'cls', label: 'Class / Period', aliases: ['classperiod', 'classorperiod', 'class', 'period', 'section', 'classname', 'officialclass', 'classsection', 'homeroom', 'course', 'coursesection'], roots: ['class', 'period', 'section'] },
  { key: 'teacher', label: 'Teacher', aliases: ['teachername', 'teacher', 'instructor', 'advisor', 'classroomteacher', 'homeroomteacher'], roots: ['teacher', 'instructor'] },
  { key: 'grade', label: 'Grade', aliases: ['gradelevel', 'grade', 'gr', 'currentgrade', 'studentgrade'], roots: ['grade'] },
];
const NWEA_FIELDS = [
  { key: 'id', label: 'Student ID', aliases: ROSTER_FIELDS[0].aliases, roots: ROSTER_FIELDS[0].roots },
  { key: 'first', label: 'First name', aliases: ROSTER_FIELDS[1].aliases, roots: ROSTER_FIELDS[1].roots },
  { key: 'last', label: 'Last name', aliases: ROSTER_FIELDS[2].aliases, roots: ROSTER_FIELDS[2].roots },
  { key: 'name', label: 'Full name', aliases: ROSTER_FIELDS[3].aliases, roots: ['name'], excl: ['teacher', 'class', 'first', 'last', 'parent', 'guardian', 'test', 'course', 'subject'] },
  { key: 'subject', label: 'Subject', aliases: ['subject', 'course', 'discipline', 'testname', 'test', 'measurementscale', 'assessment', 'testtype', 'area', 'subjectarea', 'coursename'], roots: ['subject', 'discipline', 'measurementscale', 'testname'] },
  { key: 'status', label: 'Status', aliases: ['status', 'teststatus', 'validity', 'validationstatus', 'validationresult', 'testvalidity', 'result', 'testresult', 'resultstatus', 'flag', 'issue', 'reason', 'sessionstatus', 'testeventstatus', 'eventstatus', 'invalidreason', 'incompletereason', 'category', 'problem'], roots: ['status', 'validity', 'invalid', 'incomplete', 'reason', 'issue'] },
];

function autoMap(headers, fields) {
  const hn = headers.map(norm); const used = new Set(); const m = {};
  for (const f of fields) {
    let idx = -1;
    for (const a of f.aliases) { idx = hn.findIndex((h, i) => !used.has(i) && h === a); if (idx >= 0) break; }
    if (idx < 0 && f.roots) idx = hn.findIndex((h, i) => !used.has(i) && h && f.roots.some((r) => h.includes(r)) && !(f.excl || []).some((x) => h.includes(x)));
    m[f.key] = idx; if (idx >= 0) used.add(idx);
  }
  return m;
}

function subjectFromText(t) {
  const s = String(t || '').toLowerCase();
  if (!s.trim()) return null;
  const sp = /spanish|espa[nñ]ol|\(sp\)|\bsp\b|lectura|matem[aá]ticas/.test(s);
  if (/algebra/.test(s)) return 'Algebra';
  if (/math|matem/.test(s)) return sp ? 'Math (Spanish)' : 'Math';
  if (/read|lectura|\bela\b/.test(s)) return 'Reading';
  return null;
}
function resolveSubject(cell, sheetName, fileName) {
  const c = String(cell || '').trim();
  if (c) return subjectFromText(c) || c;
  return subjectFromText(sheetName) || subjectFromText(fileName) || 'Unspecified';
}
function classifyStatus(t) {
  const s = String(t || '').toLowerCase();
  if (!s.trim()) return null;
  if (/invalid|not valid|void|rapid.?guess|disengag/.test(s)) return 'invalid';
  if (/incomplete|in.?progress|suspend|not complete|not finish|unfinish|partial|paused|terminat|not started|did not|abandon/.test(s)) return 'incomplete';
  if (/complete|valid|\bok\b|pass/.test(s)) return 'complete';
  return null;
}
const statusHint = (s) => { const x = String(s).toLowerCase(); return /invalid/.test(x) ? 'invalid' : /incomplete|in.?progress/.test(x) ? 'incomplete' : null; };
const cleanDetail = (t) => { const s = String(t || '').trim(); return /^(invalid|incomplete)$/i.test(s) ? '' : s.slice(0, 80); };
const wideColsOf = (headers) => { const out = []; headers.forEach((h, i) => { const s = subjectFromText(h); if (s && String(h).length <= 32) out.push([i, s]); }); return out; };

function makeTable(fileName, sheetName, matrix, fields) {
  const all = new Set(fields.flatMap((f) => f.aliases));
  let bi = 0, best = 0;
  matrix.slice(0, 25).forEach((row, i) => { const sc = row.filter((c) => all.has(norm(c))).length; if (sc > best) { best = sc; bi = i; } });
  const headers = matrix[bi].map((h, i) => String(h).trim() || `Column ${i + 1}`);
  const rows = matrix.slice(bi + 1).filter((r) => r.some((c) => String(c).trim() !== ''));
  return { uid: uid(), fileName, sheetName, headers, rows, mapping: autoMap(headers, fields), wide: wideColsOf(headers), defStatus: 'none' };
}
/* ---- PDF reading: rebuild table rows from text positions ---- */
async function pdfLines(file) {
  if (!window.pdfjsLib) throw new Error('The PDF reader did not load. Reload the page and try again.');
  if (!window.__pdfWorkerSrc) {
    const url = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    try { const r = await fetch(url); if (!r.ok) throw new Error(r.status); window.__pdfWorkerSrc = URL.createObjectURL(await r.blob()); }
    catch (e) { window.__pdfWorkerSrc = url; }
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc = window.__pdfWorkerSrc;
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items.filter((i) => i.str && i.str.trim() !== '').map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width || 0 }));
    items.sort((a, b) => b.y - a.y);
    const clusters = [];
    for (const it of items) {
      const c = clusters[clusters.length - 1];
      if (c && Math.abs(c.y - it.y) <= 3) c.items.push(it); else clusters.push({ y: it.y, items: [it] });
    }
    for (const c of clusters) {
      c.items.sort((a, b) => a.x - b.x);
      const cells = []; let cur = null;
      for (const it of c.items) {
        if (cur && it.x - cur.end <= 9) { cur.text += (it.x - cur.end > 1.5 ? ' ' : '') + it.s; cur.end = it.x + it.w; }
        else { cur = { text: it.s, x: it.x, end: it.x + it.w }; cells.push(cur); }
      }
      cells.forEach((x) => { x.text = x.text.replace(/\s+/g, ' ').trim(); });
      lines.push({ cells, text: cells.map((x) => x.text).join(' ') });
    }
  }
  if (!lines.length) throw new Error('This PDF has no selectable text (it may be a scan). Download the report as CSV or Excel instead.');
  return lines;
}
function pdfTableMatrix(lines, fields) {
  const all = new Set(fields.flatMap((f) => f.aliases));
  let bi = -1, best = 0;
  lines.slice(0, 60).forEach((L, i) => { const sc = L.cells.filter((c) => all.has(norm(c.text))).length; if (sc > best) { best = sc; bi = i; } });
  if (best < 2) return null;
  const head = lines[bi]; const hkey = head.cells.map((c) => norm(c.text)).join('|');
  const colX = head.cells.map((c) => c.x);
  const matrix = [head.cells.map((c) => c.text)];
  for (const L of lines.slice(bi + 1)) {
    if (L.cells.length < 2) continue;
    if (L.cells.map((c) => norm(c.text)).join('|') === hkey) continue;
    let row;
    if (L.cells.length === colX.length) row = L.cells.map((c) => c.text);
    else {
      row = colX.map(() => '');
      for (const c of L.cells) { let j = 0; colX.forEach((x, k) => { if (c.x >= x - 12) j = k; }); row[j] = (row[j] ? row[j] + ' ' : '') + c.text; }
    }
    matrix.push(row);
  }
  return matrix.length > 1 ? matrix : null;
}
function pdfTextMatrix(lines) {
  const out = [['Student ID', 'Student Name', 'Subject', 'Status']];
  let secSubject = '', secStatus = '';
  const NAME = /([A-Za-zÀ-ÿ'’-]+(?: [A-Za-zÀ-ÿ'’-]+)*,\s*[A-Za-zÀ-ÿ'’-]+(?: [A-Za-zÀ-ÿ'’-]+)?)/;
  for (const L of lines) {
    const t = L.text; const idm = t.match(/\b\d{6,10}\b/);
    if (!idm) {
      if (t.length < 80) { const s = subjectFromText(t); if (s) secSubject = s; const st = classifyStatus(t); if (st === 'invalid' || st === 'incomplete') secStatus = st; }
      continue;
    }
    const nm = t.replace(idm[0], ' ').match(NAME);
    const st = classifyStatus(t.replace(nm ? nm[1] : '', ' ')) || secStatus;
    if (st === 'complete') continue;
    out.push([idm[0], nm ? nm[1] : '', subjectFromText(t) || secSubject, st === 'invalid' ? 'Invalid' : st === 'incomplete' ? 'Incomplete' : '']);
  }
  return out;
}
async function pdfToMatrix(file, fields, textFallback) {
  const lines = await pdfLines(file);
  const t = pdfTableMatrix(lines, fields);
  if (t) return t;
  if (textFallback) { const x = pdfTextMatrix(lines); if (x.length > 1) return x; }
  return lines.map((L) => L.cells.map((c) => c.text)).filter((r) => r.length > 1);
}

async function readTables(file, fields, textFallback) {
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
    const matrix = await pdfToMatrix(file, fields, textFallback);
    return matrix.length > 1 ? [{ sheetName: 'PDF', matrix }] : [];
  }
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  return wb.SheetNames
    .map((n) => ({ sheetName: n, matrix: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '', blankrows: false }) }))
    .filter((t) => t.matrix.length > 1);
}
const hasWho = (m) => m.id >= 0 || m.name >= 0 || m.last >= 0;
async function parseRoster(file) {
  const tabs = await readTables(file, ROSTER_FIELDS, false);
  let best = null;
  for (const t of tabs) {
    const tbl = makeTable(file.name, t.sheetName, t.matrix, ROSTER_FIELDS);
    const score = (hasWho(tbl.mapping) ? 100000 : 0) + tbl.rows.length;
    if (!best || score > best.score) best = { tbl, score };
  }
  if (!best) throw new Error('No rows found in ' + file.name);
  return best.tbl;
}
async function parseNwea(file) {
  const tabs = await readTables(file, NWEA_FIELDS, true);
  const tables = [], skipped = [];
  for (const t of tabs) {
    const tbl = makeTable(file.name, t.sheetName, t.matrix, NWEA_FIELDS);
    if (hasWho(tbl.mapping)) tables.push(tbl); else skipped.push(t.sheetName);
  }
  return { tables, skipped };
}

/* ---------- core matching ---------- */
const deriveGrade = (cls) => { const m = String(cls).match(/^\s*([5-8])(?=\d{2}|-)/); return m ? m[1] : ''; };
function buildRecords(table) {
  if (!table) return [];
  const m = table.mapping; const g = (r, k) => (m[k] >= 0 ? String(r[m[k]] ?? '').trim() : '');
  const out = []; const seen = new Set();
  for (const r of table.rows) {
    let name = g(r, 'name'); const first = g(r, 'first'), last = g(r, 'last');
    if (!name && (first || last)) name = first && last ? `${last}, ${first}` : last || first;
    const rawId = g(r, 'id'); const id = normId(rawId);
    if (!name && !id) continue;
    const skey = id ? 'i:' + id : 'n:' + nameKey(name);
    const cls = g(r, 'cls') || 'Unassigned';
    const rkey = skey + '|' + cls;
    if (seen.has(rkey)) continue; seen.add(rkey);
    out.push({ rkey, skey, id, rawId, name: name || '(no name)', cls, teacher: g(r, 'teacher') || 'Unassigned', grade: g(r, 'grade') || deriveGrade(cls) });
  }
  return out;
}

function buildExceptions(tables, students) {
  const byId = new Map(), byName = new Map();
  for (const s of students) {
    if (s.id) byId.set(s.id, s.skey);
    const nk = nameKey(s.name);
    if (nk) { if (!byName.has(nk)) byName.set(nk, new Set()); byName.get(nk).add(s.skey); }
  }
  const exc = new Map(), unmatched = [];
  const info = { rows: 0, byId: 0, byName: 0, skipped: 0, skippedComplete: 0 };
  const add = (skey, subject, status, detail, file) => {
    let m = exc.get(skey); if (!m) { m = new Map(); exc.set(skey, m); }
    const cur = m.get(subject);
    if (!cur) m.set(subject, { status, details: detail ? [detail] : [], files: [file] });
    else {
      if (status === 'invalid') cur.status = 'invalid';
      if (detail && !cur.details.includes(detail)) cur.details.push(detail);
      if (!cur.files.includes(file)) cur.files.push(file);
    }
  };
  for (const t of tables) {
    const m = t.mapping; const get = (r, k) => (m[k] >= 0 ? String(r[m[k]] ?? '').trim() : '');
    const hint = statusHint(t.fileName + ' ' + t.sheetName);
    const wideMode = m.subject < 0 && m.status < 0 && t.wide.length > 0;
    for (const r of t.rows) {
      let name = get(r, 'name'); const first = get(r, 'first'), last = get(r, 'last');
      if (!name && (first || last)) name = first && last ? `${last}, ${first}` : last || first;
      const rawId = get(r, 'id'); const id = normId(rawId);
      if (!id && !name) continue;
      let skey = null, via = null;
      if (id && byId.has(id)) { skey = byId.get(id); via = 'id'; }
      else if (name) { const set = byName.get(nameKey(name)); if (set && set.size === 1) { skey = [...set][0]; via = 'name'; } }
      const entries = [];
      if (wideMode) { for (const [ci, subj] of t.wide) { const v = String(r[ci] ?? '').trim(); if (v) entries.push({ subject: subj, text: v }); } }
      else entries.push({ subject: resolveSubject(m.subject >= 0 ? get(r, 'subject') : '', t.sheetName, t.fileName), text: m.status >= 0 ? get(r, 'status') : r.join(' ') });
      for (const e of entries) {
        let status = classifyStatus(e.text);
        if (status === 'complete') { info.skippedComplete++; continue; }
        if (!status) status = hint || (t.defStatus && t.defStatus !== 'none' ? t.defStatus : null);
        if (!status) { info.skipped++; continue; }
        info.rows++;
        const detail = (m.status >= 0 || wideMode) ? cleanDetail(e.text) : '';
        if (skey) { add(skey, e.subject, status, detail, t.fileName); if (via === 'id') info.byId++; else info.byName++; }
        else unmatched.push({ name, id: rawId, subject: e.subject, status, file: t.fileName });
      }
    }
  }
  return { exc, unmatched, info };
}

function buildExempt(table, students) {
  const keys = new Set(), unmatched = [];
  if (!table) return { keys, unmatched };
  const byId = new Map(), byName = new Map();
  for (const s of students) {
    if (s.id) byId.set(s.id, s.skey);
    const nk = nameKey(s.name);
    if (nk) { if (!byName.has(nk)) byName.set(nk, new Set()); byName.get(nk).add(s.skey); }
  }
  const m = table.mapping; const get = (r, k) => (m[k] >= 0 ? String(r[m[k]] ?? '').trim() : '');
  for (const r of table.rows) {
    let name = get(r, 'name'); const first = get(r, 'first'), last = get(r, 'last');
    if (!name && (first || last)) name = first && last ? `${last}, ${first}` : last || first;
    const rawId = get(r, 'id'); const id = normId(rawId);
    if (!id && !name) continue;
    let skey = null;
    if (id && byId.has(id)) skey = byId.get(id);
    else if (name) { const set = byName.get(nameKey(name)); if (set && set.size === 1) skey = [...set][0]; }
    if (skey) keys.add(skey); else unmatched.push(name || rawId);
  }
  return { keys, unmatched };
}
const EXEMPT_CHOICES = ['Math', 'Algebra', 'Math (Spanish)'];

/* ---------- file download (standard browser download) ---------- */
function downloadFile(filename, data) {
  const type = /\.xlsx$/i.test(filename) ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : /\.pdf$/i.test(filename) ? 'application/pdf' : 'text/csv;charset=utf-8';
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ---------- sample data (invented people) ---------- */
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function makeSample() {
  const FIRST = ['Aaliyah', 'Mateo', 'Priya', 'Jamal', 'Sofia', 'Wei', 'Noah', 'Imani', 'Diego', 'Hana', 'Omar', 'Lucia', 'Kenji', 'Amara', 'Mohamed', 'Elena', 'Tyrese', 'Mei', 'Santiago', 'Fatima', 'Luca', 'Zoe', 'Andre', 'Camila', 'Rohan', 'Nadia', 'Ethan', 'Valentina', 'Malik', 'Chloe', 'Yusuf', 'Isabella'];
  const LAST = ['Rivera', 'Chen', 'Patel', 'Johnson', 'Gomez', 'Li', 'Okafor', 'Williams', 'Hernandez', 'Nakamura', 'Haddad', 'Brennan', 'Singh', 'Martinez', 'Kim', 'Thompson', 'Lopez', 'Zhang', 'Ahmed', 'Garcia', 'Nguyen', 'Robinson', 'Torres', 'Wong', 'Diallo', 'Santos', 'Park', 'Reyes', 'Brooks', 'Sanchez', 'Cohen', 'Flores'];
  const rnd = mulberry32(20261020); const pick = (a) => a[Math.floor(rnd() * a.length)];
  const classes = [
    ['6-101 · Period 1', 'Ms. Okafor', 6], ['6-102 · Period 2', 'Mr. Delgado', 6],
    ['7-201 · Period 3', 'Ms. Whitfield', 7], ['7-202 · Period 4', 'Mr. Nakamura', 7],
    ['8-301 · Period 1', 'Ms. Haddad', 8], ['8-302 · Period 5', 'Mr. Brennan', 8], ['8-303 · Period 6', 'Ms. Whitfield', 8],
  ];
  const names = new Set(), ids = new Set(), students = [];
  classes.forEach(([cls, teacher, grade]) => {
    for (let k = 0; k < 14; k++) {
      let nm; do { nm = pick(LAST) + ', ' + pick(FIRST); } while (names.has(nm)); names.add(nm);
      let id; do { id = String(300000000 + Math.floor(rnd() * 99999999)); } while (ids.has(id)); ids.add(id);
      students.push({ id, nm, cls, teacher, grade });
    }
  });
  const rosterMatrix = [['Student ID', 'Student Name', 'Class / Period', 'Teacher Name', 'Grade Level'], ...students.map((s) => [s.id, s.nm, s.cls, s.teacher, String(s.grade)])];
  const alg = new Set(['8-301 · Period 1', '8-303 · Period 6']);
  const dt = () => `10/${String(1 + Math.floor(rnd() * 16)).padStart(2, '0')}/2026`;
  const INV = ['Invalid – rapid guessing', 'Invalid – test duration too short', 'Invalid'];
  const INC = ['Incomplete – suspended', 'Incomplete – in progress', 'Incomplete'];
  const rows = [];
  const flag = (s, subject) => rows.push([s.id, s.nm, subject, rnd() < 0.45 ? pick(INV) : pick(INC), dt()]);
  students.forEach((s, i) => {
    if (i % 19 === 4) { flag(s, 'Math (Spanish)'); return; }
    if (rnd() < 0.14) flag(s, 'Reading');
    if (rnd() < 0.12) flag(s, alg.has(s.cls) ? 'Algebra' : 'Math');
  });
  rows.push(['', students[10].nm, 'Reading', 'Incomplete – suspended', dt()]);
  rows.push(['399000123', 'Alvarez, Marisol', 'Math', 'Invalid – rapid guessing', dt()]);
  const neweaMatrix = [['Student ID', 'Student Name', 'Subject', 'Test Status', 'Test Date'], ...rows];
  const exStu = students.filter((s) => alg.has(s.cls)).slice(0, 7);
  const flaggedAlg = rows.find((r) => r[2] === 'Algebra');
  if (flaggedAlg) { const s = students.find((x) => x.id === flaggedAlg[0]); if (s && !exStu.includes(s)) exStu.push(s); }
  const exMatrix = [['Student ID', 'Student Name', 'Grade Level', 'Exam'], ...exStu.map((s) => [s.id, s.nm, String(s.grade), 'Algebra I Regents'])];
  return {
    demo: true,
    exempt: makeTable('sample_math_regents_list.csv', 'Sheet1', exMatrix, ROSTER_FIELDS),
    roster: makeTable('sample_master_roster.csv', 'Sheet1', rosterMatrix, ROSTER_FIELDS),
    nwea: [makeTable('sample_nwea_exceptions.xlsx', 'Sheet1', neweaMatrix, NWEA_FIELDS)],
  };
}

/* ---------- exports ---------- */
const EXPORT_HEAD = ['Teacher', 'Class / Period', 'Grade', 'Student ID', 'Student Name', 'Subject', 'Status', 'Action', 'Details', 'Makeup Date', 'Room / Proctor', 'Done'];
function csvOf(aoa) {
  const q = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return '﻿' + aoa.map((r) => r.map(q).join(',')).join('\r\n');
}
const tsvOf = (aoa) => aoa.map((r) => r.map((v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');
function seatsAoa(items, subjectsAll) {
  const subs = subjectsAll.filter((s) => items.some((x) => x.subject === s));
  const map = new Map();
  for (const x of items) {
    const k = x.teacher + '||' + x.cls;
    if (!map.has(k)) map.set(k, { teacher: x.teacher, cls: x.cls, counts: {}, students: new Set(), tests: 0 });
    const e = map.get(k); e.counts[x.subject] = (e.counts[x.subject] || 0) + 1; e.students.add(x.skey); e.tests++;
  }
  const list = [...map.values()].sort((a, b) => cmp(a.teacher, b.teacher) || cmp(a.cls, b.cls));
  const aoa = [['Teacher', 'Class / Period', ...subs, 'Tests', 'Students']];
  list.forEach((e) => aoa.push([e.teacher, e.cls, ...subs.map((s) => e.counts[s] || ''), e.tests, e.students.size]));
  aoa.push(['Total', '', ...subs.map((s) => items.filter((x) => x.subject === s).length), items.length, new Set(items.map((x) => x.skey)).size]);
  return aoa;
}
function workbookOf(aoa, seats) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [16, 20, 7, 12, 26, 18, 11, 20, 30, 13, 16, 7].map((w) => ({ wch: w }));
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: aoa[0].length - 1 } }) };
  XLSX.utils.book_append_sheet(wb, ws, 'Makeup Roster');
  const ws2 = XLSX.utils.aoa_to_sheet(seats);
  ws2['!cols'] = seats[0].map((_, i) => ({ wch: i < 2 ? 20 : 12 }));
  XLSX.utils.book_append_sheet(wb, ws2, 'Tests by Class');
  return new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }));
}

/* ---------- small UI pieces ---------- */
const IconCheck = () => (<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.5 6.3l2.2 2.2 4.8-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>);
const IconCross = () => (<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>);
const IconHalf = () => (<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M6 1.4a4.6 4.6 0 0 1 0 9.2z" fill="currentColor" /></svg>);
const IconDash = () => (<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.8 6h6.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>);
const IconUp =() => (<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M12 16V5m0 0l-4 4m4-4l4 4M5 19h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>);
const IconChev = () => (<svg className="chev" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>);

function Badge({ status, title }) {
  if (status === 'invalid') return <span className="badge b-bad" title={title}><IconCross />Invalid</span>;
  if (status === 'incomplete') return <span className="badge b-warn" title={title}><IconHalf />Incomplete</span>;
  if (status === 'na') return <span className="muted" title={title || 'Algebra is tested in 8th grade only'} aria-label="Not applicable">–</span>;
  if (status === 'covered') return <span className="badge b-ok" title={title || 'Completed the English version, so the Spanish test is not needed'}><IconCheck />Complete (EN)</span>;
  if (status === 'exempt') return <span className="badge b-ex" title={title || 'Taking the Math Regents, exempt from this MAP test'}><IconDash />Exempt</span>;
  return <span className="badge b-ok" title="Not on the NWEA report"><IconCheck />Complete</span>;
}

function SourceCard({ id, title, blurb, multiple, onFiles, summary, chips, actionLabel, children }) {
  const [over, setOver] = useState(false);
  const inputRef = useRef(null);
  const open = () => inputRef.current && inputRef.current.click();
  const filled = !!summary;
  return (
    <div className={'zone' + (over ? ' over' : '') + (filled ? ' filled' : '')}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const fl = [...((e.dataTransfer && e.dataTransfer.files) || [])]; if (fl.length) onFiles(fl); }}>
      <input ref={inputRef} id={id} type="file" className="sr-only" accept=".csv,.tsv,.xlsx,.xls,.pdf" multiple={multiple}
        onChange={(e) => { const fl = [...e.target.files]; e.target.value = ''; if (fl.length) onFiles(fl); }} />
      {!filled ? (
        <div className="zone-empty">
          <span className="muted"><IconUp /></span>
          <div className="display" style={{ fontWeight: 700, fontSize: 18 }}>{title}</div>
          <div className="muted" style={{ maxWidth: 440 }}>{blurb}</div>
          <div className="flex flex-wrap items-center gap-3 mt-1">
            <button className="btn btn-primary" onClick={open}>Choose file</button>
            <span className="muted" style={{ fontSize: 12 }}>or drop it here · CSV, Excel or PDF</span>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <div className="eyebrow">{title}</div>
              <div style={{ fontWeight: 600 }}>{summary}</div>
            </div>
            <button className="btn btn-sm" onClick={open}>{actionLabel}</button>
          </div>
          <div className="flex flex-wrap gap-2">{chips}</div>
          {children}
        </div>
      )}
    </div>
  );
}

function Mapper({ tables, fields, onChange, requireNote, onDefault }) {
  const bad = tables.some((t) => !hasWho(t.mapping));
  return (
    <details className="mapper" open={bad}>
      <summary>Check column mapping</summary>
      {tables.map((t) => (
        <div key={t.uid} style={{ marginTop: 12 }}>
          <div className="muted" style={{ fontSize: 12 }}>
            {t.fileName}{t.sheetName && t.sheetName !== 'Sheet1' ? ' · ' + t.sheetName : ''} · {t.rows.length} rows
            {t.mapping.subject < 0 && t.mapping.status < 0 && t.wide && t.wide.length > 0 ? ' · one column per subject detected (' + t.wide.map((w) => w[1]).join(', ') + ')' : ''}
          </div>
          <div className="mgrid">
            {fields.map((f) => (
              <label className="fld" key={f.key} htmlFor={`m-${t.uid}-${f.key}`}>
                <span>{f.label}</span>
                <select className="ctl" id={`m-${t.uid}-${f.key}`} value={t.mapping[f.key]} onChange={(e) => onChange(t.uid, f.key, Number(e.target.value))}>
                  <option value={-1}>Not used</option>
                  {t.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>
          {onDefault && (
            <label className="fld mt-3" htmlFor={`def-${t.uid}`} style={{ maxWidth: 340 }}>
              <span>Rows with no readable status count as</span>
              <select className="ctl" id={`def-${t.uid}`} value={t.defStatus || 'none'} onChange={(e) => onDefault(t.uid, e.target.value)}>
                <option value="none">Skipped (not flagged)</option>
                <option value="incomplete">Incomplete</option>
                <option value="invalid">Invalid</option>
              </select>
            </label>
          )}
          {!hasWho(t.mapping) && <div className="mt-2" style={{ color: 'var(--bad)', fontSize: 12 }}>{requireNote}</div>}
        </div>
      ))}
    </details>
  );
}

function Chip({ label, onRemove }) {
  return (
    <span className="chip"><span className="nm mono" title={label}>{label}</span>
      <button aria-label={'Remove ' + label} onClick={onRemove}><IconCross /></button></span>
  );
}

/* ---------- app ---------- */
function App() {
  const [data, setData] = useState(() => ({ roster: null, nwea: [], exempt: null, demo: false }));
  const [f, setF] = useState({ q: '', cls: '', teacher: '', subject: '', status: 'all', group: 'cls', showAll: true, exSubs: ['Math', 'Algebra'], spCover: true });
  const [shut, setShut] = useState(() => new Set());
  const [toast, setToast] = useState(null);
  const [loadMsgs, setLoadMsgs] = useState([]);
  const [copyText, setCopyText] = useState(null);
  const canSave = true;
  const [pdfBusy, setPdfBusy] = useState('');
  const [pdfLight, setPdfLight] = useState(false);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3800); return () => clearTimeout(t); }, [toast]);
  const say = (msg, tone) => setToast({ msg, tone, k: Date.now() });

  /* uploads */
  async function onRoster(files) {
    try {
      const tbl = await parseRoster(files[0]);
      setData((d) => ({ roster: tbl, nwea: d.demo ? [] : d.nwea, exempt: d.demo ? null : d.exempt, demo: false }));
      setF((x) => ({ ...x, cls: '', teacher: '', subject: '' }));
      if (!hasWho(tbl.mapping)) say('Pick the student ID or name column in Check column mapping.', 'bad');
    } catch (e) { say('Could not read that file: ' + (e.message || e), 'bad'); }
  }
  async function onNwea(files) {
    const all = []; const skipped = []; const msgs = [];
    for (const file of files) {
      try {
        const r = await parseNwea(file);
        all.push(...r.tables); skipped.push(...r.skipped);
        const n = r.tables.reduce((a, t) => a + t.rows.length, 0);
        if (!r.tables.length) msgs.push({ bad: true, text: `${file.name}: read, but no student ID or name column was found.` });
        else msgs.push({ bad: n === 0, text: `${file.name}: read ${n} ${n === 1 ? 'row' : 'rows'} from ${r.tables.length} ${r.tables.length === 1 ? 'sheet' : 'sheets'}.` });
      } catch (e) { msgs.push({ bad: true, text: `${file.name}: could not be read. ${(e && e.message) || e}` }); }
    }
    setLoadMsgs(msgs);
    if (!all.length) { say('Nothing could be loaded. See the message under the file cards.', 'bad'); return; }
    setData((d) => ({ roster: d.demo ? null : d.roster, nwea: d.demo ? all : [...d.nwea, ...all], exempt: d.demo ? null : d.exempt, demo: false }));
    if (skipped.length) say('Skipped sheets with no student columns: ' + skipped.join(', '));
  }
  async function onExempt(files) {
    try {
      const tbl = await parseRoster(files[0]);
      setData((d) => ({ roster: d.demo ? null : d.roster, nwea: d.demo ? [] : d.nwea, exempt: tbl, demo: false }));
      if (!hasWho(tbl.mapping)) say('Pick the student ID or name column in Check column mapping.', 'bad');
    } catch (e) { say('Could not read that file: ' + (e.message || e), 'bad'); }
  }
  const setMap = (which) => (tuid, key, idx) => setData((d) => {
    if (which === 'roster') return { ...d, roster: { ...d.roster, mapping: { ...d.roster.mapping, [key]: idx } } };
    if (which === 'exempt') return { ...d, exempt: { ...d.exempt, mapping: { ...d.exempt.mapping, [key]: idx } } };
    return { ...d, nwea: d.nwea.map((t) => (t.uid === tuid ? { ...t, mapping: { ...t.mapping, [key]: idx } } : t)) };
  });
  const setDef = (tuid, v) => setData((d) => ({ ...d, nwea: d.nwea.map((t) => (t.uid === tuid ? { ...t, defStatus: v } : t)) }));
  const removeNwea = (tuid) => setData((d) => ({ ...d, nwea: d.nwea.filter((t) => t.uid !== tuid) }));
  const loadSample = () => { setData(makeSample()); setF({ q: '', cls: '', teacher: '', subject: '', status: 'all', group: 'cls', showAll: true, exSubs: ['Math', 'Algebra'], spCover: true }); };
  const clearAll = () => { setLoadMsgs([]); setData({ roster: null, nwea: [], exempt: null, demo: false }); setF((x) => ({ ...x, cls: '', teacher: '', subject: '', q: '', status: 'all' })); };

  /* model */
  const model = useMemo(() => {
    const records = buildRecords(data.roster);
    const stu = new Map(); records.forEach((r) => { if (!stu.has(r.skey)) stu.set(r.skey, { skey: r.skey, id: r.id, name: r.name }); });
    const { exc, unmatched, info } = buildExceptions(data.nwea, [...stu.values()]);
    const extras = new Set(); exc.forEach((m) => m.forEach((_, s) => { if (!STANDARD.includes(s)) extras.add(s); }));
    unmatched.forEach((u) => { if (!STANDARD.includes(u.subject)) extras.add(u.subject); });
    const subjectsAll = [...STANDARD, ...[...extras].sort((a, b) => (a === 'Unspecified') - (b === 'Unspecified') || cmp(a, b))];
    const withExc = new Set(); exc.forEach((m) => m.forEach((_, s) => withExc.add(s)));
    const dupStudents = records.length - stu.size;
    const exempt = buildExempt(data.exempt, [...stu.values()]);
    return {
      records, exc, unmatched, info, subjectsAll, withExc, dupStudents, exempt,
      classes: [...new Set(records.map((r) => r.cls))].sort(cmp),
      teachers: [...new Set(records.map((r) => r.teacher))].sort(cmp),
    };
  }, [data]);

  const { records, exc, subjectsAll, withExc } = model;
  const fCls = model.classes.includes(f.cls) ? f.cls : '';
  const fTeacher = model.teachers.includes(f.teacher) ? f.teacher : '';
  const fSubject = subjectsAll.includes(f.subject) ? f.subject : '';
  const activeSubjects = fSubject ? [fSubject] : (f.showAll || withExc.size === 0 ? subjectsAll.filter((s) => STANDARD.includes(s) || withExc.has(s)) : subjectsAll.filter((s) => withExc.has(s)));
  const evalSubjects = fSubject ? [fSubject] : subjectsAll;

  const rows = useMemo(() => records.map((r) => {
    const ex = exc.get(r.skey); const st = {};
    const isEx = model.exempt.keys.has(r.skey); let ignored = 0;
    for (const s of subjectsAll) {
      const raw = (ex && ex.get(s) && ex.get(s).status) || null;
      if (isEx && f.exSubs.includes(s)) { st[s] = 'exempt'; if (raw) ignored++; } else st[s] = raw;
    }
    const gnum = parseInt(String(r.grade).replace(/\D/g, ''), 10);
    if (st['Algebra'] === null && gnum && gnum !== 8) st['Algebra'] = 'na';
    let covered = 0;
    if (f.spCover) {
      for (const s of ['Math (Spanish)']) {
        const base = s.replace(' (Spanish)', '');
        if ((st[s] === 'invalid' || st[s] === 'incomplete') && st[base] === null) { st[s] = 'covered'; covered++; }
      }
    }
    const inv = evalSubjects.filter((s) => st[s] === 'invalid');
    const inc = evalSubjects.filter((s) => st[s] === 'incomplete');
    return { ...r, st, ex, inv, inc, exempt: isEx, ignored, covered, overall: inv.length ? 'invalid' : inc.length ? 'incomplete' : 'complete' };
  }), [records, exc, subjectsAll, fSubject, model.exempt, f.exSubs, f.spCover]);

  const q = f.q.trim().toLowerCase();
  const baseRows = rows.filter((r) => (!fCls || r.cls === fCls) && (!fTeacher || r.teacher === fTeacher) && (!q || r.name.toLowerCase().includes(q) || String(r.rawId).toLowerCase().includes(q)));
  const uniq = new Map(); baseRows.forEach((r) => { if (!uniq.has(r.skey)) uniq.set(r.skey, r); });
  const U = [...uniq.values()];
  const total = U.length;
  const nInv = U.filter((r) => r.inv.length).length;
  const nInc = U.filter((r) => r.inc.length).length;
  const nOk = U.filter((r) => r.overall === 'complete').length;
  const nEx = U.filter((r) => r.exempt && (!fSubject || r.st[fSubject] === 'exempt')).length;
  const nIgnored = U.reduce((a, r) => a + r.ignored, 0);
  const nCovered = U.reduce((a, r) => a + r.covered, 0);
  const tInv = U.reduce((a, r) => a + r.inv.length, 0);
  const tInc = U.reduce((a, r) => a + r.inc.length, 0);
  const bInv = U.filter((r) => r.overall === 'invalid').length;
  const bInc = U.filter((r) => r.overall === 'incomplete').length;

  const shown = baseRows.filter((r) => f.status === 'all' ? true : f.status === 'makeup' ? r.overall !== 'complete' : f.status === 'invalid' ? r.inv.length > 0 : f.status === 'incomplete' ? r.inc.length > 0 : r.overall === 'complete');
  const sortRows = (a, b) => ((a.overall === 'complete') - (b.overall === 'complete')) || cmp(a.name, b.name);
  const groups = useMemo(() => {
    const m = new Map();
    shown.forEach((r) => { const k = f.group === 'cls' ? r.cls : f.group === 'teacher' ? r.teacher : 'All students'; if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
    return [...m.entries()].sort((a, b) => cmp(a[0], b[0])).map(([key, list]) => {
      list.sort(sortRows);
      const teachers = [...new Set(list.map((r) => r.teacher))]; const cls = [...new Set(list.map((r) => r.cls))];
      return { key, list, sub: f.group === 'cls' ? teachers.join(', ') : f.group === 'teacher' ? cls.length + (cls.length === 1 ? ' class' : ' classes') : '', needs: list.filter((r) => r.overall !== 'complete').length,
        inv: list.filter((r) => r.overall === 'invalid').length, inc: list.filter((r) => r.overall === 'incomplete').length };
    });
  }, [shown, f.group]);

  /* export */
  const exportItems = useMemo(() => {
    const out = [];
    baseRows.forEach((r) => {
      (fSubject ? [fSubject] : subjectsAll).forEach((s) => {
        const status = r.st[s]; if (status !== 'invalid' && status !== 'incomplete') return;
        const d = r.ex && r.ex.get(s);
        out.push({ teacher: r.teacher, cls: r.cls, grade: r.grade, id: r.rawId, name: r.name, subject: s, status, skey: r.skey, detail: d ? d.details.join('; ') : '' });
      });
    });
    out.sort((a, b) => cmp(a.teacher, b.teacher) || cmp(a.cls, b.cls) || cmp(a.name, b.name) || (subjectsAll.indexOf(a.subject) - subjectsAll.indexOf(b.subject)));
    return out;
  }, [baseRows, fSubject, subjectsAll]);
  const exportAoa = () => [EXPORT_HEAD, ...exportItems.map((x) => [x.teacher, x.cls, x.grade, x.id, x.name, x.subject, x.status === 'invalid' ? 'Invalid' : 'Incomplete', x.status === 'invalid' ? 'Retake' : 'Finish test', x.detail, '', '', ''])];
  const stamp = () => new Date().toLocaleDateString('en-CA');

  async function saveFile(kind) {
    if (!exportItems.length) { say('No makeups in the current Class, Teacher and Subject view.'); return; }
    try {
      const aoa = exportAoa();
      if (kind === 'xlsx') downloadFile(`MAP_Makeup_Roster_${stamp()}.xlsx`, workbookOf(aoa, seatsAoa(exportItems, subjectsAll)));
      else downloadFile(`MAP_Makeup_Roster_${stamp()}.csv`, csvOf(aoa));
      say('Makeup roster saved.');
    } catch (e) {
      if (e && e.code === 'declined') say('Save cancelled.');
      else say('Could not save the file: ' + ((e && e.message) || 'unknown error'), 'bad');
    }
  }
  function copyRoster() {
    if (!exportItems.length) { say('No makeups in the current Class, Teacher and Subject view.'); return; }
    const text = tsvOf(exportAoa());
    const fallback = () => setCopyText(text);
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => say('Copied. Paste it into Sheets or Excel.')).catch(fallback);
    else fallback();
  }

  const statusLabel = { all: 'All', makeup: 'Needs makeup', invalid: 'Invalid', incomplete: 'Incomplete', complete: 'Complete' }[f.status];
  const filterSummary = [fCls && `Class ${fCls}`, fTeacher && `Teacher ${fTeacher}`, fSubject && `Subject ${fSubject}`, f.status !== 'all' && `Status: ${statusLabel}`, q && `Search "${f.q}"`].filter(Boolean).join(' · ') || 'All students';

  async function exportPdf() {
    if (!window.jspdf) { say('The PDF tool did not load. Reload the page and try again.', 'bad'); return; }
    setPdfBusy('Building…');
    await new Promise((r) => setTimeout(r, 30));
    try {
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: 'l', unit: 'pt', format: 'letter', compress: true });
      const PW = 792, PH = 612, M = 30, CW = PW - 2 * M, BOTTOM = PH - 34;
      const LIGHT = { bg: '#f2f4f9', surface: '#ffffff', s2: '#e9edf6', line: '#d6ddeb', soft: '#e6ebf4', ink: '#14203a', ink2: '#4f5e7c', ok: '#17703f', okBg: '#dff2e6', bad: '#b0241c', badBg: '#fbe1de', warn: '#7a5200', warnBg: '#fcefc2' };
      const DARK = { bg: '#0d1322', surface: '#151d33', s2: '#1c2745', line: '#28345a', soft: '#202a49', ink: '#e8edf8', ink2: '#9aa8c8', ok: '#62d49b', okBg: '#12352a', bad: '#ff8d84', badBg: '#3d1b1f', warn: '#f3c658', warnBg: '#3b3011' };
      const lum = (getComputedStyle(document.body).backgroundColor.match(/\d+/g) || [255, 255, 255]).slice(0, 3).map(Number).reduce((x, y2) => x + y2, 0) / 3;
      const P = pdfLight || lum > 128 ? LIGHT : DARK;

      const clean = (t) => Array.from(String(t ?? '').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/•/g, '*'))
        .map((ch) => { const c = ch.charCodeAt(0); if ((c >= 32 && c <= 126) || (c >= 160 && c <= 255)) return ch; if (c < 32) return ' '; const b = ch.normalize('NFD').replace(/[̀-ͯ]/g, ''); return /^[\x20-\x7e]+$/.test(b) ? b : '?'; }).join('');
      const setF2 = (o) => { pdf.setFont(o.mono ? 'courier' : 'helvetica', o.bold ? 'bold' : 'normal'); pdf.setFontSize(o.size || 8.5); };
      const width = (t, size, bold) => { setF2({ size, bold }); return pdf.getTextWidth(clean(t)); };
      const txt = (t, x, yy, o = {}) => {
        setF2(o); pdf.setTextColor(o.color || P.ink);
        let str = clean(t);
        if (o.maxW && pdf.getTextWidth(str) > o.maxW) { while (str.length > 1 && pdf.getTextWidth(str + '...') > o.maxW) str = str.slice(0, -1); str += '...'; }
        pdf.text(str, x, yy, o.align ? { align: o.align } : undefined);
        return str;
      };
      let y = M;
      const page = (first) => { if (!first) pdf.addPage(); pdf.setFillColor(P.bg); pdf.rect(0, 0, PW, PH, 'F'); y = M; };
      page(true);

      /* title */
      txt('MAP Test Makeup Tracker', M, y + 14, { size: 18, bold: true });
      txt(new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) + ' · ' + filterSummary, M, y + 29, { size: 8.5, color: P.ink2, maxW: CW });
      y += 42;

      /* summary tiles */
      const tiles = [
        ['Total students', total, fSubject ? 'Judged on ' + fSubject : 'On the roster', P.ink2],
        ['Completed', nOk, 'Not on the NWEA report' + (nEx > 0 ? ' · ' + nEx + ' Regents-exempt' : ''), P.ok],
        ['Needs retake (invalid)', nInv, tInv + (tInv === 1 ? ' test' : ' tests'), P.bad],
        ['Needs completion (incomplete)', nInc, tInc + (tInc === 1 ? ' test' : ' tests'), P.warn],
      ];
      const SH = 66, TW = CW / 4;
      pdf.setFillColor(P.surface); pdf.setDrawColor(P.line); pdf.setLineWidth(0.6);
      pdf.roundedRect(M, y, CW, SH, 6, 6, 'FD');
      tiles.forEach((tl, i) => {
        const x = M + i * TW;
        if (i) { pdf.setDrawColor(P.line); pdf.line(x, y, x, y + SH); }
        pdf.setFillColor(tl[3]); pdf.roundedRect(x + 14, y + 12, 7, 7, 1.5, 1.5, 'F');
        txt(tl[0], x + 26, y + 19, { size: 7.5, bold: true, color: tl[3], maxW: TW - 36 });
        txt(String(tl[1]), x + 14, y + 46, { size: 26, bold: true });
        txt(tl[2], x + 14, y + 59, { size: 7, color: P.ink2, maxW: TW - 24 });
      });
      y += SH + 8;
      pdf.setFillColor(P.s2); pdf.roundedRect(M, y, CW, 6, 3, 3, 'F');
      let bx = M;
      [[nOk, P.ok], [bInv, P.bad], [bInc, P.warn]].forEach(([n, c]) => { const bw = total ? (n / total) * CW : 0; if (bw > 0) { pdf.setFillColor(c); pdf.rect(bx, y, bw, 6, 'F'); bx += bw; } });
      y += 15;
      txt('A student with both an invalid and an incomplete test is counted in both numbers. The bar shows each student once, by the more urgent issue.', M, y, { size: 7, color: P.ink2, maxW: CW });
      y += 12;

      /* notices */
      const notes = [];
      if (data.nwea.length === 0) notes.push(['No NWEA file added yet, so every student shows as complete.', true]);
      if (nCovered > 0) notes.push([`${nCovered} Spanish ${nCovered === 1 ? 'test was' : 'tests were'} left out because the student completed the English version.`, false]);
      if (nIgnored > 0) notes.push([`${nIgnored} NWEA ${nIgnored === 1 ? 'test was' : 'tests were'} left out because the student is on the Math Regents list.`, false]);
      if (model.exempt.unmatched.length > 0) notes.push([`${model.exempt.unmatched.length} on the Math Regents list did not match the roster: ${model.exempt.unmatched.slice(0, 6).join('; ')}${model.exempt.unmatched.length > 6 ? '...' : ''}`, true]);
      if (model.unmatched.length > 0) notes.push([`${model.unmatched.length} NWEA ${model.unmatched.length === 1 ? 'row' : 'rows'} did not match anyone on the roster.`, true]);
      if (model.info.byName > 0) notes.push([`${model.info.byName} NWEA ${model.info.byName === 1 ? 'row was' : 'rows were'} matched by name because the ID was missing or not on the roster.`, false]);
      if (model.info.skipped > 0) notes.push([`${model.info.skipped} NWEA ${model.info.skipped === 1 ? 'row' : 'rows'} had no readable Invalid or Incomplete status and ${model.info.skipped === 1 ? 'was' : 'were'} skipped.`, true]);
      for (const [t, warn] of notes) {
        setF2({ size: 8 });
        const lines = pdf.splitTextToSize(clean(t), CW - 20); const h = lines.length * 10 + 10;
        if (y + h > BOTTOM) page();
        pdf.setFillColor(P.surface); pdf.setDrawColor(warn ? P.warn : P.line); pdf.setLineWidth(0.6);
        pdf.roundedRect(M, y, CW, h, 4, 4, 'FD');
        pdf.setTextColor(P.ink); pdf.text(lines, M + 10, y + 13);
        y += h + 5;
      }
      y += 4;
      txt(`Showing ${new Set(shown.map((r) => r.skey)).size} of ${total} students` + (fSubject ? ' · status judged on ' + fSubject : ''), M, y + 8, { size: 7.5, color: P.ink2 });
      y += 20;

      /* groups */
      const ROW = 26, HEAD = 26, COLH = 20;
      const wName = 200, wGrade = 40, wCls = showCls ? 110 : 0, wTch = showTeacher ? 100 : 0;
      const sw = (CW - wName - wGrade - wCls - wTch) / Math.max(1, activeSubjects.length);
      const xGrade = M + wName, xCls = xGrade + wGrade, xTch = xCls + wCls, xSub = xTch + wTch;

      const badge = (st, x, ym, maxW) => {
        if (st === 'na') { txt('-', x + 4, ym + 3, { size: 9, color: P.ink2 }); return; }
        const spec = { invalid: ['Invalid', P.bad, P.badBg, 'x'], incomplete: ['Incomplete', P.warn, P.warnBg, 'o'], exempt: ['Exempt', P.ink2, P.s2, '-'], covered: ['Complete (EN)', P.ok, null, 'v'] }[st] || ['Complete', P.ok, null, 'v'];
        const [label, col, bgc, icon] = spec;
        const bw = Math.min(maxW, width(label, 7.5, true) + 24);
        if (bgc) { pdf.setFillColor(bgc); pdf.roundedRect(x, ym - 7.5, bw, 15, 7.5, 7.5, 'F'); }
        else { pdf.setDrawColor(P.okBg); pdf.setLineWidth(0.8); pdf.roundedRect(x, ym - 7.5, bw, 15, 7.5, 7.5, 'S'); }
        const ix = x + 9;
        pdf.setDrawColor(col); pdf.setLineWidth(1.1);
        if (icon === 'x') { pdf.line(ix - 2.5, ym - 2.5, ix + 2.5, ym + 2.5); pdf.line(ix + 2.5, ym - 2.5, ix - 2.5, ym + 2.5); }
        else if (icon === 'v') { pdf.line(ix - 2.8, ym + 0.2, ix - 0.8, ym + 2.2); pdf.line(ix - 0.8, ym + 2.2, ix + 3, ym - 2.5); }
        else if (icon === 'o') { pdf.setLineWidth(0.9); pdf.circle(ix, ym, 3, 'S'); pdf.setFillColor(col); pdf.circle(ix, ym, 1.3, 'F'); }
        else { pdf.line(ix - 2.8, ym, ix + 2.8, ym); }
        txt(label, x + 16, ym + 2.6, { size: 7.5, bold: true, color: col });
      };
      const headBar = (g, cont) => {
        pdf.setFillColor(P.s2); pdf.roundedRect(M, y, CW, HEAD, 6, 6, 'F'); pdf.rect(M, y + HEAD / 2, CW, HEAD / 2, 'F');
        const t = txt(g.key + (cont ? ' (cont.)' : ''), M + 12, y + 17, { size: 10.5, bold: true, maxW: 260 });
        if (g.sub) txt(g.sub, M + 12 + width(t, 10.5, true) + 8, y + 17, { size: 8.5, color: P.ink2, maxW: 230 });
        const label = `${g.needs} of ${g.list.length} need makeup`;
        const lw = width(label, 7.5, true);
        txt(label, M + CW - 12, y + 16, { size: 7.5, bold: true, align: 'right' });
        const bx0 = M + CW - 12 - lw - 10 - 84, n = g.list.length;
        pdf.setFillColor(P.line); pdf.roundedRect(bx0, y + 10, 84, 5, 2.5, 2.5, 'F');
        let cx = bx0;
        [[n - g.needs, P.ok], [g.inv, P.bad], [g.inc, P.warn]].forEach(([k, c]) => { const w2 = (k / n) * 84; if (w2 > 0) { pdf.setFillColor(c); pdf.rect(cx, y + 10, w2, 5, 'F'); cx += w2; } });
        y += HEAD;
      };
      const colHead = () => {
        pdf.setFillColor(P.surface); pdf.rect(M, y, CW, COLH, 'F');
        const lab = (t, x, mw) => txt(t.toUpperCase(), x, y + 13, { size: 6.5, bold: true, color: P.ink2, maxW: mw });
        lab('Student', M + 12, wName - 20); lab('Grade', xGrade, wGrade - 4);
        if (showCls) lab('Class / Period', xCls, wCls - 6);
        if (showTeacher) lab('Teacher', xTch, wTch - 6);
        activeSubjects.forEach((s, i) => lab(s, xSub + i * sw + 6, sw - 10));
        pdf.setDrawColor(P.line); pdf.setLineWidth(0.5); pdf.line(M, y + COLH, M + CW, y + COLH);
        y += COLH;
      };
      const rowDraw = (r) => {
        pdf.setFillColor(P.surface); pdf.rect(M, y, CW, ROW, 'F');
        txt(r.name, M + 12, y + 11, { size: 8.5, maxW: wName - 20 });
        txt(r.rawId || 'No ID', M + 12, y + 21, { size: 6.5, mono: true, color: P.ink2 });
        txt(r.grade || '-', xGrade, y + 16, { size: 8.5 });
        if (showCls) txt(r.cls, xCls, y + 16, { size: 8, maxW: wCls - 8 });
        if (showTeacher) txt(r.teacher, xTch, y + 16, { size: 8, maxW: wTch - 8 });
        activeSubjects.forEach((s, i) => badge(r.st[s], xSub + i * sw + 6, y + ROW / 2, sw - 10));
        pdf.setDrawColor(P.line); pdf.setLineWidth(0.5);
        pdf.line(M, y, M, y + ROW); pdf.line(M + CW, y, M + CW, y + ROW);
        pdf.setDrawColor(P.soft); pdf.setLineWidth(0.4); pdf.line(M, y + ROW, M + CW, y + ROW);
        y += ROW;
      };
      if (!groups.length) txt('No students match these filters.', M, y + 10, { size: 9, color: P.ink2 });
      for (const g of groups) {
        const open = !shut.has(g.key);
        if (y + HEAD + (open ? COLH + ROW * Math.min(2, g.list.length) : 6) > BOTTOM) page();
        headBar(g, false);
        if (open) {
          colHead();
          for (const r of g.list) {
            if (y + ROW > BOTTOM) { page(); headBar(g, true); colHead(); }
            rowDraw(r);
          }
        }
        y += 12;
      }

      /* footer on every page */
      const n = pdf.getNumberOfPages();
      const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      for (let i = 1; i <= n; i++) {
        pdf.setPage(i);
        txt('MAP Test Makeup Tracker · ' + date, M, PH - 16, { size: 7.5, color: P.ink2 });
        txt(`Page ${i} of ${n}`, PW - M, PH - 16, { size: 7.5, color: P.ink2, align: 'right' });
      }
      setPdfBusy('Saving…');
      downloadFile(`MAP_Makeup_Tracker_${stamp()}.pdf`, pdf.output('arraybuffer'));
      say('PDF saved.');
    } catch (e) {
      if (e && e.code === 'declined') say('Save cancelled.');
      else say('Could not make the PDF: ' + ((e && e.message) || 'unknown error'), 'bad');
    } finally { setPdfBusy(''); }
  }

  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const resetFilters = () => setF((x) => ({ ...x, q: '', cls: '', teacher: '', subject: '', status: 'all' }));
  const filtered = !!(q || fCls || fTeacher || fSubject || f.status !== 'all');
  const showCls = f.group !== 'cls', showTeacher = f.group === 'none';
  const tblMin = 230 + 70 + (showCls ? 170 : 0) + (showTeacher ? 150 : 0) + activeSubjects.length * 128;
  const pct = (n) => (total ? (n / total) * 100 : 0) + '%';
  const statPress = (s) => f.status === s;

  return (
    <div className="shell">
      {/* header */}
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 mb-5">
        <div className="min-w-0">
          <div className="eyebrow mb-1">NWEA MAP Growth · makeup scheduling</div>
          <h1 className="title">MAP Test Makeup Tracker</h1>
          <p className="muted mt-2" style={{ maxWidth: 640 }}>Add your roster and the NWEA exception report. Anyone on the roster who is not on the report counts as complete for that subject.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn" onClick={loadSample}>Load sample data</button>
          <button className="btn btn-ghost" onClick={clearAll}>Clear all</button>
        </div>
      </header>

      {data.demo && (
        <div className="banner mb-4" role="note">
          <strong>Sample data.</strong> Every name, ID and teacher below is made up. Add your own files to replace it.
          <button className="btn btn-sm" onClick={clearAll}>Clear sample</button>
        </div>
      )}

      {/* sources */}
      <section aria-label="Upload files" className="grid gap-4 mb-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))' }}>
        <SourceCard id="roster-input" title="Master roster" multiple={false} onFiles={onRoster}
          blurb="Every enrolled student with ID, name, class or period, teacher and grade. Read in your browser, never uploaded."
          summary={data.roster ? `${new Set(records.map((r) => r.skey)).size} students · ${model.classes.length} classes · ${model.teachers.length} teachers` : null}
          actionLabel="Replace file"
          chips={data.roster ? [<Chip key="r" label={data.roster.fileName} onRemove={() => setData((d) => ({ ...d, roster: null }))} />] : []}>
          {data.roster && <Mapper tables={[data.roster]} fields={ROSTER_FIELDS} onChange={setMap('roster')} requireNote="Choose the column that holds the student ID or name." />}
        </SourceCard>
        <SourceCard id="nwea-input" title="NWEA exception files" multiple onFiles={onNwea}
          blurb="Students with invalid or incomplete tests, as CSV, Excel or the PDF downloaded from NWEA. Add one file or many. Reading, Math, Algebra and Math (Spanish) are recognized."
          summary={data.nwea.length ? `${model.info.rows} flagged tests · ${data.nwea.length} ${data.nwea.length === 1 ? 'sheet' : 'sheets'}` : null}
          actionLabel="Add file"
          chips={data.nwea.map((t) => <Chip key={t.uid} label={t.fileName + (t.sheetName && t.sheetName !== 'Sheet1' ? ' · ' + t.sheetName : '')} onRemove={() => removeNwea(t.uid)} />)}>
          {data.nwea.length > 0 && <Mapper tables={data.nwea} fields={NWEA_FIELDS} onChange={setMap('nwea')} onDefault={setDef} requireNote="Choose the column that holds the student ID or name." />}
        </SourceCard>
        <SourceCard id="exempt-input" title="Math Regents list (optional)" multiple={false} onFiles={onExempt}
          blurb="Students taking the Math Regents. They are exempt from the MAP subjects you pick below, even if the NWEA report lists them."
          summary={data.exempt ? `${model.exempt.keys.size} students exempt` : null}
          actionLabel="Replace file"
          chips={data.exempt ? [<Chip key="x" label={data.exempt.fileName} onRemove={() => setData((d) => ({ ...d, exempt: null }))} />] : []}>
          {data.exempt && (
            <>
              <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1" style={{ border: 0, padding: 0 }}>
                <legend className="eyebrow mb-1">Exempt from</legend>
                {EXEMPT_CHOICES.map((s) => (
                  <label key={s} className="flex items-center gap-2" htmlFor={'ex-' + norm(s)} style={{ fontSize: 13 }}>
                    <input id={'ex-' + norm(s)} type="checkbox" checked={f.exSubs.includes(s)}
                      onChange={(e) => setF((x) => ({ ...x, exSubs: e.target.checked ? [...x.exSubs, s] : x.exSubs.filter((y) => y !== s) }))} />
                    {s}
                  </label>
                ))}
              </fieldset>
              <Mapper tables={[data.exempt]} fields={ROSTER_FIELDS.filter((x) => ['id', 'first', 'last', 'name'].includes(x.key))} onChange={setMap('exempt')} requireNote="Choose the column that holds the student ID or name." />
            </>
          )}
        </SourceCard>
      </section>

      {loadMsgs.length > 0 && (
        <div className="note warn mb-4" role="status">
          <strong>Last NWEA upload</strong>
          {loadMsgs.map((m, i) => <div key={i} className="mono" style={{ fontSize: 12, marginTop: 4, color: m.bad ? 'var(--bad)' : 'var(--ink-2)' }}>{m.text}</div>)}
        </div>
      )}
      {data.nwea.length > 0 && !data.roster && (
        <div className="note warn mb-4">The NWEA files are loaded, but there is no master roster yet. Add the roster to see students and their status.</div>
      )}
      {data.nwea.length > 0 && data.roster && model.info.rows === 0 && (
        <div className="note warn mb-4">The NWEA files were read, but no Invalid or Incomplete status was found in them. Open <strong>Check column mapping</strong> on the NWEA card, pick the Status column, or set a default status for the sheet.</div>
      )}

      {!data.roster ? (
        <div className="note">Add the master roster to see every student and their status. Once the NWEA files are added, anyone not listed shows as complete.</div>
      ) : (
        <>
          {data.nwea.length === 0 && <div className="note warn mb-4">No NWEA file added yet, so every student shows as complete. Add the exception report to flag makeups.</div>}

          {/* stats */}
          <section aria-label="Summary" className="mb-4">
            <div className="stats">
              <button className="stat" aria-pressed={statPress('all')} onClick={() => set('status', 'all')}>
                <span className="lbl"><i className="dot all" />Total students</span>
                <span className="num">{total}</span>
                <span className="sub">{filtered && f.status === 'all' ? 'In current filters' : fSubject ? 'Judged on ' + fSubject : 'On the roster'}</span>
              </button>
              <button className="stat" aria-pressed={statPress('complete')} onClick={() => set('status', 'complete')}>
                <span className="lbl" style={{ color: 'var(--ok)' }}><i className="dot ok" />Completed</span>
                <span className="num">{nOk}</span>
                <span className="sub">Not on the NWEA report{nEx > 0 ? ` · ${nEx} Regents-exempt` : ''}</span>
              </button>
              <button className="stat" aria-pressed={statPress('invalid')} onClick={() => set('status', 'invalid')}>
                <span className="lbl" style={{ color: 'var(--bad)' }}><i className="dot bad" />Needs retake (invalid)</span>
                <span className="num">{nInv}</span>
                <span className="sub">{tInv} {tInv === 1 ? 'test' : 'tests'}</span>
              </button>
              <button className="stat" aria-pressed={statPress('incomplete')} onClick={() => set('status', 'incomplete')}>
                <span className="lbl" style={{ color: 'var(--warn)' }}><i className="dot warn" />Needs completion (incomplete)</span>
                <span className="num">{nInc}</span>
                <span className="sub">{tInc} {tInc === 1 ? 'test' : 'tests'}</span>
              </button>
            </div>
            <div className="bar mt-3" role="img" aria-label={`${nOk} complete, ${bInv} with an invalid test, ${bInc} with only incomplete tests`}>
              <span className="seg-ok" style={{ width: pct(nOk) }} />
              <span className="seg-bad" style={{ width: pct(bInv) }} />
              <span className="seg-warn" style={{ width: pct(bInc) }} />
            </div>
            <div className="muted mt-2" style={{ fontSize: 12 }}>A student with both an invalid and an incomplete test is counted in both numbers. The bar shows each student once, by the more urgent issue.</div>
          </section>

          {/* notices */}
          <div className="flex flex-col gap-3 mb-4">
            {model.unmatched.length > 0 && (
              <details className="note warn">
                <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{model.unmatched.length} NWEA {model.unmatched.length === 1 ? 'row' : 'rows'} did not match anyone on the roster</summary>
                <div className="scroll mt-3">
                  <table className="t" style={{ minWidth: 560 }}>
                    <thead><tr><th>Student</th><th>ID</th><th>Subject</th><th>Status</th><th>File</th></tr></thead>
                    <tbody>{model.unmatched.map((u, i) => (
                      <tr key={i}><td>{u.name || '(no name)'}</td><td className="mono">{u.id || '–'}</td><td>{u.subject}</td><td><Badge status={u.status} /></td><td className="mono muted">{u.file}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
                <div className="muted mt-2" style={{ fontSize: 12 }}>Matching uses Student ID first, then an exact name when the ID is missing. These students are not counted above.</div>
              </details>
            )}
            {nCovered > 0 && <div className="note">{nCovered} Spanish {nCovered === 1 ? 'test was' : 'tests were'} left out because the student completed the English version. They show as Complete (EN).</div>}
            {nIgnored > 0 && <div className="note">{nIgnored} NWEA {nIgnored === 1 ? 'test was' : 'tests were'} left out because the student is on the Math Regents list.</div>}
            {model.exempt.unmatched.length > 0 && <div className="note warn">{model.exempt.unmatched.length} {model.exempt.unmatched.length === 1 ? 'student' : 'students'} on the Math Regents list did not match the roster: {model.exempt.unmatched.slice(0, 6).join('; ')}{model.exempt.unmatched.length > 6 ? '…' : ''}</div>}
            {model.info.byName > 0 && <div className="note">{model.info.byName} {model.info.byName === 1 ? 'row was' : 'rows were'} matched by name because the ID was missing or not on the roster.</div>}
            {model.info.skipped > 0 && <div className="note warn">{model.info.skipped} NWEA {model.info.skipped === 1 ? 'row' : 'rows'} had no readable Invalid or Incomplete status and {model.info.skipped === 1 ? 'was' : 'were'} skipped, so no one was flagged from {model.info.skipped === 1 ? 'it' : 'them'}. Open Check column mapping under the NWEA box to pick the Status column, or to count rows with no status as Invalid or Incomplete.</div>}
            {model.dupStudents > 0 && <div className="note">{model.dupStudents} roster {model.dupStudents === 1 ? 'row lists' : 'rows list'} a student in more than one class. They appear once per class, and totals count each student once.</div>}
          </div>

          {/* filters */}
          <section aria-label="Filters" className="flex flex-wrap items-end gap-3 mb-3">
            <label className="fld" htmlFor="f-search" style={{ flex: '1 1 220px' }}>
              <span>Search</span>
              <input id="f-search" className="ctl" type="search" placeholder="Student name or ID" value={f.q} onChange={(e) => set('q', e.target.value)} />
            </label>
            <label className="fld" htmlFor="f-class" style={{ flex: '1 1 150px' }}>
              <span>Class / Period</span>
              <select id="f-class" className="ctl" value={fCls} onChange={(e) => set('cls', e.target.value)}>
                <option value="">All classes</option>{model.classes.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="fld" htmlFor="f-teacher" style={{ flex: '1 1 150px' }}>
              <span>Teacher</span>
              <select id="f-teacher" className="ctl" value={fTeacher} onChange={(e) => set('teacher', e.target.value)}>
                <option value="">All teachers</option>{model.teachers.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="fld" htmlFor="f-subject" style={{ flex: '1 1 150px' }}>
              <span>Subject</span>
              <select id="f-subject" className="ctl" value={fSubject} onChange={(e) => set('subject', e.target.value)}>
                <option value="">All subjects</option>{subjectsAll.filter((s) => STANDARD.includes(s) || withExc.has(s)).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </section>
          <section className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 mb-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="seg" role="group" aria-label="Status filter">
                {[['all', 'All'], ['makeup', 'Needs makeup'], ['invalid', 'Invalid'], ['incomplete', 'Incomplete'], ['complete', 'Complete']].map(([k, l]) => (
                  <button key={k} aria-pressed={f.status === k} onClick={() => set('status', k)}>{l}</button>
                ))}
              </div>
              <div className="seg" role="group" aria-label="Group by">
                {[['cls', 'By class'], ['teacher', 'By teacher'], ['none', 'No groups']].map(([k, l]) => (
                  <button key={k} aria-pressed={f.group === k} onClick={() => set('group', k)}>{l}</button>
                ))}
              </div>
              {!fSubject && (
                <label className="flex items-center gap-2" htmlFor="f-all-subjects" style={{ fontSize: 13 }}>
                  <input id="f-all-subjects" type="checkbox" checked={f.showAll} onChange={(e) => set('showAll', e.target.checked)} />
                  Show all subjects (uncheck to hide ones with no exceptions)
                </label>
              )}
              <label className="flex items-center gap-2" htmlFor="f-sp-cover" style={{ fontSize: 13 }}>
                <input id="f-sp-cover" type="checkbox" checked={f.spCover} onChange={(e) => set('spCover', e.target.checked)} />
                Skip Spanish makeups when English is complete
              </label>
              {filtered && <button className="btn btn-ghost btn-sm" onClick={resetFilters}>Reset filters</button>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="muted" style={{ fontSize: 12 }}>Export {exportItems.length} {exportItems.length === 1 ? 'test' : 'tests'}</span>
              <button className="btn btn-primary" disabled={!canSave} onClick={() => saveFile('xlsx')} title="Uses the current Class, Teacher, Subject and search filters">Export Makeup Roster</button>
              <button className="btn" disabled={!canSave} onClick={() => saveFile('csv')}>CSV</button>
              <button className="btn" disabled={!canSave || !!pdfBusy} onClick={exportPdf} title="Saves the summary and roster as it looks on screen">{pdfBusy || 'PDF'}</button>
              <label className="flex items-center gap-1" htmlFor="pdf-light" style={{ fontSize: 12 }}>
                <input id="pdf-light" type="checkbox" checked={pdfLight} onChange={(e) => setPdfLight(e.target.checked)} />Light PDF
              </label>
              <button className="btn" onClick={copyRoster}>Copy</button>
            </div>
          </section>
          {copyText && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2"><span className="muted" style={{ fontSize: 12 }}>Select all and copy this table by hand.</span><button className="btn btn-sm" onClick={() => setCopyText(null)}>Close</button></div>
              <textarea id="copy-box" className="copybox" readOnly value={copyText} onFocus={(e) => e.target.select()} />
            </div>
          )}

          <div className="muted mb-3" style={{ fontSize: 12 }}>Showing {new Set(shown.map((r) => r.skey)).size} of {total} students{fSubject ? ' · status judged on ' + fSubject : ''}</div>

          {/* groups */}
          {groups.length === 0 ? (
            <div className="note">No students match these filters. <button className="btn btn-sm ml-2" onClick={resetFilters}>Reset filters</button></div>
          ) : (
            <div className="flex flex-col gap-4">
              {groups.map((g) => {
                const open = !shut.has(g.key);
                const n = g.list.length;
                return (
                  <section key={g.key} className="grp">
                    <button className="grp-head" aria-expanded={open} onClick={() => setShut((s) => { const x = new Set(s); x.has(g.key) ? x.delete(g.key) : x.add(g.key); return x; })}>
                      <IconChev />
                      <span className="min-w-0 flex flex-wrap items-baseline gap-x-3">
                        <span className="gt">{g.key}</span>
                        {g.sub && <span className="muted" style={{ fontSize: 13 }}>{g.sub}</span>}
                      </span>
                      <span className="ml-auto flex items-center gap-3">
                        <span className="bar" style={{ width: 84 }} aria-hidden="true">
                          <span className="seg-ok" style={{ width: ((n - g.needs) / n) * 100 + '%' }} />
                          <span className="seg-bad" style={{ width: (g.inv / n) * 100 + '%' }} />
                          <span className="seg-warn" style={{ width: (g.inc / n) * 100 + '%' }} />
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>{g.needs} of {n} need makeup</span>
                      </span>
                    </button>
                    {open && (
                      <div className="scroll">
                        <table className="t" style={{ minWidth: tblMin }}>
                          <colgroup>
                            <col />
                            <col style={{ width: 70 }} />
                            {showCls && <col style={{ width: 170 }} />}
                            {showTeacher && <col style={{ width: 150 }} />}
                            {activeSubjects.map((s) => <col key={s} style={{ width: 128 }} />)}
                          </colgroup>
                          <thead><tr>
                            <th className="stick">Student</th><th>Grade</th>
                            {showCls && <th>Class / Period</th>}{showTeacher && <th>Teacher</th>}
                            {activeSubjects.map((s) => <th key={s}>{s}</th>)}
                          </tr></thead>
                          <tbody>
                            {g.list.map((r) => (
                              <tr key={r.rkey}>
                                <td className="stick"><div className="nm">{r.name}</div><div className="id mono">{r.rawId || 'No ID'}</div></td>
                                <td>{r.grade || '–'}</td>
                                {showCls && <td>{r.cls}</td>}{showTeacher && <td>{r.teacher}</td>}
                                {activeSubjects.map((s) => {
                                  const d = r.ex && r.ex.get(s);
                                  const tip = d ? [r.st[s] === 'invalid' ? 'Invalid test, needs a retake' : 'Incomplete test, needs to be finished', ...d.details, d.files.join(', ')].filter(Boolean).join(' · ') : '';
                                  return <td key={s}><Badge status={r.st[s]} title={tip} /></td>;
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}

      {toast && <div className={'toast' + (toast.tone === 'bad' ? ' bad' : '')} role="status" key={toast.k}>{toast.msg}</div>}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
