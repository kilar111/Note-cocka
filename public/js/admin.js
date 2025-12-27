// admin.js
// Admin UI:
// - Checks session auth (GET /api/admin/me)
// - Login (POST /api/admin/login)
// - Logout (POST /api/admin/logout)
// - Create post with image upload (POST /api/admin/posts)

let editingId = null;
let adminPosts = [];

const ADMIN_ROUTE = '/admin';
const ADMIN_LOGIN_ROUTE = '/admin-login';

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return '';
  }
}

function setEditMode(on) {
  const title = document.getElementById('formTitle');
  const submit = document.getElementById('submitBtn');
  const cancel = document.getElementById('cancelEditBtn');
  const clearWrap = document.getElementById('clearImageWrap');
  const clearCb = document.getElementById('clearImage');

  if (title) title.textContent = on ? 'Edit Post' : 'Create New Post';
  if (submit) submit.textContent = on ? 'Update' : 'Publish';
  if (cancel) cancel.style.display = on ? 'inline-block' : 'none';
  if (clearWrap) clearWrap.style.display = on ? 'block' : 'none';
  if (!on && clearCb) clearCb.checked = false;
}

function clearForm() {
  document.getElementById('postForm').reset();
  const imgUrlEl = document.getElementById('imageUrl');
  const srcUrlEl = document.getElementById('sourceUrl');
  if (imgUrlEl) imgUrlEl.value = '';
  if (srcUrlEl) srcUrlEl.value = '';
  setHtml('fbMsg', '');
  const clearCb = document.getElementById('clearImage');
  if (clearCb) clearCb.checked = false;
}

function cancelEdit() {
  editingId = null;
  setEditMode(false);
  setHtml('adminMsg', '');
  clearForm();
}

async function loadAdminPosts() {
  const res = await fetch('/api/admin/posts');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to load posts');
  adminPosts = data.posts || [];
  renderPostsList();
}

function renderPostsList() {
  const list = document.getElementById('postsList');
  if (!list) return;
  list.innerHTML = '';

  if (!adminPosts.length) {
    list.innerHTML = '<div class="empty">No posts yet.</div>';
    return;
  }

  for (const p of adminPosts) {
    const row = document.createElement('div');
    row.className = 'admin-item';

    const img = document.createElement('img');
    img.className = 'admin-thumb';
    img.alt = p.title || 'thumbnail';
    if (p.imagePath) img.src = p.imagePath;

    const meta = document.createElement('div');
    meta.className = 'admin-meta';

    const title = document.createElement('div');
    title.className = 'admin-title';
    title.textContent = p.title || '';

    const sub = document.createElement('div');
    sub.className = 'admin-sub';
    sub.textContent = `${p.category || 'Uncategorized'} • ${p.createdAt ? formatDate(p.createdAt) : ''}`;

    meta.appendChild(title);
    meta.appendChild(sub);

    const actions = document.createElement('div');
    actions.className = 'admin-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-secondary';
    editBtn.type = 'button';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => startEdit(p.id));

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-secondary';
    delBtn.type = 'button';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => deletePost(p.id));

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    row.appendChild(img);
    row.appendChild(meta);
    row.appendChild(actions);

    list.appendChild(row);
  }
}

function startEdit(id) {
  const p = adminPosts.find((x) => String(x.id) === String(id));
  if (!p) return;

  editingId = p.id;
  setEditMode(true);

  document.getElementById('title').value = p.title || '';
  document.getElementById('category').value = p.category || '';
  document.getElementById('description').value = p.description || '';
  document.getElementById('driveLinks').value = Array.isArray(p.driveLinks) ? p.driveLinks.join('\n') : '';

  // Keep sourceUrl for "View original" if present
  const srcUrlEl = document.getElementById('sourceUrl');
  if (srcUrlEl) srcUrlEl.value = p.sourceUrl || '';

  // If image is external (not /uploads/), keep it in imageUrl so update can preserve/replace.
  const imgUrlEl = document.getElementById('imageUrl');
  if (imgUrlEl) {
    imgUrlEl.value = (p.imagePath && !String(p.imagePath).startsWith('/uploads/')) ? p.imagePath : '';
  }

  // Clear file input + clearImage checkbox
  document.getElementById('image').value = '';
  const clearCb = document.getElementById('clearImage');
  if (clearCb) clearCb.checked = false;

  setHtml('adminMsg', msgBox('success', 'Editing mode: update fields then click Update.'));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deletePost(id) {
  const p = adminPosts.find((x) => String(x.id) === String(id));
  const name = p?.title ? `"${p.title}"` : 'this post';
  if (!confirm(`Delete ${name}? This cannot be undone.`)) return;

  const res = await fetch(`/api/admin/posts/${encodeURIComponent(id)}`, { method: 'DELETE' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    setHtml('postsAdminMsg', msgBox('error', data.error || 'Failed to delete'));
    return;
  }

  if (editingId && String(editingId) === String(id)) cancelEdit();
  setHtml('postsAdminMsg', msgBox('success', 'Post deleted.'));
  await loadAdminPosts();
}

function setHtml(id, html) {
  const el = document.getElementById(id);
  el.innerHTML = html || '';
}

function show(id, on) {
  document.getElementById(id).style.display = on ? 'block' : 'none';
}

function showLogout(on) {
  document.getElementById('logoutBtn').style.display = on ? 'inline-block' : 'none';
}

function msgBox(type, text) {
  const cls = type === 'error' ? 'error' : 'success';
  return `<div class="${cls}">${text}</div>`;
}

async function apiJson(url, options) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function checkAuth() {
  const res = await fetch('/api/admin/me');
  const data = await res.json();
  return !!data.isAdmin;
}

async function render() {
  const authed = await checkAuth();

  // Keep routes clean:
  // - If not authenticated, never stay on /admin (dashboard route)
  // - If authenticated, don't stay on /admin-login
  try {
    const path = window.location.pathname;
    if (!authed && path === ADMIN_ROUTE) {
      window.location.replace(ADMIN_LOGIN_ROUTE);
      return;
    }
    if (authed && path === ADMIN_LOGIN_ROUTE) {
      window.location.replace(ADMIN_ROUTE);
      return;
    }
  } catch {
    // ignore
  }

  show('loginPanel', !authed);
  show('dashboard', authed);
  showLogout(authed);

  setHtml('loginMsg', '');
  setHtml('adminMsg', '');

  if (authed) {
    try {
      await loadAdminPosts();
      setHtml('postsAdminMsg', '');
    } catch (e) {
      setHtml('postsAdminMsg', msgBox('error', e.message || 'Failed to load posts'));
    }
  }
}

async function login() {
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value.trim();

  const { res, data } = await apiJson('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });

  if (!res.ok) {
    setHtml('loginMsg', msgBox('error', data.error || 'Login failed'));
    return;
  }

  await render();
}

async function logout() {
  await fetch('/api/admin/logout', { method: 'POST' });
  cancelEdit();
  await render();
}

async function publishPost(evt) {
  evt.preventDefault();

  // Use multipart/form-data because we may upload a file.
  const formData = new FormData();
  const image = document.getElementById('image').files[0];
  const title = document.getElementById('title').value.trim();
  const category = document.getElementById('category').value.trim();
  const description = document.getElementById('description').value.trim();
  const driveLinks = document.getElementById('driveLinks').value;
  const sourceUrl = document.getElementById('sourceUrl')?.value || '';
  const imageUrl = document.getElementById('imageUrl')?.value || '';
  const clearImage = document.getElementById('clearImage')?.checked ? 'true' : 'false';

  if (image) formData.append('image', image);
  formData.append('title', title);
  formData.append('category', category);
  formData.append('description', description);
  formData.append('driveLinks', driveLinks);
  formData.append('sourceUrl', sourceUrl);
  formData.append('imageUrl', imageUrl);
  formData.append('clearImage', clearImage);

  const url = editingId ? `/api/admin/posts/${encodeURIComponent(editingId)}` : '/api/admin/posts';
  const method = editingId ? 'PUT' : 'POST';
  const res = await fetch(url, { method, body: formData });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    setHtml('adminMsg', msgBox('error', data.error || 'Failed to publish'));
    return;
  }

  setHtml('adminMsg', msgBox('success', editingId ? 'Post updated successfully.' : 'Post published successfully.'));
  cancelEdit();
  await loadAdminPosts();
}

async function fetchFromFacebook() {
  const fbUrl = document.getElementById('fbUrl').value.trim();
  if (!fbUrl) {
    setHtml('fbMsg', msgBox('error', 'Paste a Facebook link first.'));
    return;
  }

  setHtml('fbMsg', '<div class="helper">Fetching preview...</div>');

  let res;
  let data = {};
  let rawText = '';

  try {
    res = await fetch(`/api/admin/fb-preview?url=${encodeURIComponent(fbUrl)}`);
    rawText = await res.text();
    data = JSON.parse(rawText);
  } catch {
    // If JSON parse fails or network fails, we still want a useful error.
    data = {};
  }

  if (!res || !res.ok) {
    // Common cases:
    // - 404: server is running old code (needs restart)
    // - 401: not logged in
    const status = res ? res.status : 0;
    if (status === 404) {
      setHtml('fbMsg', msgBox('error', 'Preview endpoint not found (404). Please restart the Node server and try again.'));
      return;
    }
    if (status === 401) {
      setHtml('fbMsg', msgBox('error', 'Unauthorized. Please login again, then click Fetch.'));
      return;
    }

    const details = (data && data.error) ? data.error : (rawText ? rawText.slice(0, 140) : '');
    setHtml('fbMsg', msgBox('error', `Failed to fetch preview (HTTP ${status || '0'}). ${details}`.trim()));
    return;
  }

  // Only fill fields if they are empty (so admin can still override manually).
  const titleEl = document.getElementById('title');
  const descEl = document.getElementById('description');
  if (titleEl && !titleEl.value.trim() && data.title) titleEl.value = data.title;
  if (descEl && !descEl.value.trim() && data.description) descEl.value = data.description;

  const imgUrlEl = document.getElementById('imageUrl');
  const srcUrlEl = document.getElementById('sourceUrl');
  if (imgUrlEl) imgUrlEl.value = data.imageUrl || '';
  if (srcUrlEl) srcUrlEl.value = data.sourceUrl || fbUrl;

  const bits = [];
  if (data.title) bits.push('title');
  if (data.description) bits.push('description');
  if (data.imageUrl) bits.push('image');
  setHtml('fbMsg', msgBox('success', `Fetched: ${bits.join(', ') || 'some fields'}. You can edit before publishing.`));
}

(function init() {
  document.getElementById('loginBtn').addEventListener('click', login);
  document.getElementById('logoutBtn').addEventListener('click', logout);
  document.getElementById('postForm').addEventListener('submit', publishPost);
  document.getElementById('cancelEditBtn')?.addEventListener('click', cancelEdit);
  document.getElementById('refreshPostsBtn')?.addEventListener('click', async () => {
    try {
      await loadAdminPosts();
      setHtml('postsAdminMsg', msgBox('success', 'Refreshed.'));
    } catch (e) {
      setHtml('postsAdminMsg', msgBox('error', e.message || 'Failed to refresh'));
    }
  });
  // If user hits form reset while editing, exit edit mode.
  document.getElementById('postForm')?.addEventListener('reset', () => {
    if (editingId) cancelEdit();
  });
  const fbBtn = document.getElementById('fbFetchBtn');
  if (fbBtn) fbBtn.addEventListener('click', fetchFromFacebook);
  render();
})();
