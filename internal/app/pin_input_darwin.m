//go:build darwin && cgo

#import <Cocoa/Cocoa.h>
#import <objc/runtime.h>
#include <stdint.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

extern void ciip_go_pin_magnify(uintptr_t token, double magnification);

@interface CIIPPinInput : NSObject
@property(nonatomic, assign) NSWindow *window;
@property(nonatomic) uintptr_t token;
@property(nonatomic) NSSize imageSize;
@property(nonatomic) NSUInteger count;
- (void)stop;
- (void)windowClosed:(NSNotification *)notification;
- (BOOL)contains:(NSPoint)point;
@end

static NSMutableDictionary<NSNumber *, CIIPPinInput *> *pinInputs;
static CIIPPinInput *activePin;
static id pinMonitor;
static char pinInputKey;
static NSTimeInterval lastMagnifyTime;

static BOOL tracePinInput(void) {
    const char *value = getenv("CIIP_PIN_INPUT_TRACE");
    return value && strcmp(value, "1") == 0;
}

static NSEvent *handlePinMagnify(NSEvent *event) {
    // A broken/phase-less stream expires without polling. Keep an edge pinch
    // alive as the image shrinks away, but let phase-less input move to another pin.
    BOOL unphased = event.phase == NSEventPhaseNone;
    if ((event.phase & NSEventPhaseBegan) || event.timestamp-lastMagnifyTime > .4 || event.timestamp < lastMagnifyTime) activePin = nil;
    lastMagnifyTime = event.timestamp;
    if (activePin && (!activePin.window.isVisible || activePin.window.isMiniaturized || activePin.window.ignoresMouseEvents)) activePin = nil;
    if (!activePin || unphased) {
        NSPoint point = event.window ? [event.window convertPointToScreen:event.locationInWindow] : NSEvent.mouseLocation;
        // AppKit magnify may be addressed to the key panel, not the hovered panel.
        NSInteger number = [NSWindow windowNumberAtPoint:point belowWindowWithWindowNumber:0];
        CIIPPinInput *hit = [pinInputs objectForKey:@(number)];
        if ([hit contains:point]) activePin = hit;
        else if (!activePin) return event;
    }
    CIIPPinInput *input = activePin;
    input.count++;
    if (tracePinInput()) fprintf(stderr, "ciip pin-input target=%ld source=%ld phase=%lu count=%lu delta=%.6f\n", (long)input.window.windowNumber, (long)event.window.windowNumber, (unsigned long)event.phase, (unsigned long)input.count, event.magnification);
    if (isfinite(event.magnification) && event.magnification > -1)
        ciip_go_pin_magnify(input.token, event.magnification);
    if (event.phase & (NSEventPhaseEnded | NSEventPhaseCancelled)) activePin = nil;
    // The native queue owns this gesture. WebKit must not zoom it a second time.
    return nil;
}

@implementation CIIPPinInput
- (void)windowClosed:(NSNotification *)notification { [self stop]; }
- (BOOL)contains:(NSPoint)point {
    if (!self.window.isVisible || self.window.isMiniaturized || self.window.ignoresMouseEvents) return NO;
    NSView *root = self.window.contentView;
    NSRect bounds = root.bounds;
    CGFloat scale = MIN(bounds.size.width/self.imageSize.width, bounds.size.height/self.imageSize.height);
    NSSize size = NSMakeSize(self.imageSize.width*scale, self.imageSize.height*scale);
    NSRect image = NSMakeRect(NSMidX(bounds)-size.width/2, NSMidY(bounds)-size.height/2, size.width, size.height);
    NSPoint local = [root convertPoint:[self.window convertPointFromScreen:point] fromView:nil];
    return NSPointInRect(local, image);
}
- (void)stop {
    if (!self.window) return;
    if (tracePinInput()) fprintf(stderr, "ciip pin-input remove=%ld count=%lu\n", (long)self.window.windowNumber, (unsigned long)self.count);
    if (activePin == self) activePin = nil;
    [[NSNotificationCenter defaultCenter] removeObserver:self];
    [pinInputs removeObjectForKey:@(self.window.windowNumber)];
    self.window = nil;
    if (!pinInputs.count && pinMonitor) {
        [NSEvent removeMonitor:pinMonitor];
        pinMonitor = nil;
    }
}
- (void)dealloc {
    [self stop];
    [super dealloc];
}
@end

int ciip_install_pin_input(uintptr_t handle, uintptr_t token, double width, double height) {
    NSWindow *window = (NSWindow *)handle;
    if (!window || window.windowNumber <= 0 || width <= 0 || height <= 0) return 0;
    if (!pinInputs) pinInputs = [[NSMutableDictionary alloc] init];
    CIIPPinInput *input = objc_getAssociatedObject(window, &pinInputKey);
    if (input.window) return 0;
    input = [[CIIPPinInput alloc] init];
    input.window = window; input.token = token; input.imageSize = NSMakeSize(width, height);
    [pinInputs setObject:input forKey:@(window.windowNumber)];
    objc_setAssociatedObject(window, &pinInputKey, input, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    [[NSNotificationCenter defaultCenter] addObserver:input selector:@selector(windowClosed:) name:NSWindowWillCloseNotification object:window];
    [input release];
    if (!pinMonitor) pinMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskMagnify handler:^NSEvent *(NSEvent *event) { return handlePinMagnify(event); }];
    if (!pinMonitor) { [input stop]; return 0; }
    if (tracePinInput()) fprintf(stderr, "ciip pin-input install=%ld\n", (long)window.windowNumber);
    return 1;
}

void ciip_update_pin_input(uintptr_t handle, double width, double height) {
    if (width <= 0 || height <= 0) return;
    CIIPPinInput *input = objc_getAssociatedObject((NSWindow *)handle, &pinInputKey);
    input.imageSize = NSMakeSize(width, height);
}

void ciip_remove_pin_input(uintptr_t handle) {
    CIIPPinInput *input = objc_getAssociatedObject((NSWindow *)handle, &pinInputKey);
    [input stop];
}
