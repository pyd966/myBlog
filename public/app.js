const state = {
  user: null,
  token: localStorage.getItem("myblog_token") || "",
  posts: [],
  activePost: null,
  activeTag: "",
  selectedText: "",
  editingPostId: ""
};

const $ = (selector) => document.querySelector(selector);
const els = {
  searchInput: $("#searchInput"),
  postList: $("#postList"),
  tagList: $("#tagList"),
  reader: $("#reader"),
  commentList: $("#commentList"),
  highlightList: $("#highlightList"),
  commentForm: $("#commentForm"),
  commentContent: $("#commentContent"),
  loginButton: $("#loginButton"),
  newPostButton: $("#newPostButton"),
  profileButton: $("#profileButton"),
  userPill: $("#userPill"),
  authDialog: $("#authDialog"),
  authForm: $("#authForm"),
  authSubmit: $("#authSubmit"),
  authMessage: $("#authMessage"),
  authAccount: $("#authAccount"),
  authUsername: $("#authUsername"),
  authPassword: $("#authPassword"),
  accountLabel: $("#accountLabel"),
  postDialog: $("#postDialog"),
  postForm: $("#postForm"),
  postDialogTitle: $("#postDialogTitle"),
  postSubmitButton: $("#postSubmitButton"),
  postTitle: $("#postTitle"),
  postContent: $("#postContent"),
  postSummary: $("#postSummary"),
  postTags: $("#postTags"),
  postMessage: $("#postMessage"),
  aiAssistButton: $("#aiAssistButton"),
  profileDialog: $("#profileDialog"),
  profileForm: $("#profileForm"),
  profileUsername: $("#profileUsername"),
  profileEmail: $("#profileEmail"),
  profileAvatar: $("#profileAvatar"),
  profileMessage: $("#profileMessage"),
  selectionMenu: $("#selectionMenu"),
  openHighlightComposer: $("#openHighlightComposer"),
  highlightComposer: $("#highlightComposer"),
  selectedQuote: $("#selectedQuote"),
  highlightContent: $("#highlightContent"),
  cancelHighlight: $("#cancelHighlight"),
  toast: $("#toast")
};

let authMode = "login";

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  setTimeout(() => els.toast.classList.add("hidden"), 2400);
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers["content-type"]) headers["content-type"] = "application/json";
  if (state.token) headers.authorization = `Bearer ${state.token}`;
  const response = await fetch(path, { ...options, headers });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) throw new Error(payload.msg || "Request failed");
  return payload.data;
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

function sanitizeRenderedHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("script, iframe, object, embed, link, meta, style").forEach((node) => node.remove());
  template.content.querySelectorAll("*").forEach((node) => {
    [...node.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith("on")) node.removeAttribute(attr.name);
      if ((name === "href" || name === "src") && value.startsWith("javascript:")) node.removeAttribute(attr.name);
    });
    if (node.tagName === "A") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noreferrer");
    }
    if (node.tagName === "IMG") {
      node.setAttribute("loading", "lazy");
    }
  });
  return template.innerHTML;
}

function renderMathInReader() {
  const body = $("#postBody");
  if (!body || !window.renderMathInElement) return;
  window.renderMathInElement(body, {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "$", right: "$", display: false }
    ],
    throwOnError: false
  });
}

function protectMath(markdown) {
  const segments = [];
  const stash = (match) => {
    const key = `@@MATH_${segments.length}@@`;
    segments.push(match);
    return key;
  };
  const protectedMarkdown = markdown
    .replace(/\$\$[\s\S]+?\$\$/g, stash)
    .replace(/(^|[^\\$])\$([^\n$]+?)\$/g, (match, prefix, formula) => `${prefix}${stash(`$${formula}$`)}`);
  return {
    markdown: protectedMarkdown,
    restore(html) {
      return segments.reduce((result, math, index) => result.replaceAll(`@@MATH_${index}@@`, escapeHtml(math)), html);
    }
  };
}

function markdownToHtml(markdown = "") {
  const math = protectMath(markdown);
  if (window.marked?.parse) {
    window.marked.setOptions({ gfm: true, breaks: false, headerIds: false, mangle: false });
    return math.restore(sanitizeRenderedHtml(window.marked.parse(math.markdown)));
  }
  return math.restore(fallbackMarkdownToHtml(math.markdown));
}

function fallbackMarkdownToHtml(markdown = "") {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let inCode = false;
  let codeLang = "";
  let codeBuffer = [];
  let paragraph = [];
  let listType = "";
  let listItems = [];
  let tableRows = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!listType) return;
    html.push(`<${listType}>${listItems.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</${listType}>`);
    listType = "";
    listItems = [];
  };

  const flushTable = () => {
    if (!tableRows.length) return;
    const [header, , ...body] = tableRows;
    const cells = (row) => row.split("|").slice(1, -1).map((cell) => cell.trim());
    html.push(`
      <div class="table-wrap">
        <table>
          <thead><tr>${cells(header).map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join("")}</tr></thead>
          <tbody>${body.map((row) => `<tr>${cells(row).map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>
    `);
    tableRows = [];
  };

  const flushBlocks = () => {
    flushParagraph();
    flushList();
    flushTable();
  };

  const flushCode = () => {
    const language = codeLang ? ` data-lang="${escapeHtml(codeLang)}"` : "";
    html.push(`<pre${language}><code>${escapeHtml(codeBuffer.join("\n"))}</code></pre>`);
    codeLang = "";
    codeBuffer = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().startsWith("```")) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushBlocks();
        codeLang = line.trim().slice(3).trim();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuffer.push(line);
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed) {
      flushBlocks();
      continue;
    }

    if (/^\|(.+\|)+$/.test(trimmed) && lines[index + 1] && /^\|?[\s:-]+\|[\s|:-]+$/.test(lines[index + 1].trim())) {
      flushParagraph();
      flushList();
      tableRows.push(trimmed, lines[index + 1].trim());
      index += 1;
      while (lines[index + 1] && /^\|(.+\|)+$/.test(lines[index + 1].trim())) {
        index += 1;
        tableRows.push(lines[index].trim());
      }
      flushTable();
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushBlocks();
      html.push(`<h${heading[1].length}>${inlineMarkdown(heading[2])}</h${heading[1].length}>`);
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      flushBlocks();
      html.push("<hr>");
      continue;
    }

    if (trimmed.startsWith("> ")) {
      flushBlocks();
      html.push(`<blockquote>${inlineMarkdown(trimmed.slice(2))}</blockquote>`);
      continue;
    }

    const unordered = trimmed.match(/^[-*+]\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      flushTable();
      if (listType && listType !== "ul") flushList();
      listType = "ul";
      listItems.push(unordered[1]);
      continue;
    }

    const ordered = trimmed.match(/^\d+\.\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      flushTable();
      if (listType && listType !== "ol") flushList();
      listType = "ol";
      listItems.push(ordered[1]);
      continue;
    }

    flushList();
    flushTable();
    paragraph.push(trimmed);
  }
  flushBlocks();
  if (inCode) flushCode();
  return html.join("\n");
}

function inlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g, '<img src="$2" alt="$1" loading="lazy">')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");
}

function setAuth(auth) {
  state.user = auth.user;
  state.token = auth.accessToken;
  localStorage.setItem("myblog_token", state.token);
  renderAuth();
}

function renderAuth() {
  const isOwner = state.user?.role === "owner";
  if (state.user) {
    els.loginButton.textContent = "退出";
    els.userPill.textContent = `${state.user.username}${state.user.role === "owner" ? " · owner" : ""}`;
    els.userPill.classList.remove("hidden");
    els.profileButton.classList.remove("hidden");
  } else {
    els.loginButton.textContent = "登录";
    els.userPill.classList.add("hidden");
    els.profileButton.classList.add("hidden");
  }
  els.newPostButton.classList.toggle("hidden", !isOwner);
  els.aiAssistButton.classList.toggle("hidden", !isOwner);
}

function renderPostList() {
  if (!state.posts.length) {
    els.postList.innerHTML = `<p class="muted compact">还没有文章，登录后发布第一篇。</p>`;
    els.tagList.innerHTML = "";
    return;
  }

  els.postList.innerHTML = state.posts
    .map(
      (post) => `
        <a class="post-link ${state.activePost?.id === post.id ? "active" : ""}" href="#/post/${post.slug}" data-post="${post.slug}">
          <strong>${escapeHtml(post.title)}</strong>
          <span>${formatDate(post.createdAt)} · ${post.commentCount} 评论</span>
        </a>
      `
    )
    .join("");

  const tags = new Map();
  for (const post of state.posts) {
    for (const tag of post.tags || []) tags.set(tag, (tags.get(tag) || 0) + 1);
  }
  els.tagList.innerHTML = [...tags.entries()]
    .map(
      ([tag, count]) =>
        `<button class="tag ${state.activeTag === tag ? "active" : ""}" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)} ${count}</button>`
    )
    .join("");
}

function renderReader() {
  const post = state.activePost;
  if (!post) return;
  const ownerActions =
    state.user?.role === "owner"
      ? `
        <button class="ghost" id="editPostButton" type="button">编辑</button>
        <button class="ghost danger" id="deletePostButton" type="button">删除</button>
      `
      : "";
  els.reader.className = "reader";
  els.reader.innerHTML = `
    <header class="reader-header">
      <p class="eyebrow">${post.tags.map((tag) => escapeHtml(tag)).join(" · ") || "Blog"}</p>
      <h1>${escapeHtml(post.title)}</h1>
      <div class="reader-meta">
        <span>${escapeHtml(post.author?.username || "unknown")}</span>
        <span>${formatDate(post.createdAt)}</span>
        <span>${post.commentCount} 评论</span>
        <span>${post.likeCount} 赞</span>
      </div>
      <p class="summary">${escapeHtml(post.summary)}</p>
      <div class="reader-actions">
        <button class="ghost" id="likePostButton" type="button">${post.likedByMe ? "已点赞" : "点赞"}</button>
        ${ownerActions}
      </div>
    </header>
    <div class="markdown-body" id="postBody">${markdownToHtml(post.content)}</div>
  `;
  $("#likePostButton").addEventListener("click", () => toggleLike("post", post.id));
  $("#editPostButton")?.addEventListener("click", openEditPostDialog);
  $("#deletePostButton")?.addEventListener("click", deleteActivePost);
  renderMathInReader();
}

function renderComments(comments = [], highlights = []) {
  if (!state.activePost) {
    els.commentList.textContent = "选择一篇文章后查看评论。";
    els.highlightList.innerHTML = "";
    els.commentForm.classList.add("hidden");
    return;
  }
  els.commentForm.classList.toggle("hidden", !state.user);
  if (!comments.length) {
    els.commentList.innerHTML = `<p class="muted compact">暂无评论。</p>`;
  } else {
    els.commentList.innerHTML = comments
      .map(
        (comment) => `
          <div class="comment ${comment.parentId ? "reply" : ""}">
            <div class="comment-meta">
              <span>${escapeHtml(comment.author?.username || "unknown")} · ${formatDate(comment.createdAt)}</span>
              <button class="ghost" data-like-comment="${comment.id}" type="button">${comment.likedByMe ? "已赞" : "赞"} ${comment.likeCount}</button>
            </div>
            <p>${escapeHtml(comment.content)}</p>
          </div>
        `
      )
      .join("");
  }

  els.highlightList.innerHTML = highlights.length
    ? highlights
        .map(
          (item) => `
            <div class="highlight">
              <div class="highlight-meta">${escapeHtml(item.author?.username || "unknown")} · ${formatDate(item.createdAt)}</div>
              <div class="quote">${escapeHtml(item.selectedText)}</div>
              <p>${escapeHtml(item.content)}</p>
            </div>
          `
        )
        .join("")
    : `<p class="muted compact">暂无划线评论。</p>`;

  document.querySelectorAll("[data-like-comment]").forEach((button) => {
    button.addEventListener("click", () => toggleLike("comment", button.dataset.likeComment));
  });
}

async function loadMe() {
  if (!state.token) {
    renderAuth();
    return;
  }
  try {
    const data = await api("/api/me");
    state.user = data.user;
    if (!state.user) {
      localStorage.removeItem("myblog_token");
      state.token = "";
    }
  } catch {
    localStorage.removeItem("myblog_token");
    state.token = "";
    state.user = null;
  }
  renderAuth();
}

async function loadPosts() {
  const params = new URLSearchParams();
  if (els.searchInput.value.trim()) params.set("q", els.searchInput.value.trim());
  if (state.activeTag) params.set("tag", state.activeTag);
  const data = await api(`/api/posts?${params.toString()}`);
  state.posts = data.posts;
  renderPostList();
}

async function loadPost(slugOrId) {
  const [{ post }, data] = await Promise.all([
    api(`/api/posts/${encodeURIComponent(slugOrId)}`),
    api(`/api/posts/${encodeURIComponent(slugOrId)}/comments`)
  ]);
  state.activePost = post;
  renderPostList();
  renderReader();
  renderComments(data.comments, data.highlights);
}

async function reloadActivePost() {
  if (state.activePost) await loadPost(state.activePost.slug);
}

async function toggleLike(targetType, targetId) {
  if (!state.user) {
    els.authDialog.showModal();
    return;
  }
  await api(`/api/likes/${targetType}/${targetId}`, { method: "POST" });
  await reloadActivePost();
}

function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll("[data-auth-mode]").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.authMode === mode);
  });
  document.querySelectorAll(".register-only").forEach((item) => {
    item.classList.toggle("hidden", mode !== "register");
  });
  els.accountLabel.textContent = mode === "register" ? "邮箱" : "邮箱或用户名";
  els.authSubmit.textContent = mode === "register" ? "注册" : "登录";
  els.authMessage.textContent = "";
}

async function submitAuth(event) {
  event.preventDefault();
  els.authMessage.textContent = "";
  try {
    const payload =
      authMode === "register"
        ? {
            email: els.authAccount.value,
            username: els.authUsername.value,
            password: els.authPassword.value
          }
        : {
            account: els.authAccount.value,
            password: els.authPassword.value
          };
    const auth = await api(`/api/auth/${authMode}`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    setAuth(auth);
    els.authDialog.close();
    toast(authMode === "register" ? "注册成功" : "登录成功");
    await loadPosts();
  } catch (error) {
    els.authMessage.textContent = error.message;
  }
}

async function submitPost(event) {
  event.preventDefault();
  els.postMessage.textContent = "";
  try {
    const isEditing = Boolean(state.editingPostId);
    const data = await api(isEditing ? `/api/posts/${encodeURIComponent(state.editingPostId)}` : "/api/posts", {
      method: isEditing ? "PUT" : "POST",
      body: JSON.stringify({
        title: els.postTitle.value,
        content: els.postContent.value,
        summary: els.postSummary.value,
        tags: els.postTags.value
      })
    });
    els.postDialog.close();
    els.postForm.reset();
    state.editingPostId = "";
    await loadPosts();
    location.hash = `#/post/${data.post.slug}`;
    await loadPost(data.post.slug);
    toast(isEditing ? "文章已更新" : "文章已发布");
  } catch (error) {
    els.postMessage.textContent = error.message;
  }
}

function openNewPostDialog() {
  state.editingPostId = "";
  els.postForm.reset();
  els.postDialogTitle.textContent = "发布文章";
  els.postSubmitButton.textContent = "发布";
  els.postMessage.textContent = "";
  els.postDialog.showModal();
}

function openEditPostDialog() {
  if (!state.activePost || state.user?.role !== "owner") return;
  state.editingPostId = state.activePost.slug;
  els.postDialogTitle.textContent = "编辑文章";
  els.postSubmitButton.textContent = "保存修改";
  els.postTitle.value = state.activePost.title || "";
  els.postContent.value = state.activePost.content || "";
  els.postSummary.value = state.activePost.summary || "";
  els.postTags.value = (state.activePost.tags || []).join(", ");
  els.postMessage.textContent = "";
  els.postDialog.showModal();
}

async function deleteActivePost() {
  if (!state.activePost || state.user?.role !== "owner") return;
  if (!confirm(`确定删除《${state.activePost.title}》吗？相关评论、点赞和划线评论也会被删除。`)) return;
  try {
    await api(`/api/posts/${encodeURIComponent(state.activePost.slug)}`, { method: "DELETE" });
    state.activePost = null;
    await loadPosts();
    if (state.posts.length) {
      location.hash = `#/post/${state.posts[0].slug}`;
      await loadPost(state.posts[0].slug);
    } else {
      location.hash = "";
      els.reader.className = "reader empty";
      els.reader.innerHTML = `
        <p class="eyebrow">myBlog</p>
        <h1>还没有文章</h1>
        <p>owner 可以点击顶部的写文章发布第一篇博客。</p>
      `;
      renderComments([], []);
    }
    toast("文章已删除");
  } catch (error) {
    toast(error.message);
  }
}

async function submitProfile(event) {
  event.preventDefault();
  els.profileMessage.textContent = "";
  try {
    const data = await api("/api/me", {
      method: "PATCH",
      body: JSON.stringify({
        username: els.profileUsername.value,
        email: els.profileEmail.value,
        avatarUrl: els.profileAvatar.value
      })
    });
    state.user = data.user;
    renderAuth();
    els.profileDialog.close();
    await reloadActivePost();
    toast("资料已更新");
  } catch (error) {
    els.profileMessage.textContent = error.message;
  }
}

async function runAiAssist() {
  els.postMessage.textContent = "正在生成摘要与标签...";
  try {
    const data = await api("/api/ai/post-assist", {
      method: "POST",
      body: JSON.stringify({
        title: els.postTitle.value,
        content: els.postContent.value
      })
    });
    els.postSummary.value = data.summary;
    els.postTags.value = data.tags.join(", ");
    els.postMessage.textContent = data.source === "local" ? "已用本地规则生成；配置接口密钥后可启用在线生成。" : "摘要与标签已生成。";
  } catch (error) {
    els.postMessage.textContent = error.message;
  }
}

async function submitComment(event) {
  event.preventDefault();
  if (!state.activePost) return;
  try {
    await api(`/api/posts/${state.activePost.slug}/comments`, {
      method: "POST",
      body: JSON.stringify({ content: els.commentContent.value })
    });
    els.commentContent.value = "";
    await reloadActivePost();
    toast("评论已发布");
  } catch (error) {
    toast(error.message);
  }
}

async function submitHighlight(event) {
  event.preventDefault();
  if (!state.activePost) return;
  try {
    await api(`/api/posts/${state.activePost.slug}/highlights`, {
      method: "POST",
      body: JSON.stringify({
        selectedText: state.selectedText,
        content: els.highlightContent.value
      })
    });
    hideSelectionTools();
    els.highlightComposer.reset();
    await reloadActivePost();
    toast("划线评论已保存");
  } catch (error) {
    toast(error.message);
  }
}

function hideSelectionTools() {
  els.selectionMenu.classList.add("hidden");
  els.highlightComposer.classList.add("hidden");
}

function placeFloatingElement(element, rect, width = 220) {
  const top = window.scrollY + rect.top - element.offsetHeight - 10;
  const left = window.scrollX + rect.left + rect.width / 2 - width / 2;
  element.style.top = `${Math.max(window.scrollY + 72, top)}px`;
  element.style.left = `${Math.min(window.scrollX + window.innerWidth - width - 12, Math.max(window.scrollX + 12, left))}px`;
}

function handleSelection() {
  const selection = window.getSelection();
  const selectedText = selection?.toString().trim();
  if (!selectedText || selectedText.length < 2 || selectedText.length > 240) {
    if (!els.highlightComposer.matches(":focus-within")) hideSelectionTools();
    return;
  }
  const body = $("#postBody");
  if (!body || !body.contains(selection.anchorNode)) {
    hideSelectionTools();
    return;
  }
  if (!state.user) {
    toast("登录后可以添加划线评论");
    return;
  }
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (!rect.width && !rect.height) return;
  state.selectedText = selectedText;
  els.selectionMenu.classList.remove("hidden");
  els.highlightComposer.classList.add("hidden");
  placeFloatingElement(els.selectionMenu, rect, 86);
}

function openHighlightComposer() {
  const selection = window.getSelection();
  let rect = null;
  if (selection && selection.rangeCount) rect = selection.getRangeAt(0).getBoundingClientRect();
  els.selectedQuote.textContent = state.selectedText;
  els.selectionMenu.classList.add("hidden");
  els.highlightComposer.classList.remove("hidden");
  if (rect) placeFloatingElement(els.highlightComposer, rect, 320);
  els.highlightContent.focus();
}

function parseGithubAuth() {
  const params = new URLSearchParams(location.search);
  const payload = params.get("github_auth");
  if (!payload) return;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    const auth = JSON.parse(atob(padded));
    setAuth(auth);
    history.replaceState(null, "", "/");
    toast("GitHub 登录成功");
  } catch {
    toast("GitHub 登录结果解析失败");
  }
}

async function route() {
  const match = location.hash.match(/^#\/post\/(.+)$/);
  if (match) {
    await loadPost(decodeURIComponent(match[1]));
  } else if (state.posts.length) {
    await loadPost(state.posts[0].slug);
  }
}

function bindEvents() {
  els.loginButton.addEventListener("click", () => {
    if (state.user) {
      localStorage.removeItem("myblog_token");
      state.user = null;
      state.token = "";
      renderAuth();
      reloadActivePost();
      toast("已退出");
      return;
    }
    els.authDialog.showModal();
  });
  els.newPostButton.addEventListener("click", () => {
    if (state.user?.role !== "owner") return;
    openNewPostDialog();
  });
  document.querySelectorAll("[data-dialog-close]").forEach((button) => {
    button.addEventListener("click", () => button.closest("dialog")?.close());
  });
  els.profileButton.addEventListener("click", () => {
    if (!state.user) return;
    els.profileUsername.value = state.user.username || "";
    els.profileEmail.value = state.user.email || "";
    els.profileAvatar.value = state.user.avatarUrl || "";
    els.profileMessage.textContent = "";
    els.profileDialog.showModal();
  });
  document.querySelectorAll("[data-auth-mode]").forEach((tab) => {
    tab.addEventListener("click", () => setAuthMode(tab.dataset.authMode));
  });
  els.authForm.addEventListener("submit", submitAuth);
  els.postForm.addEventListener("submit", submitPost);
  els.profileForm.addEventListener("submit", submitProfile);
  els.commentForm.addEventListener("submit", submitComment);
  els.highlightComposer.addEventListener("submit", submitHighlight);
  els.openHighlightComposer.addEventListener("click", openHighlightComposer);
  els.cancelHighlight.addEventListener("click", () => {
    hideSelectionTools();
    window.getSelection()?.removeAllRanges();
  });
  els.aiAssistButton.addEventListener("click", runAiAssist);
  els.searchInput.addEventListener("input", async () => {
    state.activeTag = "";
    await loadPosts();
    renderPostList();
  });
  els.postList.addEventListener("click", (event) => {
    const link = event.target.closest("[data-post]");
    if (!link) return;
    event.preventDefault();
    location.hash = `#/post/${link.dataset.post}`;
  });
  els.tagList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-tag]");
    if (!button) return;
    state.activeTag = state.activeTag === button.dataset.tag ? "" : button.dataset.tag;
    await loadPosts();
    await route();
  });
  document.addEventListener("mouseup", (event) => {
    if (event.target.closest(".selection-menu, .highlight-composer")) return;
    setTimeout(handleSelection, 120);
  });
  document.addEventListener("mousedown", (event) => {
    if (event.target.closest(".selection-menu, .highlight-composer")) return;
    const body = $("#postBody");
    if (body && !body.contains(event.target)) hideSelectionTools();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideSelectionTools();
  });
  window.addEventListener("scroll", hideSelectionTools, { passive: true });
  window.addEventListener("hashchange", route);
}

async function init() {
  parseGithubAuth();
  bindEvents();
  setAuthMode("login");
  await loadMe();
  await loadPosts();
  await route();
}

init().catch((error) => {
  console.error(error);
  toast(error.message);
});
