// Interactive own-bundle QA. No permissions are requested; never ship this entry point.
// Includes the production panel and drag source, with QA-only diagnostics at method boundaries.
#import <Cocoa/Cocoa.h>
#import <objc/runtime.h>
#include <stdio.h>
#include <unistd.h>
#include "../permissions_darwin.m"

static FILE *qaLog;
static void qaRecord(NSString *event, NSDictionary *details) {
    NSMutableDictionary *record=[NSMutableDictionary dictionaryWithDictionary:details ?: @{}];
    record[@"event"]=event;
    record[@"time"]=@([NSDate.date timeIntervalSince1970]);
    record[@"pid"]=@(getpid());
    record[@"appActive"]=@(NSApp.isActive);
    record[@"guideVisible"]=@(permissionPanel.isVisible);
    record[@"guideKey"]=@(permissionPanel.isKeyWindow);
    NSData *json=[NSJSONSerialization dataWithJSONObject:record options:NSJSONWritingSortedKeys error:nil];
    if(qaLog&&json){fprintf(qaLog,"%s\n",[[[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding] autorelease].UTF8String);fflush(qaLog);}
}

@interface CIIPPermissionIcon (InteractiveQA)
- (void)qa_mouseDown:(NSEvent *)event;
- (BOOL)qa_acceptsFirstMouse:(NSEvent *)event;
- (NSDraggingSession *)qa_beginDraggingSessionWithItems:(NSArray<NSDraggingItem *> *)items event:(NSEvent *)event source:(id<NSDraggingSource>)source;
@end
@implementation CIIPPermissionIcon (InteractiveQA)
- (BOOL)qa_acceptsFirstMouse:(NSEvent *)event {
    BOOL accepted=[self qa_acceptsFirstMouse:event];
    qaRecord(@"accepts-first-mouse",@{@"accepted":@(accepted)});
    return accepted;
}
- (void)qa_mouseDown:(NSEvent *)event {
    qaRecord(@"mouse-down",@{@"clickCount":@(event.clickCount),@"windowNumber":@(event.windowNumber)});
    [self qa_mouseDown:event];
    qaRecord(@"mouse-down-return",nil);
}
- (NSDraggingSession *)qa_beginDraggingSessionWithItems:(NSArray<NSDraggingItem *> *)items event:(NSEvent *)event source:(id<NSDraggingSource>)source {
    id payload=items.firstObject.item;
    BOOL appURL=[payload isKindOfClass:NSURL.class]&&[payload isFileURL]&&[[payload pathExtension] isEqualToString:@"app"];
    qaRecord(@"session-begin",@{@"items":@(items.count),@"appFileURL":@(appURL)});
    NSDraggingSession *session=[self qa_beginDraggingSessionWithItems:items event:event source:source];
    qaRecord(@"session-created",@{@"created":@(session!=nil)});
    return session;
}
- (void)draggingSession:(NSDraggingSession *)session endedAtPoint:(NSPoint)point operation:(NSDragOperation)operation {
    qaRecord(@"session-ended",@{@"operation":@(operation),@"cancelledOrRejected":@(operation==NSDragOperationNone)});
}
@end

@interface CIIPPermissionPanel (InteractiveQA)
- (void)qa_requestPermission:(id)sender;
@end
@implementation CIIPPermissionPanel (InteractiveQA)
- (void)qa_requestPermission:(id)sender {
    qaRecord(@"permission-request-blocked-for-qa",nil);
    self.permissionStatus.stringValue=@"QA 模式不申请权限，仅验证窗口与拖拽。";
}
@end

static void qaExchange(Class cls, SEL original, SEL replacement) {
    Method first=class_getInstanceMethod(cls,original),second=class_getInstanceMethod(cls,replacement);
    // Add inherited methods locally before exchanging; do not mutate NSView globally.
    if(class_addMethod(cls,original,method_getImplementation(first),method_getTypeEncoding(first)))first=class_getInstanceMethod(cls,original);
    method_exchangeImplementations(first,second);
}

@interface CIIPPermissionQADelegate : NSObject <NSApplicationDelegate>
@end
@implementation CIIPPermissionQADelegate
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    qaExchange(CIIPPermissionIcon.class,@selector(acceptsFirstMouse:),@selector(qa_acceptsFirstMouse:));
    qaExchange(CIIPPermissionIcon.class,@selector(mouseDown:),@selector(qa_mouseDown:));
    qaExchange(CIIPPermissionIcon.class,@selector(beginDraggingSessionWithItems:event:source:),@selector(qa_beginDraggingSessionWithItems:event:source:));
    qaExchange(CIIPPermissionPanel.class,@selector(requestPermission:),@selector(qa_requestPermission:));
    int shown=ciip_show_permission_guide();
    qaRecord(@"guide-shown",@{@"success":@(shown),@"bundle":NSBundle.mainBundle.bundleURL.path});
}
- (void)applicationDidBecomeActive:(NSNotification *)notification { qaRecord(@"app-became-active",nil); }
- (void)applicationDidResignActive:(NSNotification *)notification { qaRecord(@"app-resigned-active",nil); }
- (void)applicationWillTerminate:(NSNotification *)notification { qaRecord(@"app-terminating",nil);if(qaLog){fclose(qaLog);qaLog=NULL;} }
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender { return YES; }
@end

int main(void) {
    @autoreleasepool {
        qaLog=fopen("/private/tmp/ciip-permission-interactive-qa.log","w");
        if(!qaLog)return 1;
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
        NSMenu *menu=[[[NSMenu alloc] init] autorelease];
        NSMenuItem *appItem=[[[NSMenuItem alloc] init] autorelease];
        NSMenu *appMenu=[[[NSMenu alloc] initWithTitle:@"ciip Permission QA"] autorelease];
        [appMenu addItemWithTitle:@"Quit ciip Permission QA" action:@selector(terminate:) keyEquivalent:@"q"];
        appItem.submenu=appMenu;[menu addItem:appItem];NSApp.mainMenu=menu;
        CIIPPermissionQADelegate *delegate=[[[CIIPPermissionQADelegate alloc] init] autorelease];
        NSApp.delegate=delegate;
        [NSApp run];
        return 0;
    }
}
