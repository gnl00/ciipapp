# AGENTS.md

本文件适用于整个仓库。README 面向使用者与初次开发者；代理工作约定放在这里，架构、设计及发布细节保留在对应的 `docs/` 文档中。

## 项目与代码边界

- ciip 是 macOS 截图与贴图应用，使用 Go、MyGo、AppKit/Objective-C 和 TypeScript。工具链版本以 `go.mod`、`package.json` 与锁文件为准；使用根目录的 `npm ci` 安装 npm workspaces 依赖。
- `main.go` 保持薄入口；原生实现位于 `internal/app/`，Go 与 Objective-C 在同包编译。
- `frontend/` 是应用编辑器，`website/` 是独立官网，`prototype/` 使用模拟原生接口。保持三个入口的资源和运行状态边界，不为套目录模板迁移前端到 `internal/`。
- Go 仅嵌入 `frontend/dist`；Pages 仅发布 `website/dist`。修改源码和构建脚本，不手工修改生成的 dist 文件。详见 [项目架构](docs/ARCHITECTURE.md)。

## 修改约定

- 先检查工作区与相关调用方，保留用户已有的修改；提交只包含当前任务的文件。
- 沿用邻近代码的组织与格式，优先复用已有实现，不为局部需求引入新依赖或通用抽象。
- 修改原生桥接时同步检查 `frontend/src/native.ts`、Go 的 `CaptureService`、事件载荷与 `prototype/mock.js`，保持真实应用和原型的接口一致。
- 保持文档 JSON、截图坐标与图片像素的语义；更改跨窗口编辑或贴图流程时，检查文档转移、取消、恢复和关闭路径。不要无意改变 bundle identifier 或偏好存储位置。
- 普通关闭编辑器会收起窗口并保留文档；退出应用会丢失内存中的可编辑截图和贴图。修改生命周期时保留这一区别，不把关闭窗口当作退出应用。
- 业务 TypeScript 放在 `frontend/src/`，`public/` 仅放静态资源；不要维护另一套 JS 业务源码供测试或原型使用。
- 应用样式复用 `frontend/src/styles/tokens.css`，不要复制变量值建立第二套主题。UI 修改先读 [设计变量](docs/DESIGN-TOKENS.md)与[组件基线](docs/design-system.html)；官网修改先读 [官网设计](website/DESIGN.md)。保留键盘焦点及减少动态效果、减少透明度等系统偏好支持。
- 修改权限引导时先读 [权限引导](docs/permission-guide.md)；修改菜单栏连字图标时先读 [菜单栏连字图标](docs/menubar-ligature.md)。
- 构建缓存、安装包、第三方参考安装器和本机 QA 材料按 `.gitignore` 保留在本地，不随源码提交。

## 开发与验证

从根目录运行命令，按改动范围选择检查；纯文档修改检查内容与链接即可。

| 改动范围 | 检查命令 |
| --- | --- |
| 应用前端与原型 | `npm run typecheck -w @ciip/frontend`、`npm run test:app` |
| 应用资源与贴图模板 | `npm run build:app` 后运行 `npm run test:bundle` |
| Go、原生桥接与嵌入资源 | 先 `npm run build:app`，再 `CGO_ENABLED=1 go test ./...` 与 `CGO_ENABLED=1 go vet ./...` |
| 官网 | `npm run typecheck -w @ciip/website`、`npm run test:website`、`npm run build:website` |
| 构建、Pages 与发布脚本 | `npm run test:build`，并执行受影响的构建 |
| 完整检查 | `npm test`、`npm run build:app`、`npm run test:bundle`、上述 Go test 与 vet |

- 应用前端开发用 `npm run dev:app`，可操作模拟演示用 `npm run dev:prototype`；浏览器中的原型不能证明系统截图、权限、剪贴板或窗口行为正常。
- 官网开发用 `npm run dev:website`。开发服务器和生产构建均通过 GitHub CLI（`gh`）解析最新正式 Release 的两个架构 DMG 地址；本机需要可用的 gh 登录，Actions 使用工作流令牌。查询失败应修复原因，不能用虚构下载地址掩盖失败。详见 [官网与 Pages](docs/WEBSITE.md)。
- Go embed 依赖已生成的 `frontend/dist`。原生测试需要正常的 macOS 登录会话；完整应用用 `./build.sh` 构建，默认本机架构，可通过 `CIIP_ARCH=arm64|amd64` 指定目标。
- 贴图入口编译为 IIFE，模板与 CSS 内联；修改构建链时保留 `CiipPin.startPin(initial)` 入口及 `PinHTML` 参数顺序（tokens、脚本、初始 JSON），避免对脚本和 JSON 中的百分号二次格式化。
- 为行为改动补充相应回归验证。Node 测试不能替代原生 WebView 的材质、窗口交互或实机权限验收；完成说明中明确已运行的检查与未验证的原生路径。

## 发布约定

- 发布前阅读 [版本发布流程](docs/RELEASING.md)，不要从历史版本示例推断本次版本号。
- 标签使用 `vX.Y.Z`（支持 SemVer 预发布后缀）；`mygo.json`、根 `package.json`、`package-lock.json` 的根版本及 `packages[""].version`、`internal/app/version.go` 必须与标签一致。运行 `node scripts/release.mjs validate <tag>` 检查。
- `v*` 标签推送触发双架构原生 runner 构建。ARM 与 Intel 的 DMG、ZIP 共四个文件完整且校验通过后，才公开 Release 与 `SHA256SUMS`；交叉编译不能代替对应架构的原生验证。
- 当前构建使用 ad hoc 签名，未做 Apple 公证。签名验证、构建成功、发布成功、实际安装与系统功能验收是不同状态，报告时分别说明。
- Release 成功后工作流显式触发 Pages 刷新下载链接；dispatch 成功仅表示已提交构建，官网部署结果仍需单独检查。
