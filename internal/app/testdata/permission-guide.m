// Own-window AppKit contract regression; does not open Settings or request access.
// Build this inside a .app bundle so the real production app-URL guard is exercised.
#import <Cocoa/Cocoa.h>
#ifndef CIIP_PERMISSION_IMPLEMENTATION
#define CIIP_PERMISSION_IMPLEMENTATION "../permissions_darwin.m"
#endif
#include CIIP_PERMISSION_IMPLEMENTATION

@interface CIIPTestDragSession : NSObject
@property BOOL animatesToStartingPositionsOnCancelOrFail;
@end
@implementation CIIPTestDragSession
@end
@interface CIIPTestPermissionIcon : CIIPPermissionIcon
@property(retain) NSArray<NSDraggingItem *> *recordedItems;
@property(retain) CIIPTestDragSession *recordedSession;
@end
@implementation CIIPTestPermissionIcon
- (NSDraggingSession *)beginDraggingSessionWithItems:(NSArray<NSDraggingItem *> *)items event:(NSEvent *)event source:(id<NSDraggingSource>)source {
    self.recordedItems=items;
    self.recordedSession=[[[CIIPTestDragSession alloc] init] autorelease];
    return (NSDraggingSession *)self.recordedSession;
}
- (void)dealloc { [_recordedItems release];[_recordedSession release];[super dealloc]; }
@end
#define CHECK(condition, text) do { if (!(condition)) { fprintf(stderr,"FAIL %s\n",text); failures++; } } while (0)
int main(void) {
 @autoreleasepool {
    [NSApplication sharedApplication];
    int failures=0;
    CHECK(ciip_show_permission_guide()==1,"real app-bundle source can create the permission guide");
    if(!permissionPanel)return 1;
    CIIPTestPermissionIcon *icon=[[[CIIPTestPermissionIcon alloc] initWithFrame:NSMakeRect(0,0,84,84)] autorelease];
    icon.image=[NSImage imageNamed:NSImageNameApplicationIcon];
    [permissionPanel.contentView addSubview:icon];
    NSEvent *event=[NSEvent mouseEventWithType:NSEventTypeLeftMouseDown location:NSMakePoint(20,20) modifierFlags:0 timestamp:1 windowNumber:permissionPanel.windowNumber context:nil eventNumber:1 clickCount:1 pressure:1];
    fprintf(stderr,"PROBE hide=%d nonactivating=%d firstMouse=%d delayOrdering=%d\n",permissionPanel.hidesOnDeactivate,(permissionPanel.styleMask&NSWindowStyleMaskNonactivatingPanel)!=0,[icon acceptsFirstMouse:event],[icon shouldDelayWindowOrderingForEvent:event]);
    CHECK(!permissionPanel.hidesOnDeactivate,"permission guide stays visible when ciip deactivates");
    CHECK(permissionPanel.styleMask&NSWindowStyleMaskNonactivatingPanel,"permission guide uses a nonactivating panel");
    CHECK(permissionPanel.becomesKeyOnlyIfNeeded,"permission panel only becomes key when a control needs it");
    CHECK([icon acceptsFirstMouse:event],"inactive source accepts the first press for a direct drag");
    CHECK([icon shouldDelayWindowOrderingForEvent:event],"starting a drag must not reorder the source over its target");
    CHECK(![icon needsPanelToBecomeKey],"drag icon does not request keyboard focus");
    CHECK(!icon.mouseDownCanMoveWindow,"drag icon does not move the guide window");
    BOOL canDock=[permissionPanel respondsToSelector:@selector(dockBesideSettings)];
    CHECK(canDock,"permission panel can move away from the target list before opening Settings");
    if(canDock){
        [permissionPanel performSelector:@selector(dockBesideSettings)];
        NSRect visible=permissionPanel.screen.visibleFrame,frame=permissionPanel.frame;
        CHECK(NSMinX(frame)<=NSMinX(visible)+17,"permission guide docks at the screen edge");
        CHECK(NSContainsRect(visible,frame),"docked guide fits inside the visible screen");
    }
    NSWindow *target=[[[NSWindow alloc] initWithContentRect:NSMakeRect(550,180,400,320) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO] autorelease];
    target.releasedWhenClosed=NO;[target makeKeyAndOrderFront:nil];
    CHECK(!permissionPanel.isKeyWindow,"source panel is not key before the drag call");
    [icon mouseDown:event];
    CHECK(icon.recordedItems.count==1,"one source call creates one drag item");
    id item=icon.recordedItems.firstObject.item;
    CHECK([item isKindOfClass:NSURL.class]&&[item isFileURL]&&[[item pathExtension] isEqualToString:@"app"],"drag payload is the current app file URL only");
    CHECK(icon.recordedSession.animatesToStartingPositionsOnCancelOrFail,"cancelled drag returns the app icon");
    CHECK(!permissionPanel.isKeyWindow,"drag source does not explicitly retake key status");
    [target close];[permissionPanel close];
    if(failures)return 1;
    puts("PASS permission-guide AppKit contract: first-mouse policy, nonactivating persistent guide, edge placement, app URL drag payload");
    return 0;
 }
}
