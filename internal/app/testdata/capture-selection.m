// Isolated AppKit/AX regression. Does not request permissions or capture user screen content.
#import <Cocoa/Cocoa.h>
#import <ApplicationServices/ApplicationServices.h>
#include <unistd.h>
#include <assert.h>
#include <stdatomic.h>
#import <objc/runtime.h>

static AXUIElementRef leaf, duplicate, parent;
static BOOL unavailable;
static NSArray *fixtureWindows;
static NSUInteger callbackCount;
static CGRect callbackRect;
static uint32_t callbackWindow;
static NSUInteger beepCount;
static void fixtureBeep(void) { beepCount++; }
static dispatch_semaphore_t hitGate, hitEntered;
static atomic_uint hitCount;
static CGPoint leafOrigin = {-160, 120};
static AXError fixtureHit(AXUIElementRef application, float x, float y, AXUIElementRef *out) {
    atomic_fetch_add(&hitCount, 1);
    if (hitGate) {
        dispatch_semaphore_signal(hitEntered);
        dispatch_semaphore_wait(hitGate, DISPATCH_TIME_FOREVER);
    }
    if (unavailable) return kAXErrorCannotComplete;
    *out = (AXUIElementRef)CFRetain(leaf); return kAXErrorSuccess;
}
static AXError fixtureAttribute(AXUIElementRef element, CFStringRef attribute, CFTypeRef *out) {
    if (CFEqual(attribute, kAXPositionAttribute)) {
        CGPoint point = element == parent ? CGPointMake(-200, 100) : leafOrigin;
        *out = AXValueCreate(kAXValueCGPointType, &point);
    } else if (CFEqual(attribute, kAXSizeAttribute)) {
        CGSize size = element == parent ? CGSizeMake(200, 140) : CGSizeMake(40, 24);
        *out = AXValueCreate(kAXValueCGSizeType, &size);
    } else if (CFEqual(attribute, kAXRoleDescriptionAttribute)) {
        *out = CFRetain(element == parent ? CFSTR("工具栏") : CFSTR("按钮"));
    } else if (CFEqual(attribute, kAXParentAttribute)) {
        *out = CFRetain(element == leaf ? duplicate : parent); // Includes a cyclic ancestor.
    } else return kAXErrorNoValue;
    return kAXErrorSuccess;
}
static CFArrayRef fixtureWindowList(CGWindowListOption option, CGWindowID window) {
    return (CFArrayRef)[fixtureWindows retain];
}
#define AXUIElementCopyElementAtPosition fixtureHit
#define AXUIElementCopyAttributeValue fixtureAttribute
#define CGWindowListCopyWindowInfo fixtureWindowList
#define NSBeep fixtureBeep
#include "../capture_selection_darwin.m"

void ciip_go_capture_selection(uintptr_t token, uint32_t window, double x, double y, double w, double h) {
    callbackCount++; callbackWindow = window; callbackRect = CGRectMake(x, y, w, h);
}
static NSDictionary *windowInfo(pid_t pid, uint32_t number, CGRect rect, double alpha) {
    return @{(id)kCGWindowOwnerPID:@(pid), (id)kCGWindowNumber:@(number), (id)kCGWindowAlpha:@(alpha),
        (id)kCGWindowName:@"偏好设置", (id)kCGWindowOwnerName:@"系统设置",
        (id)kCGWindowBounds:[(id)CGRectCreateDictionaryRepresentation(rect) autorelease]};
}
static NSEvent *key(unsigned short code) {
    return [NSEvent keyEventWithType:NSEventTypeKeyDown location:NSZeroPoint modifierFlags:0 timestamp:0 windowNumber:0 context:nil characters:@"" charactersIgnoringModifiers:@"" isARepeat:NO keyCode:code];
}

static NSPoint fixtureMouse;
static NSPoint fixtureMouseLocation(id object, SEL selector) { return fixtureMouse; }
@interface CIIPCaptureFixtureBackground : NSView
@end
@implementation CIIPCaptureFixtureBackground
- (void)drawRect:(NSRect)rect {
    [[NSColor colorWithWhite:.96 alpha:1] setFill]; NSRectFill(self.bounds);
    [[NSColor colorWithWhite:.85 alpha:1] setFill]; NSRectFill(NSMakeRect(280, 120, 300, 240));
    [@"页面元素选择" drawAtPoint:NSMakePoint(290, 330) withAttributes:@{NSFontAttributeName:[NSFont systemFontOfSize:17], NSForegroundColorAttributeName:NSColor.blackColor}];
    [@"工具栏" drawAtPoint:NSMakePoint(354, 256) withAttributes:@{NSForegroundColorAttributeName:NSColor.blackColor}];
    [NSColor.whiteColor setFill]; NSRectFill(NSMakeRect(390, 226, 40, 24));
}
@end
static void renderCaptureFrame(CIIPCapturePicker *picker, NSString *directory, NSString *name) {
    if (!directory) return;
    NSPanel *panel = [[CIIPCaptureSelectionPanel alloc] initWithContentRect:NSMakeRect(-550, 630, 800, 480) styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
    panel.releasedWhenClosed = NO;
    NSView *background = [[[CIIPCaptureFixtureBackground alloc] initWithFrame:NSMakeRect(0, 0, 800, 480)] autorelease];
    panel.contentView = background;
    CIIPCaptureSelectionView *view = [[[CIIPCaptureSelectionView alloc] initWithFrame:background.bounds] autorelease];
    view.picker = picker; [background addSubview:view];
    [view updateSelectionAnimated:NO];
    NSBitmapImageRep *rep = [background bitmapImageRepForCachingDisplayInRect:background.bounds];
    [background cacheDisplayInRect:background.bounds toBitmapImageRep:rep];
    assert([[rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:[directory stringByAppendingPathComponent:name] atomically:YES]);
    [panel close]; [panel release];
}
static void drainUntil(BOOL (^ready)(void)) {
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:3];
    while (!ready() && deadline.timeIntervalSinceNow > 0) {
        [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:.01]];
    }
    assert(ready());
}
static void testCaptureSelectionRefresh(NSDictionary *window, NSString *directory) {
    Method mouseLocation = class_getClassMethod(NSEvent.class, @selector(mouseLocation));
    IMP originalMouseLocation = method_setImplementation(mouseLocation, (IMP)fixtureMouseLocation);
    fixtureMouse = NSMakePoint(-150, 870);
    fixtureWindows = @[window];
    CIIPCapturePicker *picker = [[CIIPCapturePicker alloc] init];
    picker.elementMode = YES; picker.desktopTop = 1000;
    [picker sample]; drainUntil(^BOOL { return !picker.querying; });
    assert(picker.elements.count == 2 && usableCaptureRect(picker.rect));
    [picker keyDown:key(126)];
    CGRect selected = picker.rect;
    renderCaptureFrame(picker, directory, @"resolved.png");
    hitGate = dispatch_semaphore_create(0); hitEntered = dispatch_semaphore_create(0);
    fixtureMouse.x += 1; [picker sample];
    assert(dispatch_semaphore_wait(hitEntered, dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC)) == 0);
    renderCaptureFrame(picker, directory, @"refreshing.png");
    assert(picker.pending && CGRectEqualToRect(picker.rect, selected));
    NSUInteger callbacks = callbackCount, beeps = beepCount;
    [picker confirm];
    assert(callbackCount == callbacks && beepCount == beeps + 1);
    dispatch_semaphore_signal(hitGate);
    drainUntil(^BOOL { return !picker.querying; });
    assert(!picker.pending && picker.elementIndex == 1 && CGRectEqualToRect(picker.rect, selected));
    renderCaptureFrame(picker, directory, @"refreshed.png");

    // Slow AX response while moving continuously: coalesce to the latest point without blank frames.
    unsigned int calls = atomic_load(&hitCount);
    fixtureMouse.x += 1; [picker sample];
    assert(dispatch_semaphore_wait(hitEntered, dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC)) == 0);
    for (NSUInteger i = 0; i < 8; i++) {
        fixtureMouse.x += 1; [picker sample];
        assert(picker.pending && CGRectEqualToRect(picker.rect, selected));
        [picker keyDown:key(125)]; assert(picker.elementIndex == 1);
    }
    assert(atomic_load(&hitCount) == calls + 1);
    dispatch_semaphore_signal(hitGate);
    drainUntil(^BOOL { return atomic_load(&hitCount) == calls + 2; });
    assert(picker.pending && CGRectEqualToRect(picker.rect, selected));
    dispatch_semaphore_signal(hitGate);
    drainUntil(^BOOL { return !picker.querying; });
    assert(!picker.pending && picker.elementIndex == 1 && CGRectEqualToRect(picker.rect, selected));
    dispatch_release(hitGate); dispatch_release(hitEntered); hitGate = hitEntered = nil;

    // A different leaf resets hierarchy; an unsupported target clears after resolution.
    leafOrigin = CGPointMake(-110, 120); fixtureMouse.x = -100; [picker sample];
    drainUntil(^BOOL { return !picker.querying; });
    assert(picker.elementIndex == 0 && CGRectEqualToRect(picker.rect, CGRectMake(-110, 120, 40, 24)));
    unavailable = YES; fixtureMouse.x += 1; [picker sample];
    drainUntil(^BOOL { return !picker.querying; });
    assert(!picker.pending && !picker.elements.count && !usableCaptureRect(picker.rect));
    unavailable = NO; leafOrigin = CGPointMake(-160, 120); fixtureMouse.x = -150; [picker sample];
    drainUntil(^BOOL { return !picker.querying; });

    // Returning to the same point in a different window must not accept the old window's result.
    hitGate = dispatch_semaphore_create(0); hitEntered = dispatch_semaphore_create(0);
    calls = atomic_load(&hitCount);
    fixtureMouse.x += 1; [picker sample];
    assert(dispatch_semaphore_wait(hitEntered, dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC)) == 0);
    fixtureWindows = @[windowInfo(1003, 13, CGRectMake(-200, 100, 200, 140), 1)];
    fixtureMouse.x += 1; [picker sample]; fixtureMouse.x -= 1; [picker sample];
    assert(!usableCaptureRect(picker.rect));
    dispatch_semaphore_signal(hitGate);
    drainUntil(^BOOL { return atomic_load(&hitCount) == calls + 2; });
    assert(picker.pending && !usableCaptureRect(picker.rect));
    dispatch_semaphore_signal(hitGate);
    drainUntil(^BOOL { return !picker.querying; });
    assert(!picker.pending && usableCaptureRect(picker.rect) && [picker.targetWindow[(id)kCGWindowNumber] intValue] == 13);
    dispatch_release(hitGate); dispatch_release(hitEntered); hitGate = hitEntered = nil;

    // Leaving all windows removes the highlight immediately.
    fixtureMouse.x = 500; [picker sample];
    assert(!picker.pending && !picker.elements.count && !usableCaptureRect(picker.rect));
    picker.finished = YES; [picker release];

    // Window capture shares sampling but must continue updating synchronously.
    fixtureWindows = @[window]; fixtureMouse.x = -150;
    picker = [[CIIPCapturePicker alloc] init]; picker.desktopTop = 1000;
    [picker sample]; selected = picker.rect;
    fixtureMouse.x += 1; [picker sample];
    assert(!picker.pending && !picker.querying && CGRectEqualToRect(picker.rect, selected));
    picker.finished = YES; [picker release];
    method_setImplementation(mouseLocation, originalMouseLocation);
    puts("PASS stable refresh: micro-movement, parent selection, slow AX, latest pointer, stale window, empty target, pending confirmation, window capture");
}
int main(int argc, const char **argv) {
    @autoreleasepool {
        [NSApplication sharedApplication];
        leaf = AXUIElementCreateApplication(1111); duplicate = AXUIElementCreateApplication(2222); parent = AXUIElementCreateApplication(3333);
        CGRect target = CGRectMake(-200, 100, 200, 140);
        NSDictionary *own = windowInfo(getpid(), 10, target, 1), *hidden = windowInfo(1001, 11, target, 0), *other = windowInfo(1002, 12, target, 1);
        fixtureWindows = @[own, hidden, other];
        NSSet *excluded = [NSSet setWithObject:@10];
        assert(captureWindowAtPoint(fixtureWindows, CGPointMake(-150, 130), excluded) == other);
        assert(!captureWindowAtPoint(fixtureWindows, CGPointMake(500, 500), excluded));
        // Other ciip windows, such as pins, remain valid screenshot targets.
        assert(captureWindowAtPoint(@[own], CGPointMake(-150, 130), [NSSet set]) == own);
        assert(!usableCaptureRect(CGRectMake(0, 0, NAN, 1)));
        NSArray *elements = captureElementsAtPoint(1002, CGPointMake(-150, 130), CGRectMake(-180, 110, 100, 80));
        assert(elements.count == 2); // Duplicate rects and cyclic parents do not repeat candidates.
        assert(NSEqualRects([elements[0][@"rect"] rectValue], NSMakeRect(-160, 120, 40, 24)));
        assert(NSEqualRects([elements[1][@"rect"] rectValue], NSMakeRect(-180, 110, 100, 80)));
        unavailable = YES;
        assert(captureElementsAtPoint(1002, CGPointMake(-150, 130), target).count == 0);
        unavailable = NO;
        testCaptureSelectionRefresh(other, argc > 1 ? [NSString stringWithUTF8String:argv[1]] : nil);

        CIIPCapturePicker *picker = [[CIIPCapturePicker alloc] init];
        activeCapturePicker = picker; picker.token = 7; picker.elementMode = YES; picker.elements = elements;
        picker.rect = NSRectToCGRect([elements[0][@"rect"] rectValue]);
        [picker keyDown:key(126)]; assert(picker.elementIndex == 1);
        [picker keyDown:key(126)]; assert(picker.elementIndex == 1);
        [picker keyDown:key(125)]; assert(picker.elementIndex == 0);
        [picker keyDown:key(53)];
        assert(callbackCount == 1 && CGRectIsEmpty(callbackRect) && !activeCapturePicker);
        ciip_cancel_capture_selection(7); assert(callbackCount == 1);

        picker = [[CIIPCapturePicker alloc] init]; activeCapturePicker = picker;
        picker.token = 8; picker.targetWindow = other; picker.rect = target;
        [picker finish:YES];
        assert(callbackCount == 2 && callbackWindow == 12 && CGRectEqualToRect(callbackRect, target));

        // Render the production NSView onto a synthetic canvas, never the desktop image.
        picker = [[CIIPCapturePicker alloc] init];
        NSPoint mouse = NSEvent.mouseLocation;
        NSPanel *panel = [[CIIPCaptureSelectionPanel alloc] initWithContentRect:NSMakeRect(mouse.x - 400, mouse.y - 240, 800, 480) styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
        panel.releasedWhenClosed = NO;
        CIIPCaptureSelectionView *view = [[[CIIPCaptureSelectionView alloc] initWithFrame:NSMakeRect(0, 0, 800, 480)] autorelease];
        view.picker = picker; panel.contentView = view;
        picker.desktopTop = mouse.y + 240;
        picker.targetWindow = other; picker.appName = @"系统设置";
        picker.appIcon = [NSWorkspace.sharedWorkspace iconForFile:@"/System/Applications/System Settings.app"];
        NSCursor *cursor = captureSelectionCursor(picker.appIcon);
        assert(NSEqualSizes(cursor.image.size, NSMakeSize(28, 28)));
        assert(NSEqualPoints(cursor.hotSpot, NSMakePoint(14, 14)));
        assert(captureSelectionCursor(nil) == NSCursor.arrowCursor);
        assert([captureSelectionDimensions(CGRectMake(-10.25, 5.5, 40.5, 24.25), 2) isEqualToString:@"84 × 50 px"]);
        if (argc > 1) {
            NSBitmapImageRep *cursorRep = [NSBitmapImageRep imageRepWithData:cursor.image.TIFFRepresentation];
            NSString *cursorPath = [[NSString stringWithUTF8String:argv[1]] stringByAppendingPathComponent:@"cursor.png"];
            assert([[cursorRep representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:cursorPath atomically:YES]);
        }
        picker.rect = CGRectMake(mouse.x - 280, 80, 560, 320);
        for (NSUInteger mode = 0; mode < 2; mode++) {
            picker.elementMode = mode == 1; picker.elements = elements;
            if (mode) picker.rect = CGRectMake(mouse.x + 80, 180, 160, 34);
            [view updateSelectionAnimated:NO];
            NSBitmapImageRep *rep = [view bitmapImageRepForCachingDisplayInRect:view.bounds];
            [view cacheDisplayInRect:view.bounds toBitmapImageRep:rep];
            assert(rep.pixelsWide > 0 && rep.pixelsHigh > 0);
            if (argc > 1) {
                NSString *path = [[NSString stringWithUTF8String:argv[1]] stringByAppendingPathComponent:mode ? @"element.png" : @"window.png"];
                assert([[rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:path atomically:YES]);
            }
        }
        [panel close]; [panel release]; [picker release];
        CFRelease(leaf); CFRelease(duplicate); CFRelease(parent);
        puts("PASS capture selection: window identity, AX bounds, clipping, hierarchy, unavailable target, cancellation, callback, native drawing");
    }
}
