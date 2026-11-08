# 窗口与元素截图

窗口截图使用原生 AppKit 选择层。悬停高亮目标窗口，游标仅显示所属应用的真实图标，不显示相机、名称、窗口标题或信息卡片。元素截图使用十字游标，选区旁仅展示 `宽 × 高 px`。鼠标松开或按回车确认；Esc 或右键松开取消。选择层仅排除自身的遮罩窗口，贴图仍可作为截图目标。

元素截图入口位于编辑器截图菜单、应用截图菜单和菜单栏。悬停选择应用公开的辅助功能元素，↑ 选择外层、↓ 返回内层，点击或回车截图。默认不分配全局快捷键，可在设置中绑定。未识别到有效元素时不能确认，不会静默改为截取整个窗口。自绘画布、游戏或未提供辅助功能结构的应用可能只能识别容器，无法保证识别每个视觉元素。

## 权限与实现边界

所有截图仍需屏幕录制权限。仅元素截图额外调用 `AXIsProcessTrustedWithOptions`，首次使用由系统提示辅助功能授权；未授权时保留当前编辑器并给出设置路径。现有屏幕录制拖拽引导不申请辅助功能权限。

选择层通过 `CGWindowListCopyWindowInfo` 识别指针下最上层窗口，用 `NSRunningApplication` 读取应用图标，名称和元素描述仅用于辅助功能标签。元素识别向该应用的 AX 根对象发起命中测试，避免命中自身遮罩；后台单次查询、150ms 单次 IPC 超时与有界父级遍历防止目标应用拖住主线程。同一窗口内重新识别时保留最近有效的高亮，结果就绪后一次性替换，避免每次指针移动都先清空再恢复。仍命中同一最内层元素时保留用户选择的外层层级；切换窗口、窗口边界改变或确认无有效元素时清空旧选择。保留的画面不代表新指针位置已经确认：识别期间不能截图或切换层级，指针或目标窗口不匹配的旧结果会被丢弃。

高亮区域保留 1% 的非零绘制透明度作为鼠标命中面，避免完全透明的像素被 WindowServer 视为可穿透。选择层吞掉按下与拖动，在松开后才关闭并确认截图或取消；持键期间按 Esc 延迟到松开后取消，避免把剩余的松开事件留给下层应用。最终截图发生在选择层移除后，命中面不会写入图片。

每个显示器上的全屏选择窗口及其输入面、遮罩、边框和尺寸标签在整次选择期间保持常驻，不随指针移动重建或整屏重绘。识别到新元素后，仅对遮罩局部开口、边框路径和标签位置做 Core Animation 过渡；路径具有一致的控制点结构。新目标从 presentation layer 的当前画面接续，不回跳到上一动画的起点；重复命中同一元素不重启动画。默认 120ms 和缓动曲线由共享 tokens 提供，方向键切换层级、首次高亮、窗口选择和减少动态效果时即时更新。动画只影响显示，不改变最终截图的准确坐标，也不延迟点击确认。

窗口仍通过系统 `screencapture -l <id> -o` 输出无阴影图片，元素通过 `-R x,y,w,h` 截取屏幕中可见区域。遮罩先关闭，再等合成器更新后截图。窗口在确认时若已关闭或边界变化，要求重新选择。截图与剪贴板、快捷编辑、完整编辑器、取消恢复沿用同一条处理链。

AX 与 CG 坐标均为主显示器左上角起算的全局逻辑点，可为负数；AppKit 绘制使用左下角坐标，需要按主显示器高度转换。元素边界与窗口及当前显示器相交后向外取整，截取范围与快捷编辑定位使用同一个矩形，不把 Retina 图片像素当作屏幕点。元素截图为确认后屏幕上的内容，动态界面可能在识别和截图之间变化。

宽高读数按最终取整后的矩形乘以目标显示器缩放倍率计算，单位为图片像素。例如 Retina 显示器上的 `140 × 80` 屏幕点显示为 `280 × 160 px`。过渡时读数显示已识别目标的最终尺寸，不显示动画中途的虚拟尺寸。

原生遮罩使用 AppKit 系统颜色，窗口游标保留真实应用图标；元素的宽高使用等宽数字与系统实色背景，不展示应用信息。编辑器中的新增入口沿用现有菜单样式及共享 tokens。

## 验证

`CGO_ENABLED=1 go test ./...` 包含 Go 坐标/参数测试和 `testdata/capture-selection.m` 原生夹具。夹具直接编译生产选择层，使用模拟的窗口和 AX 返回值检查窗口身份、元素边界、裁切、层级、无响应目标、取消与回调，并渲染真实 NSView。异步回归通过控制指针与 AX 响应时序，检查微小移动不清空高亮、外层选择保留、连续移动的请求合并、跨窗口过期结果丢弃、空结果清理和识别期间禁止确认。它不申请权限、不截取用户屏幕。

`testdata/capture-pointer-routing.m` 额外验证完整鼠标序列，并短暂显示本地 QA 窗口，用 `NSWindow.windowNumberAtPoint` 检查高亮中心的真实 WindowServer 命中结果。检查范围限定在一个忽略输入的 QA 栈标记之下，先确认遮罩区与底窗的排序已就绪，再检查高亮区域，避免系统屏蔽层或窗口尚未显示的时序造成误判。它不注入输入、不点击下层窗口，也不申请权限；必须在可访问 WindowServer 的 macOS 登录会话中执行。

`testdata/capture-selection-motion.m` 使用合成页面验证真实 presentation layer 的中间帧、动画中断接续、常驻遮罩、空结果、键盘即时响应、减少动态效果和窗口模式。Go 测试将从实际构建的 tokens 读取的时长与曲线传给夹具；可额外输出起点、两个中间帧和终点 PNG，用于原生视觉检查。它不会截取用户桌面。

可另行输出仅含合成内容的原生渲染图：

```sh
mkdir -p build/capture-selection-qa
clang -fblocks internal/app/testdata/capture-selection.m \
  -framework Cocoa -framework ApplicationServices -framework QuartzCore \
  -o build/capture-selection-qa/regression
build/capture-selection-qa/regression build/capture-selection-qa
```

真实应用验收需另行覆盖：授权前后、鼠标首次点击与键盘取消、多个应用的控件层级、不支持 AX 的内容、窗口移动/关闭、Retina 与负坐标副屏、显示器变更、最终图片不包含遮罩，以及取消后原文档与窗口可见性的恢复。夹具不替代这些跨进程与系统权限验证。

API 依据：[AX 命中测试](https://developer.apple.com/documentation/applicationservices/1462077-axuielementcopyelementatposition)、[辅助功能授权检查](https://developer.apple.com/documentation/applicationservices/1459186-axisprocesstrustedwithoptions)、[WindowServer 鼠标命中与透明区域](https://developer.apple.com/documentation/appkit/nswindow/windownumber%28at%3Abelowwindowwithwindownumber%3A%29)、[CAShapeLayer 路径动画](https://developer.apple.com/documentation/quartzcore/cashapelayer/path)、[presentation layer](https://developer.apple.com/documentation/quartzcore/calayer/presentation%28%29)、[减少动态效果](https://developer.apple.com/documentation/appkit/nsworkspace/accessibilitydisplayshouldreducemotion)。`screencapture` 参数以本机系统工具的 usage 为依据。
