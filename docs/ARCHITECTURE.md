# ciip 项目结构

## frontend 是否应放进 internal

本项目采用根目录`frontend/`，`website/`并列；Go的应用实现继续位于`internal/app/`。

`internal`是[Go包导入限制](https://go.dev/doc/modules/layout)，不约束TypeScript、HTML或CSS。只承载少量嵌入文件时，内部资源包是一种可行组织方式；不能仅凭“前端不对外提供”就推导整个前端项目必须进internal。现在编辑器具有独立开发服务器、严格类型检查、构建输出与测试，根目录frontend明确这些边界，也与官网website区分。后续不要只为套目录模板来回迁移。

## 当前结构

```text
ciip/
├── main.go                    # 薄Go入口
├── internal/app/              # 截图、窗口、贴图、OCR、设置及平台实现
├── frontend/
│   ├── package.json
│   ├── tsconfig.json          # strict TypeScript检查
│   ├── vite.config.ts
│   ├── index.html             # 完整与快捷编辑器共用入口
│   ├── public/                # 不经源码转换的静态资源
│   ├── src/
│   │   ├── app.ts             # 编辑器交互协调
│   │   ├── editor.ts          # 文档与标注模型、渲染
│   │   ├── effects.ts         # 背景与遮盖
│   │   ├── types.ts           # 文档、几何与绘图类型
│   │   ├── native.ts          # 原生接口与返回值类型
│   │   ├── pin.ts             # 独立贴图入口
│   │   ├── pin.template.html  # Go填充的贴图模板
│   │   ├── quick*.ts          # 快捷窗口交互
│   │   └── styles/            # tokens与组件样式
│   ├── tests/                 # 行为回归及构建契约
│   ├── dist/                  # 生成资源，Git忽略
│   └── assets.go              # 嵌入dist，提供原生FS
├── website/                   # 独立官网，HTML/TypeScript/Vite
│   ├── src/                   # 官网页面与样式
│   ├── public/                # 官网静态图片与图标
│   └── dist/                  # GitHub Pages发布产物
├── prototype/                 # 模拟原生接口的编辑器原型
├── scripts/                   # 构建、图标与Pages辅助脚本
├── docs/                      # 设计基线、架构和验证记录
├── resources/                 # 原生应用图标
├── .github/workflows/          # Pages 官网部署与 tag 双架构 Release
├── package.json               # npm workspaces与统一命令
├── package-lock.json
├── build.sh
└── mygo.json
```

根npm workspace共用TypeScript和Vite开发依赖。编辑器与官网不共享运行状态，不互相嵌入资源；Go应用只使用frontend/dist，Pages只发布website/dist。

## 构建与资源归属

1. `npm ci`恢复锁定的开发依赖。
2. `npm run build:app`先严格检查TypeScript，再由Vite构建编辑器。
3. 贴图入口编为IIFE，以`CiipPin.startPin(initial)`启动；模板和CSS内联，不依赖空白原生页的相对模块URL。
4. Go资源包`ciip/frontend`嵌入编译后的dist。由于Go embed不能引用父目录，薄资源适配文件与dist相邻，不复制资源到internal或使用软链接。
5. `./build.sh`自动执行前端构建，再用固定MyGo0.7.4编译应用。

PinHTML的三个格式参数仍依次是共享tokens、已编译的贴图脚本、初始JSON。构建脚本仅转义模板自身的百分号，不二次解释脚本和JSON参数。构建契约检查原生入口存在，Go检查资源可达性及格式参数。

`frontend/dist`不包含原型、测试、网站、TypeScript源文件或source map。`public`只放真实静态资源，业务代码进入src。设计基线读取`frontend/src/styles`中的同一份CSS变量，不维护另一套色值。

`build.sh`默认使用本机 Go 架构，也可通过 `CIIP_ARCH=arm64|amd64` 指定构建目标。正式发布由两个原生 macOS runner 分别构建，打包脚本校验宿主与 Mach-O 架构；不会把交叉编译当作原生验证。tag、bundle 与运行时版本必须一致，具体步骤见[RELEASING.md](RELEASING.md)。

## 开发与检查

- `npm run dev:app`：应用前端，系统功能需原生ciip提供。
- `npm run dev:prototype`：可操作编辑器原型，截图/复制/贴图使用内存模拟。
- `npm run dev:website`：官网开发。
- `npm run typecheck`、`npm run test:app`、`npm run test:website`：类型与行为检查。
- `npm run build:app && npm run test:bundle`：检查原生贴图构建入口。
- 前端构建后运行`CGO_ENABLED=1 go test ./...`与`go vet ./...`。

Node测试直接执行只含可擦除类型的核心TS；需要VM的UI场景使用Node内置类型擦除，不另存一套JS业务源码。原型由独立Vite入口转换，不能直接让浏览器执行原始TS。官网部署见[WEBSITE.md](WEBSITE.md)。

## 保持的原生边界

`CaptureService.*` IPC名称、文档JSON、截图坐标、图片像素、bundle identifier与偏好位置保持原意。原生Go和Objective-C仍在同包编译。OCR夹具跟随internal/app/testdata，原型与网站不会触发真实系统截图。

完整编辑器普通关闭时隐藏窗口并保留文档；菜单栏可用时切为 accessory 策略，收起 Dock 中的运行图标。重新打开编辑器或打开图片时恢复 regular 策略与原文档；快捷编辑转入完整编辑器被取消时同样回到驻留状态。截图过程的临时隐藏与最小化不改变 Dock 策略，贴图和快捷编辑窗口也不接管它。菜单栏被关闭或创建失败时保留 Dock 入口，用户手动固定的 Dock 快捷方式由系统管理。退出应用仍会丢失内存文档。

工具默认样式保存在偏好目录的 `editor-style.json`，通过 `GetEditorStyle` / `SetEditorStyle` 按修改字段读取和合并，原子落盘；与通用 `preferences.json` 独立，避免旧设置快照覆盖新样式。笔、高亮笔和普通线条分别保留粗细，高亮笔另有独立颜色；共享颜色、箭头/编号样式、编号大小、字号、遮盖样式与强度也会恢复。只在用户明确修改控件时保存，选中、读取或缩放旧标注不会改写默认值。新文档接入时重新读取，快捷编辑销毁或转完整编辑器前等待保存完成；编号计数、背景、裁剪、选中工具仍按原文档规则处理。浏览器独立预览使用本地存储，原型桥接仅模拟内存状态，不触碰原生偏好。

先前参考[mygo-music固定版本](https://github.com/egoist/mygo-music/tree/1af0d8efd77fdf630c27cfc635f12e9cb089ce10)的薄入口和内部应用包；它使用mygo/ui原生绘制，不要求ciip照搬网站或构建结构。旧版本QA/build overlay保留当时路径，不作为现在入口。
