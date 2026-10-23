// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
// The fixed About page every app made with Dev Studio or the dev kit carries, and its Ambivo certificate.
//
// The starter ships the About page in src/ambivo-about/ ("locked files"). They must stay byte for byte
// Ambivo's copy: ABOUT_LOCK lists the accepted SHA-256 of each (bytes with CRLF turned into LF, the same
// rule as Ambivo's POST /app_certificate). The app must also show the page: provideAmbivoAbout() in
// app.config.ts, the link on the sign-in page, and the link or menu entry on a signed-in page.
//
// Dev Studio checks this on its own server before Share, Download, Push and Deploy, so a partner cannot
// skip it by changing the project's own ambivo:check. Deploy also needs a current certificate: the one in
// src/install/ambivo-certificate.json, for this app_key and app_version, valid at Ambivo, with the same
// SHA-256. Ambivo refuses to install an app's custom objects in a client's company without it anyway.
//
// Keep ABOUT_LOCK the same as plugins/ambivo-devkit/scripts/ambivo-check.mjs, mcp/src/certify.mjs and
// CANONICAL_ABOUT in Ambivo's service/app_certificate.py (test/about.test.mjs checks the first two
// against the starter's files).
import { createHash } from 'node:crypto';

export const ABOUT_LOCK = {
  'src/ambivo-about/about.page.ts': ['e7ab6a1067f731ac22e675c5decdab90eb6ea97ce91537ac41e08cfd22b0d1a6'],
  'src/ambivo-about/about.ts': ['7d850408b4e4ac5703ef52dad47160d7eb3402767eba1b4fd99535cded14c331'],
};
export const CERTIFICATE_FILE = 'src/install/ambivo-certificate.json';
export const CERT_ID_RE = /^AMB-[0-9A-Z]{4}-[0-9A-Z]{4}$/;
const SHA_RE = /^[0-9a-f]{64}$/;

export const sha256Text = (text) => createHash('sha256').update(String(text).replace(/\r\n/g, '\n'), 'utf8').digest('hex');

// Code lines only: comments and import lines do not count as showing the page.
const code = (text) => String(text ?? '').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*|import\s)/.test(l)).join('\n');

/**
 * What is wrong with the app's About page, as sentences for the partner. Empty when all is well.
 * @param read      async (relPath) => file text, or null when there is no such file
 * @param listApp   async () => relative paths of the .ts and .html files under src/app
 */
export async function aboutProblems(read, listApp) {
  const out = [];
  for (const [path, hashes] of Object.entries(ABOUT_LOCK)) {
    const text = await read(path);
    if (text === null) out.push(`${path} is missing. Put back the dev kit's copy.`);
    else if (!hashes.includes(sha256Text(text))) out.push(`${path} was changed. Put back the dev kit's copy; the About page must stay as Ambivo wrote it.`);
  }
  const cert = await read(CERTIFICATE_FILE);
  if (cert === null) out.push(`${CERTIFICATE_FILE} is missing. Put back the starter's copy, or submit the app for Ambivo's review.`);
  else if (certificateFrom(cert) === undefined) out.push(`${CERTIFICATE_FILE} is not valid JSON.`);
  if (!/provideAmbivoAbout\(\)/.test(code(await read('src/app/app.config.ts')))) {
    out.push('src/app/app.config.ts must call provideAmbivoAbout() in its providers.');
  }
  const files = await listApp();
  const texts = await Promise.all(files.map(async (f) => [f, code(await read(f))]));
  if (!texts.some(([f, t]) => f.startsWith('src/app/sign-in/') && t.includes('<ambivo-about-link'))) {
    out.push('The sign-in page must show <ambivo-about-link /> (src/app/sign-in/sign-in-layout.component.ts).');
  }
  if (!texts.some(([f, t]) => !f.startsWith('src/app/sign-in/') && (/\bABOUT_NAV_ITEM\b/.test(t) || t.includes('<ambivo-about-link')))) {
    out.push('Signed-in pages must reach the About page: ABOUT_NAV_ITEM in the left menu (src/app/shell/nav.ts), or <ambivo-about-link /> on a page.');
  }
  return out;
}

/** The certificate in the file: an object, null when the file holds none, undefined when unreadable. */
export function certificateFrom(text) {
  let doc;
  try { doc = JSON.parse(text); } catch { return undefined; }
  if (!doc || typeof doc !== 'object' || !('certificate' in doc)) return undefined;
  const c = doc.certificate;
  if (c === null) return null;
  if (!c || !CERT_ID_RE.test(String(c.cert_id)) || !SHA_RE.test(String(c.sha256))) return undefined;
  return c;
}

/**
 * For Deploy: the certificate must be for this app_key and version, and valid at Ambivo with the same SHA-256.
 * @param coreGet async (path) => {ok, body} from Ambivo's public GET (no sign-in needed)
 * Returns a sentence, or null when the certificate is current.
 */
export async function certificateProblem(read, { appKey, appVersion, codeSha256 = null }, coreGet) {
  const c = certificateFrom(await read(CERTIFICATE_FILE) ?? 'null');
  if (!c) return 'The app has no Ambivo certificate. Submit the app for Ambivo\'s review (the Review button). An approved version gets one.';
  if (c.app_key !== appKey || c.app_version !== appVersion) {
    return `The certificate is for ${c.app_key} ${c.app_version}, and the app is ${appKey} ${appVersion || '(no version)'}. `
      + 'Submit this version for Ambivo\'s review, then make the link.';
  }
  let r;
  try { r = await coreGet(`app_certificate/${c.cert_id}?sha256=${c.sha256}`); } catch { r = null; }
  if (!r?.ok) return 'Ambivo could not be reached to check the certificate. Try again in a few minutes.';
  const cert = r.body?.certificate;
  if (cert?.status !== 'valid') return `Ambivo revoked certificate ${c.cert_id}. Submit the app for Ambivo's review again.`;
  if (r.body.sha256_matches !== true) return `The certificate file does not match Ambivo's record of ${c.cert_id}. Submit the app for Ambivo's review again.`;
  // The code must be exactly what Ambivo reviewed: its fingerprint now, against the one the certificate signs.
  const st = cert.statement || {};
  if (!st.review_id || !st.code_sha256) return `Certificate ${c.cert_id} was not issued after a review. Submit the app for Ambivo's review.`;
  if (codeSha256 !== null && st.code_sha256 !== codeSha256) {
    return `The app changed after Ambivo reviewed it (certificate ${c.cert_id}). Raise app_version and submit it for review again.`;
  }
  return null;
}

/** read() and listApp() for a project, through Dev Studio's container driver. */
export function projectReader(sh, root = '/work/app') {
  const q = (p) => `'${String(p).replace(/'/g, `'\\''`)}'`;
  return {
    read: (rel) => sh(`cat ${q(`${root}/${rel}`)}`).then((o) => o.stdout, () => null),
    listApp: () => sh(`cd ${q(root)} && find src/app -type f \\( -name '*.ts' -o -name '*.html' \\) 2>/dev/null | head -2000`)
      .then((o) => o.stdout.split('\n').map((l) => l.trim()).filter(Boolean), () => []),
  };
}
