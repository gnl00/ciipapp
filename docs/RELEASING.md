# macOS 版本发布

源码仓库：[gnl00/ciipapp](https://github.com/gnl00/ciipapp)。下载入口：[GitHub Releases](https://github.com/gnl00/ciipapp/releases)。官网使用 Releases 列表，后续发布无需再次部署官网来更新下载地址。

## 准备版本

每次发布先在同一个提交中更新以下版本，保持完全一致：

- `mygo.json` 的 `version`：MyGo 用它生成 bundle 元数据和打包时的链接版本。
- 根 `package.json` 的 `version`，以及 `package-lock.json` 的根版本和 `packages[""].version`。
- `internal/app/version.go` 的 `Version`：应用的 `SetVersion(Version)` 和设置页使用此值。

标签必须是带 `v` 前缀的完整 SemVer，如 `v0.10.1` 或 `v0.11.0-beta.1`。不能只打新标签而不更新源码版本。执行 `node scripts/release.mjs validate v0.10.1` 可以在本地检查版本。工作流也会在构建之前拒绝不一致版本。

项目提交到 GitHub 后，在准备发布的提交上打标签并推送标签：

```sh
git tag -a v0.10.1 -m "ciip v0.10.1"
git push origin v0.10.1
```

GitHub 仓库需要启用 Actions，并允许发布 job 的 `GITHUB_TOKEN` 拥有 `contents: write`。构建 job 只具有读取权限，不需要个人访问令牌。

## 双架构构建与产物

`.github/workflows/release.yml` 由 `v*` 标签 push 触发：

| 平台 | 原生 runner | Go 架构 | 下载文件后缀 |
| --- | --- | --- | --- |
| Apple Silicon | `macos-15` | `arm64` | `macos-arm64` |
| Intel | `macos-15-intel` | `amd64` | `macos-x86_64` |

这里固定两个 runner，避免 `macos-latest` 的架构变化。AppKit/CGO 在各自原生机器编译；脚本会检查 `uname`、Go host/target 和最终 Mach-O 的 `lipo -archs`，拒绝把交叉编译结果当作已验证的 Intel 构建。Node 24 和 `go.mod` 指定的 Go 版本由官方 setup actions 安装。

两个 job 分别执行 npm 安装、TypeScript/前端测试、前端构建、Go 测试和 vet、MyGo 应用构建以及 bundle 资源检查。打包前验证两个 plist 版本和 `codesign --verify --deep --strict`。ZIP 使用 `ditto` 保存应用 bundle，DMG 使用 `hdiutil` 创建并验证；不依赖 Finder 或弹窗自动化。

例如 `v0.10.1` 会发布：

```text
ciip-v0.10.1-macos-arm64.dmg
ciip-v0.10.1-macos-arm64.zip
ciip-v0.10.1-macos-x86_64.dmg
ciip-v0.10.1-macos-x86_64.zip
SHA256SUMS
```

DMG 内有 `ciip.app` 和指向 Applications 的快捷方式；ZIP 是同一应用的另一种分发格式。在下载目录执行 `shasum -a 256 -c SHA256SUMS` 可以验证四个下载文件；需要先下载四个文件，或只检查对应的清单行。

## 签名与首次打开

当前工作流使用 MyGo 默认的 **ad hoc 签名**，没有 Developer ID 签名或 Apple 公证，也没有必填签名 secrets。`codesign` 验证通过表示 bundle 签名完整，不表示已经公证。macOS Gatekeeper 可能阻止首次打开；确认下载来源后可参考 [Apple 的打开未识别开发者应用说明](https://support.apple.com/guide/mac-help/mh40616/mac)。这些状态也会写入 Release 描述。后续引入 Developer ID 和公证时，需要相应调整构建、签名验证与发布文案。

## 失败与重跑

只有两种架构全部成功，`publish` job 才会运行。它先检查四个非空下载文件，生成 SHA256SUMS，然后通过 runner 自带的 GitHub CLI 创建草稿、上传完整文件，并将 GitHub 返回的 SHA-256 digest 与本地逐项比较。所有文件通过后才公开 Release；任一步失败都不公开半套下载。

可从 Actions 的失败运行选择 **Re-run failed jobs**，或重跑所有 job。上传阶段失败后会保留草稿，重跑会覆盖草稿资产并继续。脚本通过有权限的分页 Releases 列表查询草稿；按 tag 查询的 REST endpoint 只返回已发布版本，不能用它验证草稿上传。已完整发布的同标签 Release 会保持原样，兼容不可变 Release；不会用重跑的构建替换已公开二进制。如果同标签已经手动公开了不完整的 Release，脚本会拒绝继续，需要先在 GitHub 检查并处理该 Release，或修复后发新版本。

带 prerelease 部分的标签自动标记为预发布，绝不设为 Latest。正常版本只在不低于现有标准 SemVer Latest 时设为 Latest，避免重跑旧版本覆盖新版本入口。草稿不会被设为 Latest。

## 维护依据与本地验证范围

Runner 名称以 [GitHub hosted runners 文档](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)及 [runner images 清单](https://github.com/actions/runner-images/blob/main/README.md)为依据。固定的官方 action 提交取自各仓库发行标签；发布使用 [`gh release create`](https://cli.github.com/manual/gh_release_create)、[`upload`](https://cli.github.com/manual/gh_release_upload) 和 [`edit`](https://cli.github.com/manual/gh_release_edit)。更换 runner 或 actions 时应重新验证工具链与架构。

`node --test scripts/release.test.mjs` 使用临时文件和模拟 GitHub CLI，验证版本不匹配、缺失架构、校验和、上传中断、草稿重试、已发布幂等及 Latest 策略；不会创建远程 Release。工作流需要在真实标签 push 后才能证明 GitHub 原生 Intel/ARM runner 和线上上传通过。首次公开发布前建议分别在两种 Mac 上安装并做截图、贴图、权限引导验收。

## v0.10.1 首发验证

2026-11-08，`v0.10.1` 指向 `b855809626fd68893184ab80fcdb0d7506135525`；[发布运行](https://github.com/gnl00/ciipapp/actions/runs/42456865442)的版本预检、Intel、ARM 和发布 job 全部成功。[正式 Release](https://github.com/gnl00/ciipapp/releases/tag/v0.10.1)已公开，包含上述四个安装包及 SHA256SUMS。

两个 runner 分别报告 `go1.27.3 darwin/amd64` 和 `go1.27.3 darwin/arm64`，原生架构检查、npm/Go 测试、vet、应用构建和打包均通过。发布后重新下载全部文件：SHA256SUMS 与 GitHub asset digest 均匹配；两份 ZIP 解包后的版本均为 0.10.1，Mach-O 分别为 x86_64 与 arm64，strict codesign 通过；两份 DMG 完整性验证通过。

这次验证覆盖源码到公开下载的发布链路，没有执行安装包或更改系统权限；两种芯片的实际下载安装、截图及贴图操作仍需实机验收。签名仍为 ad hoc，未做 Apple 公证。
