// Run from the project root:
// clang -framework Cocoa -framework CoreGraphics internal/app/permissions_darwin.m scripts/render-tray-icons.m -o build/render-tray-icons && build/render-tray-icons
#import <Cocoa/Cocoa.h>
#include <stdlib.h>
extern char *ciip_tray_icon(const char *style);
static NSImage *tinted(NSImage *source, NSColor *ink) {
    NSImage *image=[[[NSImage alloc] initWithSize:source.size] autorelease];
    [image lockFocus];[source drawAtPoint:NSZeroPoint fromRect:NSZeroRect operation:NSCompositingOperationSourceOver fraction:1];
    [ink setFill];NSRectFillUsingOperation(NSMakeRect(0,0,image.size.width,image.size.height),NSCompositingOperationSourceIn);[image unlockFocus];
    return image;
}
static void renderLigature(NSString *directory) {
    char *encoded=ciip_tray_icon("ligature");
    NSData *png=[[[NSData alloc] initWithBase64EncodedString:[NSString stringWithUTF8String:encoded] options:0] autorelease];free(encoded);
    [png writeToFile:[directory stringByAppendingPathComponent:@"ciip-menubar-ligature.png"] atomically:YES];
    NSImage *source=[[[NSImage alloc] initWithData:png] autorelease];
    NSBitmapImageRep *sheet=[[[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:1080 pixelsHigh:600 bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0] autorelease];
    [NSGraphicsContext saveGraphicsState];[NSGraphicsContext setCurrentContext:[NSGraphicsContext graphicsContextWithBitmapImageRep:sheet]];
    NSArray *labels=@[@"17px · 1x",@"17pt · Retina 2x",@"17pt · 6x detail"];
    CGFloat sizes[]={17,34,204};
    for(NSUInteger row=0;row<2;row++) {
        BOOL dark=row==0;CGFloat y=row*300;
        [(dark?[NSColor colorWithWhite:.13 alpha:1]:[NSColor colorWithWhite:.97 alpha:1]) setFill];NSRectFill(NSMakeRect(0,y,1080,300));
        NSColor *ink=dark?NSColor.whiteColor:NSColor.blackColor;
        NSImage *image=dark?tinted(source,ink):source;
        for(NSUInteger column=0;column<3;column++) {
            CGFloat size=sizes[column],center=180+column*360;
            [image drawInRect:NSMakeRect(center-size/2,y+165-size/2,size,size)];
            [labels[column] drawAtPoint:NSMakePoint(center-65,y+20) withAttributes:@{NSFontAttributeName:[NSFont systemFontOfSize:13],NSForegroundColorAttributeName:ink}];
        }
    }
    [NSGraphicsContext restoreGraphicsState];
    [[sheet representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:[directory stringByAppendingPathComponent:@"ciip-0.9.6-ligature-preview.png"] atomically:YES];
}
int main(void) {
    @autoreleasepool {
        NSString *directory=@"docs/evidence";
        [[NSFileManager defaultManager] createDirectoryAtPath:directory withIntermediateDirectories:YES attributes:nil error:nil];
        NSArray *styles=@[@"capture",@"pin",@"wordmark"];
        NSBitmapImageRep *sheet=[[[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:720 pixelsHigh:240 bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0] autorelease];
        [NSGraphicsContext saveGraphicsState];[NSGraphicsContext setCurrentContext:[NSGraphicsContext graphicsContextWithBitmapImageRep:sheet]];
        [NSColor.whiteColor setFill];NSRectFill(NSMakeRect(0,0,720,240));
        for (NSUInteger i=0;i<styles.count;i++) {
            NSString *style=styles[i];char *encoded=ciip_tray_icon(style.UTF8String);
            NSData *png=[[[NSData alloc] initWithBase64EncodedString:[NSString stringWithUTF8String:encoded] options:0] autorelease];free(encoded);
            [png writeToFile:[directory stringByAppendingPathComponent:[NSString stringWithFormat:@"ciip-menubar-%@.png",style]] atomically:YES];
            NSImage *icon=[[[NSImage alloc] initWithData:png] autorelease];
            CGFloat width=icon.size.width*36/icon.size.height;
            [icon drawInRect:NSMakeRect(120+i*240-width/2,155,width,36)];
            [icon drawInRect:NSMakeRect(120+i*240-width,55,width*2,72)];
            [style drawAtPoint:NSMakePoint(95+i*240,20) withAttributes:@{NSFontAttributeName:[NSFont systemFontOfSize:13],NSForegroundColorAttributeName:NSColor.blackColor}];
        }
        [NSGraphicsContext restoreGraphicsState];
        [[sheet representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:[directory stringByAppendingPathComponent:@"ciip-menubar-preview.png"] atomically:YES];
        renderLigature(directory);
    }
    return 0;
}
