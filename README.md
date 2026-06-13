# myBlog

一个面向训练营结项的小型博客社区项目。目标不是做复杂的大型系统，而是用尽量清晰的代码完成一个从 0 到 1 的可运行产品。

## 功能范围

基础功能：

- 用户注册、登录、当前用户信息、用户资料管理
- 博客创建、展示、全文搜索
- Markdown 文章编辑与渲染阅读，支持 `$...$` 行内公式和 `$$...$$` 行间公式
- Owner 可编辑、删除已发布文章；普通用户看不到发布入口，也不能调用发布接口
- 博客评论
- 博客和评论点赞 / 取消点赞
- Docker Compose 部署

进阶功能：

- GitHub OAuth 登录
- 划线评论：阅读文章时选中文本，先出现悬浮评论按钮，点击后再输入评论
- Owner 专用文章辅助：发布文章时生成摘要和标签
- 轻量全文检索：标题、摘要、标签、正文均可搜索

## 技术栈

- 后端：Node.js 原生 HTTP API
- 前端：原生 HTML / CSS / JavaScript，视觉参考 TonyCrane/note 和 Material for MkDocs 的笔记站风格
- 数据存储：本地 JSON 文件，位于 `data/blog.json`
- 部署：Docker Compose

## 本地启动

```bash
node server/index.js
```

打开：

```text
http://localhost:3000
```

第一个注册的用户会自动成为 `owner`，只有 owner 能看到并使用摘要与标签生成按钮。

## Docker 启动

复制环境变量示例：

```bash
cp .env.example .env
```

启动：

```bash
docker compose up --build
```

## 环境变量

```env
PORT=3000
APP_BASE_URL=http://localhost:3000
SESSION_SECRET=change-me-in-production
DATA_DIR=data

GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

AI_API_KEY=
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
```

GitHub 登录需要在 GitHub OAuth App 中配置：

```text
http://localhost:3000/api/auth/github/callback
```

如果没有配置 `AI_API_KEY`，摘要与标签生成会退化为本地规则，方便离线演示。

Docker 部署时 `docker-compose.yml` 默认会把 `DATA_DIR` 设置为 `/app/data`，并挂载到宿主机的 `./data` 目录。

Markdown 渲染优先使用 `marked` 的 GFM 渲染能力；如果 CDN 加载失败，会退回到项目内置的轻量渲染逻辑，保证文章不会空白。

## 项目结构

```text
server/
  index.js     HTTP 路由、API 入口、静态文件服务
  store.js     JSON 数据读写和视图转换
  ai.js        owner 专用文章摘要 / 标签生成
  config.js    环境变量配置
  utils.js     密码哈希、token、Markdown 摘要等工具

public/
  index.html   页面结构
  styles.css   MkDocs 风格的简洁界面
  app.js       前端状态管理与 API 调用
```

## 数据模型

核心数据存在 `data/blog.json`：

- `users`：用户、登录方式、角色
- `posts`：文章标题、正文、摘要、标签、作者
- `comments`：普通评论和楼中楼预留字段
- `likes`：统一点赞表，支持文章和评论
- `highlightComments`：划线评论，保存选中文本和评论内容


- 为什么选择轻量 Node.js：减少框架噪音，把重点放在完整产品闭环。
- 为什么摘要标签辅助只给 owner：它服务于博主发布流程，而不是开放给所有用户消耗资源。
- 为什么点赞使用统一表：同一套逻辑可以支持博客、评论，后续也方便扩展。
- 为什么划线评论单独建表：它和普通评论的业务对象不同，重点是绑定一段正文引用。
