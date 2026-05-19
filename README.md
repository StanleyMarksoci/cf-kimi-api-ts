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

### 方式一：Git 集成（无需 CLI）

> **步骤 ①** —— **Fork 仓库** → 点击右上角 **Fork**。

> **步骤 ②** —— **创建 Worker 并连接 GitHub**

Cloudflare Dashboard → **Workers & Pages** → **创建应用程序** → **连接 GitHub 仓库** → 授权 GitHub → 选择 fork 的 `cf-kimi-api-ts`。

| 字段 | 填写 |
|------|------|
| 项目名称 | `cf-kimi-api-ts` |
| 生产分支 | `main` |
| 框架预设 | **无**（否则自动检测 Hono 会失败） |
| 构建命令 | 留空 |
| 部署命令 | `npx wrangler deploy src/index.ts --name cf-kimi-api-ts --compatibility-date 2024-12-01 --keep-vars` |

→ **保存并部署**。

> **步骤 ③** —— **创建 KV + D1**

| 资源 | 位置 | 名称示例 |
|------|------|----------|
| KV | Workers & Pages → **KV** → 创建 | `CF_KIMI_API` |
| D1 | Workers & Pages → **D1** → 创建 | `cf-kimi-api-logs` |

> **步骤 ④** —— **绑定 KV + D1**（二选一）

| 方式 | 操作 | 注意 |
|------|------|------|
| **A. Dashboard 绑定** | Worker → 设置 → 绑定 → 添加 `KV` 和 `DB` | ⚠️ 重新构建后绑定会丢失，需重新添加 |
| **B. 写在 wrangler.toml**（推荐） | 在 fork 中编辑 `wrangler.toml`，追加下方内容并提交 | ✅ 绑定持久，重建不丢 |

```toml
# 追加到 wrangler.toml 末尾
[[kv_namespaces]]
binding = "KV"
id = "你的KV_ID"

[[d1_databases]]
binding = "DB"
database_name = "cf-kimi-api-logs"
database_id = "你的D1_ID"
```

> **步骤 ⑤** —— **添加环境变量**

Worker `cf-kimi-api-ts` → **设置 → 变量** → 添加：

| 变量名 | 值 |
|--------|-----|
| `ADMIN_PASSWORD` | 你的管理密码 |
| `SESSION_SECRET` | 任意字符串，如 `my-secret` |

可选（代码有默认值，按需添加）：`KIMI_API_BASE`、`TIMEZONE`、`REQUEST_LOG_RETENTION`、`DEFAULT_MODEL`。

> **步骤 ⑥** —— **开始使用**

1. 打开 `https://cf-kimi-api-ts.你的子域名.workers.dev/admin`，输入密码登录
2. 在 **账号** 页添加 Kimi Token（获取方式：登录 [kimi.com](https://kimi.com) → F12 → **Application → Local Storage** → 搜索 `refresh_token`）
3. 在 **Keys** 页创建一个 API Key
4. 调用 API：

```bash
curl https://cf-kimi-api-ts.你的子域名.workers.dev/v1/chat/completions \
  -H "Authorization: Bearer 你的API_Key" \
  -H "Content-Type: application/json" \
  -d '{"model": "kimi-k2.6", "messages": [{"role": "user", "content": "你好"}]}'
```

---

### 方式二：Wrangler CLI

```bash
git clone https://github.com/你的用户名/cf-kimi-api-ts.git
cd cf-kimi-api-ts
npm install
cp wrangler.toml.example wrangler.toml

npx wrangler login
npx wrangler kv namespace create "CF_KIMI_API"
npx wrangler d1 create cf-kimi-api-logs

# 编辑 wrangler.toml，填入上面的 ID
echo "你的管理密码" | npx wrangler secret put ADMIN_PASSWORD
openssl rand -base64 32 | npx wrangler secret put SESSION_SECRET

npm run deploy
```

**可选：绑定自定义域名**

```bash
npx wrangler triggers deploy --name "cf-kimi-api-ts" --route "你的域名/*"
```

然后在 Cloudflare Dashboard 添加 DNS A 记录（开启代理/橙云）指向 `192.0.2.1`。

使用步骤同上方的 **步骤 ⑥**。

---

## 📖 API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/healthz` | 健康检查 |
| `GET` | `/admin` | 管理面板 SPA |
| `GET` | `/v1/models` | 模型列表 |
| `GET` | `/v1/models/{id}` | 模型详情 |
| `POST` | `/v1/chat/completions` | Chat Completions |
| `POST` | `/v1/completions` | Legacy Completions |
| `POST` | `/v1/responses` | Responses API |

所有 `/v1/*` 接口需携带 API Key：`Authorization: Bearer <你的_API_Key>`。

---

## ⚙️ 配置

| 绑定 | 类型 | 用途 |
|------|------|------|
| `KV` | KV Namespace | 账号、Key、Token 缓存等持久数据 |
| `DB` | D1 Database | 请求日志 |

| 变量 | 必填 | 说明 |
|------|------|------|
| `ADMIN_PASSWORD` | ✅ | 管理面板密码 |
| `SESSION_SECRET` | ✅ | JWT 签名密钥，任意字符串即可 |

其余变量（`KIMI_API_BASE`、`TIMEZONE`、`REQUEST_LOG_RETENTION`、`DEFAULT_MODEL`）代码已有默认值。

---

## 🏗️ 项目结构

```
src/
├── index.ts               # Hono 入口
├── config.ts              # 环境变量
├── admin-html.ts          # 管理面板 SPA（内联 HTML）
├── api/                   # OpenAI 兼容接口
│   ├── auth.ts / routes.ts / models.ts / streaming.ts / errors.ts
├── kimi/                  # Kimi 协议客户端
│   ├── client.ts / protocol.ts / transport.ts / chunks.ts / events.ts / model-catalog.ts
├── dashboard/             # 管理面板 API
│   └── routes.ts
├── services/              # 账号池 / Token 管理 / 会话
│   ├── account-pool.ts / token-manager.ts / session.ts
├── stores/                # 存储层
│   ├── accounts.ts / keys.ts / logs.ts / tokens.ts / conversations.ts / identity.ts / catalog.ts
└── utils/
    ├── crypto.ts / time.ts
static/
  └── admin.html
```

---

## 🔒 安全

- 设置强 `ADMIN_PASSWORD`
- `wrangler.toml` 中的 KV/D1 ID 会提交到你 fork 的仓库中，可考虑设为 private
- `wrangler.toml.local` 和 `.env` 已被 `.gitignore` 排除

---

## 📝 更新日志 · 🤝 贡献 · 🙏 致谢 · 📄 许可证

详见 [CHANGELOG.md](./CHANGELOG.md) · [CONTRIBUTING.md](./CONTRIBUTING.md) · 感谢 [XxxXTeam/kimi2api](https://github.com/XxxXTeam/kimi2api) · [MIT License](./LICENSE) © 2026 chopper1026
