//go:build darwin && cgo

#import <Foundation/Foundation.h>
#include <math.h>
#include <sys/xattr.h>

int ciip_capture_rect(const char *path, double *x, double *y, double *width, double *height) {
    if (!path || !x || !y || !width || !height) return 0;
    @autoreleasepool {
        // screencapture stores four global, top-left-origin point coordinates.
        // Format corroborated by https://tendedero.app/blog/macos-surprises/#04-where-on-screen-was-that-screenshot-taken
        const char *name = "com.apple.metadata:kMDItemScreenCaptureGlobalRect";
        ssize_t size = getxattr(path, name, NULL, 0, 0, 0);
        if (size <= 0 || size > 4096) return 0;
        NSMutableData *data = [NSMutableData dataWithLength:(NSUInteger)size];
        if (getxattr(path, name, data.mutableBytes, (size_t)size, 0, 0) != size) return 0;
        id value = [NSPropertyListSerialization propertyListWithData:data options:NSPropertyListImmutable format:NULL error:NULL];
        if (![value isKindOfClass:[NSArray class]] || [value count] != 4) return 0;
        double coordinates[4];
        for (NSUInteger i = 0; i < 4; i++) {
            id number = [value objectAtIndex:i];
            if (![number isKindOfClass:[NSNumber class]] || CFGetTypeID((CFTypeRef)number) == CFBooleanGetTypeID()) return 0;
            coordinates[i] = [number doubleValue];
            if (!isfinite(coordinates[i]) || fabs(coordinates[i]) > 1000000) return 0;
        }
        if (coordinates[2] <= 0 || coordinates[3] <= 0) return 0;
        *x = coordinates[0]; *y = coordinates[1]; *width = coordinates[2]; *height = coordinates[3];
        return 1;
    }
}
