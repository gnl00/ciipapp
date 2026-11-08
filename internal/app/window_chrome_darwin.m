//go:build darwin && cgo

#import <Cocoa/Cocoa.h>
#import <QuartzCore/QuartzCore.h>
#import <objc/runtime.h>
#import <dispatch/dispatch.h>
#include <stdint.h>

double ciip_double_click_interval(void) { return [NSEvent doubleClickInterval]; }

void ciip_refresh_pin_shadow(uintptr_t handle) {
    NSWindow *window = (NSWindow *)handle;
    if (!window) return;
    [window setHasShadow:YES];
    [window displayIfNeeded];
    [window invalidateShadow];
}

@interface CIIPWindowChrome : NSObject {
    NSWindow *_window;
    CGFloat _x, _y, _gap;
    BOOL _pending, _applying, _closed;
}
- (instancetype)initWithWindow:(NSWindow *)window x:(CGFloat)x y:(CGFloat)y;
- (void)changed:(NSNotification *)notification;
- (void)reconcile;
@end

@implementation CIIPWindowChrome
- (instancetype)initWithWindow:(NSWindow *)window x:(CGFloat)x y:(CGFloat)y {
    if ((self = [super init])) {
        _window = window; _x = x; _y = y;
        NSButton *close = [window standardWindowButton:NSWindowCloseButton];
        NSButton *mini = [window standardWindowButton:NSWindowMiniaturizeButton];
        _gap = mini.frame.origin.x-close.frame.origin.x;
        if (_gap <= 0) _gap = 20;
        NSNotificationCenter *center = [NSNotificationCenter defaultCenter];
        for (NSNotificationName name in @[NSWindowDidUpdateNotification, NSWindowDidResizeNotification, NSWindowDidBecomeKeyNotification, NSWindowDidExitFullScreenNotification, NSWindowWillCloseNotification]) {
            [center addObserver:self selector:@selector(changed:) name:name object:window];
        }
        [center addObserver:self selector:@selector(changed:) name:NSViewFrameDidChangeNotification object:nil];
        [self changed:nil];
    }
    return self;
}
- (void)changed:(NSNotification *)notification {
    if ([notification.name isEqualToString:NSWindowWillCloseNotification]) {
        _closed = YES;
        [[NSNotificationCenter defaultCenter] removeObserver:self];
        return;
    }
    if (_closed || _applying) return;
    NSButton *button = [_window standardWindowButton:NSWindowCloseButton];
    NSView *parent = button.superview, *container = parent.superview;
    if ([notification.name isEqualToString:NSViewFrameDidChangeNotification] && notification.object != button && notification.object != parent && notification.object != container) return;
    button.postsFrameChangedNotifications = YES;
    parent.postsFrameChangedNotifications = YES;
    container.postsFrameChangedNotifications = YES;
    if (_pending || (_window.styleMask & NSWindowStyleMaskFullScreen)) return;
    _pending = YES;
    // AppKit can reset the titlebar after windowDidResize, including when its sharing control changes.
    dispatch_async(dispatch_get_main_queue(), ^{ [self reconcile]; });
}
- (void)reconcile {
    _pending = NO;
    if (_closed || _applying || (_window.styleMask & NSWindowStyleMaskFullScreen)) return;
    NSButton *button = [_window standardWindowButton:NSWindowCloseButton];
    NSView *container = button.superview.superview;
    if (!button || !container) return;
    NSRect target = container.frame;
    target.size.height = button.frame.size.height+2*_y;
    target.origin.y = _window.frame.size.height-target.size.height;
    BOOL correct = NSEqualRects(container.frame, target);
    for (NSUInteger i=0;i<3;i++) {
        NSButton *control = [_window standardWindowButton:i];
        correct = correct && NSEqualPoints(control.frame.origin, NSMakePoint(_x+i*_gap,_y));
    }
    if (correct) return;
    _applying = YES;
    if (!NSEqualRects(container.frame,target)) container.frame = target;
    for (NSUInteger i=0;i<3;i++) {
        NSButton *control = [_window standardWindowButton:i];
        NSPoint point = NSMakePoint(_x+i*_gap,_y);
        if (!NSEqualPoints(control.frame.origin,point)) [control setFrameOrigin:point];
    }
    _applying = NO;
}
- (void)dealloc {
    [[NSNotificationCenter defaultCenter] removeObserver:self];
    [super dealloc];
}
@end

void ciip_maintain_editor_chrome(uintptr_t handle, double x, double y) {
    NSWindow *window = (NSWindow *)handle;
    static char key;
    CIIPWindowChrome *chrome = [[CIIPWindowChrome alloc] initWithWindow:window x:x y:y];
    objc_setAssociatedObject(window, &key, chrome, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    [chrome release];
}

void ciip_maintain_quick_material(uintptr_t handle) {
    NSWindow *window = (NSWindow *)handle;
    NSView *root = window.contentView;
    static char key;
    if (!root || objc_getAssociatedObject(window, &key)) return;
    // MyGo hosts WebKit in an unflipped NSView. Match the dock's CSS bottom 20px.
    NSVisualEffectView *material = [[NSVisualEffectView alloc] initWithFrame:
        NSMakeRect(12, 20, MAX(0, root.bounds.size.width-24), 84)];
    material.material = NSVisualEffectMaterialPopover;
    material.blendingMode = NSVisualEffectBlendingModeBehindWindow;
    material.state = NSVisualEffectStateActive;
    material.autoresizingMask = NSViewWidthSizable | NSViewMaxYMargin;
    material.wantsLayer = YES;
    material.layer.cornerRadius = 13;
    material.layer.cornerCurve = kCACornerCurveContinuous;
    material.layer.masksToBounds = YES;
    [root addSubview:material positioned:NSWindowBelow relativeTo:nil];
    objc_setAssociatedObject(window, &key, material, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    [material release];
}
