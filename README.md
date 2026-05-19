<h1 align="center">cf-kimi-api-ts</h1>

<p align="center">
  <strong>Kimi Web → OpenAI 兼容 API 网关</strong>
  <br>
  基于 Cloudflare Workers，将 Kimi Web 的专有协议转换为 OpenAI 兼容的 <code>/v1/*</code> 接口
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

## 🚀 部署

### 第一步：Fork 仓库

点击右上角 **Fork** 按钮，将本仓库 fork 到你的 GitHub 账号下。

---

### 方式一：一键部署（推荐，无需代码）

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Aleeyoo/cf-kimi-api-ts)

**操作步骤：**

1. **Fork 本仓库**（已完成）
2. 点击上方按钮 → 登录 Cloudflare → **选择你 fork 的仓库**
3. 在部署配置页面，创建或选择以下资源：

| 字段 | 说明 |
|------|------|
| **KV 命名空间** | 新建一个（如 `cf-kimi-api-kv`）或选已有的 |
| **D1 数据库** | 新建一个 `cf-kimi-api-logs` 或选已有的 |
| `ADMIN_PASSWORD` | 设置管理面板密码 |
| `SESSION_SECRET` | 运行 `openssl rand -base64 32` 生成填入 |

> 其他字段（`KIMI_TOKEN`、`OPENAI_API_KEY`、`SECURE_COOKIES` 等）与本项目无关，**留空即可**。

4. 部署完成后，在 Cloudflare Dashboard → Worker `cf-kimi-api-ts` → **设置 → 绑定**，确认 KV 和 D1 已绑定。

---

### 方式二：GitHub Actions 自动化部署

配置好后，每次推送代码到 `main` 分支都会自动部署。

#### 1. 在 Cloudflare 准备资源

| 资源 | 用途 | 创建位置 |
|------|------|----------|
| **KV Namespace** | 存储账号、Key、配置 | Workers & Pages → KV → 创建 |
| **D1 Database** | 存储请求日志 | Workers & Pages → D1 → 创建 |
| **API Token** | 授权部署 | [API Tokens](https://dash.cloudflare.com/profile/api-tokens) → 创建令牌 → Workers Edit 模板 |

#### 2. 配置 GitHub Secrets

在你 fork 的仓库 → **Settings → Secrets and variables → Actions** 中添加：

| Secret | 说明 | 获取方式 |
|--------|------|----------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API 令牌 | 上一步创建的 |
| `ADMIN_PASSWORD` | 管理面板密码 | 自己设 |
| `SESSION_SECRET` | session 签名密钥 | `openssl rand -base64 32` |

#### 3. 推送代码（触发自动部署）

```bash
git push origin main
```

Actions 自动部署，进度查看：你 fork 的仓库 → Actions 页面。

---

### 部署后配置

#### 绑定 KV 和 D1

一键部署会自动绑定，如需手动确认：Cloudflare Dashboard → 你的 Worker → **设置 → 绑定**

| 变量名 | 绑定类型 | 选择 |
|--------|----------|------|
| `KV` | KV Namespace | 你创建的 KV |
| `DB` | D1 Database | 你创建的 D1 |

#### 绑定自定义域名（可选）

如果你有域名托管在 Cloudflare，可以绑定到 Worker 上绕过代理限制：

```bash
# 安装依赖后执行
npx wrangler triggers deploy --name "cf-kimi-api-ts" --route "你的域名/*"
```

然后在 Cloudflare Dashboard 添加 DNS A 记录（代理模式，橙云）指向 `192.0.2.1`。

#### 首次使用

访问 `https://你的域名/admin` 或 `https://cf-kimi-api-ts.你的子域名.workers.dev/admin` → 用 `ADMIN_PASSWORD` 登录 → 添加 Kimi Token → 创建 API Key → 开始调用。

---

## 💻 本地开发（可选）

```bash
git clone https://github.com/Aleeyoo/cf-kimi-api-ts.git
cd cf-kimi-api-ts
npm install

# 编辑 wrangler.toml 填入 KV/D1 ID（参考 wrangler.toml.example）
# 设置环境变量
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET

# 本地预览
npm run dev

# 部署
npm run deploy
```

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

> 部署后需在 Cloudflare Dashboard → 你的 Worker → 设置 → 绑定 中添加 KV 和 D1 的绑定。

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
