import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";
import { generatePostAssist } from "./ai.js";
import { config } from "./config.js";
import {
  commentView,
  createPostRecord,
  highlightCommentView,
  listPostsView,
  mutate,
  postView,
  read
} from "./store.js";
import {
  createId,
  escapeHtml,
  hashPassword,
  now,
  parseJsonBody,
  publicUser,
  signToken,
  slugify,
  stripMarkdown,
  verifyPassword,
  verifyToken
} from "./utils.js";

const PUBLIC_DIR = path.resolve("public");
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8"
};

function json(res, status, data, message = "success") {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ code: status < 400 ? 0 : status, msg: message, data }));
}

function redirect(res, location) {
  res.writeHead(302, { location });
  res.end();
}

function getBearerUser(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const payload = verifyToken(token, config.sessionSecret);
  return payload?.userId || "";
}

async function requireUser(req, res) {
  const userId = getBearerUser(req);
  if (!userId) {
    json(res, 401, null, "Please login first");
    return null;
  }
  const user = await read((db) => db.users.find((item) => item.id === userId));
  if (!user) {
    json(res, 401, null, "Invalid session");
    return null;
  }
  return user;
}

async function requireOwner(req, res) {
  const user = await requireUser(req, res);
  if (!user) return null;
  if (user.role !== "owner") {
    json(res, 403, null, "Only the blog owner can do this");
    return null;
  }
  return user;
}

function issueAuth(user) {
  const token = signToken({ userId: user.id, exp: Date.now() + 1000 * 60 * 60 * 24 * 14 }, config.sessionSecret);
  return { user: publicUser(user), accessToken: token };
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags.map(String).map((tag) => tag.trim()).filter(Boolean).slice(0, 8);
  return String(tags || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 8);
}

async function handleApi(req, res, url) {
  const method = req.method || "GET";

  if (method === "GET" && url.pathname === "/api/health") {
    json(res, 200, { ok: true });
    return;
  }

  if (method === "POST" && url.pathname === "/api/auth/register") {
    const body = await parseJsonBody(req);
    const username = String(body.username || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!username || !email || password.length < 6) {
      json(res, 400, null, "Username, email and a 6+ char password are required");
      return;
    }
    const auth = await mutate((db) => {
      if (db.users.some((user) => user.email === email || user.username === username)) {
        throw new Error("USER_EXISTS");
      }
      const user = {
        id: createId("user_"),
        username,
        email,
        passwordHash: hashPassword(password),
        avatarUrl: "",
        provider: "local",
        role: db.users.length === 0 ? "owner" : "user",
        createdAt: now()
      };
      db.users.push(user);
      return issueAuth(user);
    }).catch((error) => {
      if (error.message === "USER_EXISTS") return null;
      throw error;
    });
    if (!auth) {
      json(res, 409, null, "User already exists");
      return;
    }
    json(res, 201, auth);
    return;
  }

  if (method === "POST" && url.pathname === "/api/auth/login") {
    const body = await parseJsonBody(req);
    const account = String(body.account || "").trim().toLowerCase();
    const password = String(body.password || "");
    const user = await read((db) =>
      db.users.find((item) => item.email === account || item.username.toLowerCase() === account)
    );
    if (!user || !verifyPassword(password, user.passwordHash)) {
      json(res, 401, null, "Invalid account or password");
      return;
    }
    json(res, 200, issueAuth(user));
    return;
  }

  if (method === "GET" && url.pathname === "/api/auth/github") {
    if (!config.github.clientId) {
      json(res, 400, null, "GitHub OAuth is not configured");
      return;
    }
    const state = signToken({ nonce: createId("state_"), exp: Date.now() + 1000 * 60 * 10 }, config.sessionSecret);
    const callback = `${config.appBaseUrl}/api/auth/github/callback`;
    const githubUrl = new URL("https://github.com/login/oauth/authorize");
    githubUrl.searchParams.set("client_id", config.github.clientId);
    githubUrl.searchParams.set("redirect_uri", callback);
    githubUrl.searchParams.set("scope", "read:user user:email");
    githubUrl.searchParams.set("state", state);
    redirect(res, githubUrl.toString());
    return;
  }

  if (method === "GET" && url.pathname === "/api/auth/github/callback") {
    if (!config.github.clientId || !config.github.clientSecret) {
      redirect(res, "/?oauth=missing");
      return;
    }
    const code = url.searchParams.get("code");
    const state = verifyToken(url.searchParams.get("state"), config.sessionSecret);
    if (!code || !state) {
      redirect(res, "/?oauth=failed");
      return;
    }
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        client_id: config.github.clientId,
        client_secret: config.github.clientSecret,
        code,
        redirect_uri: `${config.appBaseUrl}/api/auth/github/callback`
      })
    });
    const tokenData = await tokenResponse.json();
    if (!tokenData.access_token) {
      redirect(res, "/?oauth=failed");
      return;
    }
    const profileResponse = await fetch("https://api.github.com/user", {
      headers: {
        authorization: `Bearer ${tokenData.access_token}`,
        "user-agent": "myBlog"
      }
    });
    const profile = await profileResponse.json();
    const emailResponse = await fetch("https://api.github.com/user/emails", {
      headers: {
        authorization: `Bearer ${tokenData.access_token}`,
        "user-agent": "myBlog"
      }
    });
    const emails = emailResponse.ok ? await emailResponse.json() : [];
    const primaryEmail = emails.find((item) => item.primary)?.email || profile.email || `${profile.id}@github.local`;
    const auth = await mutate((db) => {
      let user = db.users.find((item) => item.provider === "github" && item.providerId === String(profile.id));
      if (!user) {
        user = {
          id: createId("user_"),
          username: profile.login,
          email: primaryEmail.toLowerCase(),
          passwordHash: "",
          avatarUrl: profile.avatar_url || "",
          provider: "github",
          providerId: String(profile.id),
          role: db.users.length === 0 ? "owner" : "user",
          createdAt: now()
        };
        db.users.push(user);
      }
      return issueAuth(user);
    });
    const payload = Buffer.from(JSON.stringify(auth)).toString("base64url");
    redirect(res, `/?github_auth=${payload}`);
    return;
  }

  if (method === "GET" && url.pathname === "/api/me") {
    const userId = getBearerUser(req);
    if (!userId) {
      json(res, 200, { user: null });
      return;
    }
    const user = await read((db) => db.users.find((item) => item.id === userId));
    json(res, 200, { user: publicUser(user) });
    return;
  }

  if (method === "PATCH" && url.pathname === "/api/me") {
    const user = await requireUser(req, res);
    if (!user) return;
    const body = await parseJsonBody(req);
    const username = String(body.username || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const avatarUrl = String(body.avatarUrl || "").trim();
    if (!username || !email) {
      json(res, 400, null, "Username and email are required");
      return;
    }
    const updated = await mutate((db) => {
      const exists = db.users.some(
        (item) => item.id !== user.id && (item.username === username || item.email === email)
      );
      if (exists) throw new Error("USER_EXISTS");
      const record = db.users.find((item) => item.id === user.id);
      record.username = username;
      record.email = email;
      record.avatarUrl = avatarUrl;
      return publicUser(record);
    }).catch((error) => {
      if (error.message === "USER_EXISTS") return null;
      throw error;
    });
    if (!updated) {
      json(res, 409, null, "Username or email already exists");
      return;
    }
    json(res, 200, { user: updated });
    return;
  }

  if (method === "GET" && url.pathname === "/api/posts") {
    const userId = getBearerUser(req);
    const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
    const tag = String(url.searchParams.get("tag") || "").trim();
    const posts = await read((db) => {
      let result = listPostsView(db, userId);
      if (q) {
        result = result.filter((post) => {
          const source = `${post.title} ${post.summary} ${post.tags.join(" ")}`.toLowerCase();
          const full = db.posts.find((item) => item.id === post.id)?.content || "";
          return source.includes(q) || stripMarkdown(full).toLowerCase().includes(q);
        });
      }
      if (tag) {
        result = result.filter((post) => post.tags.includes(tag));
      }
      return result;
    });
    json(res, 200, { posts });
    return;
  }

  if (method === "POST" && url.pathname === "/api/posts") {
    const user = await requireOwner(req, res);
    if (!user) return;
    const body = await parseJsonBody(req);
    const title = String(body.title || "").trim();
    const content = String(body.content || "").trim();
    if (!title || !content) {
      json(res, 400, null, "Title and content are required");
      return;
    }
    const post = await mutate((db) => {
      const record = createPostRecord({
        authorId: user.id,
        title,
        content,
        summary: String(body.summary || "").trim(),
        tags: normalizeTags(body.tags)
      });
      db.posts.push(record);
      return postView(db, record, user.id);
    });
    json(res, 201, { post });
    return;
  }

  const postMatch = url.pathname.match(/^\/api\/posts\/([^/]+)$/);
  if (method === "GET" && postMatch) {
    const userId = getBearerUser(req);
    const key = decodeURIComponent(postMatch[1]);
    const post = await read((db) => {
      const found = db.posts.find((item) => item.id === key || item.slug === key);
      return found ? postView(db, found, userId) : null;
    });
    if (!post) {
      json(res, 404, null, "Post not found");
      return;
    }
    json(res, 200, { post });
    return;
  }

  if (method === "PUT" && postMatch) {
    const user = await requireOwner(req, res);
    if (!user) return;
    const key = decodeURIComponent(postMatch[1]);
    const body = await parseJsonBody(req);
    const title = String(body.title || "").trim();
    const content = String(body.content || "").trim();
    if (!title || !content) {
      json(res, 400, null, "Title and content are required");
      return;
    }
    const post = await mutate((db) => {
      const record = db.posts.find((item) => item.id === key || item.slug === key);
      if (!record) throw new Error("POST_NOT_FOUND");
      record.title = title;
      record.content = content;
      record.summary = String(body.summary || "").trim();
      record.tags = normalizeTags(body.tags);
      record.updatedAt = now();
      if (!record.slug) record.slug = `${slugify(title)}-${Date.now().toString(36)}`;
      return postView(db, record, user.id);
    }).catch((error) => {
      if (error.message === "POST_NOT_FOUND") return null;
      throw error;
    });
    if (!post) {
      json(res, 404, null, "Post not found");
      return;
    }
    json(res, 200, { post });
    return;
  }

  if (method === "DELETE" && postMatch) {
    const user = await requireOwner(req, res);
    if (!user) return;
    const key = decodeURIComponent(postMatch[1]);
    const deleted = await mutate((db) => {
      const index = db.posts.findIndex((item) => item.id === key || item.slug === key);
      if (index < 0) return false;
      const [post] = db.posts.splice(index, 1);
      const commentIds = new Set(db.comments.filter((comment) => comment.postId === post.id).map((comment) => comment.id));
      db.comments = db.comments.filter((comment) => comment.postId !== post.id);
      db.highlightComments = db.highlightComments.filter((comment) => comment.postId !== post.id);
      db.likes = db.likes.filter(
        (like) =>
          !(like.targetType === "post" && like.targetId === post.id) &&
          !(like.targetType === "comment" && commentIds.has(like.targetId))
      );
      return true;
    });
    if (!deleted) {
      json(res, 404, null, "Post not found");
      return;
    }
    json(res, 200, { deleted: true });
    return;
  }

  const postCommentsMatch = url.pathname.match(/^\/api\/posts\/([^/]+)\/comments$/);
  if (method === "GET" && postCommentsMatch) {
    const userId = getBearerUser(req);
    const postId = decodeURIComponent(postCommentsMatch[1]);
    const payload = await read((db) => {
      const post = db.posts.find((item) => item.id === postId || item.slug === postId);
      if (!post) return null;
      return {
        comments: db.comments
          .filter((comment) => comment.postId === post.id)
          .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
          .map((comment) => commentView(db, comment, userId)),
        highlights: db.highlightComments
          .filter((comment) => comment.postId === post.id)
          .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
          .map((comment) => highlightCommentView(db, comment))
      };
    });
    if (!payload) {
      json(res, 404, null, "Post not found");
      return;
    }
    json(res, 200, payload);
    return;
  }

  if (method === "POST" && postCommentsMatch) {
    const user = await requireUser(req, res);
    if (!user) return;
    const postKey = decodeURIComponent(postCommentsMatch[1]);
    const body = await parseJsonBody(req);
    const content = String(body.content || "").trim();
    if (!content) {
      json(res, 400, null, "Comment content is required");
      return;
    }
    const comment = await mutate((db) => {
      const post = db.posts.find((item) => item.id === postKey || item.slug === postKey);
      if (!post) throw new Error("POST_NOT_FOUND");
      const record = {
        id: createId("comment_"),
        postId: post.id,
        parentId: String(body.parentId || ""),
        authorId: user.id,
        content,
        createdAt: now()
      };
      db.comments.push(record);
      return commentView(db, record, user.id);
    }).catch((error) => {
      if (error.message === "POST_NOT_FOUND") return null;
      throw error;
    });
    if (!comment) {
      json(res, 404, null, "Post not found");
      return;
    }
    json(res, 201, { comment });
    return;
  }

  const highlightMatch = url.pathname.match(/^\/api\/posts\/([^/]+)\/highlights$/);
  if (method === "POST" && highlightMatch) {
    const user = await requireUser(req, res);
    if (!user) return;
    const postKey = decodeURIComponent(highlightMatch[1]);
    const body = await parseJsonBody(req);
    const selectedText = String(body.selectedText || "").trim();
    const content = String(body.content || "").trim();
    if (!selectedText || !content) {
      json(res, 400, null, "Selected text and comment are required");
      return;
    }
    const highlight = await mutate((db) => {
      const post = db.posts.find((item) => item.id === postKey || item.slug === postKey);
      if (!post) throw new Error("POST_NOT_FOUND");
      const record = {
        id: createId("highlight_"),
        postId: post.id,
        authorId: user.id,
        selectedText: selectedText.slice(0, 240),
        content,
        position: String(body.position || ""),
        createdAt: now()
      };
      db.highlightComments.push(record);
      return highlightCommentView(db, record);
    }).catch((error) => {
      if (error.message === "POST_NOT_FOUND") return null;
      throw error;
    });
    if (!highlight) {
      json(res, 404, null, "Post not found");
      return;
    }
    json(res, 201, { highlight });
    return;
  }

  const likeMatch = url.pathname.match(/^\/api\/likes\/(post|comment)\/([^/]+)$/);
  if (method === "POST" && likeMatch) {
    const user = await requireUser(req, res);
    if (!user) return;
    const [, targetType, targetId] = likeMatch;
    const payload = await mutate((db) => {
      const exists =
        targetType === "post"
          ? db.posts.some((post) => post.id === targetId)
          : db.comments.some((comment) => comment.id === targetId);
      if (!exists) throw new Error("TARGET_NOT_FOUND");
      const likeIndex = db.likes.findIndex(
        (like) => like.userId === user.id && like.targetType === targetType && like.targetId === targetId
      );
      let liked = true;
      if (likeIndex >= 0) {
        db.likes.splice(likeIndex, 1);
        liked = false;
      } else {
        db.likes.push({
          id: createId("like_"),
          userId: user.id,
          targetType,
          targetId,
          createdAt: now()
        });
      }
      const likeCount = db.likes.filter((like) => like.targetType === targetType && like.targetId === targetId).length;
      return { liked, likeCount };
    }).catch((error) => {
      if (error.message === "TARGET_NOT_FOUND") return null;
      throw error;
    });
    if (!payload) {
      json(res, 404, null, "Target not found");
      return;
    }
    json(res, 200, payload);
    return;
  }

  if (method === "POST" && url.pathname === "/api/ai/post-assist") {
    const user = await requireUser(req, res);
    if (!user) return;
    if (user.role !== "owner") {
      json(res, 403, null, "Only the blog owner can generate post metadata");
      return;
    }
    const body = await parseJsonBody(req);
    const title = String(body.title || "").trim();
    const content = String(body.content || "").trim();
    if (!title || !content) {
      json(res, 400, null, "Title and content are required");
      return;
    }
    const assist = await generatePostAssist({ title, content });
    json(res, 200, assist);
    return;
  }

  json(res, 404, null, "API not found");
}

async function serveStatic(req, res, url) {
  const pathname = decodeURIComponent(url.pathname);
  let filePath = path.join(PUBLIC_DIR, pathname === "/" ? "index.html" : pathname);
  const relativePath = path.relative(PUBLIC_DIR, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    json(res, 403, null, "Forbidden");
    return;
  }
  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, "index.html");
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, {
      "content-type": CONTENT_TYPES[ext] || "application/octet-stream",
      "x-content-type-options": "nosniff"
    });
    res.end(data);
  } catch {
    const fallback = await fs.readFile(path.join(PUBLIC_DIR, "index.html"), "utf8");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(fallback.replace("</body>", `<script>window.__NOT_FOUND__=${JSON.stringify(escapeHtml(pathname))}</script></body>`));
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", config.appBaseUrl);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
    } else {
      await serveStatic(req, res, url);
    }
  } catch (error) {
    console.error(error);
    json(res, 500, null, error.message || "Internal server error");
  }
});

server.listen(config.port, () => {
  console.log(`myBlog is running at ${config.appBaseUrl}`);
});
