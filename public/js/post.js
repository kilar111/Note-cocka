// post.js
// Loads a single post by id and renders full details + Drive links.

function getQueryParam(name) {
  const url = new URL(window.location.href);
  return url.searchParams.get(name);
}

function showError(msg) {
  const error = document.getElementById('error');
  error.style.display = 'block';
  error.textContent = msg;
}

function setStatus(msg) {
  const status = document.getElementById('status');
  status.textContent = msg;
}

function safeUrl(url) {
  // Basic allow-list: only http(s) links.
  // Also supports pasted links without scheme (e.g. "drive.google.com/...").
  const raw = String(url || '').trim();
  if (!raw) return '';

  let candidate = raw;
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  try {
    const u = new URL(candidate);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
  } catch {
    // ignore
  }
  return '';
}

function parseLinkEntry(raw) {
  // Supports common admin input formats:
  // - "Lecture Notes: https://drive.google.com/..."
  // - "Lecture Notes - https://drive.google.com/..."
  // - "https://drive.google.com/..." (falls back to a generic label)
  // - "Section Heading:" (no URL -> rendered as a non-clickable header)
  const text = String(raw || '').trim();
  if (!text) return { label: '', url: '' };

  // Find a URL-ish substring.
  const m = text.match(/(https?:\/\/\S+)/i) || text.match(/(www\.\S+)/i) || text.match(/(drive\.google\.com\S+)/i);
  const urlPart = m ? m[1] : '';
  const url = safeUrl(urlPart || '');

  let label = '';
  if (m && typeof m.index === 'number') {
    label = text.slice(0, m.index).trim();
    label = label.replace(/[\s:\-–|]+$/g, '').trim();
  }

  // If no explicit label (e.g., only a URL), keep it student-friendly.
  if (!label && url) {
    try {
      const u = new URL(url);
      if (u.hostname.includes('drive.google.com')) return { label: 'Open Google Drive file', url };
      return { label: 'Open link', url };
    } catch {
      return { label: 'Open link', url };
    }
  }

  // If there is no valid URL, treat the line as a section header.
  if (!url) {
    return { label: text.replace(/[:\-–|]+$/g, '').trim(), url: '' };
  }

  return { label: label || 'Open link', url };
}

async function init() {
  const id = getQueryParam('id');
  if (!id) {
    showError('Missing post id.');
    return;
  }

  setStatus('Loading...');
  const res = await fetch(`/api/posts/${encodeURIComponent(id)}`);
  const data = await res.json();

  if (!res.ok) {
    showError(data.error || 'Failed to load post');
    setStatus('');
    return;
  }

  const post = data.post;

  document.title = post.title || 'Post Details';

  document.getElementById('postTitle').textContent = post.title || '';
  document.getElementById('postDescription').textContent = post.description || '';
  document.getElementById('postCategory').textContent = post.category || 'Uncategorized';

  // Optional: original source link (e.g., Facebook post)
  const sourceWrap = document.getElementById('sourceWrap');
  const sourceLink = document.getElementById('sourceLink');
  if (post.sourceUrl) {
    const url = safeUrl(post.sourceUrl);
    if (url) {
      sourceLink.href = url;
      sourceWrap.style.display = 'block';
    }
  }

  const img = document.getElementById('postImage');
  if (post.imagePath) {
    img.src = post.imagePath;
  } else {
    // Keep the gradient background if no image
    img.removeAttribute('src');
  }

  const list = document.getElementById('driveLinks');
  list.innerHTML = '';

  const links = Array.isArray(post.driveLinks) ? post.driveLinks : [];
  if (links.length === 0) {
    const div = document.createElement('div');
    div.className = 'helper';
    div.textContent = 'No Drive links added yet.';
    list.appendChild(div);
  } else {
    for (const raw of links) {
      const parsed = parseLinkEntry(raw);
      const item = document.createElement('div');
      item.className = 'link-item';

      if (!parsed.url) {
        item.classList.add('link-header');
        item.textContent = parsed.label;
        list.appendChild(item);
        continue;
      }

      // Show only the name/label (hide raw URL), but still open the URL in a new tab.
      const a = document.createElement('a');
      a.className = 'drive-btn';
      a.href = parsed.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = parsed.label;

      // Extra safety: some environments may not respect target=_blank.
      // User-initiated window.open should work in most browsers.
      a.addEventListener('click', (e) => {
        e.preventDefault();
        window.open(parsed.url, '_blank', 'noopener,noreferrer');
      });

      item.appendChild(a);
      list.appendChild(item);
    }
  }

  document.getElementById('post').style.display = 'block';
  setStatus('');
}

init().catch(() => showError('Unexpected error loading post.'));
