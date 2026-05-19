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

---

## 📸 管理面板

![管理面板](ui.png)

---

## ✨ 功能

- **OpenAI 兼容接口** — `GET /v1/models`、`POST /v1/chat/completions`、`POST /v1/completions`、`POST /v1/responses`
- **流式与非流式** — SSE streaming 与完整非流式响应
- **Kimi 账号池** — 多账号健康调度、Token 自动刷新、并发控制、冷却策略
- **API Key 管理** — 创建、删除、请求计数
- **请求日志** — 筛选、详情、错误追踪
- **管理面板** — 单文件 SPA，深色极简设计，零外部依赖
- **Cloudflare Workers 原生** — KV + D1 存储，全球部署

---

## 🚀 部署

### 方式一：Git 集成部署（无需 CLI）

> ⚠️ **关于 KV/D1 绑定**：你也可以先部署 Worker，再到 Dashboard 上绑定 KV + D1（跳过下方第 ③ 步）。但 Cloudflare Git 集成的每次重新部署都会**覆盖 Dashboard 上的绑定配置**，已绑定的 KV/D1 会丢失。
>
> **建议**：按下面的步骤，在首次部署前就把真实 ID 填入 fork 中的 `wrangler.toml`，这样绑定随代码一起部署，后续重新构建也不会丢失。

**① Fork 仓库**

点击右上角 **Fork**。

**② 创建 KV + D1**

| 资源 | 位置 | 名称示例 |
|------|------|----------|
| KV | Workers & Pages → **KV** → 创建 | `CF_KIMI_API` |
| D1 | Workers & Pages → **D1** → 创建 | `cf-kimi-api-logs` |

创建后记下返回的 **KV ID** 和 **D1 ID**。

**③ 在 fork 中填入 ID**

打开你 fork 的仓库，编辑 `wrangler.toml`，将 `YOUR_KV_NAMESPACE_ID` 和 `YOUR_D1_DATABASE_ID` 替换为上一步记下的真实 ID，然后提交。

> 在 GitHub 网页上直接编辑即可，无需本地命令行。

```diff
- id = "YOUR_KV_NAMESPACE_ID"
+ id = "56fb503eb2484fb69e785a71303dd982"   ← 你的真实 KV ID

- database_id = "YOUR_D1_DATABASE_ID"
+ database_id = "459808d8-bd81-47e1-9bb4-cfeecc3952ce"   ← 你的真实 D1 ID
```

**④ 创建 Worker 并连接 GitHub**

Cloudflare Dashboard → **Workers & Pages** → **创建应用程序** → **连接 GitHub 仓库** → 授权 GitHub → 选择 fork 的 `cf-kimi-api-ts`。

| 字段 | 填写 |
|------|------|
| 项目名称 | `cf-kimi-api-ts` |
| 生产分支 | `main` |
| 框架预设 | **无**（否则自动检测 Hono 会失败） |
| 构建命令 | 留空 |
| 部署命令 | `npx wrangler deploy src/index.ts --name cf-kimi-api-ts --compatibility-date 2024-12-01 --keep-vars` |

→ **保存并部署**。首次部署即带正确的 KV/D1 绑定。

**⑤ 添加环境变量**

Worker `cf-kimi-api-ts` → **设置 → 变量** → 添加：

| 变量名 | 值 |
|--------|-----|
| `ADMIN_PASSWORD` | 你的管理密码 |
| `SESSION_SECRET` | 随便一个字符串，如 `my-secret` |

可选（代码有默认值，按需添加）：

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `KIMI_API_BASE` | `https://www.kimi.com` | Kimi 服务地址 |
| `TIMEZONE` | `Asia/Shanghai` | 面板时区 |
| `REQUEST_LOG_RETENTION` | `1000` | 最大保留日志条数 |
| `DEFAULT_MODEL` | 空 | 默认模型名，如 `kimi-k2.6` |

**⑥ 访问**

`https://cf-kimi-api-ts.你的子域名.workers.dev/admin` → 用 `ADMIN_PASSWORD` 登录 → 添加 Kimi Token → 创建 API Key → 开始调用。

> 之后每次向 `main` 推送代码，Cloudflare 自动重新部署，绑定不会丢失。

---

### 方式二：Wrangler CLI 部署

适合开发者，命令行完成全部操作。

```bash
# Fork → Clone
git clone https://github.com/你的用户名/cf-kimi-api-ts.git
cd cf-kimi-api-ts
npm install

# 复制配置文件（仓库本身不含 wrangler.toml）
cp wrangler.toml.example wrangler.toml

# 登录 Cloudflare
npx wrangler login

# 创建 KV 和 D1（记下返回的 ID）
npx wrangler kv namespace create "CF_KIMI_API"
npx wrangler d1 create cf-kimi-api-logs

# 编辑 wrangler.toml，填入上面的 ID
# 设置 Secrets
echo "你的管理密码" | npx wrangler secret put ADMIN_PASSWORD
openssl rand -base64 32 | npx wrangler secret put SESSION_SECRET

# 部署
npm run deploy
```

**可选：绑定自定义域名**

有域名托管在 Cloudflare 的话，可以绑定绕过代理限制：

```bash
npx wrangler triggers deploy --name "cf-kimi-api-ts" --route "你的域名/*"
```

然后在 Cloudflare Dashboard 添加 DNS A 记录（开启代理/橙云）指向 `192.0.2.1`。

**首次使用**

访问 `https://你的域名/admin` → 用 `ADMIN_PASSWORD` 登录 → 添加 Kimi Token → 创建 API Key → 开始调用。

---

### 方式二：Wrangler CLI 部署

适合开发者，命令行完成全部操作。

```bash
# Fork → Clone
git clone https://github.com/你的用户名/cf-kimi-api-ts.git
cd cf-kimi-api-ts
npm install

# 登录 Cloudflare
npx wrangler login

# 创建 KV 和 D1（记下返回的 ID）
npx wrangler kv namespace create "CF_KIMI_API"
npx wrangler d1 create cf-kimi-api-logs

# 编辑 wrangler.toml，填入上面的 ID
# 设置 Secrets
echo "你的管理密码" | npx wrangler secret put ADMIN_PASSWORD
openssl rand -base64 32 | npx wrangler secret put SESSION_SECRET

# 部署
npm run deploy
```

**可选：绑定自定义域名**

有域名托管在 Cloudflare 的话，可以绑定绕过代理限制：

```bash
npx wrangler triggers deploy --name "cf-kimi-api-ts" --route "你的域名/*"
```

然后在 Cloudflare Dashboard 添加 DNS A 记录（开启代理/橙云）指向 `192.0.2.1`。

**首次使用**

访问 `https://你的域名/admin` → 用 `ADMIN_PASSWORD` 登录 → 添加 Kimi Token → 创建 API Key → 开始调用。

---

## 📖 API

### 公开接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/healthz` | 健康检查 |
| `GET` | `/admin` | 管理面板 SPA |

### OpenAI 兼容接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/v1/models` | 模型列表 |
| `GET` | `/v1/models/{id}` | 模型详情 |
| `POST` | `/v1/chat/completions` | Chat Completions |
| `POST` | `/v1/completions` | Legacy Completions |
| `POST` | `/v1/responses` | Responses API |

所有 `/v1/*` 接口需携带 API Key：`Authorization: Bearer <你的_API_Key>`。

### 管理面板

| 模块 | 说明 |
|------|------|
| **概览** | 运行状态、Token 健康、账号统计、Key 数量、24h 请求趋势 |
| **账号** | Kimi 账号池管理：添加/删除、Token 类型检测、状态监控 |
| **Keys** | API Key 管理：创建、复制、删除、调用次数统计 |
| **日志** | 请求日志：按状态筛选、分页、查看详情 |

---

## ⚙️ 配置

### 存储绑定

| 绑定 | 类型 | 用途 |
|------|------|------|
| `KV` | KV Namespace | 存储账号、Key、Token 缓存等持久数据 |
| `DB` | D1 Database | 存储请求日志 |

> Dashboard → Worker → **设置 → 绑定** 中添加。

### 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `ADMIN_PASSWORD` | ✅ | 管理面板登录密码 |
| `SESSION_SECRET` | ✅ | JWT 签名密钥，任意字符串即可 |

其余变量（`KIMI_API_BASE`、`TIMEZONE`、`REQUEST_LOG_RETENTION`、`DEFAULT_MODEL`）代码中已有默认值，**无需设置**。

---

## 🏗️ 项目结构

```
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

- 设置强 `ADMIN_PASSWORD`，不要与其他服务共用
- 不要把真实 Token、API Key 提交到**上游仓库**（本仓库）
- `wrangler.toml` 中的真实 ID 会提交到你自己的 fork 中，这是正常的
- `wrangler.toml.local` 和 `.env` 已在 `.gitignore` 中，不会被提交

---

## 📝 更新日志

详见 [CHANGELOG.md](./CHANGELOG.md)

## 🤝 贡献

欢迎贡献！请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)

## 🙏 致谢

感谢原项目 [XxxXTeam/kimi2api](https://github.com/XxxXTeam/kimi2api) 的基础实现和思路。

## 📄 许可证

[MIT License](./LICENSE) © 2026 chopper1026
