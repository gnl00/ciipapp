// Real AppKit alpha presentation on a synthetic window; no input injection or desktop capture.
#import <Cocoa/Cocoa.h>
#import <QuartzCore/QuartzCore.h>
#import <objc/runtime.h>
#include <assert.h>
#include <stdint.h>
#include <stdlib.h>
void ciip_reveal_quick_window(uintptr_t, double, double, double, double, double);

static BOOL reducedMotion;
@interface NSWorkspace (CIIPQuickPresentationTest)
- (BOOL)ciip_testReduceMotion;
@end
@implementation NSWorkspace (CIIPQuickPresentationTest)
- (BOOL)ciip_testReduceMotion { return reducedMotion; }
@end

// Record presentation updates when AppKit applies them. A busy run-loop turn can
// contain the entire animation, so polling after that turn misses valid frames.
@interface CIIPQuickPresentationPanel : NSPanel
@property(nonatomic) CGFloat intermediateAlpha;
@property(nonatomic) BOOL observeAlpha;
@end
@implementation CIIPQuickPresentationPanel
- (void)setAlphaValue:(CGFloat)alpha {
    [super setAlphaValue:alpha];
    CGFloat presented = self.alphaValue;
    if (self.observeAlpha && !self.intermediateAlpha && presented > 0 && presented < 1)
        self.intermediateAlpha = presented;
}
@end

static BOOL waitUntil(BOOL (^condition)(void)) {
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:5];
    while (!condition() && deadline.timeIntervalSinceNow > 0)
        [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode beforeDate:deadline];
    return condition();
}
static void frame(NSWindow *window, NSString *directory, NSString *name) {
    if (!directory) return;
    NSView *view = window.contentView;
    CGFloat scale = window.backingScaleFactor;
    NSBitmapImageRep *rep = [[[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:view.bounds.size.width * scale pixelsHigh:view.bounds.size.height * scale bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0] autorelease];
    [NSGraphicsContext saveGraphicsState];
    NSGraphicsContext *context = [NSGraphicsContext graphicsContextWithBitmapImageRep:rep];
    [NSGraphicsContext setCurrentContext:context]; CGContextScaleCTM(context.CGContext, scale, scale);
    CGContextSetAlpha(context.CGContext, window.alphaValue);
    CGContextBeginTransparencyLayer(context.CGContext, NULL);
    [view.layer renderInContext:context.CGContext];
    CGContextEndTransparencyLayer(context.CGContext);
    [NSGraphicsContext restoreGraphicsState];
    fprintf(stderr, "frame %s: window %.3f, pixel %.3f\n", name.UTF8String, window.alphaValue, [rep colorAtX:200 * scale y:100 * scale].alphaComponent);
    assert([[rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:[directory stringByAppendingPathComponent:name] atomically:YES]);
}
static void testPresentation(int argc, const char **argv) {
    @autoreleasepool {
        assert(NSApp.running && NSScreen.screens.count > 0);
        Method preference = class_getInstanceMethod(NSWorkspace.class, @selector(accessibilityDisplayShouldReduceMotion));
        Method fixture = class_getInstanceMethod(NSWorkspace.class, @selector(ciip_testReduceMotion));
        method_exchangeImplementations(preference, fixture);
        NSString *directory = argc > 6 ? [NSString stringWithUTF8String:argv[6]] : nil;
        NSTimeInterval duration = argc > 1 ? atof(argv[1]) : .17;
        NSRect work = NSScreen.screens[0].visibleFrame;
        CIIPQuickPresentationPanel *window = [[CIIPQuickPresentationPanel alloc] initWithContentRect:NSMakeRect(work.origin.x + 40, work.origin.y + 60, 400, 260) styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel backing:NSBackingStoreBuffered defer:NO];
        window.releasedWhenClosed = NO; window.hidesOnDeactivate = NO;
        window.backgroundColor = NSColor.clearColor; window.opaque = NO;
        window.contentView.wantsLayer = YES;
        CALayer *image = [CALayer layer]; image.frame = CGRectMake(70, 110, 260, 110); image.backgroundColor = [NSColor colorWithCalibratedRed:.6 green:.74 blue:.65 alpha:1].CGColor;
        CALayer *toolbar = [CALayer layer]; toolbar.frame = CGRectMake(12, 20, 376, 64); toolbar.backgroundColor = [NSColor colorWithWhite:.94 alpha:1].CGColor; toolbar.cornerRadius = 13;
        [window.contentView.layer addSublayer:image]; [window.contentView.layer addSublayer:toolbar];
        NSRect initial = window.frame;
        window.alphaValue = 0; [window orderFrontRegardless]; [window displayIfNeeded];
        window.observeAlpha = YES;
        ciip_reveal_quick_window((uintptr_t)window, duration, argc > 2 ? atof(argv[2]) : .16, argc > 3 ? atof(argv[3]) : 1, argc > 4 ? atof(argv[4]) : .3, argc > 5 ? atof(argv[5]) : 1);
        CGFloat start = window.alphaValue;
        frame(window, directory, @"quick-start.png");
        assert(start < .05);
        // Deliberately wait for completion before inspecting the recorded updates.
        // This also covers a run-loop turn that returns only after the fade has ended.
        BOOL settled = waitUntil(^BOOL { return window.alphaValue == 1; });
        CGFloat middle = window.intermediateAlpha;
        fprintf(stderr, "quick presentation alpha: start %.3f, recorded middle %.3f, settled %.3f\n", start, middle, window.alphaValue);
        assert(middle > start && middle < 1);
        assert(settled && window.alphaValue == 1 && NSEqualRects(window.frame, initial));
        window.observeAlpha = NO;
        frame(window, directory, @"quick-settled.png");
        reducedMotion = YES; window.alphaValue = 0;
        ciip_reveal_quick_window((uintptr_t)window, duration, .16, 1, .3, 1);
        assert(window.alphaValue == 1);
        reducedMotion = NO; window.alphaValue = 0;
        ciip_reveal_quick_window((uintptr_t)window, 0, .16, 1, .3, 1);
        assert(window.alphaValue == 1);
        [window close]; [window release];
        method_exchangeImplementations(preference, fixture);
        puts("PASS native quick presentation: intermediate alpha, stationary frame, settled image, reduced motion, zero duration");
    }
}

static int fixtureArgc;
static const char **fixtureArgv;
@interface CIIPQuickPresentationRunner : NSObject <NSApplicationDelegate>
@end
@implementation CIIPQuickPresentationRunner
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    [self performSelector:@selector(runFixture) withObject:nil afterDelay:0];
}
- (void)runFixture { testPresentation(fixtureArgc, fixtureArgv); exit(EXIT_SUCCESS); }
@end

int main(int argc, const char **argv) {
    @autoreleasepool {
        fixtureArgc = argc; fixtureArgv = argv;
        [NSApplication sharedApplication]; [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
        CIIPQuickPresentationRunner *runner = [[CIIPQuickPresentationRunner alloc] init]; NSApp.delegate = runner;
        [NSApp run];
        [runner release];
        fputs("AppKit exited before the quick presentation fixture completed\n", stderr);
    }
    return EXIT_FAILURE;
}
