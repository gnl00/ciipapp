#pragma once

#import <Foundation/Foundation.h>
#include <dlfcn.h>

// macOS 12.0 does not ship ScreenCaptureKit. Avoid a mandatory dyld dependency.
static inline BOOL loadNativeCaptureFramework(void) {
    static dispatch_once_t once;
    static void *framework;
    dispatch_once(&once, ^{
        framework = dlopen("/System/Library/Frameworks/ScreenCaptureKit.framework/ScreenCaptureKit", RTLD_LAZY | RTLD_LOCAL);
    });
    return framework && NSClassFromString(@"SCScreenshotManager");
}
