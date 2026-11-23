// Real WindowServer hit-testing, no input injection or permission requests.
#import <Cocoa/Cocoa.h>
#include <assert.h>
#include <stdint.h>
#include <string.h>
#include "../capture_selection_darwin.m"

void ciip_go_capture_selection(uintptr_t token, uint32_t window, double x, double y, double width, double height, int copyOnly) {}
void ciip_go_capture_area_image(uintptr_t token, double x, double y, double width, double height, int copyOnly,
    const void *png, size_t length, const char *error) {}

@interface CIIPCaptureInputProbe : CIIPCapturePicker
@property(nonatomic) NSUInteger confirmations, cancellations;
@end
@implementation CIIPCaptureInputProbe
- (void)confirm { self.confirmations++; }
- (void)finish:(BOOL)accepted { self.cancellations++; }
@end

@interface CIIPCaptureInputFallback : NSResponder
@property(nonatomic) NSUInteger events;
@end
@implementation CIIPCaptureInputFallback
- (void)scrollWheel:(NSEvent *)event { self.events++; }
- (void)magnifyWithEvent:(NSEvent *)event { self.events++; }
- (void)otherMouseDown:(NSEvent *)event { self.events++; }
- (void)otherMouseDragged:(NSEvent *)event { self.events++; }
- (void)otherMouseUp:(NSEvent *)event { self.events++; }
@end

static NSEvent *key(unsigned short code) {
    return [NSEvent keyEventWithType:NSEventTypeKeyDown location:NSZeroPoint modifierFlags:0 timestamp:0 windowNumber:0 context:nil characters:@"" charactersIgnoringModifiers:@"" isARepeat:NO keyCode:code];
}
static NSEvent *mouse(NSEventType type) {
    return [NSEvent mouseEventWithType:type location:NSMakePoint(80, 80) modifierFlags:0 timestamp:0 windowNumber:0 context:nil eventNumber:1 clickCount:1 pressure:0];
}
static NSEvent *middleMouse(CGEventType type) {
    CGEventRef cg = CGEventCreateMouseEvent(NULL, type, CGPointMake(80, 80), kCGMouseButtonCenter);
    NSEvent *event = [NSEvent eventWithCGEvent:cg];
    CFRelease(cg);
    assert(event.buttonNumber == 2);
    return event;
}
static void testMouseSequence(void) {
    CIIPCaptureInputProbe *picker = [[CIIPCaptureInputProbe alloc] init];
    CIIPCaptureSelectionView *view = [[CIIPCaptureSelectionView alloc] initWithFrame:NSMakeRect(0, 0, 200, 160)];
    view.picker = picker;
    [view mouseDown:mouse(NSEventTypeLeftMouseDown)];
    assert(picker.confirmations == 0 && picker.cancellations == 0);
    [view mouseDragged:mouse(NSEventTypeLeftMouseDragged)];
    [view keyDown:key(36)]; assert(picker.confirmations == 0);
    [view mouseUp:mouse(NSEventTypeLeftMouseUp)]; assert(picker.confirmations == 1);
    [view mouseUp:mouse(NSEventTypeLeftMouseUp)]; assert(picker.confirmations == 1);
    [view rightMouseDown:mouse(NSEventTypeRightMouseDown)]; assert(picker.cancellations == 0);
    [view rightMouseDragged:mouse(NSEventTypeRightMouseDragged)];
    [view rightMouseUp:mouse(NSEventTypeRightMouseUp)]; assert(picker.cancellations == 1);
    [view keyDown:key(36)]; assert(picker.confirmations == 2);
    [view mouseDown:mouse(NSEventTypeLeftMouseDown)]; [view keyDown:key(53)];
    assert(picker.cancellations == 1);
    [view mouseUp:mouse(NSEventTypeLeftMouseUp)]; assert(picker.cancellations == 2);
    [view mouseDown:mouse(NSEventTypeLeftMouseDown)]; [view rightMouseDown:mouse(NSEventTypeRightMouseDown)];
    [view rightMouseUp:mouse(NSEventTypeRightMouseUp)]; assert(picker.cancellations == 2);
    [view mouseUp:mouse(NSEventTypeLeftMouseUp)]; assert(picker.cancellations == 3 && picker.confirmations == 2);
    CIIPCaptureInputFallback *fallback = [[[CIIPCaptureInputFallback alloc] init] autorelease];
    view.nextResponder = fallback;
    CGEventRef wheel = CGEventCreateScrollWheelEvent(NULL, kCGScrollEventUnitLine, 1, 1);
    NSEvent *scroll = [NSEvent eventWithCGEvent:wheel];
    CFRelease(wheel);
    [view scrollWheel:scroll];
    [view magnifyWithEvent:scroll];
    [view otherMouseDown:middleMouse(kCGEventOtherMouseDown)];
    [view otherMouseDragged:middleMouse(kCGEventOtherMouseDragged)];
    [view otherMouseUp:middleMouse(kCGEventOtherMouseUp)];
    assert(fallback.events == 0 && "selection input must stop at its responder");
    assert(picker.confirmations == 2 && picker.cancellations == 3);

    CIIPCaptureSelectionView *second = [[[CIIPCaptureSelectionView alloc] initWithFrame:view.frame] autorelease];
    second.picker = picker;
    [view otherMouseDown:middleMouse(kCGEventOtherMouseDown)];
    [second keyDown:key(53)];
    assert(picker.cancellations == 3 && "Escape must keep input isolated across displays until mouse release");
    [view otherMouseUp:middleMouse(kCGEventOtherMouseUp)];
    assert(picker.confirmations == 2 && picker.cancellations == 4);
    [view release]; [picker release];
    puts("PASS mouse sequence: confirmation, held-button cancellation across displays, and scroll/gesture isolation");
}
static void testWindowHitRouting(BOOL frozen) {
    assert(NSScreen.screens.count > 0 && "WindowServer regression requires a macOS login session");
    NSRect screen = NSScreen.screens[0].visibleFrame;
    NSRect frame = NSMakeRect(screen.origin.x + 40, screen.origin.y + 80, 220, 180);
    NSPanel *under = [[NSPanel alloc] initWithContentRect:frame styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel backing:NSBackingStoreBuffered defer:NO];
    under.releasedWhenClosed = NO; under.level = NSScreenSaverWindowLevel; under.hidesOnDeactivate = NO;
    under.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary;
    under.backgroundColor = NSColor.whiteColor;
    CIIPCapturePicker *picker = [[CIIPCapturePicker alloc] init];
    picker.areaMode = frozen;
    picker.desktopTop = NSMaxY(NSScreen.screens[0].frame);
    picker.rect = CGRectMake(frame.origin.x + 40, picker.desktopTop - frame.origin.y - 120, 100, 80);
    NSPanel *overlay = [[CIIPCaptureSelectionPanel alloc] initWithContentRect:frame styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel backing:NSBackingStoreBuffered defer:NO];
    overlay.releasedWhenClosed = NO; overlay.opaque = frozen;
    overlay.backgroundColor = frozen ? NSColor.blackColor : NSColor.clearColor;
    overlay.level = NSScreenSaverWindowLevel; overlay.hasShadow = NO; overlay.hidesOnDeactivate = NO;
    overlay.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary;
    CIIPCaptureSelectionView *view = [[[CIIPCaptureSelectionView alloc] initWithFrame:NSMakeRect(0, 0, 220, 180)] autorelease];
    view.picker = picker; overlay.contentView = view;
    if (frozen) {
        CGColorSpaceRef colorSpace = CGColorSpaceCreateDeviceRGB();
        CGContextRef bitmap = CGBitmapContextCreate(NULL, 1, 1, 8, 4, colorSpace, kCGImageAlphaPremultipliedLast);
        assert(bitmap);
        CGContextSetRGBFillColor(bitmap, .5, .75, .25, 1);
        CGContextFillRect(bitmap, CGRectMake(0, 0, 1, 1));
        CGImageRef image = CGBitmapContextCreateImage(bitmap);
        assert(image);
        [view setFrozenImage:image];
        CGImageRelease(image); CGContextRelease(bitmap); CGColorSpaceRelease(colorSpace);
    }
    [view updateSelectionAnimated:NO];
    // Scope hit-testing below our own stack marker, so system shields never become the test target.
    NSPanel *marker = [[NSPanel alloc] initWithContentRect:NSMakeRect(frame.origin.x, frame.origin.y, 1, 1) styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel backing:NSBackingStoreBuffered defer:NO];
    marker.releasedWhenClosed = NO; marker.hidesOnDeactivate = NO; marker.ignoresMouseEvents = YES;
    marker.opaque = NO; marker.backgroundColor = NSColor.clearColor; marker.hasShadow = NO;
    marker.level = overlay.level + 1; marker.collectionBehavior = overlay.collectionBehavior;
    [under orderFrontRegardless]; [overlay orderFrontRegardless]; [marker orderFrontRegardless]; [overlay display];
    // Wait for the known dimmed area to reach WindowServer; a fixed delay can test another QA window.
    NSPoint maskPoint = NSMakePoint(frame.origin.x + 10, frame.origin.y + 10);
    NSDate *until = [NSDate dateWithTimeIntervalSinceNow:1];
    BOOL ready = NO;
    while (!ready && until.timeIntervalSinceNow > 0) {
        [under orderFrontRegardless]; [overlay orderFrontRegardless]; [CATransaction flush];
        [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:.02]];
        ready = [NSWindow windowNumberAtPoint:maskPoint belowWindowWithWindowNumber:marker.windowNumber] == overlay.windowNumber &&
            [NSWindow windowNumberAtPoint:maskPoint belowWindowWithWindowNumber:overlay.windowNumber] == under.windowNumber;
    }
    if (!ready) {
        NSInteger number = [NSWindow windowNumberAtPoint:maskPoint belowWindowWithWindowNumber:marker.windowNumber];
        NSArray *info = [(NSArray *)CGWindowListCopyWindowInfo(kCGWindowListOptionIncludingWindow, (CGWindowID)number) autorelease];
        NSDictionary *front = info.firstObject;
        fprintf(stderr, "routing setup: hit=%ld overlay=%ld underlying=%ld visible=%d/%d owner=%s pid=%d level=%d ourLevel=%ld frame=%s\n", (long)number, (long)overlay.windowNumber, (long)under.windowNumber,
            overlay.isVisible, under.isVisible, [front[(id)kCGWindowOwnerName] UTF8String], [front[(id)kCGWindowOwnerPID] intValue], [front[(id)kCGWindowLayer] intValue], (long)overlay.level, [NSStringFromRect(overlay.frame) UTF8String]);
    }
    assert(ready && "QA windows have not reached WindowServer in the expected order");
    NSPoint point = NSMakePoint(frame.origin.x + 90, frame.origin.y + 80);
    NSInteger hit = [NSWindow windowNumberAtPoint:point belowWindowWithWindowNumber:marker.windowNumber];
    NSInteger expected = overlay.windowNumber;
    if (hit != expected) fprintf(stderr, "window hit at selected center: hit=%ld overlay=%ld underlying=%ld\n", (long)hit, (long)expected, (long)under.windowNumber);
    [marker close]; [overlay close]; [under close];
    [marker release]; [overlay release]; [under release]; [picker release];
    assert(hit == expected);
    printf("PASS WindowServer QA stack: %s overlay intercepts mouse-down inside and outside the selection\n",
        frozen ? "frozen" : "live");
}
int main(int argc, const char **argv) {
    @autoreleasepool {
        [NSApplication sharedApplication];
        if (argc == 1 || strcmp(argv[1], "--sequence") == 0) testMouseSequence();
        if (argc == 1 || strcmp(argv[1], "--routing") == 0) {
            testWindowHitRouting(NO);
            testWindowHitRouting(YES);
        }
    }
}
