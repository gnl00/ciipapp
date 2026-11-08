// Regenerate: clang internal/app/testdata/ocr-multilingual.m -framework Foundation -framework CoreGraphics -framework CoreText -framework ImageIO -o /tmp/ciip-ocr-fixture && /tmp/ciip-ocr-fixture internal/app/testdata/ocr-multilingual.png
#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>
#import <CoreText/CoreText.h>
#import <ImageIO/ImageIO.h>

int main(int argc, char **argv) {
    @autoreleasepool {
        if (argc != 2) return 2;
        CGColorSpaceRef space = CGColorSpaceCreateDeviceRGB();
        CGContextRef context = CGBitmapContextCreate(NULL, 1200, 400, 8, 1200*4, space, kCGImageAlphaPremultipliedLast);
        CGColorSpaceRelease(space);
        CGContextSetRGBFillColor(context, 1, 1, 1, 1);
        CGContextFillRect(context, CGRectMake(0, 0, 1200, 400));
        CGColorRef black = CGColorCreateGenericRGB(0, 0, 0, 1);
        CTFontRef font = CTFontCreateWithName(CFSTR("PingFangSC-Regular"), 48, NULL);
        NSArray *text = @[@"CIIP OCR 2026", @"截图文字识别", @"繁體中文測試"];
        for (NSUInteger i = 0; i < text.count; i++) {
            NSAttributedString *string = [[[NSAttributedString alloc] initWithString:text[i] attributes:@{(id)kCTFontAttributeName:(id)font, (id)kCTForegroundColorAttributeName:(id)black}] autorelease];
            CTLineRef line = CTLineCreateWithAttributedString((CFAttributedStringRef)string);
            CGContextSetTextPosition(context, 50, 312-i*110);
            CTLineDraw(line, context);
            CFRelease(line);
        }
        CGImageRef image = CGBitmapContextCreateImage(context);
        NSURL *url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[1]]];
        CGImageDestinationRef destination = CGImageDestinationCreateWithURL((CFURLRef)url, CFSTR("public.png"), 1, NULL);
        CGImageDestinationAddImage(destination, image, NULL);
        BOOL saved = CGImageDestinationFinalize(destination);
        CFRelease(destination); CGImageRelease(image); CFRelease(font); CGColorRelease(black); CGContextRelease(context);
        return saved ? 0 : 1;
    }
}
