//go:build darwin && cgo

#import "capture_snapshot_crop_darwin.h"
#import <ImageIO/ImageIO.h>
#include <math.h>

static const size_t snapshotMaxPixels = 60000000;
static const size_t snapshotMaxBytes = 64 * 1024 * 1024;

static BOOL validSnapshotRect(CGRect rect) {
    return isfinite(CGRectGetMinX(rect)) && isfinite(CGRectGetMinY(rect)) &&
        isfinite(CGRectGetMaxX(rect)) && isfinite(CGRectGetMaxY(rect)) &&
        rect.size.width > 0 && rect.size.height > 0;
}

static BOOL validSnapshotSize(double width, double height) {
    return width >= 1 && height >= 1 && width * height <= snapshotMaxPixels;
}

static NSData *snapshotFailure(NSString **error, NSString *message) {
    if (error) *error = message;
    return nil;
}

static CGRect snapshotSourcePixels(CGRect selection, CGRect display, CGImageRef image) {
    CGFloat scaleX = CGImageGetWidth(image) / display.size.width;
    CGFloat scaleY = CGImageGetHeight(image) / display.size.height;
    CGRect source = CGRectMake((selection.origin.x - display.origin.x) * scaleX,
        (selection.origin.y - display.origin.y) * scaleY, selection.size.width * scaleX, selection.size.height * scaleY);
    return CGRectIntersection(CGRectIntegral(source), CGRectMake(0, 0, CGImageGetWidth(image), CGImageGetHeight(image)));
}

typedef struct {
    NSMutableData *data;
    BOOL exceededLimit;
} SnapshotPNG;

static size_t appendSnapshotPNG(void *info, const void *bytes, size_t count) {
    SnapshotPNG *png = info;
    if (png->exceededLimit || count > snapshotMaxBytes - png->data.length) {
        png->exceededLimit = YES;
        return 0;
    }
    [png->data appendBytes:bytes length:count];
    return count;
}

static NSData *encodeSnapshot(CGImageRef image, NSString **error) {
    if (!image) return snapshotFailure(error, @"无法裁剪冻结画面");
    SnapshotPNG png = { [NSMutableData data], NO };
    CGDataConsumerCallbacks callbacks = { appendSnapshotPNG, NULL };
    CGDataConsumerRef consumer = CGDataConsumerCreate(&png, &callbacks);
    CGImageDestinationRef destination = consumer ? CGImageDestinationCreateWithDataConsumer(consumer, CFSTR("public.png"), 1, NULL) : NULL;
    BOOL encoded = NO;
    if (destination) {
        CGImageDestinationAddImage(destination, image, NULL);
        encoded = CGImageDestinationFinalize(destination);
        CFRelease(destination);
    }
    if (consumer) CGDataConsumerRelease(consumer);
    if (png.exceededLimit) return snapshotFailure(error, @"截图超过 64 MB");
    if (!encoded || !png.data.length) return snapshotFailure(error, @"无法编码截图 PNG");
    return png.data;
}

NSData *ciip_crop_desktop_frames(NSDictionary<NSNumber *, id> *frames,
    NSDictionary<NSNumber *, NSValue *> *displayRects, CGRect selection, NSString **error) {
    if (error) *error = nil;
    if (!validSnapshotRect(selection)) return snapshotFailure(error, @"截图选区无效");

    NSArray<NSNumber *> *displayIDs = [displayRects.allKeys sortedArrayUsingSelector:@selector(compare:)];
    CGFloat scale = 0;
    for (NSNumber *displayID in displayIDs) {
        CGRect display = NSRectToCGRect([displayRects[displayID] rectValue]);
        if (!validSnapshotRect(display)) return snapshotFailure(error, @"显示器范围无效");
        if (CGRectIsEmpty(CGRectIntersection(selection, display))) continue;
        CGImageRef image = (__bridge CGImageRef)frames[displayID];
        if (!image || !CGImageGetWidth(image) || !CGImageGetHeight(image)) return snapshotFailure(error, @"冻结画面缺少所选显示器");
        if (CGRectContainsRect(display, selection)) {
            CGRect source = snapshotSourcePixels(selection, display, image);
            if (!validSnapshotSize(source.size.width, source.size.height)) return snapshotFailure(error, @"截图尺寸过大或无效");
            CGImageRef crop = CGImageCreateWithImageInRect(image, source);
            NSData *png = encodeSnapshot(crop, error);
            if (crop) CGImageRelease(crop);
            return png;
        }
        scale = MAX(scale, MAX(CGImageGetWidth(image) / display.size.width, CGImageGetHeight(image) / display.size.height));
    }
    if (scale <= 0) return snapshotFailure(error, @"截图选区不在显示器内");

    double width = round(selection.size.width * scale), height = round(selection.size.height * scale);
    if (!validSnapshotSize(width, height)) return snapshotFailure(error, @"截图尺寸过大或无效");
    CGColorSpaceRef colorSpace = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    if (!colorSpace) return snapshotFailure(error, @"无法创建跨屏截图色彩空间");
    CGContextRef output = CGBitmapContextCreate(NULL, (size_t)width, (size_t)height, 8, (size_t)width * 4,
        colorSpace, kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
    CGColorSpaceRelease(colorSpace);
    if (!output) return snapshotFailure(error, @"无法分配跨屏截图画布");
    CGContextClearRect(output, CGRectMake(0, 0, width, height));
    CGContextSetInterpolationQuality(output, kCGInterpolationNone);

    for (NSNumber *displayID in displayIDs) {
        CGRect display = NSRectToCGRect([displayRects[displayID] rectValue]);
        CGRect visible = CGRectIntersection(selection, display);
        if (CGRectIsEmpty(visible)) continue;
        CGImageRef image = (__bridge CGImageRef)frames[displayID];
        CGRect source = snapshotSourcePixels(visible, display, image);
        CGImageRef crop = CGImageCreateWithImageInRect(image, source);
        if (!crop) {
            CGContextRelease(output);
            return snapshotFailure(error, @"无法裁剪冻结画面");
        }
        // Align adjacent display edges to the same output pixel. For fractional
        // source pixels, draw the expanded crop and clip it to that boundary.
        CGFloat left = round((CGRectGetMinX(visible) - selection.origin.x) * scale);
        CGFloat right = round((CGRectGetMaxX(visible) - selection.origin.x) * scale);
        CGFloat top = round((CGRectGetMinY(visible) - selection.origin.y) * scale);
        CGFloat bottom = round((CGRectGetMaxY(visible) - selection.origin.y) * scale);
        CGFloat stepX = display.size.width / CGImageGetWidth(image) * scale;
        CGFloat stepY = display.size.height / CGImageGetHeight(image) * scale;
        CGFloat x = (display.origin.x - selection.origin.x) * scale + source.origin.x * stepX;
        CGFloat y = (display.origin.y - selection.origin.y) * scale + CGRectGetMaxY(source) * stepY;
        CGContextSaveGState(output);
        CGContextClipToRect(output, CGRectMake(left, height - bottom, right - left, bottom - top));
        CGContextDrawImage(output, CGRectMake(x, height - y, source.size.width * stepX, source.size.height * stepY), crop);
        CGContextRestoreGState(output);
        CGImageRelease(crop);
    }
    CGImageRef result = CGBitmapContextCreateImage(output);
    CGContextRelease(output);
    NSData *png = encodeSnapshot(result, error);
    if (result) CGImageRelease(result);
    return png;
}
