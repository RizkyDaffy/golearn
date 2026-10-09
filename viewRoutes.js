const fs = require('fs');
const path = require('path');

// Helper to sanitize filename and prevent directory traversal
function getSafeFileName(name) {
    if (!name) return null;
    const decoded = decodeURIComponent(name).trim();
    const base = path.basename(decoded);
    return base;
}

// Helper to escape HTML text when rendering plain strings
function escapeHtml(str) {
    if (typeof str !== 'string') return String(str ?? '');
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Clean question text that might have safe HTML tags
function formatQuestionContent(text) {
    if (!text) return '';
    // If the text contains HTML tags (like <strong>, <span>, <p>, etc.),
    // keep it clean while disabling script or event handlers
    let sanitized = String(text)
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '');
    return sanitized;
}

/**
 * Renders GET /view/list
 * Clean, minimal, distraction-free HTML. Almost no styling at all.
 */
function renderListView(files) {
    const fileItems = files.map((item, idx) => {
        const displayName = item.name.replace(/\.json$/i, '');
        const encodedUrl = `/view/${encodeURIComponent(item.name.replace(/\.json$/i, ''))}`;
        const metaText = item.count !== null 
            ? `(${item.count} items · ${item.sizeKb} KB)`
            : `(${item.sizeKb} KB)`;

        return `    <li><a href="${encodedUrl}">${escapeHtml(displayName)}</a> <span class="meta">${metaText}</span></li>`;
    }).join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>View List</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.6;
      margin: 40px auto;
      max-width: 650px;
      padding: 0 20px;
      color: #1a1a1a;
      background: #ffffff;
    }
    h2 {
      font-size: 1.25rem;
      font-weight: 600;
      margin-bottom: 4px;
    }
    p.subtitle {
      font-size: 0.9rem;
      color: #666;
      margin-top: 0;
      margin-bottom: 24px;
    }
    ol {
      padding-left: 24px;
      margin: 0;
    }
    li {
      margin-bottom: 10px;
      font-size: 1rem;
    }
    a {
      color: #0969da;
      text-decoration: none;
      font-weight: 500;
    }
    a:hover {
      text-decoration: underline;
    }
    .meta {
      color: #6e7781;
      font-size: 0.85rem;
      margin-left: 6px;
    }
    .empty {
      color: #666;
      font-style: italic;
    }
  </style>
</head>
<body>
  <h2>Files</h2>
  <p class="subtitle">Select a file to view questions and inspect details:</p>
  ${files.length > 0 ? `<ol>\n${fileItems}\n  </ol>` : '<p class="empty">No JSON files found in questions folder.</p>'}
</body>
</html>`;
}

/**
 * Renders GET /view/:name
 * Comfortable reading style with bottom toolbar (search, filter, jump, font size, copy, theme toggle).
 */
function renderDetailView(fileName, jsonData, fileSizeKb) {
    const isQuestionList = Array.isArray(jsonData) && jsonData.length > 0 && (jsonData[0].teks_soal !== undefined || jsonData[0].id_soal !== undefined);
    const totalCount = Array.isArray(jsonData) ? jsonData.length : 1;
    
    let pilganCount = 0;
    let essayCount = 0;
    if (isQuestionList) {
        jsonData.forEach(q => {
            if (q.tipe_soal === 'PILGAN') pilganCount++;
            else if (q.tipe_soal === 'ESSAY') essayCount++;
        });
    }

    // Safely serialize raw JSON for the client
    const jsonString = JSON.stringify(jsonData, null, 2);
    const safeEmbeddedJson = JSON.stringify(jsonData).replace(/</g, '\\u003c');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(fileName)} - View</title>
  
  <!-- KaTeX for formula rendering -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css">
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.js"></script>

  <style>
    :root {
      --bg: #f8fafc;
      --card-bg: #ffffff;
      --text: #1e293b;
      --text-muted: #64748b;
      --border: #e2e8f0;
      --primary: #2563eb;
      --primary-hover: #1d4ed8;
      --badge-pilgan-bg: #eff6ff;
      --badge-pilgan-text: #1d4ed8;
      --badge-essay-bg: #faf5ff;
      --badge-essay-text: #7e22ce;
      --correct-bg: #f0fdf4;
      --correct-border: #86efac;
      --correct-text: #166534;
      --highlight: #fef08a;
      --highlight-active: #fde047;
      --toolbar-bg: rgba(255, 255, 255, 0.92);
      --toolbar-border: #cbd5e1;
      --toolbar-shadow: 0 -4px 18px rgba(0, 0, 0, 0.08);
      --code-bg: #0f172a;
      --code-text: #e2e8f0;
      --font-scale: 16px;
    }

    [data-theme="dark"] {
      --bg: #0b0f19;
      --card-bg: #151d2e;
      --text: #e2e8f0;
      --text-muted: #94a3b8;
      --border: #243048;
      --primary: #3b82f6;
      --primary-hover: #60a5fa;
      --badge-pilgan-bg: #1e293b;
      --badge-pilgan-text: #60a5fa;
      --badge-essay-bg: #2d1e3d;
      --badge-essay-text: #c084fc;
      --correct-bg: #064e3b;
      --correct-border: #059669;
      --correct-text: #a7f3d0;
      --highlight: #854d0e;
      --highlight-active: #ca8a04;
      --toolbar-bg: rgba(21, 29, 46, 0.94);
      --toolbar-border: #334155;
      --toolbar-shadow: 0 -4px 20px rgba(0, 0, 0, 0.4);
      --code-bg: #080c14;
      --code-text: #f1f5f9;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: var(--font-scale);
      line-height: 1.65;
      color: var(--text);
      background-color: var(--bg);
      padding: 24px 20px 110px 20px; /* bottom padding so toolbar doesn't cover content */
      transition: background-color 0.2s, color 0.2s, font-size 0.15s;
    }

    .container {
      max-width: 860px;
      margin: 0 auto;
    }

    /* Top Bar */
    .top-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
      padding-bottom: 20px;
      margin-bottom: 24px;
      border-bottom: 1px solid var(--border);
    }

    .nav-back {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--text-muted);
      text-decoration: none;
      font-size: 0.9rem;
      font-weight: 500;
      padding: 6px 12px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--card-bg);
      transition: all 0.15s;
    }
    .nav-back:hover {
      color: var(--primary);
      border-color: var(--primary);
    }

    .file-info {
      display: flex;
      align-items: baseline;
      gap: 10px;
      flex-wrap: wrap;
    }
    .file-title {
      font-size: 1.35rem;
      font-weight: 700;
      color: var(--text);
    }
    .file-badge {
      font-size: 0.8rem;
      color: var(--text-muted);
      background: var(--card-bg);
      border: 1px solid var(--border);
      padding: 3px 8px;
      border-radius: 999px;
    }

    .view-toggle-btn {
      padding: 6px 14px;
      font-size: 0.85rem;
      font-weight: 500;
      border: 1px solid var(--border);
      background: var(--card-bg);
      color: var(--text);
      border-radius: 6px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s;
    }
    .view-toggle-btn:hover {
      border-color: var(--primary);
      color: var(--primary);
    }

    /* Question Cards */
    .question-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 24px;
      margin-bottom: 20px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .question-card:hover {
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
    }
    .question-card.highlight-card {
      border-color: #eab308;
      outline: 2px solid #facc15;
    }
    .question-card.hidden {
      display: none !important;
    }

    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border);
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .q-number {
      font-weight: 700;
      font-size: 1rem;
      color: var(--text);
    }

    .q-badge {
      font-size: 0.75rem;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.025em;
    }
    .badge-pilgan {
      background: var(--badge-pilgan-bg);
      color: var(--badge-pilgan-text);
      border: 1px solid rgba(37, 99, 235, 0.2);
    }
    .badge-essay {
      background: var(--badge-essay-bg);
      color: var(--badge-essay-text);
      border: 1px solid rgba(126, 34, 206, 0.2);
    }

    .q-meta-pill {
      font-size: 0.75rem;
      color: var(--text-muted);
    }

    /* Context / Passage */
    .context-box {
      background: rgba(37, 99, 235, 0.05);
      border-left: 4px solid var(--primary);
      padding: 12px 16px;
      border-radius: 0 6px 6px 0;
      margin-bottom: 16px;
      font-size: 0.95em;
      color: var(--text);
    }
    .context-label {
      font-size: 0.75rem;
      font-weight: 700;
      color: var(--primary);
      text-transform: uppercase;
      margin-bottom: 4px;
      letter-spacing: 0.05em;
    }

    /* Question Body */
    .question-text {
      font-size: 1.05em;
      line-height: 1.7;
      margin-bottom: 18px;
      color: var(--text);
      word-break: break-word;
    }

    .question-media {
      margin: 12px 0 18px 0;
    }
    .question-media img {
      max-width: 100%;
      height: auto;
      border-radius: 6px;
      border: 1px solid var(--border);
    }

    /* Options */
    .options-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 16px;
    }

    .option-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--bg);
      transition: background 0.1s, border-color 0.1s;
      font-size: 0.98em;
    }
    .option-item.correct {
      background: var(--correct-bg);
      border-color: var(--correct-border);
      color: var(--correct-text);
    }

    .option-label {
      flex-shrink: 0;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 0.85rem;
      background: var(--card-bg);
      border: 1px solid var(--border);
      color: var(--text);
    }
    .option-item.correct .option-label {
      background: #10b981;
      color: #ffffff;
      border-color: #10b981;
    }
    [data-theme="dark"] .option-item.correct .option-label {
      background: #6ee7b7;
      color: #064e3b;
      border-color: #6ee7b7;
    }

    .option-content {
      flex: 1;
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      line-height: 1.5;
    }

    .option-text {
      font-weight: 500;
    }

    .correct-tag {
      font-size: 0.75rem;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 4px;
      background: rgba(22, 101, 52, 0.15);
      color: var(--correct-text);
      display: inline-flex;
      align-items: center;
    }
    [data-theme="dark"] .correct-tag {
      background: rgba(167, 243, 208, 0.15);
      color: #a7f3d0;
    }

    /* Details Toggle */
    details.raw-meta {
      margin-top: 14px;
      padding-top: 10px;
      border-top: 1px dashed var(--border);
      font-size: 0.8rem;
      color: var(--text-muted);
    }
    details.raw-meta summary {
      cursor: pointer;
      user-select: none;
      font-weight: 500;
      color: var(--text-muted);
    }
    details.raw-meta summary:hover {
      color: var(--text);
    }
    .meta-table {
      margin-top: 8px;
      width: 100%;
      font-size: 0.8rem;
      border-collapse: collapse;
    }
    .meta-table td {
      padding: 3px 6px;
      border-bottom: 1px solid var(--border);
    }
    .meta-table td.key {
      font-weight: 600;
      width: 140px;
      color: var(--text-muted);
    }

    /* Formatted JSON Mode Container */
    #rawJsonContainer {
      display: none;
      background: var(--code-bg);
      color: var(--code-text);
      padding: 20px;
      border-radius: 10px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.9rem;
      line-height: 1.5;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-word;
      border: 1px solid var(--border);
    }

    /* Search Highlighting */
    mark.search-highlight {
      background: var(--highlight);
      color: inherit;
      padding: 1px 3px;
      border-radius: 3px;
    }
    mark.search-highlight.active-match {
      background: var(--highlight-active);
      outline: 2px solid #ca8a04;
      font-weight: 700;
    }

    /* BOTTOM TOOLBAR */
    .bottom-toolbar {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: var(--toolbar-bg);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      border-top: 1px solid var(--toolbar-border);
      box-shadow: var(--toolbar-shadow);
      padding: 10px 16px;
      z-index: 9999;
    }

    .toolbar-inner {
      max-width: 1000px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 10px;
    }

    .toolbar-section {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }

    /* Search Box */
    .search-box-wrap {
      display: flex;
      align-items: center;
      position: relative;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 2px 8px;
    }
    .search-box-wrap:focus-within {
      border-color: var(--primary);
      box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
    }

    .search-input {
      border: none;
      background: transparent;
      outline: none;
      font-size: 0.85rem;
      color: var(--text);
      padding: 5px 4px;
      width: 180px;
      min-width: 130px;
    }
    .search-input::placeholder {
      color: var(--text-muted);
    }

    .match-indicator {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-right: 4px;
      white-space: nowrap;
      min-width: 45px;
      text-align: right;
    }

    /* Toolbar Buttons */
    .tb-btn {
      border: 1px solid var(--border);
      background: var(--card-bg);
      color: var(--text);
      padding: 6px 10px;
      font-size: 0.8rem;
      font-weight: 500;
      border-radius: 6px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      transition: all 0.15s;
      white-space: nowrap;
    }
    .tb-btn:hover {
      border-color: var(--primary);
      color: var(--primary);
    }
    .tb-btn.active {
      background: var(--primary);
      border-color: var(--primary);
      color: #ffffff;
    }
    .tb-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .filter-pills {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .filter-pill {
      font-size: 0.75rem;
      padding: 4px 8px;
      border-radius: 20px;
      border: 1px solid var(--border);
      background: var(--card-bg);
      color: var(--text-muted);
      cursor: pointer;
    }
    .filter-pill.active {
      background: var(--primary);
      color: #ffffff;
      border-color: var(--primary);
    }

    /* Jump selector */
    .jump-select {
      border: 1px solid var(--border);
      background: var(--card-bg);
      color: var(--text);
      padding: 5px 8px;
      font-size: 0.8rem;
      border-radius: 6px;
      outline: none;
      cursor: pointer;
    }

    /* Toast Notification */
    .toast {
      position: fixed;
      bottom: 75px;
      right: 24px;
      background: #10b981;
      color: #ffffff;
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 0.85rem;
      font-weight: 600;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s, transform 0.2s;
      transform: translateY(10px);
      z-index: 10000;
    }
    .toast.show {
      opacity: 1;
      transform: translateY(0);
    }

    @media (max-width: 640px) {
      body {
        padding-bottom: 140px;
      }
      .toolbar-inner {
        justify-content: center;
      }
      .search-input {
        width: 140px;
      }
      .hide-mobile {
        display: none !important;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Top Bar -->
    <header class="top-bar">
      <div class="file-info">
        <a href="/view/list" class="nav-back">← List</a>
        <h1 class="file-title">${escapeHtml(fileName)}</h1>
        <span class="file-badge">${totalCount} item${totalCount !== 1 ? 's' : ''} · ${fileSizeKb} KB</span>
      </div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <button id="toggleViewBtn" class="view-toggle-btn" title="Toggle between reading cards and formatted JSON">
          { } Raw JSON
        </button>
      </div>
    </header>

    <!-- Reading Mode: Structured Cards Container -->
    <main id="cardsContainer">
      ${isQuestionList ? renderQuestionCardsHtml(jsonData) : renderGenericJsonCards(jsonData)}
    </main>

    <!-- Formatted JSON Mode Container -->
    <pre id="rawJsonContainer"><code>${escapeHtml(jsonString)}</code></pre>
  </div>

  <!-- BOTTOM TOOLBAR -->
  <footer class="bottom-toolbar">
    <div class="toolbar-inner">
      <!-- Search Tool -->
      <div class="toolbar-section">
        <div class="search-box-wrap">
          <input 
            type="text" 
            id="searchInput" 
            class="search-input" 
            placeholder="Search questions... (/)" 
            autocomplete="off"
          />
          <span id="matchIndicator" class="match-indicator">0/0</span>
        </div>
        <button id="prevMatchBtn" class="tb-btn" title="Previous match (Shift+Enter)" disabled>▲</button>
        <button id="nextMatchBtn" class="tb-btn" title="Next match (Enter)" disabled>▼</button>
      </div>

      <!-- Filter by Question Type (PILGAN / ESSAY) -->
      ${isQuestionList ? `
      <div class="toolbar-section hide-mobile">
        <div class="filter-pills">
          <button class="filter-pill active" data-filter="all">All (${totalCount})</button>
          ${pilganCount > 0 ? `<button class="filter-pill" data-filter="PILGAN">Pilgan (${pilganCount})</button>` : ''}
          ${essayCount > 0 ? `<button class="filter-pill" data-filter="ESSAY">Essay (${essayCount})</button>` : ''}
        </div>
      </div>
      ` : ''}

      <!-- Jump to Question -->
      ${isQuestionList ? `
      <div class="toolbar-section hide-mobile">
        <select id="jumpSelect" class="jump-select" title="Jump to question">
          <option value="">Jump to #...</option>
          ${jsonData.map((_, i) => `<option value="${i + 1}">#${i + 1}</option>`).join('')}
        </select>
      </div>
      ` : ''}

      <!-- Reading Comfort Tools & Utilities -->
      <div class="toolbar-section">
        <button id="fontDecBtn" class="tb-btn" title="Decrease font size">A-</button>
        <button id="fontIncBtn" class="tb-btn" title="Increase font size">A+</button>
        <button id="themeToggleBtn" class="tb-btn" title="Toggle dark/light theme">🌓</button>
        <button id="copyJsonBtn" class="tb-btn" title="Copy entire JSON to clipboard">📋 Copy</button>
        <button id="scrollTopBtn" class="tb-btn" title="Scroll to top">↑</button>
        <button id="scrollBottomBtn" class="tb-btn" title="Scroll to bottom">↓</button>
      </div>
    </div>
  </footer>

  <!-- Toast Popup -->
  <div id="toast" class="toast">Copied to clipboard!</div>

  <!-- Raw JSON Data embedded safely -->
  <script id="rawJsonData" type="application/json">${safeEmbeddedJson}</script>

  <script>
    (function() {
      // Elements
      const searchInput = document.getElementById('searchInput');
      const matchIndicator = document.getElementById('matchIndicator');
      const prevMatchBtn = document.getElementById('prevMatchBtn');
      const nextMatchBtn = document.getElementById('nextMatchBtn');
      const cardsContainer = document.getElementById('cardsContainer');
      const rawJsonContainer = document.getElementById('rawJsonContainer');
      const toggleViewBtn = document.getElementById('toggleViewBtn');
      const fontDecBtn = document.getElementById('fontDecBtn');
      const fontIncBtn = document.getElementById('fontIncBtn');
      const themeToggleBtn = document.getElementById('themeToggleBtn');
      const copyJsonBtn = document.getElementById('copyJsonBtn');
      const scrollTopBtn = document.getElementById('scrollTopBtn');
      const scrollBottomBtn = document.getElementById('scrollBottomBtn');
      const jumpSelect = document.getElementById('jumpSelect');
      const filterPills = document.querySelectorAll('.filter-pill');
      const toast = document.getElementById('toast');

      // State
      let isJsonMode = false;
      let activeFontSize = 16;
      let matches = [];
      let currentMatchIndex = -1;
      let activeFilter = 'all';

      // KaTeX math rendering if available
      window.addEventListener('load', () => {
        if (window.katex) {
          document.querySelectorAll('.math').forEach(el => {
            try {
              katex.render(el.textContent.trim(), el, { throwOnError: false });
            } catch (e) {
              console.warn('KaTeX render error:', e);
            }
          });
        }
      });

      // 1. Theme Management (persisted in localStorage)
      const savedTheme = localStorage.getItem('welearn_theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      document.documentElement.setAttribute('data-theme', savedTheme);

      themeToggleBtn.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('welearn_theme', next);
      });

      // 2. Font Size Controls
      fontIncBtn.addEventListener('click', () => {
        if (activeFontSize < 24) {
          activeFontSize += 2;
          document.documentElement.style.setProperty('--font-scale', activeFontSize + 'px');
        }
      });
      fontDecBtn.addEventListener('click', () => {
        if (activeFontSize > 12) {
          activeFontSize -= 2;
          document.documentElement.style.setProperty('--font-scale', activeFontSize + 'px');
        }
      });

      // 3. Scroll to Top / Bottom
      scrollTopBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
      scrollBottomBtn.addEventListener('click', () => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));

      // 4. Toggle between Structured Reader & Formatted JSON
      toggleViewBtn.addEventListener('click', () => {
        isJsonMode = !isJsonMode;
        if (isJsonMode) {
          cardsContainer.style.display = 'none';
          rawJsonContainer.style.display = 'block';
          toggleViewBtn.textContent = '📖 Reader';
        } else {
          cardsContainer.style.display = 'block';
          rawJsonContainer.style.display = 'none';
          toggleViewBtn.textContent = '{ } Raw JSON';
        }
        // Re-run search in the new mode
        if (searchInput.value.trim()) {
          runSearch(searchInput.value.trim());
        }
      });

      // 5. Jump to Question
      if (jumpSelect) {
        jumpSelect.addEventListener('change', (e) => {
          const val = e.target.value;
          if (!val) return;
          const targetCard = document.getElementById('card-q-' + val);
          if (targetCard) {
            targetCard.classList.remove('hidden');
            targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            targetCard.classList.add('highlight-card');
            setTimeout(() => targetCard.classList.remove('highlight-card'), 2000);
          }
          jumpSelect.value = '';
        });
      }

      // 6. Filter by Type (PILGAN / ESSAY)
      filterPills.forEach(pill => {
        pill.addEventListener('click', () => {
          filterPills.forEach(p => p.classList.remove('active'));
          pill.classList.add('active');
          activeFilter = pill.getAttribute('data-filter');
          applyFilters();
        });
      });

      function applyFilters() {
        const cards = document.querySelectorAll('.question-card');
        cards.forEach(card => {
          const type = card.getAttribute('data-type');
          if (activeFilter === 'all' || type === activeFilter) {
            card.classList.remove('hidden');
          } else {
            card.classList.add('hidden');
          }
        });
        if (searchInput.value.trim()) {
          runSearch(searchInput.value.trim());
        }
      }

      // 7. Copy JSON with Toast
      copyJsonBtn.addEventListener('click', () => {
        const rawJsonEl = document.getElementById('rawJsonData');
        if (!rawJsonEl) return;
        const text = rawJsonEl.textContent;
        navigator.clipboard.writeText(text).then(() => {
          showToast('JSON copied to clipboard!');
        }).catch(() => {
          showToast('Failed to copy');
        });
      });

      function showToast(msg) {
        toast.textContent = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2200);
      }

      // 8. Search Engine & Highlighting
      let searchDebounce = null;
      searchInput.addEventListener('input', (e) => {
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => {
          runSearch(e.target.value.trim());
        }, 150);
      });

      // Keyboard shortcuts
      window.addEventListener('keydown', (e) => {
        // Press '/' or 'Ctrl+F' to focus search
        if ((e.key === '/' && document.activeElement !== searchInput) || (e.ctrlKey && e.key === 'f')) {
          e.preventDefault();
          searchInput.focus();
          searchInput.select();
        }
        // In search input: Enter = next, Shift+Enter = prev, Esc = clear
        if (document.activeElement === searchInput) {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) navigateMatch(-1);
            else navigateMatch(1);
          } else if (e.key === 'Escape') {
            searchInput.value = '';
            runSearch('');
            searchInput.blur();
          }
        }
      });

      prevMatchBtn.addEventListener('click', () => navigateMatch(-1));
      nextMatchBtn.addEventListener('click', () => navigateMatch(1));

      function clearHighlights(container) {
        const marks = container.querySelectorAll('mark.search-highlight');
        marks.forEach(m => {
          const parent = m.parentNode;
          parent.replaceChild(document.createTextNode(m.textContent), m);
          parent.normalize();
        });
      }

      function highlightTextNodes(node, query, matchesList) {
        if (node.nodeType === Node.TEXT_NODE) {
          const val = node.nodeValue;
          const idx = val.toLowerCase().indexOf(query.toLowerCase());
          if (idx !== -1) {
            const before = val.substring(0, idx);
            const matchText = val.substring(idx, idx + query.length);
            const after = val.substring(idx + query.length);

            const mark = document.createElement('mark');
            mark.className = 'search-highlight';
            mark.textContent = matchText;

            const frag = document.createDocumentFragment();
            if (before) frag.appendChild(document.createTextNode(before));
            frag.appendChild(mark);

            matchesList.push(mark);

            const nextNode = document.createTextNode(after);
            frag.appendChild(nextNode);

            node.parentNode.replaceChild(frag, node);
            if (after) {
              highlightTextNodes(nextNode, query, matchesList);
            }
          }
        } else if (node.nodeType === Node.ELEMENT_NODE && !['SCRIPT', 'STYLE', 'MARK'].includes(node.tagName)) {
          // If in reader mode and card is hidden by filter, skip
          if (node.classList && node.classList.contains('hidden')) return;
          Array.from(node.childNodes).forEach(child => highlightTextNodes(child, query, matchesList));
        }
      }

      function runSearch(query) {
        const activeContainer = isJsonMode ? rawJsonContainer : cardsContainer;
        clearHighlights(activeContainer);
        matches = [];
        currentMatchIndex = -1;

        if (!query) {
          matchIndicator.textContent = '0/0';
          prevMatchBtn.disabled = true;
          nextMatchBtn.disabled = true;
          return;
        }

        highlightTextNodes(activeContainer, query, matches);

        if (matches.length > 0) {
          prevMatchBtn.disabled = false;
          nextMatchBtn.disabled = false;
          navigateMatch(1); // Jump to first match
        } else {
          matchIndicator.textContent = '0/0';
          prevMatchBtn.disabled = true;
          nextMatchBtn.disabled = true;
        }
      }

      function navigateMatch(dir) {
        if (matches.length === 0) return;

        if (currentMatchIndex >= 0 && matches[currentMatchIndex]) {
          matches[currentMatchIndex].classList.remove('active-match');
        }

        currentMatchIndex += dir;
        if (currentMatchIndex >= matches.length) currentMatchIndex = 0;
        if (currentMatchIndex < 0) currentMatchIndex = matches.length - 1;

        const current = matches[currentMatchIndex];
        current.classList.add('active-match');
        current.scrollIntoView({ behavior: 'smooth', block: 'center' });

        matchIndicator.textContent = (currentMatchIndex + 1) + '/' + matches.length;
      }

    })();
  </script>
</body>
</html>`;
}

/**
 * Generates HTML for question items (Cards)
 */
function renderQuestionCardsHtml(questions) {
    return questions.map((q, idx) => {
        const qNum = idx + 1;
        const qId = q.id_soal ?? 'N/A';
        const type = (q.tipe_soal || 'PILGAN').toUpperCase();
        const weight = q.bobot_nilai ? `${q.bobot_nilai} pts` : '';
        const isEssay = type === 'ESSAY';

        // Options HTML - only show the right option
        let optionsHtml = '';
        if (Array.isArray(q.options) && q.options.length > 0) {
            const correctOptions = q.options.filter(opt => opt.is_jawaban_benar === 1 || opt.is_jawaban_benar === true || opt.is_jawaban_benar === '1');
            const targetOptions = correctOptions.length > 0 ? correctOptions : q.options;

            const opts = targetOptions.map(opt => {
                const isCorrect = opt.is_jawaban_benar === 1 || opt.is_jawaban_benar === true || opt.is_jawaban_benar === '1';
                const optText = formatQuestionContent(opt.teks_opsi);
                const optImage = opt.gambar_opsi 
                    ? `<div class="question-media"><img src="${escapeHtml(opt.gambar_opsi)}" alt="Option media" loading="lazy" /></div>` 
                    : '';

                return `
                <div class="option-item ${isCorrect ? 'correct' : ''}">
                  <div class="option-label">${escapeHtml(opt.label_opsi || '')}</div>
                  <div class="option-content">
                    <span class="option-text">${optText}</span>
                    ${isCorrect ? '<span class="correct-tag">✓ Correct Answer</span>' : ''}
                    ${optImage}
                  </div>
                </div>`;
            }).join('');

            optionsHtml = `<div class="options-list">${opts}</div>`;
        }

        // Essay Answer Key HTML
        let essayAnswerHtml = '';
        if (isEssay && q.kunci_jawaban) {
            essayAnswerHtml = `
            <div class="option-item correct essay-key-box" style="align-items: flex-start;">
              <div class="option-label" style="margin-top: 2px;">✓</div>
              <div class="option-content" style="display: block;">
                <div style="margin-bottom: 6px;">
                  <span class="correct-tag" style="margin-left: 0;">✓ Official Solution Key / Jawaban</span>
                </div>
                <div class="essay-answer-text" style="white-space: pre-line; line-height: 1.6; font-size: 0.95em; font-weight: 500;">${escapeHtml(q.kunci_jawaban)}</div>
              </div>
            </div>`;
        }

        // Context / Reading passage
        const contextHtml = q.teks_konteks ? `
            <div class="context-box">
              <div class="context-label">📖 Context / Reading Passage</div>
              <div>${formatQuestionContent(q.teks_konteks)}</div>
            </div>` : '';

        // Media
        const mediaHtml = q.gambar_soal ? `
            <div class="question-media">
              <img src="${escapeHtml(q.gambar_soal)}" alt="Question illustration" loading="lazy" />
            </div>` : '';

        const audioHtml = q.audio_soal ? `
            <div class="question-media">
              <audio controls src="${escapeHtml(q.audio_soal)}"></audio>
            </div>` : '';

        // Extra metadata details
        const metaEntries = [
            ['ID Soal', q.id_soal],
            ['ID Ujian', q.id_ujian],
            ['ID Guru', q.id_guru_pembuat],
            ['ID Grup', q.id_grup],
            ['Nama Grup', q.nama_grup],
            ['Created At', q.created_at]
        ].filter(([_, v]) => v !== null && v !== undefined);

        const metaRows = metaEntries.map(([k, v]) => `
            <tr>
              <td class="key">${escapeHtml(k)}</td>
              <td>${escapeHtml(v)}</td>
            </tr>`).join('');

        return `
        <article class="question-card" id="card-q-${qNum}" data-type="${type}" data-id="${qId}">
          <div class="card-header">
            <div class="header-left">
              <span class="q-number">#${qNum}</span>
              <span class="q-badge ${isEssay ? 'badge-essay' : 'badge-pilgan'}">${type}</span>
              ${weight ? `<span class="q-meta-pill">· ${escapeHtml(weight)}</span>` : ''}
              <span class="q-meta-pill">· ID: ${escapeHtml(qId)}</span>
            </div>
          </div>

          ${contextHtml}
          ${mediaHtml}
          ${audioHtml}

          <div class="question-text">
            ${formatQuestionContent(q.teks_soal)}
          </div>

          ${optionsHtml}
          ${essayAnswerHtml}

          <details class="raw-meta">
            <summary>More Info & IDs</summary>
            <table class="meta-table">
              ${metaRows}
            </table>
          </details>
        </article>`;
    }).join('\n');
}

/**
 * Fallback card viewer for arbitrary JSON (like manifest.json or non-question arrays/objects)
 */
function renderGenericJsonCards(data) {
    if (Array.isArray(data)) {
        return data.map((item, i) => `
            <div class="question-card">
              <div class="card-header">
                <span class="q-number">Item #${i + 1}</span>
              </div>
              <pre style="font-size: 0.9em; overflow-x: auto;"><code>${escapeHtml(JSON.stringify(item, null, 2))}</code></pre>
            </div>
        `).join('\n');
    }

    return `
        <div class="question-card">
          <div class="card-header">
            <span class="q-number">Object Root</span>
          </div>
          <pre style="font-size: 0.9em; overflow-x: auto;"><code>${escapeHtml(JSON.stringify(data, null, 2))}</code></pre>
        </div>
    `;
}

/**
 * Register the /view routes on Express application
 */
function registerViewRoutes(app, questionsDir) {
    // Redirect /view to /view/list
    app.get(['/view', '/view/'], (req, res) => {
        res.redirect('/view/list');
    });

    // 1. GET /view/list
    app.get('/view/list', async (req, res) => {
        try {
            if (!fs.existsSync(questionsDir)) {
                return res.send(renderListView([]));
            }

            const rawFiles = await fs.promises.readdir(questionsDir);
            // Include .json files (filter out manifest.json from main items list, or keep manifest)
            const jsonFiles = rawFiles
                .filter(f => f.toLowerCase().endsWith('.json') && f.toLowerCase() !== 'manifest.json')
                .sort();

            const fileInfos = [];
            for (const file of jsonFiles) {
                const filePath = path.join(questionsDir, file);
                try {
                    const stat = await fs.promises.stat(filePath);
                    const content = await fs.promises.readFile(filePath, 'utf-8');
                    let count = null;
                    try {
                        const parsed = JSON.parse(content);
                        if (Array.isArray(parsed)) count = parsed.length;
                    } catch (_) {}

                    fileInfos.push({
                        name: file,
                        sizeKb: Math.round(stat.size / 1024),
                        count
                    });
                } catch (err) {
                    console.error(`Error reading ${file}:`, err.message);
                }
            }

            res.send(renderListView(fileInfos));
        } catch (err) {
            console.error('Error in /view/list:', err);
            res.status(500).send('Error reading questions folder');
        }
    });

    // 2. GET /view/:name
    app.get('/view/:name', async (req, res) => {
        try {
            const rawName = req.params.name;
            const safeName = getSafeFileName(rawName);

            if (!safeName) {
                return res.status(400).send('Invalid file name');
            }

            // Find file with or without .json extension
            const candidates = [
                safeName.endsWith('.json') ? safeName : `${safeName}.json`,
                safeName
            ];

            let foundPath = null;
            let finalName = safeName;

            for (const candidate of candidates) {
                const candidatePath = path.join(questionsDir, candidate);
                if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
                    foundPath = candidatePath;
                    finalName = candidate;
                    break;
                }
            }

            if (!foundPath) {
                return res.status(404).send(`
                    <!DOCTYPE html>
                    <html lang="en">
                    <head><title>File Not Found</title></head>
                    <body style="font-family: sans-serif; padding: 40px; text-align: center;">
                        <h2>File Not Found: ${escapeHtml(safeName)}</h2>
                        <p><a href="/view/list" style="color: #0969da;">← Back to file list</a></p>
                    </body>
                    </html>
                `);
            }

            const rawContent = await fs.promises.readFile(foundPath, 'utf-8');
            const stat = await fs.promises.stat(foundPath);
            const fileSizeKb = Math.round(stat.size / 1024);

            let jsonData;
            try {
                jsonData = JSON.parse(rawContent);
            } catch (parseErr) {
                return res.status(500).send(`Invalid JSON in file: ${parseErr.message}`);
            }

            res.send(renderDetailView(finalName, jsonData, fileSizeKb));
        } catch (err) {
            console.error('Error in /view/:name:', err);
            res.status(500).send('Error rendering view');
        }
    });
}

module.exports = {
    registerViewRoutes
};
