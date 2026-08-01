import {
  ERROR_CATALOG_ENTRIES,
  errorTypeSlug,
  type ErrorTypeDoc,
} from '@nestjs-fastify-nx/contracts';

// Production CSP allows neither inline <style> nor inline <script>, so these pages are plain
// semantic HTML. Nothing here interpolates caller-controlled input — an unknown slug is answered
// with a 404 problem document before any rendering happens.
const DOC_HEAD = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`;

function layout(title: string, body: string): string {
  return `${DOC_HEAD}<title>${title}</title></head>
<body>
${body}
<hr>
<p><small>Error responses follow <a href="https://www.rfc-editor.org/rfc/rfc9457">RFC 9457</a>
(<code>application/problem+json</code>). Include the <code>requestId</code> from the response body
when reporting a problem.</small></p>
</body>
</html>`;
}

export function renderErrorDocPage(doc: ErrorTypeDoc): string {
  return layout(
    `${doc.title} — API errors`,
    `<h1>${doc.title}</h1>
<dl>
<dt>Error code</dt><dd><code>${doc.code}</code></dd>
<dt>HTTP status</dt><dd>${doc.status}</dd>
</dl>
<h2>What it means</h2>
<p>${doc.meaning}</p>
<h2>How to resolve it</h2>
<p>${doc.resolution}</p>
<p><a href="/errors">All error types</a></p>`,
  );
}

export function renderErrorIndexPage(): string {
  const rows = ERROR_CATALOG_ENTRIES.map(
    (doc) =>
      `<tr><td>${doc.status}</td><td><a href="/errors/${errorTypeSlug(doc.code)}"><code>${doc.code}</code></a></td><td>${doc.title}</td></tr>`,
  ).join('\n');

  return layout(
    'API error types',
    `<h1>API error types</h1>
<p>Every error response carries a <code>type</code> URI pointing at one of these pages, and a
<code>code</code> that is stable across releases — key client-side handling off <code>code</code>.</p>
<table>
<thead><tr><th>Status</th><th>Code</th><th>Meaning</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`,
  );
}
