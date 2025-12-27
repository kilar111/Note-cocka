// index.js
// Fetch posts from backend, render responsive cards, and filter instantly on the frontend.

let allPosts = [];
let selectedCategory = 'All';
let selectedQuery = '';

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

function matchesCategory(post, category) {
  if (!category || category === 'All') return true;
  return String(post.category || '').trim().toLowerCase() === String(category).trim().toLowerCase();
}

function applyFilters() {
  const q = String(selectedQuery || '').trim().toLowerCase();
  const filtered = allPosts.filter((p) => matchesCategory(p, selectedCategory) && matchesQuery(p, q));
  renderPosts(filtered);
}

function uniqueCategoriesFromPosts(posts) {
  const set = new Set();
  for (const p of posts) {
    const c = String(p.category || '').trim();
    if (c) set.add(c);
  }
  return Array.from(set);
}

function buildCategoryList(posts) {
  // Keep the requested common subjects visible, but also include any real categories found.
  const preferred = ['All', 'Art', 'Maths', 'Physics', 'Chemistry', 'Biology', 'ICT', 'English', 'Sinhala'];
  const detected = uniqueCategoriesFromPosts(posts);

  const normalized = new Map();
  for (const c of detected) {
    normalized.set(c.toLowerCase(), c);
  }

  const out = [];
  for (const c of preferred) {
    if (c === 'All') {
      out.push('All');
      continue;
    }
    const hit = normalized.get(c.toLowerCase());
    if (hit) out.push(hit);
    else out.push(c);
  }

  // Append any remaining categories not in preferred.
  const preferredSet = new Set(preferred.map((x) => x.toLowerCase()));
  for (const c of detected) {
    if (!preferredSet.has(c.toLowerCase())) out.push(c);
  }

  // Remove duplicates preserving order.
  const final = [];
  const seen = new Set();
  for (const c of out) {
    const key = c.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    final.push(c);
  }
  return final;
}

function renderCategoryChips(categories) {
  const wrap = document.getElementById('categoryChips');
  if (!wrap) return;

  wrap.innerHTML = '';
  for (const c of categories) {
    const btn = el('button', 'chip');
    btn.type = 'button';
    btn.textContent = c;
    if (String(c).toLowerCase() === String(selectedCategory).toLowerCase()) {
      btn.classList.add('is-active');
    }
    btn.addEventListener('click', () => {
      selectedCategory = c;
      renderCategoryChips(categories);
      applyFilters();
    });
    wrap.appendChild(btn);
  }
}

function renderPosts(posts) {
  const grid = document.getElementById('postsGrid');
  const empty = document.getElementById('emptyState');
  const stats = document.getElementById('stats');

  grid.innerHTML = '';

  const catLabel = selectedCategory && selectedCategory !== 'All' ? ` • ${selectedCategory}` : '';
  stats.textContent = `${posts.length} post(s) shown${catLabel}`;

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
    const categories = buildCategoryList(allPosts);
    // If current selection no longer exists, reset.
    if (selectedCategory !== 'All') {
      const exists = categories.some((c) => c.toLowerCase() === selectedCategory.toLowerCase());
      if (!exists) selectedCategory = 'All';
    }
    renderCategoryChips(categories);
    applyFilters();
  } catch (err) {
    allPosts = [];
    if (empty) {
      empty.textContent = 'Posts load වෙන්නේ නැහැ. Page එක refresh කරන්න, නැත්නම් ටිකකින් try කරන්න.';
    }
    renderCategoryChips(buildCategoryList([]));
    applyFilters();
    console.error('Failed to load posts:', err);
  }
}

function wireSearch() {
  const input = document.getElementById('searchInput');
  input.addEventListener('input', () => {
    selectedQuery = input.value || '';
    applyFilters();
  });
}

(async function init() {
  wireSearch();
  await loadPosts();
})();
