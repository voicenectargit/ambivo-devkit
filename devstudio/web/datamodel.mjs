// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
// The app's data model for the project page: read from the install definitions the project ships
// (src/install/app-objects.json), or, before those exist, the phase 0 document (docs/DATA_MODEL.md).

export const OBJECTS_FILE = '/work/app/src/install/app-objects.json';
export const MODEL_DOC = '/work/app/docs/DATA_MODEL.md';

const RULES = new Set(['restrict', 'cascade', 'nullify', 'none']);

// A plain id field that holds one of Ambivo's own (Core) records. Custom objects link to each other
// with reference_fields; a Core record is only ever named by its id, so the field name tells which.
export const CORE_RECORDS = [
  { id: 'account', name: 'Account', test: /(^|_)account_ids?$/ },
  { id: 'product', name: 'Product', test: /(^|_)product_ids?$/ },
  { id: 'user', name: 'User', test: /(^|_)(userids?|user_ids?)$/ },
  { id: 'site', name: 'Site', test: /(^|_)site_(code|id)s?$/ },
  { id: 'inventory_txn', name: 'Stock movement', test: /(^|_)txn_ids?$/ },
  { id: 'file', name: 'File', test: /(^|_)file_ids?$/ },
];
const coreOf = (field) => CORE_RECORDS.find((c) => c.test.test(field))?.id ?? null;
const CORE_IDS = new Set(CORE_RECORDS.map((c) => c.id));
// "Ambivo account", "Ambivo stock movement": the words DATA_MODEL.md uses in its "links to" column.
const CORE_WORDS = [['account', 'account'], ['product', 'product'], ['user', 'user'], ['site', 'site'],
  ['stock movement', 'inventory_txn'], ['movement', 'inventory_txn'], ['file', 'file']];

/**
 * The objects in app-objects.json, in a plain shape for the page:
 * [{ id, name, fields: [{ name, type, required, link: { to, rule } | null }] }].
 * The file is a list of objects, or { objects: [...] }. Throws on text that is not that.
 */
export function modelFromObjects(text) {
  const raw = JSON.parse(text);
  const list = Array.isArray(raw) ? raw : raw?.objects;
  if (!Array.isArray(list)) throw new Error('src/install/app-objects.json has no list of objects.');
  // Fields that hold an Ambivo record's id, as the custom-objects skill records them. Without the map,
  // the field name is the only clue, and the page marks those links as guessed.
  const stated = raw && !Array.isArray(raw) && raw.core_links && typeof raw.core_links === 'object' ? raw.core_links : null;
  const coreFor = (obj, name) => {
    const v = stated?.[obj]?.[name];
    if (typeof v === 'string' && CORE_IDS.has(v)) return { core: v, guessed: false };
    if (stated?.[obj] && name in stated[obj]) return { core: null, guessed: false };
    const g = coreOf(name);
    return { core: g, guessed: !!g };
  };
  return list.filter((o) => o && typeof o.collection_id === 'string').map((o) => {
    const required = new Set(Array.isArray(o.required_fields) ? o.required_fields : []);
    const refs = o.reference_fields && typeof o.reference_fields === 'object' ? o.reference_fields : {};
    const schema = o.schema && typeof o.schema === 'object' ? o.schema : {};
    const fields = Object.entries(schema).map(([name, def]) => {
      const ref = refs[name];
      const type = Array.isArray(def?.bsonType) ? def.bsonType.join(' or ') : String(def?.bsonType ?? '');
      return {
        name, type, required: required.has(name),
        link: ref?.target_collection ? { to: String(ref.target_collection), rule: RULES.has(ref.on_delete) ? ref.on_delete : 'none' } : null,
        ...(ref?.target_collection ? { core: null } : coreFor(o.collection_id, name)),
      };
    });
    // A link on a field the schema does not list still shows.
    for (const [name, ref] of Object.entries(refs)) {
      if (!schema[name] && ref?.target_collection) fields.push({ name, type: 'string', required: required.has(name), link: { to: String(ref.target_collection), rule: RULES.has(ref.on_delete) ? ref.on_delete : 'none' }, core: null });
    }
    return { id: o.collection_id, name: typeof o.name === 'string' ? o.name : o.collection_id, fields };
  });
}

const cellText = (c) => c.replace(/`/g, '').trim();
const splitRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

/**
 * The objects planned in docs/DATA_MODEL.md, in the same shape as modelFromObjects. Reads each heading
 * with an id in backticks and the tables under it: a field table (field, type, R or required, and
 * optionally "links to"), and a links table (field, target, on_delete). Text it cannot read is skipped.
 */
export function modelFromDoc(md) {
  const objects = [];
  let cur = null, header = null;
  for (const raw of String(md).split('\n')) {
    const line = raw.trim();
    const h = /^#{2,4}\s.*?`([a-z][a-z0-9_]*)`/.exec(line);
    if (h) {
      cur = { id: h[1], name: line.replace(/^#+\s*(\d+\.\s*)?/, '').replace(/`[^`]*`:?\s*/, '').trim() || h[1], fields: [] };
      objects.push(cur); header = null; continue;
    }
    if (/^#{1,4}\s/.test(line)) { cur = null; header = null; continue; }
    if (!cur || !line.startsWith('|')) { header = null; continue; }
    const cells = splitRow(line);
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
    if (!header) { header = cells.map((c) => cellText(c).toLowerCase()); continue; }
    const col = (...names) => header.findIndex((x) => names.includes(x));
    const fi = col('field'), ti = col('type'), ri = col('r', 'required', 'req'), li = col('links to', 'link', 'links'),
      tgt = col('target', 'target object'), od = col('on_delete', 'on delete');
    if (fi < 0) continue;
    const names = cellText(cells[fi] ?? '').split(/\s*\/\s*/).filter((n) => /^[a-z][a-z0-9_]*$/.test(n));
    if (!names.length) continue;
    if (tgt >= 0) {
      // A links table: set the link on fields the field table already listed (or add them).
      const to = cellText(cells[tgt] ?? ''), rule = cellText(cells[od] ?? '').toLowerCase();
      for (const n of names) {
        let f = cur.fields.find((x) => x.name === n);
        if (!f) { f = { name: n, type: 'string', required: false, link: null, core: null }; cur.fields.push(f); }
        if (/^[a-z][a-z0-9_]*$/.test(to)) { f.link = { to, rule: RULES.has(rule) ? rule : 'none' }; f.core = null; }
      }
      continue;
    }
    if (ti < 0) continue;
    const types = cellText(cells[ti] ?? '').split(/\s*\/\s*/);
    const req = ri >= 0 && /^(r|yes|y|required)$/i.test(cellText(cells[ri] ?? ''));
    const linkText = li >= 0 ? cellText(cells[li] ?? '') : '';
    names.forEach((n, i) => {
      const type = (types[i] ?? types[0] ?? '').replace(/\s+of\s+.*/, '') || 'string';
      let link = null, core = null, guessed = false;
      const m = /^([a-z][a-z0-9_]*)\s*\((restrict|cascade|nullify|none)\)/.exec(linkText);
      if (m) link = { to: m[1], rule: m[2] };
      else {
        const w = /ambivo\s+([a-z ]+)/i.exec(linkText);
        if (w) core = CORE_WORDS.find(([word]) => w[1].toLowerCase().startsWith(word))?.[1] ?? null;
        if (!core && li < 0) { core = coreOf(n); guessed = !!core; }
      }
      cur.fields.push({ name: n, type, required: req, link, core, ...(guessed ? { guessed } : {}) });
    });
  }
  return objects.filter((o) => o.fields.length);
}

const coreUsed = (objects) => {
  const used = new Set(objects.flatMap((o) => o.fields.map((f) => f.core).filter(Boolean)));
  return CORE_RECORDS.filter((c) => used.has(c.id)).map(({ id, name }) => ({ id, name }));
};

/** What GET /api/projects/<id>/datamodel answers, from the two files' text (null when a file is not there). */
export function dataModelView(objectsText, docText) {
  if (objectsText !== null && objectsText !== undefined) {
    try {
      const objects = modelFromObjects(objectsText);
      return { source: 'install', objects, core: coreUsed(objects) };
    }
    catch (err) { return { source: 'install', objects: [], error: `src/install/app-objects.json could not be read: ${err.message}` }; }
  }
  if (docText) {
    const objects = modelFromDoc(docText);
    return { source: 'doc', doc: docText, objects, core: coreUsed(objects) };
  }
  return { source: 'none' };
}
