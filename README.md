<div align="center">
  <img src="resources/icon.png" width="112" height="112" alt="ciip 图标">
  <h1>ciip</h1>
  <p>macOS 截图与贴图工具。截下来，贴在手边。</p>
  <p>
    <a href="https://github.com/gnl00/ciipapp/releases/latest"><img src="https://img.shields.io/github/v/release/gnl00/ciipapp?color=cc582e" alt="GitHub 最新正式 Release 版本"></a>
  </p>
  <p>macOS · Apple Silicon (ARM64) · Intel (x86_64)</p>
  <p>
    <a href="https://gnl00.github.io/ciipapp/">官网</a> ·
    <a href="https://github.com/gnl00/ciipapp/releases/latest">最新版本</a> ·
    <a href="https://github.com/gnl00/ciipapp">源码</a>
  </p>
</div>

## 功能

- 区域、窗口和全屏截图，完成后自动复制到剪贴板。
- 截图原地快捷编辑，可切换到完整编辑器。
- 置顶贴图、拖动和缩放、再次编辑；双击贴图关闭。
- 直线、弯曲与渐粗箭头，数字编号、文字、手写、高亮、模糊和实色遮盖。
- 多种静态背景、随机配色、截图圆角与留白。
- Apple Vision 和本机 Tesseract 离线文字识别、划选文字复制。
- 菜单栏、全局快捷键及启动偏好设置。

## 安装

在 [最新版本](https://github.com/gnl00/ciipapp/releases/latest) 选择对应芯片的 DMG 或 ZIP：Apple Silicon 使用 `arm64`，Intel Mac 使用 `x86_64`。打开 DMG 后将 ciip.app 拖到 Applications，或解压 ZIP。

当前构建使用 ad hoc 签名，尚未进行 Apple 公证。首次打开如被 macOS 阻止，请确认下载来源并参考 [Apple 的说明](https://support.apple.com/guide/mac-help/mh40616/mac)。截图需要屏幕录制权限；应用中的权限引导可打开对应系统设置。

Apple Vision 使用系统内置引擎；选择 Tesseract 时需在本机安装 Tesseract 及所需语言数据。安装包不附带 Tesseract。

## 开发

需要 macOS 原生构建环境、Node.js 24 与 Go 1.27.3。MyGo 版本由 `go.mod` 固定。

```sh
npm ci
npm run dev:app       # 应用前端，原生功能需桌面进程提供
npm run dev:prototype # 可操作演示，使用模拟接口
npm run dev:website   # 独立官网
```

按需选择开发入口。完整检查及应用构建：

```sh
npm test
npm run build:app
npm run test:bundle
CGO_ENABLED=1 go test ./...
CGO_ENABLED=1 go vet ./...
./build.sh
```

`build.sh` 默认使用本机架构，生成 `build/darwin-arm64/ciip.app` 或 `build/darwin-amd64/ciip.app`；`CIIP_ARCH` 可指定目标。Go embed 需要先生成 `frontend/dist`。原生测试须在正常 macOS 登录会话中运行。

## 项目结构

- `internal/app/`：Go、AppKit、截图、贴图、OCR 与系统集成。
- `frontend/`：TypeScript 编辑器，包含 `public/`、`src/`、`src/styles/` 与测试。
- `website/`：独立 HTML、TypeScript、CSS 官网。
- `prototype/`：使用模拟原生接口的编辑器预览。
- `scripts/`：构建、图标、Pages 与 Release 脚本。
- `docs/`：架构、设计基线和发布文档。

前端与官网按独立构建边界放在根目录，Go 应用只嵌入前端生产资源。构建缓存、安装包和本机 QA 材料不随源码提交。

## 文档与发布

- [项目架构](docs/ARCHITECTURE.md)
- [设计变量](docs/DESIGN-TOKENS.md)与[组件设计基线](docs/design-system.html)
- [官网设计](website/DESIGN.md)与[GitHub Pages 部署](docs/WEBSITE.md)
- [权限引导](docs/permission-guide.md)
- [菜单栏连字图标](docs/menubar-ligature.md)
- [版本发布流程](docs/RELEASING.md)

推送 `vX.Y.Z` 标签触发 GitHub Actions，分别在原生 ARM 和 Intel runner 构建 DMG、ZIP；四个文件完整且校验通过后发布 Release 和 SHA256SUMS。标签、应用元数据、npm 及运行时版本必须一致。

普通关闭窗口会收起编辑器；退出应用会清除内存中的可编辑截图与贴图，退出前请保存需要保留的图片。
