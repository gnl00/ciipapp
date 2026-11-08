// Run: clang -fblocks internal/app/testdata/window-chrome.m internal/app/window_chrome_darwin.m -framework Cocoa -framework QuartzCore -o /tmp/ciip-chrome-test && /tmp/ciip-chrome-test
#import <Cocoa/Cocoa.h>
#include <stdint.h>
#include <math.h>
void ciip_maintain_editor_chrome(uintptr_t,double,double);
static void drain(void) {
    NSDate *until=[NSDate dateWithTimeIntervalSinceNow:.03];
    while(until.timeIntervalSinceNow>0) [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode beforeDate:until];
}
static void put(NSWindow *window,CGFloat x,CGFloat y,CGFloat height) {
    NSButton *button=[window standardWindowButton:NSWindowCloseButton];
    NSView *container=button.superview.superview;
    NSRect frame=container.frame;frame.size.height=height;frame.origin.y=window.frame.size.height-height;container.frame=frame;
    for(NSUInteger i=0;i<3;i++)[[window standardWindowButton:i]setFrameOrigin:NSMakePoint(x+i*20,y)];
}
static int aligned(NSWindow *window,const char *stage) {
    for(NSUInteger i=0;i<3;i++) {
        NSButton *button=[window standardWindowButton:i];NSRect frame=[button convertRect:button.bounds toView:nil];
        CGFloat x=frame.origin.x,y=window.frame.size.height-NSMaxY(frame);
        if(fabs(x-(20+i*20))>.01||fabs(y-22)>.01){fprintf(stderr,"FAIL %s button%lu top-left %.1f,%.1f\n",stage,(unsigned long)i,x,y);return 0;}
    }
    return 1;
}
int main(void) {
 @autoreleasepool {
    [NSApplication sharedApplication];
    NSWindow *window=[[NSWindow alloc]initWithContentRect:NSMakeRect(0,0,1120,760) styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskMiniaturizable|NSWindowStyleMaskResizable|NSWindowStyleMaskFullSizeContentView backing:NSBackingStoreBuffered defer:NO];
    window.releasedWhenClosed=NO;window.titleVisibility=NSWindowTitleHidden;window.titlebarAppearsTransparent=YES;
    put(window,20,22,60);
    ciip_maintain_editor_chrome((uintptr_t)window,20,22);
    drain();if(!aligned(window,"initial"))return 1;
    // Reproduce the observed AppKit reset without any NSWindowDidResize notification.
    for(int i=0;i<100;i++)put(window,7,6,28);
    drain();if(!aligned(window,"titlebar reset"))return 1;
    [window setFrame:NSMakeRect(0,0,840,540) display:NO];put(window,7,6,28);
    drain();if(!aligned(window,"resize then reset"))return 1;
    drain();if(!aligned(window,"stable"))return 1;
    // Pending reconciliation must not touch a closed window.
    put(window,7,6,28);[window close];[window release];drain();
    puts("PASS native chrome: reset, coalescing, resize, stability, pending close");return 0;
 }
}
