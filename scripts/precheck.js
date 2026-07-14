#!/usr/bin/env node
// Project-wide static precheck for wp-image-seo-tool. Pure Node built-ins,
// no dependencies to install - safe to run any time with `node scripts/precheck.js`.
//
// What this catches: purely mechanical, cross-referencing bugs - broken
// imports (typo'd/renamed export), dead DOM hooks (JS looks up an #id that
// no longer exists in index.html), missing files, duplicate HTML ids,
// unbalanced tags, PowerShell syntax errors, broken relative links in
// Markdown docs, and (as a heuristic, not a hard error) CSS selectors that
// don't match anything live in the project.
//
// Scans the whole repo tree (skipping .git) rather than a hardcoded file
// list, so a new .js/.ps1/.md file dropped in anywhere is automatically
// covered next run without needing to update this script.
//
// What this deliberately does NOT try to catch: logic bugs, race conditions,
// missing error handlers, accessibility gaps, edge-case math - anything that
// needs actually reading and reasoning about the code rather than just
// cross-referencing names. See docs/manual-review-checklist.md for that half.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const JS_DIR = path.join(ROOT, 'js');
const SCRIPTS_DIR = path.join(ROOT, 'scripts');
const HTML_FILE = path.join(ROOT, 'index.html');
const CSS_FILE = path.join(ROOT, 'css', 'style.css');
const EXCLUDE_DIRS = new Set(['.git', 'node_modules']);

const errors = [];
const warnings = [];

function rel(p) { return path.relative(ROOT, p).replace(/\\/g, '/'); }
function read(p) { return fs.readFileSync(p, 'utf8'); }

// Recursive so a future subdirectory (under js/, or anywhere else scanned
// below) is picked up automatically instead of silently going unchecked.
function findFiles(dir, ext) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findFiles(full, ext));
    else if (entry.name.endsWith(ext)) found.push(full);
  }
  return found;
}

// Node-run scripts (scripts/*.js, CommonJS) get the syntax check below
// alongside the browser app modules (js/*.js, ES modules) - `node
// --input-type=module --check` parses both fine since this is a syntax-only
// check (require()/module.exports are just ordinary expressions under
// module grammar too). They deliberately do NOT get the DOM-id/import-
// export cross-reference checks (sections 2-3) - those are naive text-based
// regex scans, not a real parser, and scripts/refactor-split-main.js embeds
// entire other files' source as string literals (the content it writes
// out), which those regexes can't tell apart from real import statements -
// confirmed by an actual false-positive run: it flagged that file's
// *embedded* `import ... from './languages.js'` text as if
// refactor-split-main.js itself imported it, and separately flagged this
// file's own explanatory comment two-hundred-some lines below (`// e.g.
// import Foo from './foo.js'`) as a real import too. appJsFiles (js/ only)
// keeps those two checks scoped to files that only ever contain *real*
// import/export statements, not string content that happens to look like some.
const appJsFiles = findFiles(JS_DIR, '.js');
const jsFiles = [...appJsFiles, ...findFiles(SCRIPTS_DIR, '.js')];
const htmlSrc = read(HTML_FILE);
const cssSrc = read(CSS_FILE);

// ---------------------------------------------------------------------------
// 1. JS syntax check - each file piped through `node --check` as an ES module.
// ---------------------------------------------------------------------------
for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ['--input-type=module', '--check'], {
    input: read(file),
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    errors.push(`[syntax] ${rel(file)}: ${result.stderr.trim().split('\n').slice(0, 2).join(' | ')}`);
  }
}

// ---------------------------------------------------------------------------
// 2. document.getElementById / getElementsByName cross-referenced against
//    index.html - a typo'd or stale id means the lookup silently returns
//    null/empty and the next line that uses it throws at runtime.
// ---------------------------------------------------------------------------
const htmlIds = new Set([...htmlSrc.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const htmlNames = new Set([...htmlSrc.matchAll(/\bname="([^"]+)"/g)].map((m) => m[1]));

for (const file of appJsFiles) {
  const src = read(file);
  for (const m of src.matchAll(/document\.getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    if (!htmlIds.has(m[1])) {
      errors.push(`[dom-id] ${rel(file)}: getElementById('${m[1]}') - no matching id="${m[1]}" in index.html`);
    }
  }
  for (const m of src.matchAll(/document\.getElementsByName\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    if (!htmlNames.has(m[1])) {
      errors.push(`[dom-name] ${rel(file)}: getElementsByName('${m[1]}') - no matching name="${m[1]}" in index.html`);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. ES module import/export cross-reference - a named import that the
//    target file doesn't actually export is a guaranteed
//    "X is not defined"/undefined-call crash the first time it's used.
// ---------------------------------------------------------------------------
function getExportedNames(src) {
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s+(?:const|let|var|class)\s+([A-Za-z0-9_$]+)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.split(/\s+as\s+/)[0].trim();
      if (name) names.add(name);
    }
  }
  if (/export\s+default\b/.test(src)) names.add('default');
  return names;
}

for (const file of appJsFiles) {
  const src = read(file);
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"](\.[^'"]+)['"]/g)) {
    const importedNames = m[1].split(',').map((s) => s.split(/\s+as\s+/)[0].trim()).filter(Boolean);
    const targetPath = path.resolve(path.dirname(file), m[2]);
    if (!fs.existsSync(targetPath)) {
      errors.push(`[import] ${rel(file)}: imports from '${m[2]}' - file does not exist (resolved: ${rel(targetPath)})`);
      continue;
    }
    const exported = getExportedNames(read(targetPath));
    for (const name of importedNames) {
      if (!exported.has(name)) {
        errors.push(`[import] ${rel(file)}: imports '${name}' from '${m[2]}' - not exported there`);
      }
    }
  }
  // Default imports, e.g. `import Foo from './foo.js'`
  for (const m of src.matchAll(/import\s+([A-Za-z0-9_$]+)\s*from\s*['"](\.[^'"]+)['"]/g)) {
    const targetPath = path.resolve(path.dirname(file), m[2]);
    if (!fs.existsSync(targetPath)) {
      errors.push(`[import] ${rel(file)}: default-imports from '${m[2]}' - file does not exist`);
      continue;
    }
    if (!getExportedNames(read(targetPath)).has('default')) {
      errors.push(`[import] ${rel(file)}: default-imports '${m[1]}' from '${m[2]}' - no default export there`);
    }
  }
}

// ---------------------------------------------------------------------------
// 4. <script src>/<link href> targets in index.html must exist on disk.
// ---------------------------------------------------------------------------
for (const m of htmlSrc.matchAll(/<(?:script[^>]*\ssrc|link[^>]*\shref)="([^"]+)"/g)) {
  const src = m[1];
  if (/^https?:\/\//.test(src)) continue; // external CDN URL, not a local file
  const target = path.resolve(ROOT, src);
  if (!fs.existsSync(target)) {
    errors.push(`[html-ref] index.html references '${src}' - file does not exist`);
  }
}

// ---------------------------------------------------------------------------
// 5. Duplicate id="..." in index.html (invalid HTML; getElementById only
//    ever finds the first one, silently breaking anything wired to the rest).
// ---------------------------------------------------------------------------
const idCounts = {};
for (const m of htmlSrc.matchAll(/\bid="([^"]+)"/g)) {
  idCounts[m[1]] = (idCounts[m[1]] || 0) + 1;
}
for (const [id, count] of Object.entries(idCounts)) {
  if (count > 1) errors.push(`[dup-id] index.html: id="${id}" appears ${count} times`);
}

// ---------------------------------------------------------------------------
// 6. Basic HTML tag-balance check (stack-based, void-element-aware). Not a
//    full HTML5 parser, but enough to catch a missing/extra closing tag.
// ---------------------------------------------------------------------------
const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
{
  const noComments = htmlSrc.replace(/<!--[\s\S]*?-->/g, '');
  const stack = [];
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let m;
  while ((m = tagRe.exec(noComments))) {
    const [, closing, name, , selfClosing] = m;
    const tag = name.toLowerCase();
    if (closing) {
      if (VOID_ELEMENTS.has(tag)) continue;
      const top = stack.pop();
      if (!top || top !== tag) {
        errors.push(`[html-tags] index.html: found </${tag}> but innermost open tag was ${top ? `<${top}>` : '(none)'}`);
        if (top) stack.push(top); // best-effort recovery so one mismatch doesn't cascade into noise
      }
    } else if (!VOID_ELEMENTS.has(tag) && !selfClosing) {
      stack.push(tag);
    }
  }
  if (stack.length) {
    errors.push(`[html-tags] index.html: unclosed tag(s) at end of file: ${stack.join(', ')}`);
  }
}

// ---------------------------------------------------------------------------
// 7. CSS selectors (#id / .class) that don't match anything in index.html or
//    any JS string literal - heuristic, reported as warnings since dynamic
//    class construction can produce false positives.
// ---------------------------------------------------------------------------
{
  const cssNoComments = cssSrc.replace(/\/\*[\s\S]*?\*\//g, '');
  const ruleBlocks = [...cssNoComments.matchAll(/([^{}]+)\{/g)].map((m) => m[1]);
  const selectorTokens = new Set();
  for (const block of ruleBlocks) {
    for (const selector of block.split(',')) {
      for (const tokenMatch of selector.matchAll(/([.#][A-Za-z0-9_-]+)/g)) {
        selectorTokens.add(tokenMatch[1]);
      }
    }
  }
  const allJsSrc = jsFiles.map(read).join('\n');
  for (const token of selectorTokens) {
    const bare = token.slice(1);
    const inHtml = token[0] === '#' ? htmlSrc.includes(`id="${bare}"`) : htmlSrc.includes(`class="${bare}"`) || htmlSrc.includes(` ${bare}"`) || htmlSrc.includes(` ${bare} `);
    // Word-boundary search rather than requiring an exact quoted-string match -
    // classes are often built via concatenation (e.g. 'ovResizeHandle ' + corner),
    // so an exact-literal check produces false positives for those.
    const inJs = new RegExp(`\\b${bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(allJsSrc);
    if (!inHtml && !inJs) {
      warnings.push(`[css-orphan] css/style.css: selector "${token}" doesn't appear to match anything in index.html or any .js file`);
    }
  }
}

// ---------------------------------------------------------------------------
// 8. PowerShell syntax check (docs/archive-done.ps1 and any other .ps1 in the
//    repo) - parse-only via the PowerShell AST parser, never actually run,
//    so this is safe even for scripts (like archive-done.ps1) that mutate
//    real files when executed for real.
// ---------------------------------------------------------------------------
const ps1Files = findFiles(ROOT, '.ps1');
if (ps1Files.length) {
  const probe = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', 'exit 0']);
  if (probe.error) {
    warnings.push(`[skip] PowerShell not found on PATH - skipped syntax check for ${ps1Files.length} .ps1 file(s)`);
  } else {
    for (const file of ps1Files) {
      const escaped = file.replace(/'/g, "''");
      const result = spawnSync('powershell', [
        '-NoProfile', '-NonInteractive', '-Command',
        `$tokens=$null; $errs=$null; [void][System.Management.Automation.Language.Parser]::ParseFile('${escaped}', [ref]$tokens, [ref]$errs); if ($errs.Count -gt 0) { $errs | ForEach-Object { Write-Output $_.Message }; exit 1 }`
      ], { encoding: 'utf8' });
      if (result.status !== 0) {
        const msg = (result.stdout || result.stderr || 'parse error').trim().split('\n').slice(0, 3).join(' | ');
        errors.push(`[syntax] ${rel(file)}: ${msg}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 9. Markdown relative-link check (CLAUDE.md, README.md, 實作進度.md,
//    docs/*.md) - a link to a moved/renamed/deleted file is a mechanically
//    certain bug, same class as the html-ref check above. Skips external
//    (http/https/mailto) links and pure-anchor (#section) links; a
//    path#anchor link is checked on its path part only.
// ---------------------------------------------------------------------------
const mdFiles = findFiles(ROOT, '.md');
for (const file of mdFiles) {
  const src = read(file);
  for (const m of src.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const raw = m[1].trim();
    if (!raw || /^(https?:)?\/\//.test(raw) || raw.startsWith('mailto:') || raw.startsWith('#')) continue;
    const linkPath = raw.split('#')[0];
    if (!linkPath) continue;
    let target;
    try {
      target = path.resolve(path.dirname(file), decodeURIComponent(linkPath));
    } catch {
      continue; // malformed %-escape - not this check's concern
    }
    if (!fs.existsSync(target)) {
      errors.push(`[md-link] ${rel(file)}: link to '${raw}' - target does not exist (resolved: ${rel(target)})`);
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
console.log(`Checked ${jsFiles.length} JS file(s), index.html, css/style.css, ${ps1Files.length} .ps1 file(s), ${mdFiles.length} .md file(s).\n`);

if (errors.length) {
  console.log(`ERRORS (${errors.length}) - mechanically certain bugs:`);
  for (const e of errors) console.log('  ✗ ' + e);
  console.log('');
}
if (warnings.length) {
  console.log(`WARNINGS (${warnings.length}) - heuristic, needs human triage:`);
  for (const w of warnings) console.log('  ? ' + w);
  console.log('');
}
if (!errors.length && !warnings.length) {
  console.log('Nothing found.');
}

process.exit(errors.length ? 1 : 0);
