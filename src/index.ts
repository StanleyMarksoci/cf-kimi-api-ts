import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./config";
import apiRoutes from "./api/routes";
import dashboardRoutes from "./dashboard/routes";
import ADMIN_HTML from "./admin-html";

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());
app.use("*", async (c, next) => {
  await next();
  c.res.headers.set("X-Powered-By", "worker-ai-proxy");
});

app.get("/healthz", (c) => c.json({ status: "ok" }));

app.route("/", apiRoutes);
app.route("/", dashboardRoutes);

// 管理面板 SPA 入口
app.get("/admin", (c) => c.html(ADMIN_HTML));
app.get("/admin.html", (c) => c.html(ADMIN_HTML));
// SPA 回退：管理面板子路径一律输出管理页面
app.get("/admin/*", (c) => c.html(ADMIN_HTML));

export default app;
