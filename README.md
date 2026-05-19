<h1 align="center">cf-kimi-api-ts</h1>

<p align="center">
  <strong>Kimi Web → OpenAI 兼容 API 网关</strong>
  <br>
  基于 Cloudflare Workers，将 Kimi Web 的专有协议转换为 OpenAI 兼容的 <code>/v1/*</code> 接口
</p>

<p align="center">
  <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/Aleeyoo/cf-kimi-api-ts">
    <img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare Workers">
  </a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare Workers">
  <img src="https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Hono-4.7-E36002" alt="Hono">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT License">
</p>

<p align="center">
  <a href="https://pi.ai"><img src="https://img.shields.io/badge/π_pi-7C3AED?style=flat-square" alt="pi"></a>
  <a href="https://chat.deepseek.com/"><img src="https://img.shields.io/badge/DeepSeek_V4-4F46E5?style=flat-square" alt="DeepSeek V4"></a>
</p>

---

## 📸 管理面板

![管理面板](ui.png)

---

## ✨ 功能

- **OpenAI 兼容接口** — `GET /v1/models`、`POST /v1/chat/completions`、`POST /v1/completions`、`POST /v1/responses`
- **流式与非流式输出** — SSE streaming 与完整非流式响应
- **Kimi 账号池** — 多账号健康调度、Token 自动刷新、并发控制、冷却策略
- **API Key 管理** — 创建、删除、请求计数
- **请求日志** — 筛选、详情、错误追踪
- **管理面板** — 单文件 SPA，深色极简设计，零外部依赖
- **Cloudflare Workers 原生** — KV + D1 存储，全球部署

---

## 🚀 一键部署

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Aleeyoo/cf-kimi-api-ts)

点击按钮，在 Cloudflare 引导页只需填写 **4 项**即可完成部署：

| 字段 | 说明 |
|------|------|
| **KV 命名空间** | 选择或创建一个 KV Namespace |
| **D1 数据库** | 选择或创建一个 D1 Database |
| `ADMIN_PASSWORD` | 管理面板登录密码（自己设） |
| `SESSION_SECRET` | 运行 `openssl rand -base64 32` 生成一个随机字符串 |

> 其余参数（`KIMI_API_BASE`、`TIMEZONE`、日志保留等）均有合理默认值，部署后可在管理面板或 Cloudflare Dashboard 中按需调整。

---

## 📦 手动部署（可选）

### 前置条件

- Node.js >= 18
- [Cloudflare 账户](https://dash.cloudflare.com/)
- 安装 [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)（`npm install -g wrangler` 或通过 `npx wrangler`）

### 1. 代码托管到 GitHub

```bash
# 在 GitHub 新建仓库（建议设为 Private），然后：
git remote add origin https://github.com/你的用户名/cf-kimi-api-ts.git
git push -u origin main
```

将代码托管到 GitHub 后，可利用 GitHub Actions 自动部署（见下文 CI/CD 章节）。

### 2. 本地安装

```bash
git clone https://github.com/你的用户名/cf-kimi-api-ts.git
cd cf-kimi-api-ts
npm install
```

### 3. 创建 Cloudflare 资源

在 [Cloudflare Dashboard](https://dash.cloudflare.com/) 创建：

1. **KV Namespace** — Workers & Pages → KV → 创建命名空间（如 `cf-kimi-api-kv`）
2. **D1 Database** — Workers & Pages → D1 → 创建数据库（如 `cf-kimi-api-logs`）

### 4. 配置 wrangler.toml

编辑 `wrangler.toml`，填入上一步创建的资源 ID：

```toml
[[kv_namespaces]]
binding = "KV"
id = "你刚创建的_KV_ID"

[[d1_databases]]
binding = "DB"
database_name = "cf-kimi-api-logs"
database_id = "你刚创建的_D1_ID"
```

> 仓库里的 `wrangler.toml` 不包含 `id` / `database_id`，这是为了让一键部署工具弹出资源选择器。本地手动部署时需要手动补上。如需本地覆盖（不污染仓库），可创建 `wrangler.toml.local`，Wrangler 会自动合并。

### 5. 设置环境变量

```bash
# 管理面板密码（必填）
npx wrangler secret put ADMIN_PASSWORD

# Cookie 签名密钥（推荐）
npx wrangler secret put SESSION_SECRET
# 运行 `openssl rand -base64 32` 生成一个随机值

# 可选：预设 Kimi Token（也可部署后在管理面板添加）
npx wrangler secret put KIMI_TOKEN
```

### 6. 本地预览

```bash
npm run dev
```

访问 `http://localhost:8787/admin` 进入管理面板。

### 7. 部署到 Cloudflare

```bash
npm run deploy
```

部署成功后终端会输出 Worker 地址，如 `https://cf-kimi-api-ts.你的账号.workers.dev`。

### 8. 首次使用

1. 访问 `https://你的域名/admin`，用 `ADMIN_PASSWORD` 登录
2. 在「账号」页面添加 Kimi Token（支持 refresh_token 或 JWT access_token）
3. 在「Keys」页面创建 API Key
4. 测试调用：

```bash
curl https://你的域名/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <你的_API_Key>" \
  -d '{
    "model": "kimi-k2.6",
    "messages": [{"role": "user", "content": "你好"}]
  }'
```

### 9.（可选）绑定自定义域名

在 Cloudflare Dashboard → Workers & Pages → 你的 Worker → 触发器 → 自定义域名中添加。

---

## 🤖 CI/CD：GitHub Actions 自动部署

仓库包含 `.github/workflows/deploy.yml`，推送 `main` 分支时自动部署。

### 配置步骤

1. 在 [Cloudflare Dashboard](https://dash.cloudflare.com/profile/api-tokens) 创建 API Token（权限：Workers → Edit）
2. 在 GitHub 仓库 → Settings → Secrets and variables → Actions 中添加：
   - `CLOUDFLARE_API_TOKEN`：上一步创建的 API Token
3. 推送 `main` 分支即可触发自动部署

```bash
git push origin main
```

可在 GitHub 仓库 Actions 页面查看部署日志。

---

## 📖 API

### 公开接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/healthz` | 健康检查 |
| `GET` | `/admin` | 管理面板 |

### OpenAI 兼容接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/v1/models` | 模型列表 |
| `GET` | `/v1/models/{model_id}` | 模型详情 |
| `POST` | `/v1/chat/completions` | Chat Completions |
| `POST` | `/v1/completions` | Legacy Completions |
| `POST` | `/v1/responses` | Responses API |

所有 `/v1/*` 接口要求携带 API Key：`Authorization: Bearer <你的_API_Key>`。

### 管理面板

| 模块 | 说明 |
|------|------|
| **概览** | 运行状态、Token 健康、账号统计、Key 数量、24h 请求趋势 |
| **账号** | Kimi 账号池管理：添加/删除、Token 类型检测、状态监控 |
| **Keys** | 对外 API Key 管理：创建、复制、删除、调用次数统计 |
| **日志** | 请求日志列表：按状态筛选、分页、查看详情 |

---

## ⚙️ 配置

### 存储绑定（Cloudflare Dashboard 中创建）

| 绑定 | 用途 | 创建位置 |
|------|------|----------|
| **KV 命名空间** | 存储账号、Key、Token 缓存等所有持久数据 | Workers & Pages → KV |
| **D1 数据库** | 存储请求日志 | Workers & Pages → D1 → 创建数据库 |

> 一键部署时会弹出下拉菜单让你选择或创建。本地手动部署需在 `wrangler.toml` 中填入 ID。

### 环境变量

| 变量 | 部署必填 | 默认值 | 说明 | 获取方式 |
|------|----------|--------|------|----------|
| `ADMIN_PASSWORD` | **✅ 是** | — | 管理面板登录密码 | 自己设一个强密码 |
| `SESSION_SECRET` | **✅ 是** | — | JWT 签名密钥，用于加密管理面板登录 session | 运行 `openssl rand -base64 32` 生成随机字符串 |
| `KIMI_API_BASE` | 否 | `https://www.kimi.com` | Kimi Web 服务地址 | 不需要改 |
| `TIMEZONE` | 否 | `Asia/Shanghai` | 面板时间显示时区 | 按需设为 `Asia/Shanghai`、`America/New_York` 等 |
| `REQUEST_LOG_RETENTION` | 否 | `1000` | 最大保留请求日志条数，超出后自动清除旧日志 | 调大调小都行 |
| `DEFAULT_MODEL` | 否 | 空 | 请求未指定 model 时使用的默认模型名 | 例如 `kimi-k2.6` |

### 可选预设（部署后可改）

以下变量非必填，部署后可通过管理面板配置，效果相同：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `KIMI_TOKEN` | 空 | 预设 Kimi Token（refresh_token 或 JWT access_token），免去首次登录面板手动添加 |

> ⚠️ 已从文档移除的字段：`SECURE_COOKIES`、`KIMI_ACCEPT_LANGUAGE`、`KIMI_MAX_CONCURRENCY`、`KIMI_MIN_REQUEST_INTERVAL`、`TIMEOUT`、`OPENAI_API_KEY`、`MODEL` — 这些变量在代码中未使用，旧的 README 记录有误。

---

## 🏗️ 项目结构

```text
src/
├── index.ts               # Hono 应用入口
├── config.ts              # 环境变量配置
├── admin-html.ts          # 管理面板 SPA（HTML 内联）
├── api/                   # OpenAI 兼容 API
│   ├── auth.ts            #   API Key 验证中间件
│   ├── routes.ts          #   /v1/* 路由处理
│   ├── models.ts          #   模型解析
│   ├── streaming.ts       #   流式响应
│   └── errors.ts          #   错误响应
├── kimi/                  # Kimi Web 协议客户端
│   ├── client.ts          #   Kimi2API 主类
│   ├── protocol.ts        #   协议定义、消息格式化
│   ├── transport.ts       #   请求传输与重试
│   ├── chunks.ts          #   Streaming chunk 构造
│   ├── events.ts          #   gRPC 事件解析
│   └── model-catalog.ts   #   模型目录
├── dashboard/             # 管理面板 API
│   └── routes.ts          #   所有 /admin/api/* 路由
├── services/              # 核心服务
│   ├── account-pool.ts    #   账号池调度
│   ├── token-manager.ts   #   Token 刷新与缓存
│   └── session.ts         #   管理面板会话
├── stores/                # KV/D1 存储层
│   ├── accounts.ts        #   Kimi 账号
│   ├── keys.ts            #   API Key
│   ├── logs.ts            #   请求日志 (D1)
│   ├── tokens.ts          #   Token 缓存
│   ├── conversations.ts   #   对话上下文
│   ├── identity.ts        #   客户端设备标识
│   └── catalog.ts         #   模型目录缓存
└── utils/
    ├── crypto.ts          #   加密工具
    └── time.ts            #   时间工具
static/
  └── admin.html           # 管理面板 SPA（独立 HTML）
```

---

## 🔒 安全

- 生产环境请设置强 `ADMIN_PASSWORD` 和稳定的 `SESSION_SECRET`
- 公开部署时保持 `SECURE_COOKIES=true`
- 不要把真实 Token、API Key 提交到仓库
- 本地配置覆盖请用 `wrangler.toml.local`（已加入 `.gitignore`），真实 ID 不会误提交

---

## 📝 更新日志

详见 [CHANGELOG.md](./CHANGELOG.md)

---

## 🤝 贡献

欢迎贡献！请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)

---

## 🙏 致谢

感谢原项目 [XxxXTeam/kimi2api](https://github.com/XxxXTeam/kimi2api) 的基础实现和思路。

---

## 📄 许可证

[MIT License](./LICENSE) © 2026 chopper1026
