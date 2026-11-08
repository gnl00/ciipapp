// Isolated AppKit/AX regression. Does not request permissions or capture user screen content.
#import <Cocoa/Cocoa.h>
#import <ApplicationServices/ApplicationServices.h>
#include <unistd.h>
#include <assert.h>
#include <stdatomic.h>
#import <objc/runtime.h>

static AXUIElementRef leaf, duplicate, parent, root, sibling;
static BOOL unavailable, transientFailure;
static BOOL hitContainer, hitGroup, rootChildrenAvailable;
static BOOL overlappingBranches, sameBoundsSibling, equalAreaSibling, reverseBranches;
static BOOL sameFrameDescendants, framelessParent;
static NSArray *fixtureWindows;
static NSUInteger callbackCount;
static CGRect callbackRect;
static uint32_t callbackWindow;
static NSUInteger beepCount;
static void fixtureBeep(void) { beepCount++; }
static dispatch_semaphore_t hitGate, hitEntered;
static atomic_uint hitCount;
static atomic_uint applicationCreations;
static AXUIElementRef fixtureApplication(pid_t pid) {
    atomic_fetch_add(&applicationCreations, 1); return AXUIElementCreateApplication(pid);
}
static CGPoint leafOrigin = {-160, 120};
static CGRect containerRect = {{-200, 100}, {200, 140}};
static CGSize leafSize = {40, 24};
static AXError fixtureHit(AXUIElementRef application, float x, float y, AXUIElementRef *out) {
    atomic_fetch_add(&hitCount, 1);
    if (hitGate) {
        dispatch_semaphore_signal(hitEntered);
        dispatch_semaphore_wait(hitGate, DISPATCH_TIME_FOREVER);
    }
    if (transientFailure) return kAXErrorCannotComplete;
    if (unavailable) return kAXErrorNotImplemented;
    *out = (AXUIElementRef)CFRetain(hitContainer ? root : hitGroup ? parent : leaf); return kAXErrorSuccess;
}
static AXError fixtureAttribute(AXUIElementRef element, CFStringRef attribute, CFTypeRef *out) {
    if (CFEqual(attribute, kAXPositionAttribute)) {
        if (element == parent && framelessParent) return kAXErrorNoValue;
        CGPoint point = sameFrameDescendants || element == parent || element == root || (element == sibling && sameBoundsSibling) ? containerRect.origin : element == sibling ? (equalAreaSibling ? CGPointMake(-165, 115) : CGPointMake(-180, 110)) : leafOrigin;
        *out = AXValueCreate(kAXValueCGPointType, &point);
    } else if (CFEqual(attribute, kAXSizeAttribute)) {
        if (element == parent && framelessParent) return kAXErrorNoValue;
        CGSize size = sameFrameDescendants || element == parent || element == root || (element == sibling && sameBoundsSibling) ? containerRect.size : element == sibling && !equalAreaSibling ? CGSizeMake(80, 60) : leafSize;
        *out = AXValueCreate(kAXValueCGSizeType, &size);
    } else if (CFEqual(attribute, kAXRoleDescriptionAttribute)) {
        *out = CFRetain(element == parent ? CFSTR("工具栏") : CFSTR("按钮"));
    } else if (CFEqual(attribute, kAXRoleAttribute)) {
        *out = CFRetain(element == root ? kAXWindowRole : element == parent || element == sibling ? kAXGroupRole : kAXButtonRole);
    } else if (CFEqual(attribute, kAXChildrenAttribute)) {
        if (!rootChildrenAvailable || (element != root && element != parent)) return kAXErrorNoValue;
        if (element == root && overlappingBranches) {
            const void *children[] = {reverseBranches ? sibling : parent, reverseBranches ? parent : sibling, root}; // Includes a descendant cycle.
            *out = CFArrayCreate(NULL, children, 3, &kCFTypeArrayCallBacks);
            return kAXErrorSuccess;
        }
        const void *child = element == root ? (const void *)parent : (const void *)leaf;
        *out = CFArrayCreate(NULL, &child, 1, &kCFTypeArrayCallBacks);
    } else if (CFEqual(attribute, kAXParentAttribute)) {
        if (element == root) return kAXErrorNoValue;
        *out = CFRetain(element == leaf ? duplicate : parent); // Includes a cyclic ancestor.
    } else return kAXErrorNoValue;
    return kAXErrorSuccess;
}
static CFArrayRef fixtureWindowList(CGWindowListOption option, CGWindowID window) {
    return (CFArrayRef)[fixtureWindows retain];
}
#define AXUIElementCopyElementAtPosition fixtureHit
#define AXUIElementCopyAttributeValue fixtureAttribute
#define AXUIElementCreateApplication fixtureApplication
#define CGWindowListCopyWindowInfo fixtureWindowList
#define NSBeep fixtureBeep
#include "../capture_selection_darwin.m"
#undef AXUIElementCreateApplication

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
static void waitForHit(unsigned int expectedCount) {
    // A counter increment precedes the signal. Consume exactly one entry notification for
    // each gated request, including requests started by a main-queue completion callback.
    __block BOOL entered = NO;
    drainUntil(^BOOL {
        if (!entered) entered = dispatch_semaphore_wait(hitEntered, DISPATCH_TIME_NOW) == 0;
        return entered;
    });
    assert(atomic_load(&hitCount) == expectedCount);
}
static void drainFor(NSTimeInterval duration) {
    NSDate *until = [NSDate dateWithTimeIntervalSinceNow:duration];
    while (until.timeIntervalSinceNow > 0) [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode beforeDate:until];
}

@interface CIIPCaptureDwellView : CIIPCaptureSelectionView
@property(nonatomic) BOOL forceReducedMotion;
@end
@implementation CIIPCaptureDwellView
- (BOOL)reduceSelectionMotion { return self.forceReducedMotion; }
@end
static void renderDwellFrame(CALayer *layer, NSString *directory, NSString *name, CGFloat scale) {
    if (!directory) return;
    NSBitmapImageRep *rep = [[[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:layer.bounds.size.width * scale pixelsHigh:layer.bounds.size.height * scale bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0] autorelease];
    NSGraphicsContext *context = [NSGraphicsContext graphicsContextWithBitmapImageRep:rep];
    CGContextScaleCTM(context.CGContext, scale, scale);
    [(layer.presentationLayer ?: layer) renderInContext:context.CGContext];
    assert([[rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:[directory stringByAppendingPathComponent:name] atomically:YES]);
}
static void testCaptureAncestorVisual(NSString *directory) {
    Method mouseLocation = class_getClassMethod(NSEvent.class, @selector(mouseLocation));
    IMP originalMouseLocation = method_setImplementation(mouseLocation, (IMP)fixtureMouseLocation);
    hitGroup = hitContainer = rootChildrenAvailable = NO;
    CIIPCapturePicker *picker = [[CIIPCapturePicker alloc] init]; picker.elementMode = YES;
    picker.desktopTop = NSMaxY(NSScreen.screens[0].frame); picker.selectionDuration = .12;
    NSRect work = NSScreen.screens[0].visibleFrame;
    NSRect frame = NSMakeRect(work.origin.x + 20, work.origin.y + 20, MIN(800, work.size.width - 40), MIN(480, work.size.height - 40));
    NSPanel *panel = [[CIIPCaptureSelectionPanel alloc] initWithContentRect:frame styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel backing:NSBackingStoreBuffered defer:NO];
    panel.releasedWhenClosed = NO;
    CIIPCaptureDwellView *view = [[[CIIPCaptureDwellView alloc] initWithFrame:NSMakeRect(0, 0, frame.size.width, frame.size.height)] autorelease]; view.picker = picker; panel.contentView = view;
    view.layer.backgroundColor = [NSColor colorWithWhite:.96 alpha:1].CGColor; // Synthetic page; never read the desktop image.
    [picker.panels addObject:panel]; [panel orderFrontRegardless]; [panel display];
    // AppKit can constrain a requested frame on a smaller display. AX and pointer fixtures must
    // follow the actual window, rather than assuming an off-screen frame or a 1000pt desktop.
    frame = panel.frame;
    containerRect = CGRectMake(frame.origin.x + 20, picker.desktopTop - NSMaxY(frame) + 20, frame.size.width - 40, frame.size.height - 40);
    leafSize = CGSizeMake(MIN(430, floor(containerRect.size.width - 40)), 18);
    leafOrigin = CGPointMake(floor(containerRect.origin.x + 20), floor(containerRect.origin.y + containerRect.size.height / 2));
    fixtureWindows = @[windowInfo(1002, 12, containerRect, 1)];
    fixtureMouse = NSMakePoint(leafOrigin.x + 20, picker.desktopTop - leafOrigin.y - 5);
    [picker sample]; drainUntil(^BOOL { return !picker.querying && !picker.pending; }); [CATransaction flush];
    CAShapeLayer *outline = (CAShapeLayer *)view.layer.sublayers[1];
    CALayer *plate = view.layer.sublayers[2]; CATextLayer *dimensions = (CATextLayer *)plate.sublayers[0];
    assert(usableCaptureRect(CGPathGetBoundingBox(outline.path)));
    assert(!plate.hidden);
    drainUntil(^BOOL { return usableCaptureRect(CGPathGetBoundingBox([(CAShapeLayer *)outline.presentationLayer path])); });
    NSString *expectedDimensions = [NSString stringWithFormat:@"%.0f × %.0f px", leafSize.width * panel.backingScaleFactor, leafSize.height * panel.backingScaleFactor];
    assert([[(NSAttributedString *)dimensions.string string] isEqualToString:expectedDimensions]);
    renderDwellFrame(view.layer, directory, @"ancestor-line-start.png", panel.backingScaleFactor);
    hitGroup = YES; fixtureMouse.y = picker.desktopTop - leafOrigin.y - leafSize.height - 3;
    [picker sample]; drainUntil(^BOOL { return !picker.querying; });
    [CATransaction flush]; drainFor(.033);
    renderDwellFrame(view.layer, directory, @"ancestor-gap-33ms.png", panel.backingScaleFactor);
    CGRect presented = CGPathGetBoundingBox([(CAShapeLayer *)outline.presentationLayer path]);
    expectedDimensions = [NSString stringWithFormat:@"%.0f × %.0f px", leafSize.width * panel.backingScaleFactor, leafSize.height * panel.backingScaleFactor];
    fprintf(stderr, "ancestor presentation gap frame=%s height=%.2f scale=%.0f hidden=%d label=%s\n", NSStringFromRect(frame).UTF8String, presented.size.height, panel.backingScaleFactor, plate.hidden, [[(NSAttributedString *)dimensions.string string] UTF8String]);
    assert(usableCaptureRect(presented) && presented.size.height < 20);
    assert(!plate.hidden);
    assert([[(NSAttributedString *)dimensions.string string] isEqualToString:expectedDimensions]);
    drainFor(.017); hitGroup = NO; leafOrigin.y += 32;
    fixtureMouse.y = picker.desktopTop - leafOrigin.y - 5; [picker sample];
    drainUntil(^BOOL { return !picker.querying && !picker.pending; }); [CATransaction flush]; drainFor(.033);
    renderDwellFrame(view.layer, directory, @"ancestor-next-line-83ms.png", panel.backingScaleFactor);
    presented = CGPathGetBoundingBox([(CAShapeLayer *)outline.presentationLayer path]);
    assert(usableCaptureRect(presented) && presented.size.height < 20);
    drainFor(.13);
    // The stability policy survives reduced motion; only the eventual transition becomes immediate.
    view.forceReducedMotion = YES; hitGroup = YES;
    fixtureMouse.y = picker.desktopTop - leafOrigin.y - leafSize.height - 3; [picker sample];
    drainUntil(^BOOL { return !picker.querying; }); assert(picker.pending);
    assert(![outline animationForKey:@"path"] && CGPathGetBoundingBox(outline.path).size.height < 20);
    drainUntil(^BOOL { return !picker.pending && !picker.querying; });
    assert(CGRectEqualToRect(picker.rect, containerRect) && ![outline animationForKey:@"path"]);
    renderDwellFrame(view.layer, directory, @"ancestor-settled-reduced-motion.png", panel.backingScaleFactor);
    [picker finish:NO]; [panel release];
    containerRect = CGRectMake(-200, 100, 200, 140); leafOrigin = CGPointMake(-160, 120); leafSize = CGSizeMake(40, 24); hitGroup = NO;
    method_setImplementation(mouseLocation, originalMouseLocation);
    puts("PASS ancestor native presentation: gap skipped, sibling line remains narrow, dimensions stable, reduced motion dwell");
}

static void testCaptureAncestorDwell(NSDictionary *window, NSString *directory) {
    Method mouseLocation = class_getClassMethod(NSEvent.class, @selector(mouseLocation));
    IMP originalMouseLocation = method_setImplementation(mouseLocation, (IMP)fixtureMouseLocation);
    fixtureWindows = @[window]; fixtureMouse = NSMakePoint(-150, 870);
    leafOrigin = CGPointMake(-160, 120); hitGroup = hitContainer = rootChildrenAvailable = NO;
    CIIPCapturePicker *picker = [[CIIPCapturePicker alloc] init];
    picker.elementMode = YES; picker.desktopTop = 1000;
    [picker sample]; drainUntil(^BOOL { return !picker.querying && !picker.pending; });
    CGRect leafRect = picker.rect;
    // Crossing the gap between two leaves must not publish their large, valid ancestor for one sample.
    hitGroup = YES; fixtureMouse.y = 853; [picker sample];
    drainUntil(^BOOL { return !picker.querying; });
    renderCaptureFrame(picker, directory, @"ancestor-gap.png");
    fprintf(stderr, "ancestor gap pending=%d selected=%s\n", picker.pending, NSStringFromRect(NSRectFromCGRect(picker.rect)).UTF8String);
    assert(picker.pending && CGRectEqualToRect(picker.rect, leafRect));
    drainFor(.05);
    hitGroup = NO; leafOrigin.y += 32; fixtureMouse.y = 838; [picker sample];
    drainUntil(^BOOL { return !picker.querying && !picker.pending; });
    assert(CGRectEqualToRect(picker.rect, (CGRect){leafOrigin, {40, 24}}));
    unsigned int calls = atomic_load(&hitCount); drainFor(.15);
    assert(atomic_load(&hitCount) == calls && CGRectEqualToRect(picker.rect, (CGRect){leafOrigin, {40, 24}}));

    // Staying in the same ancestor, including micro-movement, confirms it after one dwell.
    hitGroup = YES; fixtureMouse.y = 821; [picker sample]; drainUntil(^BOOL { return !picker.querying; });
    assert(picker.pending); calls = atomic_load(&hitCount);
    for (NSUInteger i = 0; i < 6; i++) {
        drainFor(.03); fixtureMouse.x += .5; [picker sample]; drainUntil(^BOOL { return !picker.querying; });
    }
    assert(!picker.pending && CGRectEqualToRect(picker.rect, containerRect) && atomic_load(&hitCount) >= calls + 6);
    hitGroup = NO; fixtureMouse.y = 838; [picker sample]; drainUntil(^BOOL { return !picker.querying; });
    assert(!picker.pending && CGRectEqualToRect(picker.rect, (CGRect){leafOrigin, {40, 24}})); // Shrinking is immediate.

    // Return/click cannot capture an ancestor that has not been displayed. Up explicitly reveals it.
    hitGroup = YES; fixtureMouse.y = 821; [picker sample]; drainUntil(^BOOL { return !picker.querying; });
    NSUInteger callbacks = callbackCount, beeps = beepCount;
    [picker keyDown:key(36)]; assert(callbackCount == callbacks && beepCount == beeps + 1 && picker.pending);
    CIIPCaptureSelectionView *gesture = [[CIIPCaptureSelectionView alloc] initWithFrame:NSMakeRect(0, 0, 10, 10)]; gesture.picker = picker;
    NSEvent *down = [NSEvent mouseEventWithType:NSEventTypeLeftMouseDown location:NSZeroPoint modifierFlags:0 timestamp:0 windowNumber:0 context:nil eventNumber:1 clickCount:1 pressure:1];
    NSEvent *up = [NSEvent mouseEventWithType:NSEventTypeLeftMouseUp location:NSZeroPoint modifierFlags:0 timestamp:0 windowNumber:0 context:nil eventNumber:2 clickCount:1 pressure:0];
    [gesture mouseDown:down]; [gesture mouseUp:up]; [gesture release];
    assert(callbackCount == callbacks && beepCount == beeps + 2 && picker.pending);
    drainUntil(^BOOL { return !picker.querying; }); // A blocked click can refresh the pointer after tracking resumes.
    [picker keyDown:key(126)];
    assert(!picker.pending && CGRectEqualToRect(picker.rect, containerRect) && callbackCount == callbacks);
    calls = atomic_load(&hitCount); drainFor(.15); assert(atomic_load(&hitCount) == calls);

    // The dwell timer samples the real pointer, including a move not yet seen by the regular timer.
    hitGroup = NO; fixtureMouse.y = 838; [picker sample]; drainUntil(^BOOL { return !picker.querying; });
    hitGroup = YES; fixtureMouse.y = 821; [picker sample]; drainUntil(^BOOL { return !picker.querying; }); assert(picker.pending);
    hitGroup = NO; leafOrigin.y -= 32; fixtureMouse.y = 870; // Intentionally no sample call.
    drainUntil(^BOOL { return !picker.pending && !picker.querying; });
    assert(CGRectEqualToRect(picker.rect, (CGRect){leafOrigin, {40, 24}}));

    // A new window invalidates both the proposal and its scheduled verification.
    hitGroup = YES; fixtureMouse.y = 853; [picker sample]; drainUntil(^BOOL { return !picker.querying; }); assert(picker.pending);
    fixtureWindows = @[windowInfo(1003, 13, containerRect, 1)]; hitGroup = NO; fixtureMouse.x += 1;
    [picker sample]; drainUntil(^BOOL { return !picker.pending && !picker.querying; });
    calls = atomic_load(&hitCount); drainFor(.15);
    assert(atomic_load(&hitCount) == calls && [picker.targetWindow[(id)kCGWindowNumber] intValue] == 13);

    // Leaving and returning to an ancestor inside one larger window starts a new dwell.
    fixtureWindows = @[windowInfo(1002, 12, CGRectMake(-240, 80, 300, 200), 1)]; fixtureMouse = NSMakePoint(-150, 870);
    [picker sample]; drainUntil(^BOOL { return !picker.pending && !picker.querying; });
    hitGroup = YES; fixtureMouse.y = 853; [picker sample]; drainUntil(^BOOL { return !picker.querying; }); assert(picker.pending);
    hitGate = dispatch_semaphore_create(0); hitEntered = dispatch_semaphore_create(0);
    calls = atomic_load(&hitCount);
    fixtureMouse = NSMakePoint(-220, 870); [picker sample];
    waitForHit(calls + 1);
    drainFor(.13); fixtureMouse = NSMakePoint(-150, 853); [picker sample]; calls = atomic_load(&hitCount);
    dispatch_semaphore_signal(hitGate); waitForHit(calls + 1);
    dispatch_semaphore_signal(hitGate); drainUntil(^BOOL { return !picker.querying; });
    assert(picker.pending && CGRectEqualToRect(picker.rect, (CGRect){leafOrigin, {40, 24}}));
    dispatch_release(hitGate); dispatch_release(hitEntered); hitGate = hitEntered = nil;
    drainUntil(^BOOL { return !picker.pending && !picker.querying; });
    assert(CGRectEqualToRect(picker.rect, containerRect));
    [picker keyDown:key(36)]; assert(callbackCount == callbacks + 1 && CGRectEqualToRect(callbackRect, containerRect));

    // Cancel clears the proposal; its delayed callback must not issue another AX request.
    fixtureWindows = @[window]; hitGroup = NO; fixtureMouse = NSMakePoint(-150, 870);
    picker = [[CIIPCapturePicker alloc] init]; picker.elementMode = YES; picker.desktopTop = 1000;
    [picker sample]; drainUntil(^BOOL { return !picker.pending && !picker.querying; });
    hitGroup = YES; fixtureMouse.y = 853; [picker sample]; drainUntil(^BOOL { return !picker.querying; }); assert(picker.pending);
    calls = atomic_load(&hitCount); [picker keyDown:key(53)]; drainFor(.15);
    assert(atomic_load(&hitCount) == calls && callbackCount == callbacks + 2 && CGRectIsEmpty(callbackRect));
    leafOrigin = CGPointMake(-160, 120); hitGroup = NO;
    method_setImplementation(mouseLocation, originalMouseLocation);
    puts("PASS ancestor dwell: gap, sibling, micro-movement, stationary verification, click/Return, Up, physical pointer, window, leave/return, cancellation");
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
    unsigned int applicationCount = atomic_load(&applicationCreations); fixtureMouse.x += .125;
    [picker sample]; drainUntil(^BOOL { return !picker.querying; });
    fprintf(stderr, "AX application roots %u -> %u\n", applicationCount, atomic_load(&applicationCreations));
    assert(atomic_load(&applicationCreations) == applicationCount);
    CIIPCaptureSelectionView *eventView = [[CIIPCaptureSelectionView alloc] initWithFrame:NSMakeRect(0, 0, 10, 10)]; eventView.picker = picker;
    unsigned int eventCalls = atomic_load(&hitCount); fixtureMouse.x += .25;
    NSEvent *move = [NSEvent mouseEventWithType:NSEventTypeMouseMoved location:NSZeroPoint modifierFlags:0 timestamp:0 windowNumber:0 context:nil eventNumber:1 clickCount:0 pressure:0];
    [eventView mouseMoved:move]; drainUntil(^BOOL { return !picker.querying; });
    fprintf(stderr, "pointer event query count %u -> %u\n", eventCalls, atomic_load(&hitCount));
    assert(atomic_load(&hitCount) == eventCalls + 1); [eventView release];
    [picker keyDown:key(126)];
    CGRect selected = picker.rect;
    renderCaptureFrame(picker, directory, @"resolved.png");
    leafOrigin.x += .25; fixtureMouse.x += .25; [picker sample]; drainUntil(^BOOL { return !picker.querying; });
    assert(picker.elementIndex == 1 && CGRectEqualToRect(picker.rect, selected));
    assert(NSRectToCGRect([picker.elements[0][@"rect"] rectValue]).origin.x == leafOrigin.x); // Keep the exact new geometry.
    leafOrigin.x -= .25; fixtureMouse.x += .25; [picker sample]; drainUntil(^BOOL { return !picker.querying; });

    // Lazy providers may return a childless Group while its already-resolved leaf remains live.
    hitGroup = YES; fixtureMouse.x += 1; [picker sample];
    drainUntil(^BOOL { return !picker.querying; });
    assert(!picker.pending && picker.elementIndex == 1);
    assert(NSEqualRects([picker.elements[0][@"rect"] rectValue], NSMakeRect(-160, 120, 40, 24)));
    [picker keyDown:key(125)];
    renderCaptureFrame(picker, directory, @"group-warmup.png");
    assert(CGRectEqualToRect(picker.rect, CGRectMake(-160, 120, 40, 24)));
    // A moved/removed leaf must never be kept merely because its old rectangle still contains the pointer.
    leafOrigin.x += 80; fixtureMouse.x += 1; [picker sample];
    drainUntil(^BOOL { return !picker.querying && !picker.pending; });
    assert(picker.elements.count == 1 && CGRectEqualToRect(picker.rect, selected));
    leafOrigin.x -= 80; hitGroup = NO; fixtureMouse.x = -150; [picker sample];
    drainUntil(^BOOL { return !picker.querying; }); [picker keyDown:key(126)];

    hitGate = dispatch_semaphore_create(0); hitEntered = dispatch_semaphore_create(0);
    unsigned int calls = atomic_load(&hitCount);
    fixtureMouse.x += 1; [picker sample];
    waitForHit(calls + 1);
    renderCaptureFrame(picker, directory, @"refreshing.png");
    assert(picker.pending && CGRectEqualToRect(picker.rect, selected));
    NSUInteger callbacks = callbackCount, beeps = beepCount;
    [picker confirm];
    assert(callbackCount == callbacks && beepCount == beeps + 1);
    dispatch_semaphore_signal(hitGate);
    drainUntil(^BOOL { return !picker.querying; });
    assert(!picker.pending && picker.elementIndex == 1 && CGRectEqualToRect(picker.rect, selected));
    renderCaptureFrame(picker, directory, @"refreshed.png");

    // A completed hit remains useful after micro-movement inside its innermost element.
    // Show it before the pointer stops, then recheck the exact latest point before allowing confirmation.
    calls = atomic_load(&hitCount);
    picker.elements = nil; picker.elementIndex = 0; picker.rect = selected;
    fixtureMouse.x += 1; [picker sample];
    waitForHit(calls + 1);
    fixtureMouse.x += 1; [picker sample];
    dispatch_semaphore_signal(hitGate);
    waitForHit(calls + 2);
    assert(picker.querying && picker.pending && CGRectEqualToRect(picker.rect, CGRectMake(-160, 120, 40, 24)));
    dispatch_semaphore_signal(hitGate); drainUntil(^BOOL { return !picker.querying; });
    assert(!picker.pending); [picker keyDown:key(126)];

    // Slow AX response while moving continuously: coalesce to the latest point without blank frames.
    calls = atomic_load(&hitCount);
    fixtureMouse.x = -122; [picker sample];
    waitForHit(calls + 1);
    for (NSUInteger i = 0; i < 8; i++) {
        fixtureMouse.x += 1; [picker sample];
        assert(picker.pending && CGRectEqualToRect(picker.rect, selected));
        [picker keyDown:key(125)]; assert(picker.elementIndex == 1);
    }
    assert(atomic_load(&hitCount) == calls + 1);
    dispatch_semaphore_signal(hitGate);
    waitForHit(calls + 2);
    assert(picker.pending && CGRectEqualToRect(picker.rect, selected));
    dispatch_semaphore_signal(hitGate);
    drainUntil(^BOOL { return !picker.querying; });
    assert(!picker.pending && picker.elementIndex == 0 && CGRectEqualToRect(picker.rect, selected));
    dispatch_release(hitGate); dispatch_release(hitEntered); hitGate = hitEntered = nil;
    fixtureMouse.x = -150; [picker sample]; drainUntil(^BOOL { return !picker.querying; });
    [picker keyDown:key(126)];

    // A temporary AX failure must preserve the resolved frame and retry even without another mouse move.
    transientFailure = YES; fixtureMouse.x += 1; [picker sample];
    drainUntil(^BOOL { return !picker.querying; });
    assert(picker.pending && picker.elementIndex == 1 && CGRectEqualToRect(picker.rect, selected));
    transientFailure = NO;
    drainUntil(^BOOL { return !picker.querying && !picker.pending; });
    assert(picker.elementIndex == 1 && CGRectEqualToRect(picker.rect, selected));

    // A container-only reply during AX warm-up must not briefly expand or close the existing hole.
    hitContainer = YES; rootChildrenAvailable = NO; fixtureMouse.x += 1; [picker sample];
    drainUntil(^BOOL { return !picker.querying; });
    assert(picker.pending && CGRectEqualToRect(picker.rect, selected));
    rootChildrenAvailable = YES;
    drainUntil(^BOOL { return !picker.querying && !picker.pending; });
    assert(picker.elementIndex == 1 && CGRectEqualToRect(picker.rect, selected));
    rootChildrenAvailable = NO; fixtureMouse.x += 1; [picker sample];
    drainUntil(^BOOL { return !picker.querying && !picker.pending; });
    assert(!usableCaptureRect(picker.rect) && picker.unresolvedRetries == 3);
    hitContainer = NO; fixtureMouse.x += 1; [picker sample];
    drainUntil(^BOOL { return !picker.querying && !picker.pending; });
    assert(picker.unresolvedRetries == 0 && usableCaptureRect(picker.rect));

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
    waitForHit(calls + 1);
    fixtureWindows = @[windowInfo(1003, 13, CGRectMake(-200, 100, 200, 140), 1)];
    fixtureMouse.x += 1; [picker sample]; fixtureMouse.x -= 1; [picker sample];
    assert(!usableCaptureRect(picker.rect));
    dispatch_semaphore_signal(hitGate);
    waitForHit(calls + 2);
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
        leaf = AXUIElementCreateApplication(1111); duplicate = AXUIElementCreateApplication(2222); parent = AXUIElementCreateApplication(3333); root = AXUIElementCreateApplication(4444); sibling = AXUIElementCreateApplication(5555);
        CGRect target = CGRectMake(-200, 100, 200, 140);
        NSDictionary *own = windowInfo(getpid(), 10, target, 1), *hidden = windowInfo(1001, 11, target, 0), *other = windowInfo(1002, 12, target, 1);
        fixtureWindows = @[own, hidden, other];
        NSSet *excluded = [NSSet setWithObject:@10];
        assert(captureWindowAtPoint(fixtureWindows, CGPointMake(-150, 130), excluded) == other);
        assert(!captureWindowAtPoint(fixtureWindows, CGPointMake(500, 500), excluded));
        // Other ciip windows, such as pins, remain valid screenshot targets.
        assert(captureWindowAtPoint(@[own], CGPointMake(-150, 130), [NSSet set]) == own);
        assert(!usableCaptureRect(CGRectMake(0, 0, NAN, 1)));
        NSArray *elements = captureElementsAtPoint(1002, CGPointMake(-150, 130), CGRectMake(-180, 110, 100, 80), nil);
        assert(elements.count == 2); // Duplicate rects and cyclic parents do not repeat candidates.
        assert(NSEqualRects([elements[0][@"rect"] rectValue], NSMakeRect(-160, 120, 40, 24)));
        assert(NSEqualRects([elements[1][@"rect"] rectValue], NSMakeRect(-180, 110, 100, 80)));
        // Overlapping geometry alone cannot justify retaining an old element from another branch.
        NSArray *unrelated = @[@{@"rect":[NSValue valueWithRect:NSRectFromCGRect(target)], @"label":@"容器", @"element":(id)root}];
        assert(captureElementsKeepingLeaf(unrelated, elements, CGPointMake(-150, 130), target) == unrelated);
        hitContainer = YES; rootChildrenAvailable = YES;
        NSArray *containerHit = captureElementsAtPoint(1002, CGPointMake(-150, 130), target, nil);
        if (containerHit.count && argc > 1) {
            CIIPCapturePicker *preview = [[CIIPCapturePicker alloc] init]; preview.elementMode = YES; preview.desktopTop = 1000;
            preview.rect = NSRectToCGRect([containerHit[0][@"rect"] rectValue]);
            renderCaptureFrame(preview, [NSString stringWithUTF8String:argv[1]], @"container-hit.png");
            [preview release];
        }
        if (containerHit.count == 0 || !NSEqualRects([containerHit[0][@"rect"] rectValue], NSMakeRect(-160, 120, 40, 24))) fprintf(stderr, "container hit: first=%s candidates=%lu\n", [NSStringFromRect([containerHit.firstObject[@"rect"] rectValue]) UTF8String], (unsigned long)containerHit.count);
        assert(containerHit.count > 0 && NSEqualRects([containerHit[0][@"rect"] rectValue], NSMakeRect(-160, 120, 40, 24)));
        // A smaller direct sibling must not hide a still smaller descendant in another branch.
        overlappingBranches = YES;
        for (NSUInteger sameBounds = 0; sameBounds < 3; sameBounds++) {
            sameBoundsSibling = sameBounds == 1; equalAreaSibling = sameBounds == 2;
            for (NSUInteger reverse = 0; reverse < 2; reverse++) {
                reverseBranches = reverse != 0;
                NSArray *branchHit = captureElementsAtPoint(1002, CGPointMake(-150, 130), target, nil);
                if (branchHit.count && argc > 1) {
                    CIIPCapturePicker *preview = [[CIIPCapturePicker alloc] init]; preview.elementMode = YES; preview.desktopTop = 1000;
                    preview.rect = NSRectToCGRect([branchHit[0][@"rect"] rectValue]);
                    renderCaptureFrame(preview, [NSString stringWithUTF8String:argv[1]], [NSString stringWithFormat:@"branches-%lu-%lu.png", (unsigned long)sameBounds, (unsigned long)reverse]);
                    [preview release];
                }
                fprintf(stderr, "AX branches same-bounds=%lu reversed=%lu first=%s\n", (unsigned long)sameBounds, (unsigned long)reverse, NSStringFromRect([branchHit.firstObject[@"rect"] rectValue]).UTF8String);
                NSRect expected = equalAreaSibling ? NSMakeRect(-165, 115, 40, 24) : NSMakeRect(-160, 120, 40, 24);
                assert(branchHit.count > 0 && NSEqualRects([branchHit[0][@"rect"] rectValue], expected));
            }
        }
        overlappingBranches = sameBoundsSibling = equalAreaSibling = reverseBranches = NO;
        sameFrameDescendants = YES;
        NSArray *sameFrameHit = captureElementsAtPoint(1002, CGPointMake(-150, 130), target, nil);
        sameFrameDescendants = NO; framelessParent = YES;
        NSArray *framelessHit = captureElementsAtPoint(1002, CGPointMake(-150, 130), target, nil);
        framelessParent = NO;
        fprintf(stderr, "AX boundaries same-frame=%lu frameless-first=%s\n", (unsigned long)sameFrameHit.count, NSStringFromRect([framelessHit.firstObject[@"rect"] rectValue]).UTF8String);
        assert(sameFrameHit.count == 1 && NSEqualRects([sameFrameHit[0][@"rect"] rectValue], NSRectFromCGRect(target)));
        assert(framelessHit.count > 0 && NSEqualRects([framelessHit[0][@"rect"] rectValue], NSMakeRect(-160, 120, 40, 24)));
        rootChildrenAvailable = NO;
        assert(captureElementsAtPoint(1002, CGPointMake(-150, 130), target, nil).count == 0);
        hitContainer = NO; rootChildrenAvailable = NO;
        unavailable = YES;
        assert(captureElementsAtPoint(1002, CGPointMake(-150, 130), target, nil).count == 0);
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
        testCaptureAncestorVisual(argc > 1 ? [NSString stringWithUTF8String:argv[1]] : nil);
        testCaptureAncestorDwell(other, argc > 1 ? [NSString stringWithUTF8String:argv[1]] : nil);
        CFRelease(leaf); CFRelease(duplicate); CFRelease(parent); CFRelease(root); CFRelease(sibling);
        puts("PASS capture selection: window identity, AX bounds, clipping, hierarchy, unavailable target, cancellation, callback, native drawing");
    }
}
