// Synthetic AppKit routing regression, not a physical trackpad acceptance test.
// clang -fblocks internal/app/testdata/pin-input.m -framework Cocoa -o /tmp/ciip-pin-input-test
#import <Cocoa/Cocoa.h>
#include <stdint.h>
#include <math.h>

#ifndef CIIP_PIN_INPUT_IMPLEMENTATION
#define CIIP_PIN_INPUT_IMPLEMENTATION "../pin_input_darwin.m"
#endif
#include CIIP_PIN_INPUT_IMPLEMENTATION

static NSUInteger counts[3];
static double products[3] = {1, 1, 1};
void ciip_go_pin_magnify(uintptr_t token, double delta) {
    if (token < 3) { counts[token]++; products[token] *= 1+delta; }
}

@interface CIIPTestMagnify : NSEvent
@property(nonatomic, assign) NSWindow *source;
@property(nonatomic) NSPoint point;
@property(nonatomic) NSEventPhase testPhase;
@property(nonatomic) CGFloat delta;
@property(nonatomic) NSTimeInterval time;
@end
@implementation CIIPTestMagnify
- (NSEventType)type { return NSEventTypeMagnify; }
- (NSWindow *)window { return self.source; }
- (NSPoint)locationInWindow { return [self.source convertPointFromScreen:self.point]; }
- (NSEventPhase)phase { return self.testPhase; }
- (CGFloat)magnification { return self.delta; }
- (NSTimeInterval)timestamp { return self.time; }
@end

static CIIPTestMagnify *gesture(NSWindow *source, NSPoint point, NSEventPhase phase, double delta) {
    CIIPTestMagnify *event = [[[CIIPTestMagnify alloc] init] autorelease];
    static NSTimeInterval time=1;
    event.source=source; event.point=point; event.testPhase=phase; event.delta=delta; event.time=time; time+=.01;
    return event;
}
static NSPanel *panel(CGFloat x) {
    NSPanel *window = [[NSPanel alloc] initWithContentRect:NSMakeRect(x, 180, 280, 200) styleMask:NSWindowStyleMaskBorderless|NSWindowStyleMaskNonactivatingPanel backing:NSBackingStoreBuffered defer:NO];
    window.releasedWhenClosed=NO; window.hidesOnDeactivate=NO; window.level=NSFloatingWindowLevel;
    return window;
}
static void drain(void) {
    NSDate *until=[NSDate dateWithTimeIntervalSinceNow:.03];
    while(until.timeIntervalSinceNow>0) [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode beforeDate:until];
}
#define CHECK(condition, text) do { if (!(condition)) { fprintf(stderr, "FAIL %s\n", text); return 1; } } while (0)

int main(void) {
 @autoreleasepool {
    [NSApplication sharedApplication];
    NSPanel *first=panel(80), *second=panel(420), *foreign=panel(760);
    CHECK(!first.isVisible && !second.isVisible && first.windowNumber>0 && second.windowNumber>0, "defer:NO hidden panels already have WindowServer identities");
    CHECK(ciip_install_pin_input((uintptr_t)first,1,280,200), "install first pin");
    CHECK(ciip_install_pin_input((uintptr_t)second,2,200,200), "install second pin");
    [first orderFront:nil];[second orderFront:nil];[foreign orderFront:nil];drain();
    NSPoint firstPoint=NSMakePoint(220,280), secondPoint=NSMakePoint(560,280);
    // The event is addressed to A while the touch is over B, as key-window routing permits.
    CHECK(handlePinMagnify(gesture(first,secondPoint,NSEventPhaseBegan,.1))==nil, "magnify addressed to another panel must reach hovered pin without DOM events");
    CHECK(counts[1]==0 && counts[2]==1, "only hovered pin consumes the first delta");
    CHECK(handlePinMagnify(gesture(first,firstPoint,NSEventPhaseChanged,.2))==nil, "gesture stays with its start pin while its window resizes");
    handlePinMagnify(gesture(first,firstPoint,NSEventPhaseEnded,0));
    CHECK(counts[1]==0 && counts[2]==3 && fabs(products[2]-1.32)<1e-9, "native deltas must be incremental and consumed once");
    handlePinMagnify(gesture(second,firstPoint,NSEventPhaseBegan,-.1));
    handlePinMagnify(gesture(second,firstPoint,NSEventPhaseEnded,0));
    CHECK(counts[1]==2 && fabs(products[1]-.9)<1e-9, "next gesture routes independently to first pin");
    NSUInteger firstCount=counts[1],secondCount=counts[2];
    handlePinMagnify(gesture(first,firstPoint,NSEventPhaseNone,.1));
    handlePinMagnify(gesture(first,secondPoint,NSEventPhaseNone,.1));
    CHECK(counts[1]==firstCount+1 && counts[2]==secondCount+1, "phase-less deltas must not lock the next pin out");
    NSUInteger edgeCount=counts[2];
    NSPoint edge=NSMakePoint(659,280);
    handlePinMagnify(gesture(first,edge,NSEventPhaseNone,.1));
    [second setFrame:NSMakeRect(510,230,100,100) display:NO];drain();
    handlePinMagnify(gesture(first,edge,NSEventPhaseNone,-.1));
    CHECK(counts[2]==edgeCount+2, "phase-less edge pinch survives the image shrinking away from the pointer");
    handlePinMagnify(gesture(first,edge,NSEventPhaseEnded,0));
    [second setFrame:NSMakeRect(420,180,280,200) display:NO];drain();
    handlePinMagnify(gesture(first,firstPoint,NSEventPhaseBegan,.1));
    CIIPTestMagnify *afterGap=gesture(first,secondPoint,NSEventPhaseChanged,.1);afterGap.time+=1;
    NSUInteger gapCount=counts[2];
    CHECK(handlePinMagnify(afterGap)==nil && counts[2]==gapCount+1, "missing End must recover after a stream gap");
    handlePinMagnify(gesture(first,secondPoint,NSEventPhaseEnded,0));
    CHECK(handlePinMagnify(gesture(first,NSMakePoint(430,280),NSEventPhaseBegan,.1))!=nil, "transparent contain margin must not consume magnify");
    CHECK(handlePinMagnify(gesture(foreign,NSMakePoint(900,280),NSEventPhaseBegan,.1))!=nil, "foreign window must not consume magnify");
    [foreign setFrame:second.frame display:NO];[foreign orderWindow:NSWindowAbove relativeTo:second.windowNumber];drain();
    CHECK(handlePinMagnify(gesture(first,secondPoint,NSEventPhaseBegan,.1))!=nil, "frontmost foreign window blocks a pin below");
    [foreign orderOut:nil];[second orderOut:nil];
    CHECK(handlePinMagnify(gesture(first,secondPoint,NSEventPhaseBegan,.1))!=nil, "hidden pin must not consume magnify");
    [second orderFront:nil];drain();
    ciip_update_pin_input((uintptr_t)second,280,200);
    CHECK(handlePinMagnify(gesture(first,NSMakePoint(430,280),NSEventPhaseBegan,.1))==nil, "updated image ratio updates hit region");
    [second close];
    CHECK(handlePinMagnify(gesture(first,secondPoint,NSEventPhaseChanged,.1))!=nil, "closed pin releases active gesture and monitor membership");
    ciip_remove_pin_input((uintptr_t)first);
    CHECK(handlePinMagnify(gesture(first,firstPoint,NSEventPhaseBegan,.1))!=nil, "explicit teardown removes only registered pin input");
    [first close];[foreign close];[first release];[second release];[foreign release];
    puts("PASS AppKit synthetic magnify: non-key routing, independent pins, phased/unphased/gapped streams, one owner, transparent margins, frontmost filtering, hidden/closed cleanup");
    return 0;
 }
}
