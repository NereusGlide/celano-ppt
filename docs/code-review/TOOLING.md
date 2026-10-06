# 自动化门禁落地说明

规范靠人执行会退化，能自动化的部分必须交给机器。以下配置已随规范一并生成，只需装依赖即可生效。

## 1. 安装

```bash
npm i -D eslint @eslint/js typescript-eslint eslint-plugin-react-hooks prettier
```

> 若 `typescript-eslint` 与当前 TypeScript 版本（^7）出现兼容告警，可改用 **Biome** 替代 ESLint + Prettier：
> `npm i -D @biomejs/biome && npx biome init`，规则等价项为 `noExplicitAny`、`noNonNullAssertion`、`useConst`。

## 2. 接入脚本

在 `package.json` 的 `scripts` 中追加（**不要替换原有 `lint`**，避免依赖未装时构建中断）：

```json
"lint:es": "eslint .",
"lint:types": "tsc --noEmit",
"format": "prettier --write \"{src,server,docs}/**/*.{ts,tsx,css,md,json}\"",
"format:check": "prettier --check \"{src,server,docs}/**/*.{ts,tsx,css,md,json}\""
```

依赖装好后，再把 `lint` 改为 `npm run lint:types && npm run lint:es`，CI 即自动生效。

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
