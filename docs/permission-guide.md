# macOS 截图权限引导

## 问题与原因

点击“打开系统设置”后，Settings 成为活跃应用是正常行为。原引导使用普通 `NSPanel`，没有覆盖 `hidesOnDeactivate`；AppKit 对面板的默认值是 `YES`。图标继承 `NSImageView`，也没有接受 inactive 窗口的 first mouse。两者组合使引导在失活时不可用，或第一次按下只激活来源窗口，拖动需要再次操作。

现在引导使用 nonactivating 浮动面板，设置 `hidesOnDeactivate = NO` 和 `becomesKeyOnlyIfNeeded = YES`。图标接受 first mouse、不要求键盘焦点、不拖动窗口，并延迟窗口排序；开始应用图标拖拽时调用 `preventWindowOrdering`。打开 Settings 后不会再激活 ciip，也不会把来源窗口重新排到目标之上。

打开设置前，360 × 430 的内容面板会移到当前屏幕可用区域的左侧，留出 16pt 边距；只依据自身屏幕几何布局，不读取 Settings 的窗口或用户屏幕。小屏幕及用户手动放置 Settings 时仍可能重叠，可以拖动引导标题栏重新安排。不会申请辅助功能、输入监控等额外权限来定位目标列表。

拖拽数据仍只有当前 `.app` 的 file URL。若目标系统版本的屏幕录制列表不接受拖入，保留系统列表“＋”选取应用和“在 Finder 中显示”的后备操作。来源窗口可拖动，与目标列表是否接收，是两个独立的验收项。

## 自动回归验证

`internal/app/testdata/permission-guide.m` 直接包含实际的生产 Objective-C 实现，创建自己的 AppKit 面板及目标窗口。它不打开 Settings、不调用授权请求、不注入全局输入。用替身 dragging session 捕获生产 `mouseDown:` 创建的 payload，避免对真实用户应用执行拖拽。

修复前同一夹具有 6 个失败项：面板失活隐藏、缺少 nonactivating 样式、未限制 key 获取、图标不接受 first mouse、不延迟来源窗口排序、没有靠边布局方法。修复后通过以下检查：

- 面板不会失活隐藏，采用 nonactivating / key-only-if-needed 配置。
- 图标允许 first mouse，且不要求面板成为 key、不触发窗口移动。
- 打开设置前的靠边位置处于屏幕可用范围内。
- 来源非 key 时，调用生产图标处理逻辑创建一个 `.app` file URL；保留拖拽取消回弹，不主动夺取 key。

这些检查验证 AppKit 配置和来源逻辑，不等价于跨应用真实鼠标事件分发或 Settings 列表接收验证。

在 ciip 主目录中可运行：

```sh
permission_test_app=build/permission-guide-regression/ciip-permission-test.app
mkdir -p "$permission_test_app/Contents/MacOS"
cat > "$permission_test_app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>ciip-permission-test</string>
<key>CFBundleIdentifier</key><string>dev.ciip.permission-regression</string>
<key>CFBundleName</key><string>ciip Permission Regression</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
PLIST
clang -fblocks internal/app/testdata/permission-guide.m \
  -framework Cocoa -framework CoreGraphics \
  -o "$permission_test_app/Contents/MacOS/ciip-permission-test"
"$permission_test_app/Contents/MacOS/ciip-permission-test"
```

需要处于可访问 WindowServer 的 macOS 登录会话；受限沙盒中可能无法创建 AppKit 窗口。

## 原生交互验收

1. 使用独立的 QA bundle 打开引导，让无权限要求的外部测试目标处于活跃状态。
2. 确认引导仍显示，首次按下图标即可开始拖动，不先点击唤醒来源窗口；来源窗口不抢走目标的活跃状态或遮住目标区域。
3. 验证目标接收且只得到 QA `.app` 的 file URL，并验证取消回弹和手动移动引导。
4. 另行验证真实 Settings 链接、各 macOS 版本的目标列表接收和授权后的刷新。授权需要用户本人操作；自动夹具未执行这些操作。

`internal/app/testdata/permission-guide-interactive.m` 是独立交互 QA 入口，直接包含生产面板，仅用 category/swizzle 在方法边界记录首次鼠标按下与原生 dragging session。它拦截“请求授权”，不调用真正的授权请求；日志写入 `/private/tmp/ciip-permission-interactive-qa.log`。按上述 bundle 方式编译此文件即可运行，拖到不接收文件的空白处可以验证取消回弹，无需改动系统权限。不得把 QA 入口编入正式应用。

0.10.1 本轮已观察到原生面板和新布局的可访问性内容；电脑操作工具随后误报测试应用已变更，点击被拦截，因此尚未取得真实 Settings 激活后的首次拖动证据。自动配置与 payload 检查通过不替代这项交互验收。

## AppKit 依据

- [NSWindow.hidesOnDeactivate](https://developer.apple.com/documentation/appkit/nswindow/hidesondeactivate)：NSPanel 的默认值与普通窗口不同。
- [NSPanel.becomesKeyOnlyIfNeeded](https://developer.apple.com/documentation/appkit/nspanel/becomeskeyonlyifneeded)：nonactivating panel 根据点击视图的 needsPanelToBecomeKey 决定是否取得 key。
- [View Programming Guide：acceptsFirstMouse](https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/CocoaViewsGuide/SubclassingNSView/SubclassingNSView.html)：允许 inactive 视图接收首次鼠标事件。
- [AppKit Event Handling](https://developer.apple.com/documentation/appkit/event-handling)：延迟窗口排序使拖拽不必激活来源应用或将其排到目标之上。
- [NSApplication.preventWindowOrdering](https://developer.apple.com/documentation/appkit/nsapplication/preventwindowordering())：在鼠标按下事件处理中阻止来源窗口排序。
