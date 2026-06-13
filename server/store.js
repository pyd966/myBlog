import fs from "node:fs/promises";
import path from "node:path";
import { createId, excerpt, now, publicUser, slugify } from "./utils.js";

const DATA_DIR = path.resolve(process.env.DATA_DIR || "data");
const DATA_FILE = path.join(DATA_DIR, "blog.json");

const emptyData = {
  users: [],
  posts: [],
  comments: [],
  likes: [],
  highlightComments: []
};

let data = null;
let writeQueue = Promise.resolve();

export async function loadData() {
  if (data) return data;
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    data = { ...emptyData, ...JSON.parse(raw) };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    data = structuredClone(emptyData);
    await saveData();
  }
  return data;
}

export async function saveData() {
  writeQueue = writeQueue.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
  });
  return writeQueue;
}

export async function mutate(mutator) {
  await loadData();
  const result = await mutator(data);
  await saveData();
  return result;
}

export async function read(reader) {
  await loadData();
  return reader(data);
}

export function listPostsView(db, currentUserId = "") {
  return db.posts
    .filter((post) => post.status === "published")
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((post) => postView(db, post, currentUserId, false));
}

export function postView(db, post, currentUserId = "", includeContent = true) {
  const author = db.users.find((user) => user.id === post.authorId);
  const postLikes = db.likes.filter((like) => like.targetType === "post" && like.targetId === post.id);
  const comments = db.comments.filter((comment) => comment.postId === post.id);
  return {
    id: post.id,
    slug: post.slug,
    title: post.title,
    content: includeContent ? post.content : undefined,
    summary: post.summary || excerpt(post.content),
    tags: post.tags || [],
    author: publicUser(author),
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    likeCount: postLikes.length,
    commentCount: comments.length,
    likedByMe: Boolean(
      currentUserId &&
        postLikes.some((like) => like.userId === currentUserId)
    )
  };
}

export function commentView(db, comment, currentUserId = "") {
  const author = db.users.find((user) => user.id === comment.authorId);
  const likes = db.likes.filter((like) => like.targetType === "comment" && like.targetId === comment.id);
  return {
    id: comment.id,
    postId: comment.postId,
    parentId: comment.parentId || "",
    content: comment.content,
    author: publicUser(author),
    createdAt: comment.createdAt,
    likeCount: likes.length,
    likedByMe: Boolean(currentUserId && likes.some((like) => like.userId === currentUserId))
  };
}

export function highlightCommentView(db, comment) {
  const author = db.users.find((user) => user.id === comment.authorId);
  return {
    id: comment.id,
    postId: comment.postId,
    selectedText: comment.selectedText,
    content: comment.content,
    position: comment.position,
    author: publicUser(author),
    createdAt: comment.createdAt
  };
}

export function createPostRecord({ authorId, title, content, summary, tags }) {
  const titleSlug = slugify(title);
  return {
    id: createId("post_"),
    slug: `${titleSlug}-${Date.now().toString(36)}`,
    authorId,
    title,
    content,
    summary: summary || excerpt(content),
    tags: tags || [],
    status: "published",
    createdAt: now(),
    updatedAt: now()
  };
}
