// index.js
// Fetch posts from backend, render responsive cards, and filter instantly on the frontend.

let allPosts = [];

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return '';
  }
}

function matchesQuery(post, q) {
  if (!q) return true;
  const hay = `${post.title} ${post.description} ${post.category}`.toLowerCase();
  return hay.includes(q);
}

function renderPosts(posts) {
  const grid = document.getElementById('postsGrid');
  const empty = document.getElementById('emptyState');
  const stats = document.getElementById('stats');

  grid.innerHTML = '';

  stats.textContent = `${posts.length} post(s) shown`;

  if (posts.length === 0) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  for (const post of posts) {
    const card = el('article', 'card');

    const img = el('img', 'card-img');
    img.alt = post.title || 'Post image';
    img.loading = 'lazy';
    if (post.imagePath) img.src = post.imagePath;

    const body = el('div', 'card-body');

    const badge = el('div', 'badge');
    badge.textContent = post.category || 'Uncategorized';

    const title = el('h3', 'card-title');
    title.textContent = post.title || '';

    const desc = el('p', 'card-desc');
    // Short description snippet
    const snippet = (post.description || '').slice(0, 120);
    desc.textContent = (post.description || '').length > 120 ? `${snippet}...` : snippet;

    const meta = el('div', 'meta');
    meta.textContent = post.createdAt ? `Posted: ${formatDate(post.createdAt)}` : '';

    body.appendChild(badge);
    body.appendChild(title);
    body.appendChild(desc);
    body.appendChild(meta);

    card.appendChild(img);
    card.appendChild(body);

    // Clicking a card opens a NEW page (post detail page)
    card.addEventListener('click', () => {
      window.location.href = `/post?id=${encodeURIComponent(post.id)}`;
    });

    grid.appendChild(card);
  }
}

async function loadPosts() {
  const empty = document.getElementById('emptyState');
  try {
    const res = await fetch('/api/posts', { cache: 'no-store' });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    allPosts = data.posts || [];
    if (empty) empty.textContent = 'No posts yet.';
    renderPosts(allPosts);
  } catch (err) {
    allPosts = [];
    if (empty) {
      empty.textContent = 'Posts load වෙන්නේ නැහැ. Page එක refresh කරන්න, නැත්නම් ටිකකින් try කරන්න.';
    }
    renderPosts([]);
    console.error('Failed to load posts:', err);
  }
}

function wireSearch() {
  const input = document.getElementById('searchInput');
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    const filtered = allPosts.filter((p) => matchesQuery(p, q));
    renderPosts(filtered);
  });
}

(async function init() {
  wireSearch();
  await loadPosts();
})();
