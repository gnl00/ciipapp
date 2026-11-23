// Synthetic AppKit windows and direct event delivery; never injects desktop input.
#import <Cocoa/Cocoa.h>
#import <ApplicationServices/ApplicationServices.h>
#import <ImageIO/ImageIO.h>
#import <objc/runtime.h>
#include <assert.h>
#include <unistd.h>

static CGPoint mousePoint;
static NSDictionary *queryWindow;
static CGRect hitRect;
static pid_t hitPID;
static NSUInteger selectionCallbacks;
static CGRect callbackRect;
static uint32_t callbackWindow;
static int callbackCopyOnly;
static NSData *callbackPNG;
static NSString *callbackError;
static NSDictionary<NSNumber *, id> *snapshotFixtureFrames;
static void (^pendingSnapshot)(NSDictionary<NSNumber *, id> *, NSString *);
static NSArray<NSWindow *> *windowsToHideBeforeCallback;
static BOOL holdHit;
static dispatch_semaphore_t hitStarted, releaseHit;
static NSDictionary<NSNumber *, NSArray *> *layoutChildren;
static NSDictionary<NSNumber *, NSValue *> *layoutFrames;
static CFArrayRef dragWindowInfo(CGWindowListOption options, CGWindowID window);
static AXError dragHit(AXUIElementRef application, float x, float y, AXUIElementRef *element);
static AXError dragAttribute(AXUIElementRef element, CFStringRef attribute, CFTypeRef *value);
static AXError dragAttributeValues(AXUIElementRef element, CFStringRef attribute, CFIndex index, CFIndex count, CFArrayRef *values);
static AXError dragTimeout(AXUIElementRef element, float timeout) { return kAXErrorSuccess; }
#define CGWindowListCopyWindowInfo dragWindowInfo
#define AXUIElementCopyElementAtPosition dragHit
#define AXUIElementCopyAttributeValue dragAttribute
#define AXUIElementCopyAttributeValues dragAttributeValues
#define AXUIElementSetMessagingTimeout dragTimeout
#define ciip_capture_desktop_frames dragDesktopFrames
#include "../capture_selection_darwin.m"
#undef ciip_capture_desktop_frames

void dragDesktopFrames(NSArray<NSNumber *> *displayIDs, void (^completion)(NSDictionary<NSNumber *, id> *, NSString *)) {
    assert(!pendingSnapshot && [displayIDs count] == [snapshotFixtureFrames count]);
    pendingSnapshot = [completion copy];
}

void ciip_go_capture_selection(uintptr_t token, uint32_t window, double x, double y, double width, double height, int copyOnly) {
    for (NSWindow *overlay in windowsToHideBeforeCallback) assert(!overlay.visible);
    selectionCallbacks++; callbackWindow = window; callbackRect = CGRectMake(x, y, width, height); callbackCopyOnly = copyOnly;
}
void ciip_go_capture_area_image(uintptr_t token, double x, double y, double width, double height, int copyOnly,
    const void *png, size_t length, const char *error) {
    NSData *data = png ? [NSData dataWithBytes:png length:length] : nil;
    NSString *failure = error ? [NSString stringWithUTF8String:error] : nil;
    dispatch_async(dispatch_get_main_queue(), ^{
        [callbackPNG release]; callbackPNG = [data retain];
        [callbackError release]; callbackError = [failure copy];
        ciip_go_capture_selection(token, 0, x, y, width, height, copyOnly);
    });
}
static CFArrayRef dragWindowInfo(CGWindowListOption options, CGWindowID window) {
    return (CFArrayRef)[(queryWindow ? @[queryWindow] : @[]) retain];
}
static AXError dragHit(AXUIElementRef application, float x, float y, AXUIElementRef *element) {
    if (holdHit) { dispatch_semaphore_signal(hitStarted); dispatch_semaphore_wait(releaseHit, DISPATCH_TIME_FOREVER); }
    *element = AXUIElementCreateApplication(hitPID ?: getpid());
    return kAXErrorSuccess;
}
static AXError dragAttribute(AXUIElementRef element, CFStringRef attribute, CFTypeRef *value) {
    *value = NULL;
    pid_t pid = 0; AXUIElementGetPid(element, &pid);
    NSValue *frame = layoutFrames[@(pid)];
    NSArray *children = layoutChildren[@(pid)];
    CGRect rect = frame ? NSRectToCGRect(frame.rectValue) : children ? CGRectNull : hitRect;
    if (CFEqual(attribute, kAXPositionAttribute)) {
        if (CGRectIsNull(rect)) return kAXErrorNoValue;
        *value = AXValueCreate(kAXValueCGPointType, &rect.origin);
    }
    else if (CFEqual(attribute, kAXSizeAttribute)) {
        if (CGRectIsNull(rect)) return kAXErrorNoValue;
        *value = AXValueCreate(kAXValueCGSizeType, &rect.size);
    }
    else if (CFEqual(attribute, kAXRoleAttribute)) *value = CFRetain(kAXButtonRole);
    else if (CFEqual(attribute, kAXRoleDescriptionAttribute)) *value = CFRetain(CFSTR("按钮"));
    else if (CFEqual(attribute, kAXChildrenAttribute)) *value = (CFTypeRef)[(children ?: @[]) retain];
    else return kAXErrorNoValue;
    return kAXErrorSuccess;
}
static AXError dragAttributeValues(AXUIElementRef element, CFStringRef attribute, CFIndex index, CFIndex count, CFArrayRef *values) {
    *values = NULL;
    if (!CFEqual(attribute, kAXChildrenAttribute)) return kAXErrorAttributeUnsupported;
    assert(index == 0 && count <= 96);
    pid_t pid = 0; AXUIElementGetPid(element, &pid);
    NSArray *children = layoutChildren[@(pid)] ?: @[];
    *values = (CFArrayRef)[[children subarrayWithRange:NSMakeRange(0, MIN((NSUInteger)count, children.count))] retain];
    return kAXErrorSuccess;
}

@interface NSEvent (CIIPDragMouse)
+ (NSPoint)ciip_dragMouse;
@end
@implementation NSEvent (CIIPDragMouse)
+ (NSPoint)ciip_dragMouse { return NSPointFromCGPoint(mousePoint); }
@end

@interface CIIPDragProbe : CIIPCapturePicker
@property(nonatomic) NSUInteger confirmations, completions;
@property(nonatomic) BOOL accepted;
@property(nonatomic) CGRect completedRect;
@end
@implementation CIIPDragProbe
- (void)confirm {
    self.confirmations++;
    if (self.adjusting) [super confirm];
}
- (void)finish:(BOOL)accepted {
    if (self.finished) return;
    self.finished = YES; self.completions++; self.accepted = accepted; self.completedRect = self.rect;
    for (CIIPCaptureSelectionPanel *panel in self.panels) {
        CIIPCaptureSelectionView *view = (CIIPCaptureSelectionView *)panel.contentView;
        assert(!view.leftPressed && !view.rightPressed); [view stopSelectionAnimation];
    }
}
@end

static void drainFor(NSTimeInterval seconds) {
    [CATransaction flush]; NSDate *until = [NSDate dateWithTimeIntervalSinceNow:seconds];
    while (until.timeIntervalSinceNow > 0) [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode beforeDate:until];
}
static CGRect panelRect(NSPanel *panel, CGFloat top) {
    return CGRectMake(panel.frame.origin.x, top - NSMaxY(panel.frame), panel.frame.size.width, panel.frame.size.height);
}
static CIIPCapturePicker *pickerFixture(Class pickerClass) {
    CIIPCapturePicker *picker = [[pickerClass alloc] init]; picker.elementMode = YES;
    picker.desktopTop = NSMaxY(NSScreen.screens[0].frame); picker.selectionDuration = .12;
    NSRect work = NSScreen.screens[0].visibleFrame;
    NSRect frames[] = {NSMakeRect(work.origin.x + 40, work.origin.y + 60, 340, 220), NSMakeRect(-200, picker.desktopTop + 20, 200, 180)};
    for (NSUInteger i = 0; i < 2; i++) {
        NSPanel *panel = [[[CIIPCaptureSelectionPanel alloc] initWithContentRect:frames[i] styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel backing:NSBackingStoreBuffered defer:NO] autorelease];
        panel.releasedWhenClosed = NO; panel.hidesOnDeactivate = NO; panel.opaque = NO; panel.backgroundColor = NSColor.clearColor;
        CIIPCaptureSelectionView *view = [[[CIIPCaptureSelectionView alloc] initWithFrame:NSMakeRect(0, 0, frames[i].size.width, frames[i].size.height)] autorelease];
        view.picker = picker; panel.contentView = view; [picker.panels addObject:panel];
    }
    return picker;
}
static CIIPDragProbe *fixture(void) { return (CIIPDragProbe *)pickerFixture(CIIPDragProbe.class); }
static void closeFixture(CIIPDragProbe *picker) {
    for (NSPanel *panel in picker.panels) [panel close];
    [picker release];
}
static CGPoint pointInView(CIIPCaptureSelectionView *view, CGFloat x, CGFloat y) {
    CGRect rect = panelRect((NSPanel *)view.window, view.picker.desktopTop);
    return CGPointMake(rect.origin.x + x, rect.origin.y + y);
}
static NSEvent *mouse(CIIPCaptureSelectionView *view, NSEventType type, CGPoint point) {
    mousePoint = CGPointMake(point.x, view.picker.desktopTop - point.y);
    NSPoint local = [view.window convertPointFromScreen:NSPointFromCGPoint(mousePoint)];
    return [NSEvent mouseEventWithType:type location:local modifierFlags:0 timestamp:0 windowNumber:view.window.windowNumber context:nil eventNumber:1 clickCount:1 pressure:0];
}
static NSEvent *key(unsigned short code) {
    return [NSEvent keyEventWithType:NSEventTypeKeyDown location:NSZeroPoint modifierFlags:0 timestamp:0 windowNumber:0 context:nil characters:@"" charactersIgnoringModifiers:@"" isARepeat:NO keyCode:code];
}
static void drag(CIIPCaptureSelectionView *view, CGPoint start, CGPoint end) {
    [view mouseDown:mouse(view, NSEventTypeLeftMouseDown, start)];
    [view mouseDragged:mouse(view, NSEventTypeLeftMouseDragged, end)];
    [view mouseUp:mouse(view, NSEventTypeLeftMouseUp, end)];
}
static void renderFrame(CIIPCaptureSelectionView *view, NSString *directory) {
    if (!directory) return;
    CGFloat scale = view.window.backingScaleFactor;
    NSBitmapImageRep *rep = [[[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:view.bounds.size.width * scale pixelsHigh:view.bounds.size.height * scale bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0] autorelease];
    NSGraphicsContext *context = [NSGraphicsContext graphicsContextWithBitmapImageRep:rep];
    CGContextScaleCTM(context.CGContext, scale, scale); [(view.layer.presentationLayer ?: view.layer) renderInContext:context.CGContext];
    assert([[rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:[directory stringByAppendingPathComponent:@"drag-selection.png"] atomically:YES]);
}
static void testClickAndDrag(NSString *directory) {
    CIIPDragProbe *picker = fixture(); CIIPCaptureSelectionView *view = [picker.panels[0] contentView];
    CGPoint start = pointInView(view, 60, 55), end = pointInView(view, 240, 155);
    picker.rect = CGRectMake(start.x - 10, start.y - 10, 40, 30);
    CGRect leaf = picker.rect;
    [view mouseDown:mouse(view, NSEventTypeLeftMouseDown, start)];
    [view mouseDragged:mouse(view, NSEventTypeLeftMouseDragged, CGPointMake(start.x + 2, start.y + 1))];
    assert(picker.trackingSelection && !picker.draggingSelection && CGRectEqualToRect(picker.rect, leaf));
    [view mouseDragged:mouse(view, NSEventTypeLeftMouseDragged, CGPointMake(start.x + 3, start.y))];
    assert(!picker.draggingSelection && CGRectEqualToRect(picker.rect, leaf));
    [view mouseUp:mouse(view, NSEventTypeLeftMouseUp, start)];
    assert(picker.confirmations == 1 && picker.completions == 0 && !picker.trackingSelection);
    [view mouseDown:mouse(view, NSEventTypeLeftMouseDown, start)];
    [view mouseDragged:mouse(view, NSEventTypeLeftMouseDragged, CGPointMake(start.x + 4, start.y + 1))];
    assert(picker.draggingSelection);
    [view mouseDragged:mouse(view, NSEventTypeLeftMouseDragged, end)];
    CGRect expected = CGRectMake(start.x, start.y, 180, 100);
    assert(picker.draggingSelection && !picker.pending && !picker.targetWindow && CGRectEqualToRect(picker.rect, expected));
    [view keyDown:key(36)]; assert(picker.completions == 0); // No teardown while the button is held.
    view.layer.backgroundColor = [NSColor colorWithWhite:.95 alpha:1].CGColor;
    [view.window orderFrontRegardless]; [view.window display]; drainFor(.03);
    CAShapeLayer *outline = (CAShapeLayer *)view.layer.sublayers[1];
    CGRect local = CGRectMake(60, 65, 180, 100);
    assert(CGRectEqualToRect(CGPathGetBoundingBox(outline.path), CGRectInset(local, 1, 1)));
    assert(![outline animationForKey:@"path"]); // Dragging always displays the exact latest frame.
    CATextLayer *dimensions = (CATextLayer *)[view.layer.sublayers[2] sublayers][0];
    NSString *label = [dimensions.string string];
    assert([label isEqualToString:view.window.backingScaleFactor == 2 ? @"360 × 200 px" : @"180 × 100 px"]);
    [view mouseUp:mouse(view, NSEventTypeLeftMouseUp, end)];
    assert(picker.adjusting && picker.completions == 0 && CGRectEqualToRect(picker.rect, expected));
    assert(outline.lineDashPattern.count >= 2);
    renderFrame(view, directory);
    [view keyDown:key(36)];
    assert(picker.completions == 1 && picker.accepted && CGRectEqualToRect(picker.completedRect, expected));
    [view mouseUp:mouse(view, NSEventTypeLeftMouseUp, end)]; assert(picker.completions == 1);
    closeFixture(picker);
}
static void testReverseAndDesktopClip(void) {
    CIIPDragProbe *picker = fixture(); CIIPCaptureSelectionView *view = [picker.panels[0] contentView];
    CGPoint start = pointInView(view, 240, 155), end = pointInView(view, 60, 55);
    [view mouseDown:mouse(view, NSEventTypeLeftMouseDown, start)]; [view mouseDragged:mouse(view, NSEventTypeLeftMouseDragged, end)];
    assert(CGRectEqualToRect(picker.rect, CGRectMake(end.x, end.y, 180, 100)));
    [view mouseUp:mouse(view, NSEventTypeLeftMouseUp, end)];
    assert(picker.adjusting && picker.completions == 0);
    [view keyDown:key(36)]; assert(picker.accepted);
    closeFixture(picker);
    picker = fixture(); view = [picker.panels[0] contentView];
    start = pointInView(view, 60, 55); end = pointInView(view, 240, 155);
    [view mouseDown:mouse(view, NSEventTypeLeftMouseDown, start)]; [view mouseUp:mouse(view, NSEventTypeLeftMouseUp, end)];
    assert(picker.adjusting && picker.completions == 0);
    [view keyDown:key(36)];
    assert(picker.accepted && CGRectEqualToRect(picker.completedRect, CGRectMake(start.x, start.y, 180, 100)));
    closeFixture(picker);
    picker = fixture(); view = [picker.panels[1] contentView];
    CGRect desktop = CGRectUnion(panelRect(picker.panels[0], picker.desktopTop), panelRect(picker.panels[1], picker.desktopTop));
    start = CGPointMake(-150, -150); end = CGPointMake(CGRectGetMaxX(desktop) + 50, CGRectGetMaxY(desktop) + 50);
    [view mouseDown:mouse(view, NSEventTypeLeftMouseDown, start)]; [view mouseDragged:mouse(view, NSEventTypeLeftMouseDragged, end)];
    CGRect expected = CGRectMake(-150, -150, CGRectGetMaxX(desktop) + 150, CGRectGetMaxY(desktop) + 150);
    assert(CGRectEqualToRect(picker.rect, expected) && picker.rect.origin.x < 0 && picker.rect.origin.y < 0);
    [view mouseUp:mouse(view, NSEventTypeLeftMouseUp, end)];
    assert(picker.adjusting && picker.completions == 0);
    [view keyDown:key(36)]; assert(picker.accepted);
    closeFixture(picker);
}
static void testCancellation(void) {
    for (NSUInteger mode = 0; mode < 3; mode++) {
        CIIPDragProbe *picker = fixture(); CIIPCaptureSelectionView *view = [picker.panels[0] contentView];
        CGPoint start = pointInView(view, 60, 55), end = pointInView(view, 240, 155);
        [view mouseDown:mouse(view, NSEventTypeLeftMouseDown, start)]; [view mouseDragged:mouse(view, NSEventTypeLeftMouseDragged, end)];
        if (!mode) [view keyDown:key(53)]; else [view rightMouseDown:mouse(view, NSEventTypeRightMouseDown, end)];
        assert(picker.completions == 0);
        if (mode == 1) { [view rightMouseUp:mouse(view, NSEventTypeRightMouseUp, end)]; assert(picker.completions == 0); }
        [view mouseUp:mouse(view, NSEventTypeLeftMouseUp, end)];
        if (mode == 2) { assert(picker.completions == 0); [view rightMouseUp:mouse(view, NSEventTypeRightMouseUp, end)]; }
        assert(picker.completions == 1 && !picker.accepted);
        closeFixture(picker);
    }
    CIIPDragProbe *picker = fixture();
    CIIPCaptureSelectionView *view = [picker.panels[0] contentView];
    CGPoint start = pointInView(view, 60, 55), end = pointInView(view, 240, 155);
    drag(view, start, end);
    assert(picker.adjusting && picker.completions == 0);
    [view keyDown:key(53)];
    assert(picker.completions == 1 && !picker.accepted && !picker.copyOnly);
    closeFixture(picker);
}
static void testLateAXDoesNotReplaceDrag(void) {
    CIIPDragProbe *picker = fixture(); CIIPCaptureSelectionView *view = [picker.panels[0] contentView];
    CGRect frame = panelRect(picker.panels[0], picker.desktopTop);
    CFDictionaryRef bounds = CGRectCreateDictionaryRepresentation(frame);
    queryWindow = [@{(id)kCGWindowNumber:@77, (id)kCGWindowOwnerPID:@(getpid()), (id)kCGWindowOwnerName:@"Synthetic QA", (id)kCGWindowAlpha:@1, (id)kCGWindowBounds:(id)bounds} retain];
    CFRelease(bounds);
    CGPoint start = pointInView(view, 60, 55), end = pointInView(view, 240, 155);
    hitRect = CGRectMake(start.x - 5, start.y - 5, 20, 20); holdHit = YES;
    hitStarted = dispatch_semaphore_create(0); releaseHit = dispatch_semaphore_create(0);
    mousePoint = CGPointMake(start.x, picker.desktopTop - start.y); [picker sample];
    NSDate *until = [NSDate dateWithTimeIntervalSinceNow:2];
    BOOL started = NO;
    while (until.timeIntervalSinceNow > 0) {
        if (!dispatch_semaphore_wait(hitStarted, DISPATCH_TIME_NOW)) { started = YES; break; }
        drainFor(.001);
    }
    assert(started && picker.querying);
    [view mouseDown:mouse(view, NSEventTypeLeftMouseDown, start)]; [view mouseDragged:mouse(view, NSEventTypeLeftMouseDragged, end)];
    CGRect expected = picker.rect;
    mousePoint = CGPointMake(50000, 50000); [picker sample]; assert(CGRectEqualToRect(picker.rect, expected));
    [view mouseUp:mouse(view, NSEventTypeLeftMouseUp, end)];
    assert(picker.adjusting && picker.completions == 0);
    holdHit = NO; dispatch_semaphore_signal(releaseHit);
    until = [NSDate dateWithTimeIntervalSinceNow:2];
    while (picker.querying && until.timeIntervalSinceNow > 0) drainFor(.001);
    assert(!picker.querying && picker.adjusting && !picker.pending && !picker.targetWindow && CGRectEqualToRect(picker.rect, expected));
    [view keyDown:key(36)]; assert(picker.accepted && CGRectEqualToRect(picker.completedRect, expected));
    [queryWindow release]; queryWindow = nil;
    dispatch_release(hitStarted); dispatch_release(releaseHit); closeFixture(picker);
}
static void awaitMeasurementHit(CIIPCapturePicker *picker) {
    NSDate *until = [NSDate dateWithTimeIntervalSinceNow:2];
    while (picker.querying && until.timeIntervalSinceNow > 0) drainFor(.001);
    assert(!picker.querying && !picker.pending);
}
static NSButton *adjustmentButton(NSView *view, NSString *identifier) {
    if ([view isKindOfClass:NSButton.class] && [view.identifier isEqualToString:identifier]) return (NSButton *)view;
    for (NSView *subview in view.subviews) {
        NSButton *button = adjustmentButton(subview, identifier);
        if (button) return button;
    }
    return nil;
}
static CGImageRef frozenFixtureImage(void) {
    CGColorSpaceRef colorSpace = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    CGContextRef context = CGBitmapContextCreate(NULL, 128, 128, 8, 0, colorSpace, kCGImageAlphaPremultipliedLast);
    CGColorSpaceRelease(colorSpace);
    assert(context);
    CGContextSetRGBFillColor(context, 1, 0, 0, 1);
    CGContextFillRect(context, CGRectMake(0, 0, 128, 128));
    CGImageRef image = CGBitmapContextCreateImage(context);
    CGContextRelease(context);
    return image;
}
static void finishSnapshotFixture(void) {
    assert(pendingSnapshot);
    void (^completion)(NSDictionary<NSNumber *, id> *, NSString *) = pendingSnapshot;
    pendingSnapshot = nil;
    completion(snapshotFixtureFrames, nil);
    [completion release];
}
static void testFrozenAreaSession(void) {
    CGImageRef image = frozenFixtureImage();
    NSMutableDictionary *frames = [NSMutableDictionary dictionary];
    for (NSScreen *screen in NSScreen.screens)
        frames[screen.deviceDescription[@"NSScreenNumber"]] = (id)image;
    CGImageRelease(image);
    snapshotFixtureFrames = frames;
    NSUInteger callbacks = selectionCallbacks;
    assert(ciip_start_capture_selection(401, 3, .12, 0));
    assert(activeCapturePicker && !activeCapturePicker.panels.count && selectionCallbacks == callbacks);
    ciip_cancel_capture_selection(401);
    assert(!activeCapturePicker && selectionCallbacks == callbacks + 1);
    finishSnapshotFixture();
    assert(!activeCapturePicker && selectionCallbacks == ++callbacks);

    assert(ciip_start_capture_selection(402, 3, .12, 0));
    assert(activeCapturePicker && !activeCapturePicker.panels.count);
    finishSnapshotFixture();
    CIIPCapturePicker *picker = activeCapturePicker;
    assert(picker.panels.count == frames.count && picker.frozenFrames == frames);
    CIIPCaptureSelectionView *view = [[[picker.panels.firstObject contentView] retain] autorelease];
    assert(view.window.isOpaque && !view.window.ignoresMouseEvents);
    CALayer *snapshot = view.layer.sublayers.firstObject;
    assert(snapshot.contents == (id)image);
    CGPoint start = pointInView(view, 40, 40), end = pointInView(view, 140, 120);
    drag(view, start, end);
    assert(picker.adjusting && snapshot.contents == (id)image);
    windowsToHideBeforeCallback = [NSArray arrayWithArray:picker.panels];
    [adjustmentButton(view, @"capture-copy") performClick:nil];
    NSDate *until = [NSDate dateWithTimeIntervalSinceNow:2];
    while (selectionCallbacks == callbacks && until.timeIntervalSinceNow > 0) drainFor(.005);
    windowsToHideBeforeCallback = nil;
    assert(selectionCallbacks == callbacks + 1 && !activeCapturePicker && !callbackError && callbackPNG.length > 0);
    assert(callbackCopyOnly && CGRectEqualToRect(callbackRect, CGRectIntegral(CGRectMake(start.x, start.y, 100, 80))));
    CGImageSourceRef source = CGImageSourceCreateWithData((CFDataRef)callbackPNG, NULL);
    CGImageRef cropped = source ? CGImageSourceCreateImageAtIndex(source, 0, NULL) : NULL;
    assert(cropped);
    uint8_t pixel[4];
    CGColorSpaceRef colorSpace = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    CGContextRef context = CGBitmapContextCreate(pixel, 1, 1, 8, 4, colorSpace, kCGImageAlphaPremultipliedLast);
    assert(context);
    CGContextDrawImage(context, CGRectMake(0, 0, 1, 1), cropped);
    assert(pixel[0] == 255 && pixel[1] == 0 && pixel[2] == 0 && pixel[3] == 255);
    CGContextRelease(context); CGColorSpaceRelease(colorSpace); CGImageRelease(cropped); CFRelease(source);
    [callbackPNG release]; callbackPNG = nil; snapshotFixtureFrames = nil;
}
static void testAreaAdjustment(void) {
    CIIPCapturePicker *picker = pickerFixture(CIIPCapturePicker.class);
    picker.areaMode = YES; picker.elementMode = NO;
    CIIPCaptureSelectionView *view = [[[picker.panels[0] contentView] retain] autorelease];
    NSUInteger callbacks = selectionCallbacks;
    [view keyDown:key(36)];
    assert(!picker.adjusting && !picker.finished && selectionCallbacks == callbacks);

    CGPoint start = pointInView(view, 60, 55);
    drag(view, start, pointInView(view, 220, 125));
    assert(picker.adjusting && !picker.finished && selectionCallbacks == callbacks);
    assert(CGRectEqualToRect(picker.rect, CGRectMake(start.x, start.y, 160, 70)));

    CGPoint moved = pointInView(view, 80, 65);
    drag(view, pointInView(view, 140, 90), pointInView(view, 160, 100));
    assert(CGRectEqualToRect(picker.rect, CGRectMake(moved.x, moved.y, 160, 70)));
    drag(view, pointInView(view, 240, 100), pointInView(view, 250, 100));
    assert(CGRectEqualToRect(picker.rect, CGRectMake(moved.x, moved.y, 170, 70)));
    CGPoint resized = pointInView(view, 65, 50);
    drag(view, moved, resized);
    assert(CGRectEqualToRect(picker.rect, CGRectMake(resized.x, resized.y, 185, 85)));

    CGPoint redrawn = pointInView(view, 20, 170);
    drag(view, redrawn, pointInView(view, 55, 204));
    CGRect expected = CGRectMake(redrawn.x, redrawn.y, 35, 34);
    assert(picker.adjusting && CGRectEqualToRect(picker.rect, expected));
    assert(!picker.finished && selectionCallbacks == callbacks);
    NSButton *copy = adjustmentButton(view, @"capture-copy");
    assert(copy && copy.enabled && ![copy isHiddenOrHasHiddenAncestor]);
    [copy performClick:nil];
    assert(picker.finished && !picker.panels.count && selectionCallbacks == callbacks + 1);
    assert(callbackCopyOnly && callbackWindow == 0 && CGRectEqualToRect(callbackRect, expected));
}
static void testPreparedToolbarRouting(CIIPCaptureSelectionView *view, NSWindow *toolbar) {
    NSWindow *overlay = view.window;
    NSPoint overToolbar = NSMakePoint(NSMidX(toolbar.frame), NSMidY(toolbar.frame));
    NSPoint overOverlay = NSMakePoint(NSMinX(overlay.frame) + 2, NSMaxY(overlay.frame) - 2);
    NSPanel *marker = [[[NSPanel alloc] initWithContentRect:NSMakeRect(overOverlay.x, overOverlay.y, 1, 1)
        styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel backing:NSBackingStoreBuffered defer:NO] autorelease];
    marker.releasedWhenClosed = NO; marker.ignoresMouseEvents = YES; marker.level = toolbar.level + 1;
    marker.collectionBehavior = overlay.collectionBehavior; [marker orderFrontRegardless];
    NSDate *until = [NSDate dateWithTimeIntervalSinceNow:1];
    NSInteger toolbarHit = 0, overlayHit = 0;
    while (until.timeIntervalSinceNow > 0) {
        drainFor(.02);
        toolbarHit = [NSWindow windowNumberAtPoint:overToolbar belowWindowWithWindowNumber:marker.windowNumber];
        overlayHit = [NSWindow windowNumberAtPoint:overOverlay belowWindowWithWindowNumber:marker.windowNumber];
        if (toolbarHit == toolbar.windowNumber && overlayHit == overlay.windowNumber) break;
    }
    if (toolbarHit != toolbar.windowNumber || overlayHit != overlay.windowNumber)
        fprintf(stderr, "selection routing: toolbar hit=%ld/%ld level=%ld, overlay hit=%ld/%ld level=%ld\n",
            (long)toolbarHit, (long)toolbar.windowNumber, (long)toolbar.level,
            (long)overlayHit, (long)overlay.windowNumber, (long)overlay.level);
    assert(toolbarHit == toolbar.windowNumber && overlayHit == overlay.windowNumber);
    [marker close];
    CGPoint point = CGPointMake(overToolbar.x, view.picker.desktopTop - overToolbar.y);
    CGPoint outside = CGPointMake(overOverlay.x, view.picker.desktopTop - overOverlay.y);
    [view mouseMoved:mouse(view, NSEventTypeMouseMoved, outside)];
    assert(NSCursor.currentCursor == NSCursor.crosshairCursor);
    [view mouseMoved:mouse(view, NSEventTypeMouseMoved, point)];
    assert(NSCursor.currentCursor == NSCursor.arrowCursor && "selection overlay must hand the cursor off at the toolbar");
    [NSCursor.pointingHandCursor set];
    [view mouseMoved:mouse(view, NSEventTypeMouseMoved, point)];
    assert(NSCursor.currentCursor == NSCursor.pointingHandCursor && "selection overlay must preserve the toolbar's hover cursor");
    CGRect selection = view.picker.rect;
    CGPoint edge = CGPointMake(CGRectGetMaxX(selection), CGRectGetMidY(selection));
    CGPoint resized = CGPointMake(edge.x + 18, edge.y);
    drag(view, edge, resized);
    assert(CGRectGetMaxX(view.picker.rect) == resized.x);
    NSCursor *resizeCursor = captureAdjustmentCursor(CIIPCaptureEdgeRight, NO, NO);
    assert(NSCursor.currentCursor == resizeCursor);
    // The exit is delivered to the overlay and may still carry its last edge
    // location. Subsequent mouseMoved events go directly to the toolbar.
    [view mouseExited:mouse(view, NSEventTypeMouseMoved, resized)];
    assert(NSCursor.currentCursor == NSCursor.arrowCursor && "leaving the resized selection must release its cursor");
    NSEvent *queuedEdgeMove = mouse(view, NSEventTypeMouseMoved, resized);
    mousePoint = NSPointToCGPoint(overToolbar);
    [view mouseMoved:queuedEdgeMove];
    assert(NSCursor.currentCursor == NSCursor.arrowCursor && "a queued edge move must not take the toolbar cursor");
    assert(!toolbar.isKeyWindow);
    // AppKit can route the event to the toolbar before the live location agrees.
    mousePoint = NSPointToCGPoint(overOverlay);
    [resizeCursor set];
    [view.picker updateQuickToolbarCursorForWindow:toolbar];
    assert(NSCursor.currentCursor == NSCursor.arrowCursor && "non-key toolbar must replace the stale resize cursor on arrival");
    [NSCursor.pointingHandCursor set];
    [view.picker updateQuickToolbarCursorForWindow:toolbar];
    assert(NSCursor.currentCursor == NSCursor.pointingHandCursor && "toolbar must preserve the button's hover cursor");
    [view mouseEntered:mouse(view, NSEventTypeMouseMoved, resized)];
    assert(NSCursor.currentCursor == resizeCursor && "reentering the overlay must restore its resize cursor");
    [view.picker updateQuickToolbarCursorForWindow:view.window];
    assert(NSCursor.currentCursor == resizeCursor && "overlay mouse moves must leave its resize cursor in place");
    drag(view, resized, edge);
    assert(CGRectEqualToRect(view.picker.rect, selection));
}

static NSWindow *prepareToolbarFixture(CIIPCapturePicker *picker) {
    NSWindow *overlay = picker.panels[0];
    overlay.level = NSScreenSaverWindowLevel;
    [overlay orderFrontRegardless];
    NSWindow *toolbar = [[[NSPanel alloc] initWithContentRect:NSMakeRect(0, 0, 220, 48) styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel
        backing:NSBackingStoreBuffered defer:NO] autorelease];
    toolbar.releasedWhenClosed = NO;
    toolbar.level = NSFloatingWindowLevel;
    picker.quickToolbar = toolbar;
    picker.quickToolbarLevel = toolbar.level;
    picker.quickToolbarBehavior = toolbar.collectionBehavior;
    picker.quickToolbarAcceptedMouseMoves = toolbar.acceptsMouseMovedEvents;
    assert(!activeCapturePicker);
    activeCapturePicker = picker;
    return toolbar;
}
static void testPreparedToolbarAdjustment(BOOL copyOnly) {
    CIIPCapturePicker *picker = pickerFixture(CIIPCapturePicker.class);
    picker.areaMode = YES; picker.elementMode = NO;
    CIIPCaptureSelectionView *view = [[[picker.panels[0] contentView] retain] autorelease];
    NSRect display = view.window.frame;
    NSWindow *toolbar = prepareToolbarFixture(picker);
    NSRect originalFrame = toolbar.frame;
    NSInteger originalLevel = toolbar.level;
    NSUInteger callbacks = selectionCallbacks;
    assert(!toolbar.visible);
    assert(!ciip_submit_capture_toolbar((uintptr_t)toolbar, 1));

    CGPoint start = pointInView(view, 60, 25);
    drag(view, start, pointInView(view, 220, 95));
    assert(picker.adjusting && toolbar.visible && toolbar.level > view.window.level);
    assert(!NSEqualRects(toolbar.frame, originalFrame) && NSContainsRect(display, toolbar.frame));
    assert(NSHeight(toolbar.frame) == 90 && toolbar.acceptsMouseMovedEvents);
    assert(!NSIntersectsRect(toolbar.frame, NSMakeRect(NSMinX(display) + 60, NSMaxY(display) - 95, 160, 70)));
    assert(!adjustmentButton(view, @"capture-copy") && !adjustmentButton(view, @"capture-confirm"));
    NSVisualEffectView *material = (NSVisualEffectView *)toolbar.contentView.subviews.firstObject;
    assert([material isKindOfClass:NSVisualEffectView.class] && material.blendingMode == NSVisualEffectBlendingModeBehindWindow);
    testPreparedToolbarRouting(view, toolbar);

    assert(!ciip_submit_capture_toolbar((uintptr_t)view.window, 1));
    assert(!ciip_submit_capture_toolbar((uintptr_t)toolbar, 3));
    assert(!picker.finished && selectionCallbacks == callbacks);

    CGPoint moveStart = pointInView(view, 140, 60), moveEnd = pointInView(view, 160, 70);
    [view mouseDown:mouse(view, NSEventTypeLeftMouseDown, moveStart)];
    [view mouseDragged:mouse(view, NSEventTypeLeftMouseDragged, moveEnd)];
    assert(!toolbar.visible);
    assert(!ciip_submit_capture_toolbar((uintptr_t)toolbar, 1));
    assert(!picker.finished && selectionCallbacks == callbacks);
    [view mouseUp:mouse(view, NSEventTypeLeftMouseUp, moveEnd)];
    assert(toolbar.visible && NSContainsRect(display, toolbar.frame));

    windowsToHideBeforeCallback = [picker.panels arrayByAddingObject:toolbar];
    assert(ciip_submit_capture_toolbar((uintptr_t)toolbar, copyOnly ? 1 : 0));
    windowsToHideBeforeCallback = nil;
    assert(picker.finished && !activeCapturePicker && selectionCallbacks == callbacks + 1);
    assert(callbackCopyOnly == copyOnly && callbackWindow == 0 &&
        CGRectEqualToRect(callbackRect, CGRectMake(start.x + 20, start.y + 10, 160, 70)));
    assert(!toolbar.visible && toolbar.level == originalLevel && !toolbar.acceptsMouseMovedEvents);
    assert(!ciip_submit_capture_toolbar((uintptr_t)toolbar, 1) && selectionCallbacks == callbacks + 1);
    [toolbar close];
}
static void testAdjustmentCursors(void) {
    assert(captureAdjustmentCursor(CIIPCaptureEdgeNone, NO, NO) == NSCursor.crosshairCursor);
    assert(captureAdjustmentCursor(CIIPCaptureEdgeNone, YES, NO) == NSCursor.openHandCursor);
    assert(captureAdjustmentCursor(CIIPCaptureEdgeNone, YES, YES) == NSCursor.closedHandCursor);
    NSCursor *horizontal = captureAdjustmentCursor(CIIPCaptureEdgeLeft, YES, NO);
    NSCursor *vertical = captureAdjustmentCursor(CIIPCaptureEdgeTop, YES, NO);
    assert(horizontal && vertical && horizontal != vertical && horizontal != NSCursor.crosshairCursor && vertical != NSCursor.crosshairCursor);
    CIIPCaptureEdge corners[] = {CIIPCaptureEdgeTop | CIIPCaptureEdgeLeft, CIIPCaptureEdgeTop | CIIPCaptureEdgeRight,
        CIIPCaptureEdgeBottom | CIIPCaptureEdgeLeft, CIIPCaptureEdgeBottom | CIIPCaptureEdgeRight};
    for (NSUInteger i = 0; i < 4; i++) {
        NSCursor *cursor = captureAdjustmentCursor(corners[i], YES, NO);
        assert(cursor && cursor != NSCursor.crosshairCursor && cursor != NSCursor.openHandCursor);
    }
}
static void testElementClickAdjustment(void) {
    CIIPCapturePicker *picker = pickerFixture(CIIPCapturePicker.class);
    CIIPCaptureSelectionView *view = [[[picker.panels[0] contentView] retain] autorelease];
    CFDictionaryRef bounds = CGRectCreateDictionaryRepresentation(panelRect(picker.panels[0], picker.desktopTop));
    queryWindow = [@{(id)kCGWindowNumber:@77, (id)kCGWindowOwnerPID:@(getpid()), (id)kCGWindowOwnerName:@"Synthetic QA", (id)kCGWindowAlpha:@1, (id)kCGWindowBounds:(id)bounds} retain];
    CFRelease(bounds);
    NSUInteger callbacks = selectionCallbacks;
    CGPoint start = pointInView(view, 80, 65);
    hitRect = CGRectMake(start.x - 20, start.y - 15, 40, 30);
    CGRect expected = hitRect;
    [view mouseMoved:mouse(view, NSEventTypeMouseMoved, start)];
    awaitMeasurementHit(picker);
    drag(view, start, pointInView(view, 120, 65));
    assert(!picker.adjusting && !picker.draggingSelection && selectionCallbacks == callbacks);
    [view mouseMoved:mouse(view, NSEventTypeMouseMoved, start)];
    awaitMeasurementHit(picker);
    assert(CGRectEqualToRect(picker.rect, expected));
    [view mouseDown:mouse(view, NSEventTypeLeftMouseDown, start)];
    [view mouseUp:mouse(view, NSEventTypeLeftMouseUp, start)];
    assert(picker.adjusting && !picker.finished && selectionCallbacks == callbacks);
    [queryWindow release]; queryWindow = nil;
    [view mouseMoved:mouse(view, NSEventTypeMouseMoved, pointInView(view, 240, 150))];
    assert(!picker.querying && CGRectEqualToRect(picker.rect, expected));
    NSButton *confirm = adjustmentButton(view, @"capture-confirm");
    assert(confirm && confirm.enabled && ![confirm isHiddenOrHasHiddenAncestor]);
    [confirm performClick:nil];
    assert(picker.finished && !picker.panels.count && selectionCallbacks == callbacks + 1);
    assert(!callbackCopyOnly && CGRectEqualToRect(callbackRect, expected));
}
static void testLayoutCollection(void) {
    pid_t base = getpid() + 30;
    NSMutableArray *nodes = [NSMutableArray array];
    for (NSUInteger i = 0; i < 8; i++) {
        AXUIElementRef element = AXUIElementCreateApplication(base + (pid_t)i);
        [nodes addObject:(id)element]; CFRelease(element);
    }
    CGRect container = CGRectMake(-100, 30, 100, 100), clip = CGRectMake(-100, 30, 60, 100);
    NSValue *containerValue = [NSValue valueWithRect:NSRectFromCGRect(container)];
    NSValue *first = [NSValue valueWithRect:NSMakeRect(-90, 40, 20, 10)];
    NSValue *partiallyVisible = [NSValue valueWithRect:NSMakeRect(-50, 65, 22, 10)];
    layoutFrames = @{@(base): containerValue, @(base + 1): containerValue,
        @(base + 3): first, @(base + 4): first, @(base + 5): partiallyVisible,
        @(base + 6): [NSValue valueWithRect:NSMakeRect(-30, 65, 10, 10)],
        @(base + 7): [NSValue valueWithRect:NSMakeRect(-110, 65, 20, 10)]};
    layoutChildren = @{@(base): @[nodes[1], nodes[6], nodes[7], @"not an AX node"],
        @(base + 1): @[nodes[2], nodes[0]], @(base + 2): @[nodes[3], nodes[4], nodes[5]]};
    NSArray *result = captureLayoutChildren((AXUIElementRef)nodes[0], container, clip);
    assert(([result isEqualToArray:@[first, partiallyVisible]]));
    layoutChildren = nil; layoutFrames = nil;
}
static void testMeasurementSession(void) {
    CIIPCapturePicker *picker = pickerFixture(CIIPCapturePicker.class); picker.measurementMode = YES; picker.selectionDuration = 0;
    CIIPCaptureSelectionView *view = [[[picker.panels[0] contentView] retain] autorelease];
    CGRect frame = panelRect(picker.panels[0], picker.desktopTop);
    CGRect targetWindowFrame = CGRectMake(frame.origin.x + 40, frame.origin.y, frame.size.width - 40, frame.size.height);
    CFDictionaryRef bounds = CGRectCreateDictionaryRepresentation(targetWindowFrame);
    queryWindow = [@{(id)kCGWindowNumber:@77, (id)kCGWindowOwnerPID:@(getpid()), (id)kCGWindowOwnerName:@"Synthetic QA", (id)kCGWindowAlpha:@1, (id)kCGWindowBounds:(id)bounds} retain];
    CFRelease(bounds);
    CGPoint first = pointInView(view, 100, 140), second = pointInView(view, 260, 140);
    hitRect = CGRectMake(frame.origin.x + 30, first.y - 60, 120, 120);
    CGRect reference = hitRect;
    pid_t childPID = getpid() + 20;
    AXUIElementRef child = AXUIElementCreateApplication(childPID);
    NSValue *childFrame = [NSValue valueWithRect:NSMakeRect(frame.origin.x + 53, first.y - 20, 36, 40)];
    layoutFrames = @{@(getpid()): [NSValue valueWithRect:NSRectFromCGRect(reference)], @(childPID): childFrame};
    layoutChildren = @{@(getpid()): @[(id)child]}; CFRelease(child);
    [view mouseMoved:mouse(view, NSEventTypeMouseMoved, first)];
    awaitMeasurementHit(picker);
    assert(CGRectEqualToRect([picker measurementFrame], reference) && picker.rect.size.width == 110);
    NSDate *until = [NSDate dateWithTimeIntervalSinceNow:2];
    while (!picker.measurementLayoutChildren.count && until.timeIntervalSinceNow > 0) drainFor(.001);
    assert(!picker.measurementLayoutQuerying && [picker.measurementLayoutChildren isEqualToArray:@[childFrame]]);
    CALayer *measurement = view.layer.sublayers[2];
    CALayer *layout = measurement.sublayers[measurement.sublayers.count - 2];
    CAShapeLayer *childBoxes = (CAShapeLayer *)layout.sublayers[0];
    CAShapeLayer *spacingLines = (CAShapeLayer *)layout.sublayers[1];
    assert(!layout.hidden && CGRectEqualToRect(CGPathGetBoundingBox(childBoxes.path), CGRectMake(53, 60, 36, 40)));
    assert(!CGPathIsEmpty(spacingLines.path));
    BOOL showsChildSize = NO, showsGap = NO;
    for (CALayer *badge in layout.sublayers[2].sublayers) {
        if (badge.hidden) continue;
        CATextLayer *text = (CATextLayer *)badge.sublayers.firstObject;
        NSString *label = [text.string string];
        showsChildSize |= [label isEqualToString:@"36 × 40 pt"];
        showsGap |= [label isEqualToString:@"40 pt"];
    }
    assert(showsChildSize && showsGap);
    CATextLayer *dimensions = (CATextLayer *)[view.layer.sublayers.lastObject sublayers].firstObject;
    assert([[dimensions.string string] isEqualToString:@"120 × 120 pt"]);
    [view mouseDown:mouse(view, NSEventTypeLeftMouseDown, first)];
    [view mouseUp:mouse(view, NSEventTypeLeftMouseUp, first)];
    assert(picker.measurementReference.count == 1 && !picker.finished && selectionCallbacks == 0);

    hitRect = CGRectMake(second.x - 10, second.y - 10, 30, 20); hitPID = getpid() + 1;
    [view mouseMoved:mouse(view, NSEventTypeMouseMoved, second)];
    awaitMeasurementHit(picker);
    assert(!picker.measurementLayoutChildren.count);
    CIIPMeasurementGuide guides[4];
    assert([picker measurementGuides:guides] == 1);
    assert(CGPointEqualToPoint(guides[0].start, CGPointMake(CGRectGetMaxX(reference), first.y)));
    assert(CGPointEqualToPoint(guides[0].end, CGPointMake(CGRectGetMinX(hitRect), second.y)));
    CAShapeLayer *referenceOutline = (CAShapeLayer *)measurement.sublayers[0];
    CALayer *distancePlate = measurement.sublayers[2];
    CATextLayer *distanceLabel = (CATextLayer *)distancePlate.sublayers.firstObject;
    assert(!CGPathIsEmpty(referenceOutline.path) && !distancePlate.hidden);
    assert([[distanceLabel.string string] isEqualToString:@"100 pt"]);

    CGPoint above = pointInView(view, 76, 55);
    hitRect = CGRectMake(above.x - 50, above.y - 10, 100, 20);
    [view mouseMoved:mouse(view, NSEventTypeMouseMoved, above)];
    awaitMeasurementHit(picker);
    assert([[distanceLabel.string string] isEqualToString:@"15 pt"]);
    assert(!CGRectIntersectsRect(distancePlate.frame, view.layer.sublayers.lastObject.frame));

    [view keyDown:key(36)];
    assert(!picker.finished && [picker measurementGuides:guides] == 0);
    assert(CGRectEqualToRect(NSRectToCGRect([picker.measurementReference[0][@"frame"] rectValue]), hitRect));
    assert(distancePlate.hidden);
    CGPoint empty = pointInView(view, 315, 120);
    [view mouseMoved:mouse(view, NSEventTypeMouseMoved, empty)];
    awaitMeasurementHit(picker);
    CALayer *status = measurement.sublayers.lastObject;
    CATextLayer *statusLabel = (CATextLayer *)status.sublayers.firstObject;
    assert(!status.hidden && [[statusLabel.string string] containsString:@"此处没有可识别元素"]);
    assert(picker.measurementReference.count == 1 && !CGPathIsEmpty(referenceOutline.path));
    [view keyDown:key(53)];
    assert(picker.finished && !picker.panels.count && selectionCallbacks == 1 && callbackWindow == 0 && CGRectEqualToRect(callbackRect, CGRectZero));
    hitPID = 0; [queryWindow release]; queryWindow = nil; layoutChildren = nil; layoutFrames = nil;
}
int main(int argc, const char **argv) {
    @autoreleasepool {
        testLayoutCollection();
        [NSApplication sharedApplication]; assert(NSScreen.screens.count);
        method_exchangeImplementations(class_getClassMethod(NSEvent.class, @selector(mouseLocation)), class_getClassMethod(NSEvent.class, @selector(ciip_dragMouse)));
        testClickAndDrag(argc > 1 ? [NSString stringWithUTF8String:argv[1]] : nil);
        testReverseAndDesktopClip(); testCancellation(); testLateAXDoesNotReplaceDrag();
        testMeasurementSession();
        testAreaAdjustment(); testElementClickAdjustment(); testPreparedToolbarAdjustment(NO); testPreparedToolbarAdjustment(YES);
        testFrozenAreaSession();
        testAdjustmentCursors();
        puts("PASS capture adjustment, prepared toolbar teardown before capture and copy, cursors, cancellation, late AX rejection, and element measurement session");
    }
    return 0;
}
