//go:build darwin && cgo

#import <Cocoa/Cocoa.h>
#import <CoreGraphics/CoreGraphics.h>
#include <stdlib.h>
#include <string.h>

static NSURL *ciipAppURL(void) {
    NSURL *url = NSBundle.mainBundle.bundleURL;
    return [url.pathExtension.lowercaseString isEqualToString:@"app"] ? url : nil;
}
char *ciip_bundle_identifier(void) { @autoreleasepool { return strdup((NSBundle.mainBundle.bundleIdentifier ?: @"dev.ciip.app").UTF8String); } }
char *ciip_application_path(void) { @autoreleasepool { return strdup((ciipAppURL().path ?: @"").UTF8String); } }
int ciip_screen_permission(void) { return CGPreflightScreenCaptureAccess(); }
int ciip_reveal_application(void) {
    NSURL *url=ciipAppURL();if(!url)return 0;
    [NSWorkspace.sharedWorkspace activateFileViewerSelectingURLs:@[url]];return 1;
}

@interface CIIPPermissionIcon : NSImageView <NSDraggingSource>
@end
@implementation CIIPPermissionIcon
- (BOOL)acceptsFirstMouse:(NSEvent *)event { return YES; }
- (BOOL)needsPanelToBecomeKey { return NO; }
- (BOOL)mouseDownCanMoveWindow { return NO; }
- (BOOL)shouldDelayWindowOrderingForEvent:(NSEvent *)event { return YES; }
- (void)resetCursorRects { [self addCursorRect:self.bounds cursor:NSCursor.openHandCursor]; }
- (void)mouseDown:(NSEvent *)event {
    NSURL *url=ciipAppURL();if(!url)return;
    [NSApp preventWindowOrdering];
    NSDraggingItem *item=[[[NSDraggingItem alloc] initWithPasteboardWriter:url] autorelease];
    [item setDraggingFrame:self.bounds contents:self.image];
    NSDraggingSession *session=[self beginDraggingSessionWithItems:@[item] event:event source:self];
    session.animatesToStartingPositionsOnCancelOrFail=YES;
}
- (NSDragOperation)draggingSession:(NSDraggingSession *)session sourceOperationMaskForDraggingContext:(NSDraggingContext)context { return NSDragOperationCopy; }
@end

@interface CIIPPermissionPanel : NSPanel <NSWindowDelegate>
@property(nonatomic,retain) NSTextField *permissionStatus;
- (void)dockBesideSettings;
@end
@implementation CIIPPermissionPanel
- (void)refreshStatus {
    BOOL granted=CGPreflightScreenCaptureAccess();
    self.permissionStatus.stringValue=granted?@"屏幕录制已允许":@"需要允许 ciip 录制屏幕，才能截取图片";
    self.permissionStatus.textColor=granted?[NSColor systemGreenColor]:[NSColor secondaryLabelColor];
}
- (void)requestPermission:(id)sender { CGRequestScreenCaptureAccess(); [self refreshStatus]; }
- (void)dockBesideSettings {
    NSScreen *screen=self.screen ?: NSScreen.mainScreen;if(!screen)return;
    NSRect visible=screen.visibleFrame,frame=self.frame;
    frame.origin.x=NSMinX(visible)+16;
    frame.origin.y=MAX(NSMinY(visible)+16,MIN(NSMidY(visible)-frame.size.height/2,NSMaxY(visible)-frame.size.height-16));
    [self setFrame:[self constrainFrameRect:frame toScreen:screen] display:YES];
}
- (void)openSettings:(id)sender {
    [self dockBesideSettings];
    if(![NSWorkspace.sharedWorkspace openURL:[NSURL URLWithString:@"x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"]]){
        self.permissionStatus.stringValue=@"未能打开系统设置，请手动打开屏幕录制设置。";
        self.permissionStatus.textColor=NSColor.secondaryLabelColor;
    }
}
- (void)reveal:(id)sender { ciip_reveal_application(); }
- (void)windowDidBecomeKey:(NSNotification *)notification { [self refreshStatus]; }
- (void)dealloc { [_permissionStatus release];[super dealloc]; }
@end
static CIIPPermissionPanel *permissionPanel;
static NSTextField *permissionLabel(NSString *text,NSRect frame,CGFloat size,NSFontWeight weight) {
    NSTextField *label=[NSTextField wrappingLabelWithString:text];label.frame=frame;label.font=[NSFont systemFontOfSize:size weight:weight];label.alignment=NSTextAlignmentCenter;return label;
}
int ciip_show_permission_guide(void) {
    NSURL *appURL=ciipAppURL();if(!appURL)return 0;
    if(!permissionPanel){
        permissionPanel=[[CIIPPermissionPanel alloc] initWithContentRect:NSMakeRect(0,0,360,430) styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskNonactivatingPanel backing:NSBackingStoreBuffered defer:NO];
        permissionPanel.title=@"允许 ciip 截图";permissionPanel.titlebarAppearsTransparent=YES;permissionPanel.releasedWhenClosed=NO;
        // The Settings app stays active while this utility remains available as a drag source.
        permissionPanel.hidesOnDeactivate=NO;permissionPanel.becomesKeyOnlyIfNeeded=YES;permissionPanel.floatingPanel=YES;
        permissionPanel.level=NSFloatingWindowLevel;permissionPanel.delegate=permissionPanel;
        permissionPanel.collectionBehavior=NSWindowCollectionBehaviorCanJoinAllSpaces|NSWindowCollectionBehaviorFullScreenAuxiliary;
        NSVisualEffectView *content=[[[NSVisualEffectView alloc] initWithFrame:NSMakeRect(0,0,360,430)] autorelease];content.material=NSVisualEffectMaterialPopover;content.blendingMode=NSVisualEffectBlendingModeBehindWindow;content.state=NSVisualEffectStateActive;permissionPanel.contentView=content;
        [content addSubview:permissionLabel(@"让截图随手可用",NSMakeRect(22,374,316,30),20,NSFontWeightSemibold)];
        NSTextField *intro=permissionLabel(@"ciip 只在你发起截图时读取屏幕内容。",NSMakeRect(22,342,316,24),12,NSFontWeightRegular);intro.textColor=NSColor.secondaryLabelColor;[content addSubview:intro];
        CIIPPermissionIcon *icon=[[[CIIPPermissionIcon alloc] initWithFrame:NSMakeRect(138,242,84,84)] autorelease];icon.image=[NSWorkspace.sharedWorkspace iconForFile:appURL.path];icon.imageScaling=NSImageScaleProportionallyUpOrDown;icon.toolTip=@"直接拖动到系统设置的屏幕录制应用列表，无需先激活此窗口";[icon setAccessibilityLabel:@"拖动 ciip 应用图标"];[content addSubview:icon];
        [content addSubview:permissionLabel(@"把 ciip.app 拖进屏幕录制列表",NSMakeRect(24,213,312,20),12,NSFontWeightMedium)];
        permissionPanel.permissionStatus=permissionLabel(@"",NSMakeRect(24,180,312,26),11,NSFontWeightMedium);[content addSubview:permissionPanel.permissionStatus];
        NSTextField *steps=permissionLabel(@"打开设置后，此窗口会留在左侧。\n可直接拖动图标；如果列表不接受拖入，\n点系统列表的“＋”选择 ciip.app。",NSMakeRect(24,118,312,54),11,NSFontWeightRegular);steps.textColor=NSColor.secondaryLabelColor;[content addSubview:steps];
        NSButton *settings=[NSButton buttonWithTitle:@"打开系统设置" target:permissionPanel action:@selector(openSettings:)];settings.frame=NSMakeRect(28,80,304,32);settings.bezelStyle=NSBezelStyleRounded;[content addSubview:settings];
        NSArray *titles=@[@"请求授权",@"在 Finder 中显示"];
        SEL actions[]={@selector(requestPermission:),@selector(reveal:)};
        for(int i=0;i<2;i++){NSButton *button=[NSButton buttonWithTitle:titles[i] target:permissionPanel action:actions[i]];button.frame=NSMakeRect(28+i*160,42,144,28);button.bezelStyle=NSBezelStyleRounded;button.font=[NSFont systemFontOfSize:11];[content addSubview:button];}
        NSTextField *note=permissionLabel(@"允许后可关闭此窗口，按系统提示重新打开应用。",NSMakeRect(18,12,324,22),10,NSFontWeightRegular);note.textColor=NSColor.tertiaryLabelColor;[content addSubview:note];
        [permissionPanel center];
    }
    [permissionPanel refreshStatus];[permissionPanel makeKeyAndOrderFront:nil];return 1;
}
// A small, open capture frame keeps the custom lettering legible at 18pt.
static void ciipDrawTrayWordmark(void) {
    NSBezierPath *frame=[NSBezierPath bezierPath];
    frame.lineWidth=1.7;frame.lineCapStyle=NSLineCapStyleRound;frame.lineJoinStyle=NSLineJoinStyleRound;
    [frame moveToPoint:NSMakePoint(11,4)];[frame lineToPoint:NSMakePoint(6,4)];[frame curveToPoint:NSMakePoint(3,7) controlPoint1:NSMakePoint(4.3,4) controlPoint2:NSMakePoint(3,5.3)];[frame lineToPoint:NSMakePoint(3,11)];
    [frame moveToPoint:NSMakePoint(3,21)];[frame lineToPoint:NSMakePoint(3,25)];[frame curveToPoint:NSMakePoint(6,28) controlPoint1:NSMakePoint(3,26.7) controlPoint2:NSMakePoint(4.3,28)];[frame lineToPoint:NSMakePoint(11,28)];
    [frame moveToPoint:NSMakePoint(37,28)];[frame lineToPoint:NSMakePoint(42,28)];[frame curveToPoint:NSMakePoint(45,25) controlPoint1:NSMakePoint(43.7,28) controlPoint2:NSMakePoint(45,26.7)];[frame lineToPoint:NSMakePoint(45,21)];
    [frame moveToPoint:NSMakePoint(45,11)];[frame lineToPoint:NSMakePoint(45,7)];[frame curveToPoint:NSMakePoint(42,4) controlPoint1:NSMakePoint(45,5.3) controlPoint2:NSMakePoint(43.7,4)];[frame lineToPoint:NSMakePoint(37,4)];[frame stroke];
    NSBezierPath *letters=[NSBezierPath bezierPath];
    letters.lineWidth=2.2;letters.lineCapStyle=NSLineCapStyleRound;letters.lineJoinStyle=NSLineJoinStyleRound;
    [letters moveToPoint:NSMakePoint(15.8,20.2)];
    [letters curveToPoint:NSMakePoint(8.5,16) controlPoint1:NSMakePoint(12.7,23) controlPoint2:NSMakePoint(8.7,20.9)];
    [letters curveToPoint:NSMakePoint(15.2,11.9) controlPoint1:NSMakePoint(8.1,10.8) controlPoint2:NSMakePoint(12.2,9.1)];
    [letters moveToPoint:NSMakePoint(19.7,10.8)];[letters lineToPoint:NSMakePoint(21.1,20.8)];
    [letters moveToPoint:NSMakePoint(25.7,10.8)];[letters lineToPoint:NSMakePoint(27.1,20.8)];
    [letters moveToPoint:NSMakePoint(32,6.8)];[letters lineToPoint:NSMakePoint(34,21)];
    [letters moveToPoint:NSMakePoint(33.9,20.4)];
    [letters curveToPoint:NSMakePoint(33.2,12.2) controlPoint1:NSMakePoint(43.6,24.2) controlPoint2:NSMakePoint(43.2,8.8)];
    [letters stroke];
    [[NSBezierPath bezierPathWithOvalInRect:NSMakeRect(20.2,24,2.5,2.5)] fill];
    [[NSBezierPath bezierPathWithOvalInRect:NSMakeRect(26.2,24,2.5,2.5)] fill];
}
// Shared 32-unit geometry with trayLigature in settings.js: two dots, one stem.
static void ciipDrawTrayLigature(void) {
    [NSGraphicsContext saveGraphicsState];
    CGContextRef context=NSGraphicsContext.currentContext.CGContext;
    CGContextTranslateCTM(context,0,32);CGContextScaleCTM(context,1,-1);
    NSBezierPath *path=[NSBezierPath bezierPath];path.lineWidth=2.2;
    path.lineCapStyle=NSLineCapStyleRound;path.lineJoinStyle=NSLineJoinStyleRound;
    [path moveToPoint:NSMakePoint(13.2,3.6)];[path lineToPoint:NSMakePoint(4.7,3.6)];
    [path curveToPoint:NSMakePoint(3.2,5.2) controlPoint1:NSMakePoint(3.7,3.6) controlPoint2:NSMakePoint(3.2,4.1)];
    [path curveToPoint:NSMakePoint(8.2,20.4) controlPoint1:NSMakePoint(2.2,10.6) controlPoint2:NSMakePoint(4.1,17.5)];
    [path curveToPoint:NSMakePoint(15,22.5) controlPoint1:NSMakePoint(10.2,21.8) controlPoint2:NSMakePoint(12.1,22.5)];
    [path lineToPoint:NSMakePoint(19,22.5)];
    [path curveToPoint:NSMakePoint(28.3,16.1) controlPoint1:NSMakePoint(23.1,22.5) controlPoint2:NSMakePoint(27.8,19.1)];
    [path curveToPoint:NSMakePoint(20.4,12.5) controlPoint1:NSMakePoint(28.5,14.4) controlPoint2:NSMakePoint(23.2,12.5)];
    [path lineToPoint:NSMakePoint(15,12.5)];[path lineToPoint:NSMakePoint(15,29.2)];[path stroke];
    [[NSBezierPath bezierPathWithOvalInRect:NSMakeRect(8.7,7.5,2.8,2.8)] fill];
    [[NSBezierPath bezierPathWithOvalInRect:NSMakeRect(16.6,7.5,2.8,2.8)] fill];
    [NSGraphicsContext restoreGraphicsState];
}
char *ciip_tray_icon(const char *style) {
    @autoreleasepool {
        NSString *kind=[NSString stringWithUTF8String:style];
        BOOL word=[kind isEqualToString:@"wordmark"];
        NSSize size=NSMakeSize(word?48:32,32);
        NSBitmapImageRep *rep=[[[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:size.width*2 pixelsHigh:size.height*2 bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0] autorelease];
        [NSGraphicsContext saveGraphicsState];[NSGraphicsContext setCurrentContext:[NSGraphicsContext graphicsContextWithBitmapImageRep:rep]];
        CGContextScaleCTM(NSGraphicsContext.currentContext.CGContext,2,2);
        [NSColor.blackColor set];
        if([kind isEqualToString:@"ligature"])ciipDrawTrayLigature();
        else if(word)ciipDrawTrayWordmark();
        else {
            NSBezierPath *path=[NSBezierPath bezierPath];path.lineWidth=2.5;path.lineCapStyle=NSLineCapStyleRound;path.lineJoinStyle=NSLineJoinStyleRound;
            if([kind isEqualToString:@"pin"]){[path moveToPoint:NSMakePoint(12,26)];[path lineToPoint:NSMakePoint(26,12)];[path moveToPoint:NSMakePoint(15,23)];[path lineToPoint:NSMakePoint(8,15)];[path lineToPoint:NSMakePoint(5,14)];[path lineToPoint:NSMakePoint(18,1)];[path lineToPoint:NSMakePoint(19,4)];[path lineToPoint:NSMakePoint(27,11)];[path moveToPoint:NSMakePoint(11,8)];[path lineToPoint:NSMakePoint(3,1)];}
            else {for(int i=0;i<4;i++){CGFloat x=i%2?26:6,y=i/2?26:6,sx=i%2?-1:1,sy=i/2?-1:1;[path moveToPoint:NSMakePoint(x,y+7*sy)];[path lineToPoint:NSMakePoint(x,y)];[path lineToPoint:NSMakePoint(x+7*sx,y)];} [path appendBezierPathWithRoundedRect:NSMakeRect(12,12,8,8) xRadius:1 yRadius:1];}
            [path stroke];
        }
        [NSGraphicsContext restoreGraphicsState];NSData *png=[rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];return strdup([png base64EncodedStringWithOptions:0].UTF8String);
    }
}
