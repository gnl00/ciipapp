//go:build darwin && cgo

#import <Cocoa/Cocoa.h>
#import <QuartzCore/QuartzCore.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <ImageIO/ImageIO.h>
#include <stdint.h>
#include <math.h>
#include <dlfcn.h>

extern void ciip_go_capture_png(uintptr_t, void *, size_t, const char *, int);

static const size_t nativeCaptureMaxPixels = 60000000;
static const size_t nativeCaptureMaxBytes = 64 * 1024 * 1024;

// The app also supports macOS 12.0, where ScreenCaptureKit is absent. Load this
// public framework only on supported systems, without a mandatory dyld dependency.
static BOOL loadNativeCaptureFramework(void) {
    static dispatch_once_t once;
    static void *framework;
    dispatch_once(&once, ^{ framework = dlopen("/System/Library/Frameworks/ScreenCaptureKit.framework/ScreenCaptureKit", RTLD_LAZY | RTLD_LOCAL); });
    return framework && NSClassFromString(@"SCScreenshotManager");
}

static BOOL nativeCaptureRectValid(CGRect rect) {
    return !CGRectIsNull(rect) && !CGRectIsInfinite(rect) && isfinite(rect.origin.x) && isfinite(rect.origin.y) &&
        isfinite(rect.size.width) && isfinite(rect.size.height) && rect.size.width > 0 && rect.size.height > 0 &&
        fabs(rect.origin.x) <= 1000000 && fabs(rect.origin.y) <= 1000000 && rect.size.width <= 1000000 && rect.size.height <= 1000000;
}

// SCStreamConfiguration.sourceRect is local to the display, in logical points.
// Explicit output pixels preserve Retina density; never rescale a mixed-DPI region.
static BOOL nativeCaptureRegionPlan(CGRect rect, CGRect display, CGFloat scale, CGRect *source, size_t *width, size_t *height) {
    if (!nativeCaptureRectValid(rect) || !nativeCaptureRectValid(display) || !CGRectContainsRect(display, rect) || !isfinite(scale) || scale <= 0) return NO;
    double w = round(rect.size.width * scale), h = round(rect.size.height * scale);
    if (w < 1 || h < 1 || w > nativeCaptureMaxPixels || h > nativeCaptureMaxPixels || w * h > nativeCaptureMaxPixels) return NO;
    *source = CGRectOffset(rect, -display.origin.x, -display.origin.y); *width = w; *height = h;
    return YES;
}

@interface CIIPNativeCapture : NSObject
@property(nonatomic) uintptr_t token;
@property(nonatomic) BOOL windowMode, cancelled;
@property(nonatomic) CGWindowID windowID;
@property(nonatomic) CGRect rect;
- (void)start;
- (void)complete:(NSData *)data error:(NSString *)error unsupported:(BOOL)unsupported;
- (void)captured:(CGImageRef)image error:(NSError *)error;
@end

// Accessed only on AppKit's main queue. Completion blocks retain their request
// until Apple's asynchronous operation finishes, including after cancellation.
static NSMutableDictionary *nativeCaptures;

@implementation CIIPNativeCapture
- (void)complete:(NSData *)data error:(NSString *)error unsupported:(BOOL)unsupported {
    if (self.cancelled || nativeCaptures[@(self.token)] != self) return;
    self.cancelled = YES;
    [self retain]; [nativeCaptures removeObjectForKey:@(self.token)];
    ciip_go_capture_png(self.token, (void *)data.bytes, data.length, error.UTF8String, unsupported);
    [self release];
}
- (void)captured:(CGImageRef)image error:(NSError *)error {
    if (image) CGImageRetain(image);
    dispatch_async(dispatch_get_main_queue(), ^{
        if (self.cancelled) { if (image) CGImageRelease(image); return; }
        if (!image || error) {
            if (image) CGImageRelease(image);
            [self complete:nil error:error.localizedDescription ?: @"原生截图未返回图片" unsupported:NO];
            return;
        }
        size_t width = CGImageGetWidth(image), height = CGImageGetHeight(image);
        if (!width || !height || width > nativeCaptureMaxPixels / height) {
            CGImageRelease(image); [self complete:nil error:@"截图尺寸过大，最多支持 6000 万像素" unsupported:NO]; return;
        }
        // ImageIO encoding can be expensive for a large capture; keep it off AppKit.
        dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
            @autoreleasepool {
                NSMutableData *png = [NSMutableData data];
                CGImageDestinationRef destination = CGImageDestinationCreateWithData((CFMutableDataRef)png, CFSTR("public.png"), 1, NULL);
                BOOL encoded = NO;
                if (destination) {
                    CGImageDestinationAddImage(destination, image, NULL);
                    encoded = CGImageDestinationFinalize(destination); CFRelease(destination);
                }
                CGImageRelease(image);
                NSString *failure = !encoded ? @"无法编码截图 PNG" : png.length > nativeCaptureMaxBytes ? @"截图超过 64 MB" : nil;
                dispatch_async(dispatch_get_main_queue(), ^{ [self complete:failure ? nil : png error:failure unsupported:NO]; });
            }
        });
    });
}
- (void)start {
    if (self.cancelled) return;
    if (!nativeCaptureRectValid(self.rect) || (self.windowMode && !self.windowID)) {
        [self complete:nil error:@"截图选区无效" unsupported:NO]; return;
    }
    if (!CGPreflightScreenCaptureAccess()) {
        [self complete:nil error:@"屏幕录制权限不可用，请重新允许 ciip 截图" unsupported:NO]; return;
    }
    if (@available(macOS 14.0, *)) {
        if (!loadNativeCaptureFramework()) { [self complete:nil error:@"无法加载系统截图框架" unsupported:NO]; return; }
    }
    if (@available(macOS 14.0, *)) {
        [NSClassFromString(@"SCShareableContent") getShareableContentExcludingDesktopWindows:YES onScreenWindowsOnly:YES completionHandler:^(SCShareableContent *content, NSError *error) {
            dispatch_async(dispatch_get_main_queue(), ^{
                if (self.cancelled) return;
                if (error || !content) { [self complete:nil error:error.localizedDescription ?: @"无法读取可截图内容" unsupported:NO]; return; }
                SCContentFilter *filter = nil;
                SCStreamConfiguration *configuration = [[[NSClassFromString(@"SCStreamConfiguration") alloc] init] autorelease];
                configuration.showsCursor = NO; configuration.shouldBeOpaque = NO;
                configuration.ignoreShadowsSingleWindow = YES; configuration.ignoreGlobalClipSingleWindow = YES;
                if (self.windowMode) {
                    for (SCWindow *window in content.windows) if (window.windowID == self.windowID) {
                        filter = [[[NSClassFromString(@"SCContentFilter") alloc] initWithDesktopIndependentWindow:window] autorelease]; break;
                    }
                    if (!filter) { [self complete:nil error:@"截图窗口已关闭或不可读取，请重新选择" unsupported:NO]; return; }
                    CGRect source; size_t width, height;
                    if (!nativeCaptureRegionPlan(filter.contentRect, filter.contentRect, filter.pointPixelScale, &source, &width, &height)) {
                        [self complete:nil error:@"截图尺寸过大或无效" unsupported:NO]; return;
                    }
                    configuration.width = width; configuration.height = height;
                } else {
                    for (SCDisplay *display in content.displays) {
                        if (!CGRectContainsRect(display.frame, self.rect)) continue;
                        filter = [[[NSClassFromString(@"SCContentFilter") alloc] initWithDisplay:display excludingWindows:@[]] autorelease];
                        CGRect source; size_t width, height;
                        if (!nativeCaptureRegionPlan(self.rect, display.frame, filter.pointPixelScale, &source, &width, &height)) {
                            [self complete:nil error:@"截图尺寸过大或无效" unsupported:NO]; return;
                        }
                        configuration.sourceRect = source; configuration.width = width; configuration.height = height;
                        break;
                    }
                    // The macOS 15.2 display-agnostic rectangle API includes the
                    // pointer and offers no configuration to exclude it. Keep
                    // system capture for cross-display regions instead of
                    // changing cursor or mixed-DPI screenshot semantics.
                    if (!filter) { [self complete:nil error:nil unsupported:YES]; return; }
                }
                [NSClassFromString(@"SCScreenshotManager") captureImageWithFilter:filter configuration:configuration completionHandler:^(CGImageRef image, NSError *error) { [self captured:image error:error]; }];
            });
        }];
    } else {
        [self complete:nil error:nil unsupported:YES];
    }
}
@end

void ciip_capture_png_begin(uintptr_t token, int window, uint32_t windowID, double x, double y, double width, double height) {
    @autoreleasepool {
        if (!nativeCaptures) nativeCaptures = [[NSMutableDictionary alloc] init];
        CIIPNativeCapture *request = [[[CIIPNativeCapture alloc] init] autorelease];
        request.token = token; request.windowMode = window != 0; request.windowID = windowID; request.rect = CGRectMake(x, y, width, height);
        nativeCaptures[@(token)] = request;
        // Picker.finish closes every panel before notifying Go. Flush that
        // transaction, then start on the next main-queue turn: SCK requests a new
        // compositor frame, without a fixed sleep between selection and capture.
        [CATransaction flush];
        dispatch_async(dispatch_get_main_queue(), ^{ [request start]; });
    }
}

void ciip_capture_png_cancel(uintptr_t token) {
    CIIPNativeCapture *request = nativeCaptures[@(token)];
    request.cancelled = YES; [nativeCaptures removeObjectForKey:@(token)];
}
