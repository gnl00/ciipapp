//go:build darwin && cgo

#import "capture_snapshot_darwin.h"
#import "screen_capture_kit_darwin.h"
#import <CoreGraphics/CoreGraphics.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#include <math.h>

static const size_t desktopSnapshotMaxPixels = 100000000;
static NSString *const desktopSnapshotSizeError = @"屏幕画面过大，无法冻结截图选区";

static BOOL consumeDesktopPixels(size_t width, size_t height, size_t *remaining) {
    if (!width || !height || width > *remaining / height) return NO;
    *remaining -= width * height;
    return YES;
}

// The macOS 15 SDK marks this symbol obsolete, but macOS 12 and 13 ship it.
static NSDictionary<NSNumber *, id> *legacyDesktopFrames(NSArray<NSNumber *> *displayIDs, NSString **error) {
    CGImageRef (*captureDisplay)(CGDirectDisplayID) = dlsym(RTLD_DEFAULT, "CGDisplayCreateImage");
    if (!captureDisplay) {
        *error = @"系统不支持冻结屏幕画面";
        return nil;
    }
    size_t remaining = desktopSnapshotMaxPixels;
    for (NSNumber *number in displayIDs) {
        CGDisplayModeRef mode = CGDisplayCopyDisplayMode(number.unsignedIntValue);
        if (!mode) {
            *error = @"显示器已变化，请重新截图";
            return nil;
        }
        BOOL fits = consumeDesktopPixels(CGDisplayModeGetPixelWidth(mode), CGDisplayModeGetPixelHeight(mode), &remaining);
        CGDisplayModeRelease(mode);
        if (!fits) {
            *error = desktopSnapshotSizeError;
            return nil;
        }
    }
    NSMutableDictionary<NSNumber *, id> *frames = [NSMutableDictionary dictionaryWithCapacity:displayIDs.count];
    remaining = desktopSnapshotMaxPixels;
    for (NSNumber *number in displayIDs) {
        CGImageRef image = captureDisplay(number.unsignedIntValue);
        if (!image) {
            *error = @"无法冻结屏幕画面";
            return nil;
        }
        BOOL fits = consumeDesktopPixels(CGImageGetWidth(image), CGImageGetHeight(image), &remaining);
        if (fits) frames[number] = (id)image;
        CGImageRelease(image);
        if (!fits) {
            *error = desktopSnapshotSizeError;
            return nil;
        }
    }
    return frames;
}

typedef void (^DesktopSnapshotCompletion)(NSDictionary<NSNumber *, id> *, NSString *);

@interface CIIPDesktopSnapshot : NSObject
@property(nonatomic, copy) NSArray<NSNumber *> *displayIDs;
@property(nonatomic, copy) DesktopSnapshotCompletion completion;
@property(nonatomic, retain) NSMutableDictionary<NSNumber *, id> *frames;
- (void)start;
- (void)complete:(NSDictionary<NSNumber *, id> *)frames error:(NSString *)error;
- (void)captureModern API_AVAILABLE(macos(14.0));
@end

@implementation CIIPDesktopSnapshot
- (void)dealloc {
    [_displayIDs release]; [_completion release]; [_frames release];
    [super dealloc];
}
- (void)complete:(NSDictionary<NSNumber *, id> *)frames error:(NSString *)error {
    if (!self.completion) return;
    DesktopSnapshotCompletion completion = [self.completion copy];
    self.completion = nil;
    self.frames = nil;
    completion(frames, error);
    [completion release];
}
- (void)start {
    if (!self.displayIDs.count) {
        [self complete:nil error:@"没有可用的显示器"];
        return;
    }
    if (!CGPreflightScreenCaptureAccess()) {
        [self complete:nil error:@"屏幕录制权限不可用，请重新允许 ciip 截图"];
        return;
    }
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 4 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
        [self complete:nil error:@"冻结屏幕画面超时，请重试"];
    });
    if (@available(macOS 14.0, *)) {
        if (!loadNativeCaptureFramework()) {
            [self complete:nil error:@"无法加载系统截图框架"];
            return;
        }
        [self captureModern];
    } else {
        dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
            @autoreleasepool {
                NSString *error = nil;
                NSDictionary<NSNumber *, id> *frames = legacyDesktopFrames(self.displayIDs, &error);
                dispatch_async(dispatch_get_main_queue(), ^{ [self complete:frames error:error]; });
            }
        });
    }
}
- (void)captureModern {
    [NSClassFromString(@"SCShareableContent") getShareableContentExcludingDesktopWindows:YES
        onScreenWindowsOnly:YES completionHandler:^(SCShareableContent *content, NSError *error) {
        dispatch_async(dispatch_get_main_queue(), ^{
            if (!self.completion) return;
            if (!content || error) {
                [self complete:nil error:error.localizedDescription ?: @"无法读取可截图显示器"];
                return;
            }
            NSMutableDictionary<NSNumber *, SCDisplay *> *displays = [NSMutableDictionary dictionary];
            for (SCDisplay *display in content.displays) displays[@(display.displayID)] = display;
            NSMutableArray<SCContentFilter *> *filters = [NSMutableArray arrayWithCapacity:self.displayIDs.count];
            NSMutableArray<SCStreamConfiguration *> *configurations = [NSMutableArray arrayWithCapacity:self.displayIDs.count];
            size_t remaining = desktopSnapshotMaxPixels;
            for (NSNumber *number in self.displayIDs) {
                SCDisplay *display = displays[number];
                if (!display) {
                    [self complete:nil error:@"显示器已变化，请重新截图"];
                    return;
                }
                SCContentFilter *filter = [[[NSClassFromString(@"SCContentFilter") alloc] initWithDisplay:display excludingWindows:@[]] autorelease];
                double width = round(CGRectGetWidth(display.frame) * filter.pointPixelScale);
                double height = round(CGRectGetHeight(display.frame) * filter.pointPixelScale);
                if (!isfinite(width) || !isfinite(height) || width < 1 || height < 1 ||
                    width > remaining || height > remaining || !consumeDesktopPixels((size_t)width, (size_t)height, &remaining)) {
                    [self complete:nil error:desktopSnapshotSizeError];
                    return;
                }
                SCStreamConfiguration *configuration = [[[NSClassFromString(@"SCStreamConfiguration") alloc] init] autorelease];
                configuration.width = (size_t)width;
                configuration.height = (size_t)height;
                configuration.showsCursor = NO;
                configuration.shouldBeOpaque = YES;
                [filters addObject:filter];
                [configurations addObject:configuration];
            }
            self.frames = [NSMutableDictionary dictionaryWithCapacity:self.displayIDs.count];
            for (NSUInteger index = 0; index < self.displayIDs.count; index++) {
                NSNumber *number = self.displayIDs[index];
                SCStreamConfiguration *configuration = configurations[index];
                [NSClassFromString(@"SCScreenshotManager") captureImageWithFilter:filters[index]
                    configuration:configuration completionHandler:^(CGImageRef image, NSError *error) {
                    if (image) CGImageRetain(image);
                    dispatch_async(dispatch_get_main_queue(), ^{
                        if (self.completion) {
                            if (error || !image || CGImageGetWidth(image) != configuration.width ||
                                CGImageGetHeight(image) != configuration.height) {
                                [self complete:nil error:error.localizedDescription ?: @"冻结画面的尺寸已变化，请重新截图"];
                            } else {
                                self.frames[number] = (id)image;
                                if (self.frames.count == self.displayIDs.count) [self complete:[[self.frames copy] autorelease] error:nil];
                            }
                        }
                        if (image) CGImageRelease(image);
                    });
                }];
            }
        });
    }];
}
@end

void ciip_capture_desktop_frames(NSArray<NSNumber *> *displayIDs, DesktopSnapshotCompletion completion) {
    CIIPDesktopSnapshot *request = [[[CIIPDesktopSnapshot alloc] init] autorelease];
    request.displayIDs = [NSOrderedSet orderedSetWithArray:displayIDs].array;
    request.completion = completion;
    dispatch_async(dispatch_get_main_queue(), ^{ [request start]; });
}
