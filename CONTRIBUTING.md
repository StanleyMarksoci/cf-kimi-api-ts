# Contributing

感谢你考虑为本项目贡献代码！

## 开发流程

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feat/your-feature-name`
3. 提交更改：`git commit -m "feat: add something"`
4. 推送到你的分支：`git push origin feat/your-feature-name`
5. 创建 Pull Request

## 代码规范

- 使用 TypeScript，开启 `strict` 模式
- 遵循现有的代码风格（使用 `pnpm format` 或 Prettier 格式化）
- 提交前运行 `npm run typecheck` 确保无类型错误

## 提交信息

建议使用 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

```
feat: add new feature
fix: correct bug
refactor: restructure code
docs: update documentation
chore: maintenance tasks
```

## 本地测试

```bash
# 类型检查
npm run typecheck

# 运行测试
npm run test
```

## Pull Request 指南

- 确保 PR 描述清楚做了什么以及为什么
- 如果修复了某个 issue，请引用：`Closes #123`
- 保持 PR 范围集中，一个 PR 一个功能
- 更新相关文档（如 README.md）

## 报告问题

提交 issue 时请包含：

- 清晰的标题和描述
- 复现步骤
- 预期行为和实际行为
- 环境信息（Worker 版本、配置等）
