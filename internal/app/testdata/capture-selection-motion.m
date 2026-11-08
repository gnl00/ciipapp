// Presentation-layer QA on a synthetic full-screen-style surface; no input injection or screen capture.
#import <Cocoa/Cocoa.h>
#include <assert.h>
#include <stdlib.h>
#include "../capture_selection_darwin.m"

void ciip_go_capture_selection(uintptr_t token, uint32_t window, double x, double y, double width, double height) {}

@interface CIIPCaptureMotionView : CIIPCaptureSelectionView
@property(nonatomic) BOOL forceReducedMotion;
@end
@implementation CIIPCaptureMotionView
- (BOOL)reduceSelectionMotion { return self.forceReducedMotion; }
@end

static void drainFor(NSTimeInterval seconds) {
    [CATransaction flush];
    NSDate *until = [NSDate dateWithTimeIntervalSinceNow:seconds];
    while (until.timeIntervalSinceNow > 0) [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode beforeDate:until];
}
static CGRect globalRect(CGRect local, NSWindow *window, CGFloat top) {
    return CGRectMake(window.frame.origin.x + local.origin.x, top - window.frame.origin.y - CGRectGetMaxY(local), local.size.width, local.size.height);
}
static void renderFrame(CALayer *layer, NSString *directory, NSString *name, CGFloat scale) {
    if (!directory) return;
    NSBitmapImageRep *rep = [[[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:layer.bounds.size.width * scale pixelsHigh:layer.bounds.size.height * scale bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0] autorelease];
    [NSGraphicsContext saveGraphicsState];
    NSGraphicsContext *context = [NSGraphicsContext graphicsContextWithBitmapImageRep:rep];
    [NSGraphicsContext setCurrentContext:context]; CGContextScaleCTM(context.CGContext, scale, scale);
    [(layer.presentationLayer ?: layer) renderInContext:context.CGContext];
    [NSGraphicsContext restoreGraphicsState];
    assert([[rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:[directory stringByAppendingPathComponent:name] atomically:YES]);
}
int main(int argc, const char **argv) {
    @autoreleasepool {
        [NSApplication sharedApplication]; assert(NSScreen.screens.count > 0);
        NSString *directory = argc > 6 ? [NSString stringWithUTF8String:argv[6]] : nil;
        NSRect work = NSScreen.screens[0].visibleFrame;
        NSPanel *panel = [[CIIPCaptureSelectionPanel alloc] initWithContentRect:NSMakeRect(work.origin.x + 40, work.origin.y + 60, 680, 420) styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel backing:NSBackingStoreBuffered defer:NO];
        panel.releasedWhenClosed = NO; panel.hidesOnDeactivate = NO; panel.level = NSScreenSaverWindowLevel;
        panel.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary;
        NSView *background = [[[NSView alloc] initWithFrame:NSMakeRect(0, 0, 680, 420)] autorelease];
        background.wantsLayer = YES; background.layer.backgroundColor = [NSColor colorWithWhite:.95 alpha:1].CGColor; panel.contentView = background;
        // A few fixed page blocks make the stationary background visible in intermediate frames.
        for (NSUInteger i = 0; i < 3; i++) {
            CALayer *block = [CALayer layer]; block.frame = CGRectMake(50 + i * 190, 80, 150, 260);
            block.backgroundColor = [NSColor colorWithCalibratedRed:.75 + i * .05 green:.82 blue:.79 alpha:1].CGColor;
            [background.layer addSublayer:block];
        }
        CIIPCapturePicker *picker = [[CIIPCapturePicker alloc] init]; picker.elementMode = YES;
        picker.desktopTop = NSMaxY(NSScreen.screens[0].frame);
        picker.selectionDuration = argc > 1 ? atof(argv[1]) : .12;
        picker.selectionCurve = [CAMediaTimingFunction functionWithControlPoints:argc > 2 ? atof(argv[2]) : .16 :argc > 3 ? atof(argv[3]) : 1 :argc > 4 ? atof(argv[4]) : .3 :argc > 5 ? atof(argv[5]) : 1];
        CIIPCaptureMotionView *view = [[[CIIPCaptureMotionView alloc] initWithFrame:background.bounds] autorelease];
        view.picker = picker; [background addSubview:view];
        CGRect a = CGRectMake(60, 220, 140, 80), b = CGRectMake(360, 100, 180, 100), c = CGRectMake(240, 240, 120, 60);
        picker.rect = globalRect(a, panel, picker.desktopTop); [view updateSelectionAnimated:NO];
        [panel orderFrontRegardless]; [panel display]; drainFor(.03);
        CAShapeLayer *shade = (CAShapeLayer *)view.layer.sublayers[0], *outline = (CAShapeLayer *)view.layer.sublayers[1];
        CALayer *plate = view.layer.sublayers[2];
        assert(!plate.hidden && ![outline animationForKey:@"path"]);
        renderFrame(background.layer, directory, @"selection-start.png", panel.backingScaleFactor);

        picker.rect = globalRect(b, panel, picker.desktopTop); [view updateSelectionAnimated:YES];
        CABasicAnimation *motion = (CABasicAnimation *)[outline animationForKey:@"path"];
        assert(motion && fabs(motion.duration - picker.selectionDuration) < .0001);
        [view layout]; assert([outline animationForKey:@"path"]); // Unchanged AppKit layout must not interrupt hover motion.
        assert(CGRectEqualToRect(CGPathGetBoundingBox(outline.path), CGRectInset(b, 1, 1)));
        drainFor(.025);
        CGRect first = CGPathGetBoundingBox([(CAShapeLayer *)outline.presentationLayer path]);
        if (!(first.origin.x > a.origin.x + 1 && first.origin.x < b.origin.x + 1)) fprintf(stderr, "selection motion: first x=%.2f, from=%.2f, to=%.2f\n", first.origin.x, a.origin.x + 1, b.origin.x + 1);
        assert(first.origin.x > a.origin.x + 1 && first.origin.x < b.origin.x + 1);
        renderFrame(background.layer, directory, @"selection-moving-1.png", panel.backingScaleFactor);
        drainFor(.02);
        CGRect second = CGPathGetBoundingBox([(CAShapeLayer *)outline.presentationLayer path]);
        assert(second.origin.x >= first.origin.x && second.origin.x < b.origin.x + 1);
        renderFrame(background.layer, directory, @"selection-moving-2.png", panel.backingScaleFactor);

        picker.rect = globalRect(c, panel, picker.desktopTop); [view updateSelectionAnimated:YES];
        motion = (CABasicAnimation *)[outline animationForKey:@"path"];
        CGRect retarget = CGPathGetBoundingBox((CGPathRef)motion.fromValue);
        assert(fabs(retarget.origin.x - second.origin.x) < 1);
        [view updateSelectionAnimated:YES]; // Repeated hits of the same element must not restart the transition.
        assert(CGRectEqualToRect(retarget, CGPathGetBoundingBox((CGPathRef)[(CABasicAnimation *)[outline animationForKey:@"path"] fromValue])));
        drainFor(picker.selectionDuration + .04);
        assert(CGRectEqualToRect(CGPathGetBoundingBox([(CAShapeLayer *)outline.presentationLayer path]), CGRectInset(c, 1, 1)));
        renderFrame(background.layer, directory, @"selection-settled.png", panel.backingScaleFactor);

        picker.pending = YES; picker.rect = CGRectNull; [view updateSelectionAnimated:YES];
        assert(CGRectEqualToRect(CGPathGetBoundingBox(outline.path), CGRectInset(c, 1, 1)));
        picker.pending = NO; picker.rect = globalRect(a, panel, picker.desktopTop); [view updateSelectionAnimated:NO];
        assert(![outline animationForKey:@"path"]); // Keyboard changes are immediate.
        view.forceReducedMotion = YES;
        picker.rect = globalRect(b, panel, picker.desktopTop); [view updateSelectionAnimated:YES];
        assert(![outline animationForKey:@"path"] && CGRectEqualToRect(CGPathGetBoundingBox(outline.path), CGRectInset(b, 1, 1)));
        picker.rect = CGRectNull; [view updateSelectionAnimated:NO]; assert(plate.hidden && CGPathIsEmpty(outline.path));
        assert(view.layer.sublayers[0] == shade && view.layer.sublayers[1] == outline); // One persistent overlay.
        picker.elementMode = NO; picker.rect = globalRect(a, panel, picker.desktopTop); [view updateSelectionAnimated:YES];
        assert(plate.hidden && ![outline animationForKey:@"path"]);
        [panel close]; [panel release]; [picker release];
        puts("PASS native selection motion: presentation frames, retargeting, stable overlay, pixel dimensions, keyboard, reduced motion, window mode");
    }
}
