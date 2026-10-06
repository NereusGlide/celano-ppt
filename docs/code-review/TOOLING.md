# 自动化门禁落地说明

> **状态（2026-10-07）：已落地。** TypeScript 7 与 typescript-eslint 不兼容（peer 要求 <6.1.0），
> 最终采用 **Biome** 替代 ESLint + Prettier（本文件「§1 安装」所述 ESLint 方案已废弃，保留作历史参考）。
> 实际配置见根目录 `biome.json`；`npm run lint` 现在 = `tsc --noEmit` + `biome check`，CI 已自动生效。

## 1. 安装（当前生效方案：Biome）

```bash
npm i -D @biomejs/biome
```

配置 `biome.json`（已生成）：只启用「不需要类型信息」的规则，error 级为
`noDoubleEquals` / `noDebugger` / `noAsyncPromiseExecutor` / `useConst` / `noUnsafeFinally`；
warn 级为 `noExplicitAny` / `noNonNullAssertion`（记账不阻断）。

> ~~ESLint 方案（已废弃）：~~ `npm i -D eslint @eslint/js typescript-eslint eslint-plugin-react-hooks`
> —— 因 typescript-eslint 运行时不支持 TS 7，弃用。

## 2. 接入脚本

`package.json` 已配置：

```json
"lint": "npm run lint:types && npm run lint:biome",
"lint:types": "tsc --noEmit",
"lint:biome": "biome check src server server.ts"
```

## 3. 提交前钩子（可选，推荐）

```bash
npm i -D husky lint-staged
npx husky init
```

`.husky/pre-commit`：

```sh
npx lint-staged
```

`package.json` 追加：

```json
"lint-staged": {
  "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
  "*.{css,md,json}": ["prettier --write"]
}
```

## 4. 分支保护（GitHub）

仓库 Settings → Branches → 对 `main` 开启：

- [x] Require a pull request before merging
- [x] Require approvals: **1**
- [x] Dismiss stale pull request approvals when new commits are pushed
- [x] Require status checks to pass：`quality` / `build`
- [x] Require conversation resolution before merging
- [x] Include administrators（Owner 同样受约束）
- [ ] Allow force pushes —— 保持关闭
- [ ] Allow deletions —— 保持关闭

## 5. CI

已生成 `.github/workflows/ci.yml`：`quality`（tsc + ESLint + `node --test`）→ `build`（`npm run build`）。
首次运行若 `build` 因无限画布子项目耗时过长超时，把 `timeout-minutes` 提到 45。

## 6. 存量债务的处理方式

- ESLint 的 `no-explicit-any` / `no-non-null-assertion` 当前设为 **warn**，CI 不会因此变红，但每次提交都会在终端刷出计数——这是刻意的，用来提示"债务在增加"。
- Wave 2 清零到 ≤ 40 处后，把这两条改为 `error` 并加 `--max-warnings 0`，彻底封死。
- 在此之前，新增 `any` 由审查者按 `CODE_REVIEW.md §6-T` 人工拦截。
