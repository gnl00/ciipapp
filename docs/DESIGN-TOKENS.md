# ciip 设计变量

产品和设计基线共同读取 [tokens.css](../frontend/src/styles/tokens.css)。本地打开 [design-system.html](design-system.html) 可查看实际变量值、组件状态与材质对照。不要从此文档复制数值建立第二套主题。

## 色彩与层级

| 变量 | 用途 |
| --- | --- |
| `--accent` | 原有品牌橙，标识圆点和强调。 |
| `--accent-fill` / `--accent-hover` / `--accent-active` | 橙色操作按钮。常规填色略深于品牌色，以便小字号白色文字达到至少 4.5:1 对比度。当前白色对比度 4.74:1；品牌橙为 4.20:1，不能直接替代小字按钮填色。 |
| `--ink` / `--text-secondary` / `--muted` | 正文、次级说明、辅助标签。 |
| `--text-tertiary` | 非关键装饰说明；不承担必须读出的信息。 |
| `--selection` / `--selection-strong` / `--selection-soft` | 灰绿色选框、焦点与柔和选中底色。与橙色主要动作分工。 |
| `--success` / `--warning` / `--danger` | 权限与反馈状态。颜色之外同时提供文字或图标。 |
| `--control-hover` / `--control-active` / `--control-disabled-opacity` | 常规按钮交互状态。不要用整个容器透明度制作常规禁用状态。 |

## 材质

| 变量族 | 消费位置 | 层级 |
| --- | --- | --- |
| `--surface-app` | 完整编辑器 `body` | 稳定的不透明浅灰绿页面采样基底，当前为 `#eef1ed`。快捷编辑与贴图不使用这个底色。 |
| `--material-panel-bg` / `--material-filter` / `--shadow-panel` | 截图菜单、背景与圆角 | 94–97% 密实浅灰绿底色，32px 背景模糊，细亮边线。 |
| `--material-dialog-bg` / `--shadow-dialog` | 设置、替换确认 | 更高密度的浅底，承载长文字。 |
| `--material-toolbar-bg` / `--material-toolbar-filter` / `--shadow-toolbar` | 快捷编辑工具区 | 适度轻薄的工具面，24px 模糊。 |
| `--surface` / `--surface-properties` / `--surface-footer` | 完整编辑器工具栏、属性栏、页脚 | 工作面的层级，不承担覆盖复杂内容的弹窗职责。 |
| `--close-*` | 快捷编辑圆形关闭按钮 | 浅色材质与暖红图标；键盘焦点保留灰绿色。 |
| `--pin-toolbar-*` / `--pin-close-*` | 原生贴图工具栏 | 深灰绿材质和浅色文字。由 Go 嵌入的贴图页通过同一份 CSS 注入消费。 |

轻弹窗由 `.popover` 容器自身负责 `--material-panel-bg` 与 `backdrop-filter`，不再添加 `.popover-material` 子层。背景滤镜处理容器后方的内容，弹窗文字与缩略图保持清晰；不使用整层 `opacity` 长期模拟玻璃。截图菜单和背景弹窗均提升到 `body`，`data-anchor` 与 `data-placement="top"` 决定定位。动画期间容器可改变透明度与 transform，结束后恢复稳定状态。

完整编辑器在 `frontend/src/styles/style.css` 中给 `body` 设置 `background:var(--surface-app)`，当前为浅灰绿实色；`body.quick-mode` 与独立贴图页保留透明。弹窗模糊网页内的内容，跨窗口系统材质仍按原生 NSVisualEffectView 的职责处理。

本次原生对照限定于 macOS 15.7.3、固定 MyGo 0.7.4：临时把同一弹窗底色设为 55% 后，`blur:none` 切换到 `blur(32px)` 能柔化画布色块边界，但工具栏色点仍有硬轮廓；随后保持面板透明度与滤镜不变，仅将 `document.body` 背景设为 `#e4e8e3`，工具栏轮廓即完全模糊、不可辨。这说明该环境下透明页面基底影响了工具栏区域的背景采样，并非滤镜整体不支持。生产采用 `--surface-app` 的稳定基底，保留原定的 94–97% 弹窗材质；不把继续提高 alpha 当作采样修复。此结论不等于定位了 WebKit 内部缺陷，也不泛化到所有系统或 WebKit 版本。

## 几何与文字

间距使用 `--space-1` 至 `--space-8`：紧凑工具间隔、按钮内边距与内容区留白属于不同层级，不把所有空间压缩到同一个值。圆角使用 `--radius-control`、`--radius-selector`、`--radius-panel`、`--radius-toolbar` 与 `--radius-dialog`。圆形关闭按钮和编号圆点使用 `--radius-round`。

`--font-ui` 跟随 macOS 系统字体；`--text-xs`、`--text-sm`、`--text-base` 和 `--text-title` 区分数字说明、辅助文字、正文与设置标题。12px 关闭图标使用 `--icon-sm`；外围 26px 操作区使用 `--control-sm`。百分比和数值启用等宽数字，工具文字禁止选择，OCR 与错误信息保留按需选择能力。

## 动效与系统偏好

`animatePanel()` 实际读取 `--motion-panel-in`、`--motion-panel-out`、`--ease-panel` 与 `--ease-exit`，更改变量会改变产品动效。默认展开 170ms、收起 110ms，可被再次操作打断。键盘操作和后台窗口即时完成，动画时间线挂起时仍有完成期限。

快捷编辑首次显示也读取 `--motion-panel-in` 与 `--ease-panel`：画布完成绘制后，原生窗口从透明渐显，截图位置与窗口边界保持不动。原生显示和 WebView 绘制在同一就绪流程内衔接；重复的就绪通知不重播入场，macOS 的“减少动态效果”即时显示。

`--motion-pin-toolbar` 与 `--ease-pin-toolbar` 控制贴图工具栏的展开/收起，默认 140ms；百分比更新不重启动画。工具栏与圆形关闭按钮切换时，新旧内容交叉淡入、淡出；旧内容只保留不参与点击、键盘或无障碍导航的视觉副本，并在动画完成、鼠标离窗或关闭时清理。快速反向切换保留当前可见帧，减少动态效果时即时切换。时间变量接受 `ms`、`s` 与零值，非法值回退到组件默认时长。

`--motion-feedback` 是操作反馈的时长基准，暂不为频繁动作额外添加动画。拖动画布、滚轮缩放、键盘切工具均以即时响应为准。

`--motion-capture-selection` 控制原生元素选框连续跟随的约 95% 收敛时间，默认 120ms；不增加 AX 识别或确认等待。Go 从嵌入的同一份 CSS 读取该时长，由显示帧回调推进指数平滑；连续换目标从当前显示位置接续，接近目标时贴合停止。该跟随不使用弹层的 `--ease-panel` 曲线。方向键、拖动框选、窗口截图和首次高亮即时更新，macOS 的“减少动态效果”关闭跟随。时长采用 `ms` 字面量，非法值由原生契约测试拒绝；结束、取消或窗口关闭均停止显示时钟。

- `prefers-reduced-transparency`：材质变为实色、滤镜关闭，贴图仍保持深色工具区。
- `prefers-reduced-motion`：弹层时长归零，JS 同时跳过动效。
- `prefers-contrast:more`：强化边线、控制边界与辅助文字。
- `:focus-visible`：保留键盘可见焦点，不能为了消除鼠标首焦环而全局移除 outline。

## 接入与验收

`frontend/index.html` 和 `prototype/preview.html` 首先引入 `tokens.css`，再加载组件样式。生产资源先由 Vite 构建，再由 `frontend/assets.go` 嵌入 dist；`frontend/src/styles/style.css` 拥有完整编辑器页面基底与公共弹窗规则，`frontend/src/styles/quick.css` 覆盖快捷模式的透明页面，独立贴图页保持自身透明规则。目录与依赖详见 [ARCHITECTURE.md](ARCHITECTURE.md)。

贴图页由 `fmt.Sprintf` 生成，不能依赖相对地址读取 CSS。应将 `tokens.css` 作为原始字符串参数与贴图样式一起嵌入 `<style>`；避免把其 `%` 再次当作格式模板解释。贴图消费 `--font-ui`、`--text-sm`、`--pin-toolbar-*`、`--pin-close-*`、`--icon-sm`、`--close-*` 和 `--selection-strong`。原生生命周期与缩放逻辑无需因主题变量改变。

验收至少包含：截图菜单与背景弹窗覆盖彩色工具点/文字的状态，展开结束与收起中断，设置与确认弹窗，普通及最小快捷编辑窗口，减少透明度/动态效果偏好，以及键盘定位、Esc 收起和重开弹窗。以原生 WebView 截图为最终材质证据，Node 行为测试只验证定位和生命周期。
