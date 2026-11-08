// Real screenshot QA is restricted to opaque windows created by this process.
// No permission request, clipboard mutation, input injection, or image files.
#import <Cocoa/Cocoa.h>
#include <assert.h>
#include <time.h>
#include "../native_capture_darwin.m"

static uintptr_t sequence;
static NSUInteger completions;
static NSData *resultPNG;
static NSString *resultError;
static BOOL resultUnsupported;

void ciip_go_capture_png(uintptr_t token, void *bytes, size_t length, const char *error, int unsupported) {
    [resultPNG release]; resultPNG = length ? [[NSData alloc] initWithBytes:bytes length:length] : nil;
    [resultError release]; resultError = error ? [[NSString alloc] initWithUTF8String:error] : nil;
    resultUnsupported = unsupported != 0; completions++;
}
static double now(void) {
    struct timespec time; clock_gettime(CLOCK_MONOTONIC, &time); return time.tv_sec + time.tv_nsec / 1e9;
}
static void drain(double seconds) {
    NSDate *until = [NSDate dateWithTimeIntervalSinceNow:seconds];
    while (until.timeIntervalSinceNow > 0) [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode beforeDate:until];
}
static void until(BOOL (^ready)(void)) {
    double deadline = now() + 8;
    while (!ready() && now() < deadline) drain(.001);
    assert(ready());
}
static CGRect screenRect(NSWindow *window) {
    NSRect frame = window.frame;
    return CGRectMake(frame.origin.x, NSMaxY(NSScreen.screens[0].frame) - NSMaxY(frame), frame.size.width, frame.size.height);
}
static BOOL unobscured(NSWindow *window, CGWindowID ownOverlay) {
    CGRect target = screenRect(window);
    NSArray *above = [(NSArray *)CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenAboveWindow | kCGWindowListExcludeDesktopElements, (CGWindowID)window.windowNumber) autorelease];
    if (!above) return NO;
    for (NSDictionary *info in above) {
        CGWindowID windowID = [info[(id)kCGWindowNumber] unsignedIntValue];
        if (windowID == (CGWindowID)window.windowNumber || (ownOverlay && windowID == ownOverlay)) continue;
        if ([info[(id)kCGWindowAlpha] doubleValue] <= 0) continue;
        CGRect frame;
        if (CGRectMakeWithDictionaryRepresentation((CFDictionaryRef)info[(id)kCGWindowBounds], &frame) && CGRectIntersectsRect(frame, target)) {
            fprintf(stderr, "QA surface obscured: higher compositor layer=%ld alpha=%.2f\n", [info[(id)kCGWindowLayer] longValue], [info[(id)kCGWindowAlpha] doubleValue]);
            return NO;
        }
    }
    return YES;
}
static NSBitmapImageRep *take(BOOL window, CGWindowID windowID, CGRect rect) {
    NSUInteger before = completions;
    ciip_capture_png_begin(++sequence, window, windowID, rect.origin.x, rect.origin.y, rect.size.width, rect.size.height);
    until(^BOOL { return completions != before; });
    assert(nativeCaptures.count == 0);
    return resultPNG ? [NSBitmapImageRep imageRepWithData:resultPNG] : nil;
}
static NSBitmapImageRep *ownRegion(NSWindow *window) {
    assert(unobscured(window, 0));
    NSBitmapImageRep *image = take(NO, 0, screenRect(window));
    if (!image) fprintf(stderr, "region failure: %s unsupported=%d\n", resultError.UTF8String, resultUnsupported);
    assert(image && !resultError && !resultUnsupported);
    return image;
}
static uint64_t imageHash(NSBitmapImageRep *image, size_t *different) {
    size_t width = image.pixelsWide, height = image.pixelsHigh;
    uint32_t *pixels = calloc(width * height, 4);
    CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    CGContextRef context = CGBitmapContextCreate(pixels, width, height, 8, width * 4, space, kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
    CGContextDrawImage(context, CGRectMake(0, 0, width, height), image.CGImage);
    uint64_t hash = 1469598103934665603ULL; *different = 0;
    for (size_t i = 0; i < width * height; i++) {
        if (pixels[i] != pixels[0]) (*different)++;
        hash ^= pixels[i]; hash *= 1099511628211ULL;
    }
    CGContextRelease(context); CGColorSpaceRelease(space); free(pixels); return hash;
}
static void geometry(void) {
    CGRect source; size_t width, height;
    assert(nativeCaptureRegionPlan(CGRectMake(-1900, -1170, 60, 24), CGRectMake(-1920, -1200, 1920, 1200), 2, &source, &width, &height));
    assert(CGRectEqualToRect(source, CGRectMake(20, 30, 60, 24)) && width == 120 && height == 48);
    assert(!nativeCaptureRegionPlan(CGRectMake(-1930, -1170, 60, 24), CGRectMake(-1920, -1200, 1920, 1200), 2, &source, &width, &height));
    assert(!nativeCaptureRegionPlan(CGRectMake(0, 0, 10000, 10000), CGRectMake(0, 0, 10000, 10000), 2, &source, &width, &height));
    assert(!nativeCaptureRegionPlan(CGRectMake(0, 0, 60, 24), CGRectMake(0, 0, 1920, 1200), NAN, &source, &width, &height));
    assert(!nativeCaptureRectValid(CGRectMake(NAN, 0, 10, 10)));
    puts("PASS native screenshot geometry: negative origins, Retina pixels, cross-display rejection, pixel budget");
}
static void cursorControl(NSWindow *window, NSBitmapImageRep *clean) {
    NSPoint mouse = NSEvent.mouseLocation;
    if (!NSPointInRect(mouse, NSInsetRect(window.frame, 20, 20))) { puts("SKIP cursor control: physical pointer moved outside QA window"); return; }
    if (@available(macOS 14.0, *)) {
        __block BOOL done = NO;
        __block CGImageRef cursorImage = NULL;
        CGRect rect = screenRect(window);
        [NSClassFromString(@"SCShareableContent") getShareableContentExcludingDesktopWindows:YES onScreenWindowsOnly:YES completionHandler:^(SCShareableContent *content, NSError *error) {
            SCContentFilter *filter = nil;
            for (SCDisplay *display in content.displays) if (CGRectContainsRect(display.frame, rect)) { filter = [[[NSClassFromString(@"SCContentFilter") alloc] initWithDisplay:display excludingWindows:@[]] autorelease]; break; }
            assert(filter && !error);
            SCStreamConfiguration *config = [[[NSClassFromString(@"SCStreamConfiguration") alloc] init] autorelease];
            config.width = clean.pixelsWide; config.height = clean.pixelsHigh;
            config.sourceRect = CGRectOffset(rect, -filter.contentRect.origin.x, -filter.contentRect.origin.y);
            config.showsCursor = YES;
            [NSClassFromString(@"SCScreenshotManager") captureImageWithFilter:filter configuration:config completionHandler:^(CGImageRef image, NSError *error) {
                assert(image && !error); CGImageRef retained = CGImageRetain(image);
                dispatch_async(dispatch_get_main_queue(), ^{ cursorImage = retained; done = YES; });
            }];
        }];
        until(^BOOL { return done; });
        size_t cleanDifferent, cursorDifferent;
        imageHash(clean, &cleanDifferent);
        NSBitmapImageRep *positive = [[[NSBitmapImageRep alloc] initWithCGImage:cursorImage] autorelease];
        imageHash(positive, &cursorDifferent); CGImageRelease(cursorImage);
        fprintf(stderr, "cursor pixels: excluded=%zu explicit-included=%zu\n", cleanDifferent, cursorDifferent);
        assert(cleanDifferent == 0 && cursorDifferent > 0);
    }
}
static void benchmark(NSWindow *window) {
    for (NSUInteger i = 0; i < 5; i++) {
        double started = now(); NSBitmapImageRep *region = ownRegion(window);
        fprintf(stderr, "native region round=%lu ms=%.3f pixels=%ldx%ld\n", (unsigned long)i + 1, (now() - started) * 1000, (long)region.pixelsWide, (long)region.pixelsHigh);
        started = now(); NSBitmapImageRep *image = take(YES, (CGWindowID)window.windowNumber, screenRect(window));
        assert(image && !resultError);
        fprintf(stderr, "native window round=%lu ms=%.3f pixels=%ldx%ld\n", (unsigned long)i + 1, (now() - started) * 1000, (long)image.pixelsWide, (long)image.pixelsHigh);
    }
}
int main(int argc, const char **argv) {
    @autoreleasepool {
        geometry(); [NSApplication sharedApplication];
        // These checks never request a permission. Geometry/callback tests still
        // run on a CI host without an existing screen-capture grant.
        if (!CGPreflightScreenCaptureAccess() || !NSScreen.screens.count) { puts("SKIP live screenshots: no existing screen authorization/session"); return 0; }
        if (@available(macOS 14.0, *)) {} else { puts("SKIP live screenshots: legacy OS uses system capture"); return 0; }
        NSPoint mouse = NSEvent.mouseLocation;
        NSScreen *screen = NSScreen.screens[0];
        for (NSScreen *candidate in NSScreen.screens) if (NSPointInRect(mouse, candidate.visibleFrame)) { screen = candidate; break; }
        NSRect work = screen.visibleFrame;
        NSRect frame = NSMakeRect(work.origin.x + 80, work.origin.y + 80, 384, 192);
        NSPanel *base = [[NSPanel alloc] initWithContentRect:frame styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel backing:NSBackingStoreBuffered defer:NO];
        base.releasedWhenClosed = NO; base.hidesOnDeactivate = NO; base.hasShadow = NO; base.opaque = YES;
        base.level = CGWindowLevelForKey(kCGMaximumWindowLevelKey); base.backgroundColor = [NSColor colorWithCalibratedRed:.16 green:.38 blue:.27 alpha:1];
        [base orderFrontRegardless]; [base displayIfNeeded]; drain(.08);
        if (!unobscured(base, 0)) { [base close]; [base release]; puts("SKIP live screenshots: higher window intersects opaque QA surface"); return 0; }
        NSBitmapImageRep *clean = ownRegion(base);
        assert(clean.pixelsWide == (NSInteger)(384 * screen.backingScaleFactor) && clean.pixelsHigh == (NSInteger)(192 * screen.backingScaleFactor));
        size_t different; uint64_t cleanHash = imageHash(clean, &different); assert(different == 0);
        cursorControl(base, clean);

        // A visible overlay is the negative control. Closing it must expose a
        // clean new frame through the production flush/next-main-turn barrier.
        for (NSUInteger i = 0; i < 6; i++) {
            NSPanel *overlay = [[NSPanel alloc] initWithContentRect:base.frame styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel backing:NSBackingStoreBuffered defer:NO];
            overlay.releasedWhenClosed = NO; overlay.hidesOnDeactivate = NO; overlay.hasShadow = NO; overlay.opaque = NO;
            overlay.level = CGWindowLevelForKey(kCGMaximumWindowLevelKey); overlay.backgroundColor = [[NSColor redColor] colorWithAlphaComponent:.5];
            [overlay orderFrontRegardless]; [overlay displayIfNeeded]; drain(.025);
            NSBitmapImageRep *covered = take(NO, 0, screenRect(base)); assert(covered && imageHash(covered, &different) != cleanHash);
            [overlay close];
            // The closed self-owned overlay may remain in the window-list
            // snapshot briefly. Ignore only its known ID, then let the production
            // barrier prove the returned pixels are already clear of it.
            assert(unobscured(base, (CGWindowID)overlay.windowNumber));
            NSBitmapImageRep *uncovered = take(NO, 0, screenRect(base));
            assert(uncovered && imageHash(uncovered, &different) == cleanHash);
            [overlay release];
        }
        puts("PASS native screenshot compositor: six visible-overlay negative controls and clean closed-overlay frames");

        NSWindow *titled = [[NSWindow alloc] initWithContentRect:NSMakeRect(work.origin.x + 40, work.origin.y + 40, 384, 192) styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable backing:NSBackingStoreBuffered defer:NO];
        titled.releasedWhenClosed = NO; titled.hasShadow = YES; titled.backgroundColor = NSColor.systemBlueColor; titled.level = base.level;
        titled.title = @"ciip screenshot QA"; [titled orderFrontRegardless]; [titled displayIfNeeded]; drain(.04);
        NSBitmapImageRep *windowImage = take(YES, (CGWindowID)titled.windowNumber, screenRect(titled));
        assert(windowImage && !resultError && !resultUnsupported);
        fprintf(stderr, "titled window frame=%.0fx%.0f scale=%.1f output=%ldx%ld\n", titled.frame.size.width, titled.frame.size.height, titled.backingScaleFactor, (long)windowImage.pixelsWide, (long)windowImage.pixelsHigh);
        assert(windowImage.pixelsWide == (NSInteger)round(titled.frame.size.width * titled.backingScaleFactor));
        assert(windowImage.pixelsHigh == (NSInteger)round(titled.frame.size.height * titled.backingScaleFactor));
        NSColor *top = [[windowImage colorAtX:windowImage.pixelsWide / 2 y:8] colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
        NSColor *bottom = [[windowImage colorAtX:windowImage.pixelsWide / 2 y:windowImage.pixelsHigh - 20] colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
        assert(fabs(top.redComponent - bottom.redComponent) + fabs(top.greenComponent - bottom.greenComponent) + fabs(top.blueComponent - bottom.blueComponent) > .2);
        [titled close]; [titled release];
        puts("PASS native screenshot window: titlebar retained, output equals full frame, shadow excluded");

        // A region no single physical display can contain must explicitly take
        // the old system fallback; no image request is made for this geometry.
        CGRect all = CGRectNull;
        for (NSScreen *candidate in NSScreen.screens) all = CGRectUnion(all, CGRectMake(candidate.frame.origin.x, NSMaxY(NSScreen.screens[0].frame) - NSMaxY(candidate.frame), candidate.frame.size.width, candidate.frame.size.height));
        assert(!take(NO, 0, CGRectInset(all, -1, -1)) && resultUnsupported && !resultError);
        assert(!take(YES, UINT32_MAX, screenRect(base)) && resultError && !resultUnsupported);
        assert(!take(NO, 0, CGRectZero) && resultError && !resultUnsupported);

        NSUInteger before = completions;
        uintptr_t token = ++sequence; CGRect rect = screenRect(base);
        ciip_capture_png_begin(token, 0, 0, rect.origin.x, rect.origin.y, rect.size.width, rect.size.height);
        CIIPNativeCapture *cancelled = [nativeCaptures[@(token)] retain];
        ciip_capture_png_cancel(token); drain(.03);
        [cancelled captured:clean.CGImage error:nil]; drain(.03);
        assert(completions == before && !nativeCaptures[@(token)]); [cancelled release];
        puts("PASS native screenshot lifecycle: explicit fallback/errors, cancellation, ignored late callback");
        if (argc > 1) benchmark(base);
        [base close]; [base release]; [resultPNG release]; [resultError release];
        return 0;
    }
}
