# CELANO PPT

项目的正式版本包含首页、文生图页面、PPT 生成、智能画布、模版库、技术支持、个人中心和管理后台。PPT 使用服务端任务生成，固定 6 路并发，输出原生 16:9 图片页面。

## 运行与构建

要求 Node.js 22.12 或更新版本。此包包含纯净源码，首次运行先安装依赖：

```bash
npm ci
npm run dev
```

地址为 `http://127.0.0.1:3000`，端口可通过 `PORT` 设置。安装与首次启动会构建智能画布，请等待完成。

> **平台适配**：两份 `package-lock.json` 已包含 Windows / Linux / macOS 的原生二进制条目，`npm ci` 在三者上均可一次成功；首次启动会自动补齐对应平台的 TypeScript、Tailwind Oxide、Rolldown 等原生依赖。Windows 上请使用 Git Bash 或 PowerShell 执行上述命令，`scripts/ensure-canvas.mjs` 与 `npm run clean` 均已做跨平台处理。

## 纯净版初始状态

- 仅保留一个后台超级管理员：账号 `admin`，初始密码 `admin123`，登录地址 `http://127.0.0.1:3000/admin`。
- **安全提示**：该初始口令随源码公开，等同于公开凭据。本地开发可直接登录；**生产部署必须先设置环境变量 `ADMIN_INITIAL_PASSWORD`（≥8 位）再初始化数据，或登录后立即在后台修改**。生产模式下若仍使用初始口令，服务端会在启动日志中输出安全告警。
- 不包含普通用户、用户作品、生成任务、积分流水、充值码、历史邀请码、接口密钥或登录会话。
- `data/` 为运行时数据目录，**不随仓库分发**（见 `.gitignore`）。首次启动时服务端会自动创建该目录并生成唯一的超级管理员凭据；删除数据目录重新初始化时，也不会创建演示用户或演示作品。
- 保留正式模版库素材、13 张技术支持教程图片、全部功能源码与画布许可证。
- 先在后台「AI 接口配置」分别配置 2K、4K 生图接口及内容规划模型，再创建邀请码供用户注册。接口未配置前无法调用 AI 生成。
- 生产部署后请修改管理员初始密码。新部署会自动生成独立的会话签名密钥。

检查代码与构建正式产物：

```bash
npm run lint
npm run build
NODE_ENV=production npm start
```

生产运行仍需要服务端及其依赖，不能仅部署 `dist` 静态文件。模型接口在管理后台配置，环境变量说明见 `.env.example`。

## 项目目录

- `src/`：正式前端代码、所有页面和样式。
- `server.ts`、`server/`：服务入口、账号认证、计费、任务、模型调用和后台接口。
- `public/templates/`：已导入的整套 PPT 模版图片，不依赖桌面上的原始文件夹。
- `data/store.json`：账号、接口配置、积分流水、作品和任务状态。
- `data/images/`：生成作品和任务参考图。
- `data/legacy-uploads/`：正在使用的参考文件及 Logo 上传目录；名称包含 legacy，但仍属于现行功能，不能删除。
- `data/user-session.key`：用户会话密钥，首次启动自动创建，迁移实际运行环境时保留。
- `dist/`：正式构建产物，此包不包含，通过 `npm run build` 创建。
- `node_modules/`：运行依赖；此包不包含，安装时通过 `npm ci` 创建。
- `package.json`、`package-lock.json`：主站依赖定义与 npm 锁定文件；画布子项目使用自身的 `package-lock.json`。
- `public/tutorials/`：技术支持的流程概览与详细操作图。
- `docs/`：教程图片提示词和代码维护规范；`docs/deploy.md` 为腾讯云服务器部署与更新指南。
- `design/celano-ui-spec.html`：现行设计规范，代码维护规范仍会引用它。
- `LICENSE`：主项目许可证（MIT）；智能画布的 MIT 许可证见 `integrations/infinite-canvas/LICENSE`。
- `deploy/`：生产部署资产（systemd 服务单元、Nginx 反向代理配置）；引导脚本见 `scripts/server-bootstrap.sh`。
- `.github/`：CI 工作流、PR 模板与 CODEOWNERS；`.gitattributes` 统一跨平台的 LF 行尾。
- `index.html`、`tsconfig.json`、`vite.config.ts`：页面入口和编译配置。

`data/` 是运行时数据目录。此源码包只提供初始管理员数据；后续生成的作品、账号、接口设置与会话密钥均在新环境独立创建。请勿用此初始文件覆盖已有生产数据。

### 保持目录纯净

源码包不附带依赖目录、构建产物、检查截图、日志、缓存或旧版本。主站与画布统一使用 npm 锁定文件；`npm ci` 安装依赖，`npm run build` 生成正式产物。模版及教程图片属于功能素材，已随源码保留。

## 正式页面

- `/#/`：首页。
- `/#/ppt`：PPT 生成、参考资料、Logo 和风格参考。
- `/#/workspace`：PPT 预览、画板修改、演示和导出。
- `/#/templates`：按文件夹系列展示的模版库。
- `/#/account`：个人中心、作品及使用记录。
- `/#/image`、`/#/canvas`、`/#/support`：文生图、智能画布和技术支持页面。
- `/admin`：用户、积分流水、邀请码、充值码和模型接口管理。
- `/#/membership`：会员及充值展示页；真实支付通道尚未接入。

点数规则：生图与画布生成按画质计费，2K 每张 5 点、4K 每张 10 点；图片局部修改与所选画质同价（2K 5 点、4K 10 点）。PPT 逐页生成按页数乘以画质单价计费；提示词优化每次 1 点。会员按套餐享受更低的实扣点数，免费用户每天有 3 张 2K 文生图免费额度。所有单价统一来自 `src/shared/imageSpecs.ts` 的 `IMAGE_COST`，不在路由中写魔法数字。

## 智能画布

采用 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas) 的 MIT 源码，固定版本 `dab19adc0847e32e39b7fc8ff90cb392561fb826`。许可证位于 `integrations/infinite-canvas/LICENSE`，源码与许可证保留作者信息。原简化画布已移除。

- 源码位于 `integrations/infinite-canvas/web/`；独立产物位于 `public/infinite-canvas/`。
- `npm install` 同时安装画布依赖；`npm run build` 构建画布和主站。修改画布源码后运行 `npm run build:canvas` 更新开发页面。
- `/#/canvas` 保留统一导航，同源子页面隔离原项目样式与依赖，不依赖外部网站运行。
- 默认图片、文本通道使用管理后台配置，系统密钥只在服务端使用。生图使用现有六路并发限制，2K 每张 5 点、4K 每张 10 点；局部修改与所选画质同价，失败退回。画布支持原始比例，不套用 PPT 的 16:9 限制。
- 画布项目按账号保存在浏览器 IndexedDB，可通过导出、导入迁移。文本与图片资产保存到账号的服务端素材库，与个人中心“画布素材”双向互通；未登录只可本地编辑，调用模型与云素材需要登录。
- 已移除视频、音频、Agent/Codex 连接、文档、配置及版本更新入口和相应页面/连接代码。保留文本、图片、节点插件、分组与基础画布操作。模型由管理后台统一配置。
- `data/canvas-assets/` 保存账号素材图片，素材索引位于 `data/store.json`。迁移时与原有 `data/` 一并保留。

### 图片尺寸与画质规则

统一规格位于 `src/shared/imageSpecs.ts`，PPT、文生图、画布设置、计费和导出使用同一来源。
PPT 固定原生 16:9：2K 请求规格为 2048×1152（5 点/页），4K 为 3840×2160（10 点/页）。2K 对应上游 medium 档位，保留符合比例与最低像素要求的原生返回尺寸；4K 校验所请求的实际像素。文生图默认方形，画布按用户选择的比例使用对应规格。局部编辑保持原图像素尺寸，遮罩与原图一致，修改单价与所选画质相同。提示词优化统一 1 点/次。系统不会裁剪、拉伸或放大生成结果以通过校验，不符合要求时失败并退回对应预扣点数。

2K 和 4K 分别映射管理后台配置的生图接口，最终能力取决于对应模型和上游服务。`npm run test:image` 可运行统一规格、参数透传及失败退款回归检查。

## 安全与配置约定

开源后以下信息均对所有人可见，配置时请注意：

| 项目 | 说明 |
|---|---|
| 初始管理员口令 `admin123` | 随源码公开；生产必须设置 `ADMIN_INITIAL_PASSWORD` 或登录后立即修改 |
| 画布代理令牌 | 以前写死在代码中，现为进程启动随机生成，可用 `CANVAS_PROXY_TOKEN` 固定（多实例必备） |
| 模型 API Key | 只存在于环境变量、管理后台与未入库的 `data/`，源码与 `.env.example` 均为空 |
| 上游 endpoint | 源码中的默认地址仅供本地演示，生产请用 `PIAO_BASE_URL` / 管理后台覆盖 |

完整环境变量清单见 `.env.example`。

## 依赖安装说明

- 智能画布使用 `@ant-design/pro-components`，其 peer 要求 `antd ^5`，而本项目固定在 `antd ^6`。二者无法同时满足，因此在 `integrations/infinite-canvas/web/.npmrc` 中显式放宽 peer 检查，安装时无需额外传参。
- 不要删除两份 `package-lock.json`：其中的平台原生二进制条目（win32/linux/darwin）由多平台解析生成，是 Windows 与 CI 能够直接使用 `npm ci` 的前提。

## 参与贡献

代码审查标准、PR 模板与 CODEOWNERS 分工见 `docs/code-review/` 与 `.github/`。概要约定：

1. 分支命名：`feat/` `fix/` `chore/` `refactor/` `docs/` + scope，例如 `fix/billing-refund`。
2. 提交前本地通过 `npm run lint`、`npm run test:image`，改动涉及前端构建时补跑 `npm run build`。
3. 合并使用 Squash merge 并删除源分支；任何人不得合并自己的 PR。
4. 涉及资金计费、鉴权会话、服务端入口与设计令牌的改动需 Owner 复核。

## 许可证

主项目源码采用 **MIT** 许可证，详见 [`LICENSE`](./LICENSE)。

智能画布基于 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas) 的 MIT 源码，许可证保留在 [`integrations/infinite-canvas/LICENSE`](./integrations/infinite-canvas/LICENSE)，作者信息未做改动。

`public/templates/` 模版图片与 `public/tutorials/` 教程图片为功能素材，**不包含在 MIT 授权范围内**，不可独立再分发或用于训练集；二次分发前请替换为自有素材。
