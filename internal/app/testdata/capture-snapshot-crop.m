// Synthetic displays with known pixels. No AppKit session or screen access is needed.
#import "../capture_snapshot_crop_darwin.h"
#import <ImageIO/ImageIO.h>
#include <assert.h>

static CGImageRef makeFrame(size_t width, size_t height, uint8_t red, uint8_t blue) {
    NSMutableData *pixels = [NSMutableData dataWithLength:width * height * 4];
    uint8_t *bytes = pixels.mutableBytes;
    for (size_t y = 0; y < height; y++) {
        for (size_t x = 0; x < width; x++) {
            uint8_t *pixel = bytes + (y * width + x) * 4;
            pixel[0] = red + x; pixel[1] = 30 + 12 * y; pixel[2] = blue; pixel[3] = 255;
        }
    }
    CGDataProviderRef provider = CGDataProviderCreateWithCFData((CFDataRef)pixels);
    CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    CGImageRef image = CGImageCreate(width, height, 8, 32, width * 4, space,
        kCGImageAlphaLast | kCGBitmapByteOrder32Big, provider, NULL, NO, kCGRenderingIntentDefault);
    CGDataProviderRelease(provider);
    CGColorSpaceRelease(space);
    assert(image);
    return image;
}

static NSData *decodePNG(NSData *png, size_t width, size_t height) {
    assert(png);
    CGImageSourceRef source = CGImageSourceCreateWithData((CFDataRef)png, NULL);
    CGImageRef image = CGImageSourceCreateImageAtIndex(source, 0, NULL);
    CFRelease(source);
    assert(image && CGImageGetWidth(image) == width && CGImageGetHeight(image) == height);
    NSMutableData *data = [NSMutableData dataWithLength:width * height * 4];
    CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    CGContextRef output = CGBitmapContextCreate(data.mutableBytes, width, height, 8, width * 4, space,
        kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
    CGColorSpaceRelease(space);
    assert(output);
    CGContextDrawImage(output, CGRectMake(0, 0, width, height), image);
    CGContextRelease(output);
    CGImageRelease(image);
    return data;
}

static void assertPixel(NSData *data, size_t width, size_t x, size_t y, uint8_t red, uint8_t green, uint8_t blue, uint8_t alpha) {
    const uint8_t *pixel = (const uint8_t *)data.bytes + (y * width + x) * 4;
    assert(pixel[0] == red && pixel[1] == green && pixel[2] == blue && pixel[3] == alpha);
}

int main(void) {
    @autoreleasepool {
        CGImageRef retina = makeFrame(4, 4, 100, 50), standard = makeFrame(2, 2, 20, 180);
        NSDictionary *frames = @{@1: (__bridge id)retina, @2: (__bridge id)standard};
        NSDictionary *displays = @{@1: [NSValue valueWithRect:NSMakeRect(-3, -2, 2, 2)],
            @2: [NSValue valueWithRect:NSMakeRect(0, -1, 2, 2)]};
        CGImageRelease(retina);
        CGImageRelease(standard);

        NSString *error = nil;
        NSData *single = ciip_crop_desktop_frames(frames, displays, CGRectMake(-2, -1, 1, 1), &error);
        assert(single && !error);
        NSData *pixels = decodePNG(single, 2, 2);
        assertPixel(pixels, 2, 0, 0, 102, 54, 50, 255);
        assertPixel(pixels, 2, 1, 1, 103, 66, 50, 255);

        NSData *spanning = ciip_crop_desktop_frames(frames, displays, CGRectMake(-2, -2, 4, 3), &error);
        assert(spanning && !error);
        pixels = decodePNG(spanning, 8, 6);
        assertPixel(pixels, 8, 0, 0, 102, 30, 50, 255);
        assertPixel(pixels, 8, 1, 3, 103, 66, 50, 255);
        assertPixel(pixels, 8, 2, 2, 0, 0, 0, 0);
        assertPixel(pixels, 8, 4, 1, 0, 0, 0, 0);
        assertPixel(pixels, 8, 4, 2, 20, 30, 180, 255);
        assertPixel(pixels, 8, 5, 3, 20, 30, 180, 255);
        assertPixel(pixels, 8, 6, 4, 21, 42, 180, 255);
        assertPixel(pixels, 8, 7, 5, 21, 42, 180, 255);

        NSDictionary *adjacent = @{@1: displays[@1], @2: [NSValue valueWithRect:NSMakeRect(-1, -2, 2, 2)]};
        NSData *seam = ciip_crop_desktop_frames(frames, adjacent, CGRectMake(-2, -2, 2, 2), &error);
        assert(seam && !error);
        pixels = decodePNG(seam, 4, 4);
        assertPixel(pixels, 4, 1, 3, 103, 66, 50, 255);
        assertPixel(pixels, 4, 2, 3, 20, 42, 180, 255);

        assert(!ciip_crop_desktop_frames(frames, displays, CGRectMake(8, 8, 2, 2), &error) && error);
        assert(!ciip_crop_desktop_frames(@{}, displays, CGRectMake(-2, -1, 1, 1), &error) && error);
        assert(!ciip_crop_desktop_frames(frames, displays, CGRectMake(-2, -2, 10000, 10000), &error) && error);
        puts("PASS frozen screenshot crop orientation, Retina pixels, mixed-scale composition, gaps, and limits");
    }
    return 0;
}
