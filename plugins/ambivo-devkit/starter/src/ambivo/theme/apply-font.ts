// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
/*
export function applyFont(renderer: Renderer2, document: Document, fontFamily: string) {
  const uri = 'https://fonts.googleapis.com/css';
  const linkId = `am_font_link_${snakeCase(fontFamily)}`;
  if (!fontFamily || document.getElementById(linkId)) return;

  const linkEl = renderer.createElement('link');
  const href = appendParams(uri, { fontFamily, display: 'swap' });
  renderer.setAttribute(linkEl, 'id', linkId);
  renderer.setAttribute(linkEl, 'rel', 'stylesheet');
  renderer.setAttribute(linkEl, 'href', href);
  renderer.appendChild(document.head, linkEl);
  renderer.setStyle(document.documentElement, '--am-font-family', `"${fontFamily}", sans-serif`);
}
*/
/**
 * Apply a Google Font and set the CSS var --am-font-family using native DOM APIs.
 * Safe for use in environment_initializers (no Renderer2).
 */
export function applyFont(doc: Document, fontFamily: string) {
  if (!doc || !fontFamily) return;

  const linkId = `am_font_link_${slug(fontFamily)}`;
  const existing = doc.getElementById(linkId) as HTMLLinkElement | null;

  // Always set the CSS custom property (even if link already exists).
  doc.documentElement.style.setProperty('--am-font-family', `"${fontFamily}", sans-serif`);

  // If the stylesheet link is already present, nothing else to do.
  if (existing) return;

  // Optional: preconnects for faster font loading (added once).
  ensurePreconnect(doc, 'https://fonts.googleapis.com', 'am_font_pc_gfonts');
  ensurePreconnect(doc, 'https://fonts.gstatic.com', 'am_font_pc_gstatic', true);

  // Create and inject the Google Fonts stylesheet link.
  const link = doc.createElement('link');
  link.id = linkId;
  link.rel = 'stylesheet';
  link.href = buildGoogleFontsHref(fontFamily); // css2 endpoint with family & display
  doc.head.appendChild(link);
}

/** Build a css2 Google Fonts URL for a family name. */
function buildGoogleFontsHref(family: string): string {
  // Encode as css2 expects: spaces become '+', others URL-encoded.
  // We keep it minimal: just family + display=swap (weights/styles can be added later).
  const familyParam = encodeFamilyForCss2(family);
  const base = 'https://fonts.googleapis.com/css2';
  const params = new URLSearchParams({ family: familyParam, display: 'swap' });
  return `${base}?${params.toString()}`;
}

/** Encode family as "Inter" -> "Inter", "Open Sans" -> "Open+Sans", etc. */
function encodeFamilyForCss2(family: string): string {
  // Google Fonts accepts '+' for spaces; encode the rest safely.
  return family.trim().replace(/\s+/g, '+');
}

/** Simple slug for element ids. */
function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Add (or reuse) a preconnect link. */
function ensurePreconnect(doc: Document, href: string, id: string, crossOrigin = false) {
  if (doc.getElementById(id)) return;
  const link = doc.createElement('link');
  link.id = id;
  link.rel = 'preconnect';
  link.href = href;
  if (crossOrigin) link.crossOrigin = '';
  doc.head.appendChild(link);
}
