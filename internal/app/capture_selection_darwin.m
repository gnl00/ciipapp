//go:build darwin && cgo

#import <Cocoa/Cocoa.h>
#import <ApplicationServices/ApplicationServices.h>
#import <QuartzCore/QuartzCore.h>
#include <stdint.h>
#include <math.h>

extern void ciip_go_capture_selection(uintptr_t, uint32_t, double, double, double, double);

static BOOL usableCaptureRect(CGRect rect) {
    return !CGRectIsNull(rect) && !CGRectIsInfinite(rect) && isfinite(rect.origin.x) && isfinite(rect.origin.y) &&
        isfinite(rect.size.width) && isfinite(rect.size.height) && rect.size.width > 0 && rect.size.height > 0;
}

static NSDictionary *captureWindowAtPoint(NSArray *windows, CGPoint point, NSSet *excludedWindows) {
    for (NSDictionary *window in windows) {
        if ([excludedWindows containsObject:window[(id)kCGWindowNumber]] || [window[(id)kCGWindowAlpha] doubleValue] <= 0) continue;
        CGRect rect;
        if (CGRectMakeWithDictionaryRepresentation((CFDictionaryRef)window[(id)kCGWindowBounds], &rect) &&
            usableCaptureRect(rect) && CGRectContainsPoint(rect, point)) return window;
    }
    return nil;
}

static BOOL sameCaptureWindow(NSDictionary *a, NSDictionary *b) {
    return a && b && [a[(id)kCGWindowNumber] isEqual:b[(id)kCGWindowNumber]] &&
        [a[(id)kCGWindowOwnerPID] isEqual:b[(id)kCGWindowOwnerPID]] &&
        [a[(id)kCGWindowBounds] isEqual:b[(id)kCGWindowBounds]];
}

static NSCursor *captureSelectionCursor(NSImage *appIcon) {
    if (!appIcon) return NSCursor.arrowCursor;
    NSImage *image = [NSImage imageWithSize:NSMakeSize(28, 28) flipped:NO drawingHandler:^BOOL(NSRect rect) {
        [appIcon drawInRect:NSMakeRect(2, 2, 24, 24) fromRect:NSZeroRect operation:NSCompositingOperationSourceOver fraction:1 respectFlipped:YES hints:nil];
        return YES;
    }];
    return [[[NSCursor alloc] initWithImage:image hotSpot:NSMakePoint(14, 14)] autorelease];
}

static NSString *captureSelectionDimensions(CGRect rect, CGFloat scale) {
    if (!usableCaptureRect(rect) || scale <= 0) return @"";
    CGFloat width = (ceil(CGRectGetMaxX(rect)) - floor(rect.origin.x)) * scale;
    CGFloat height = (ceil(CGRectGetMaxY(rect)) - floor(rect.origin.y)) * scale;
    return [NSString stringWithFormat:@"%.0f × %.0f px", width, height];
}

static void updateCaptureLayer(CALayer *layer, NSString *key, id value, NSTimeInterval duration, CAMediaTimingFunction *curve) {
    id from = [[(layer.presentationLayer ?: layer) valueForKey:key] retain];
    [layer removeAnimationForKey:key];
    [layer setValue:value forKey:key];
    if (duration > 0 && from) {
        CABasicAnimation *animation = [CABasicAnimation animationWithKeyPath:key];
        animation.fromValue = from; animation.toValue = value; animation.duration = duration; animation.timingFunction = curve;
        [layer addAnimation:animation forKey:key];
    }
    [from release];
}

static BOOL captureElementRect(AXUIElementRef element, CGRect *rect) {
    CFTypeRef position = NULL, size = NULL;
    CGPoint origin; CGSize dimensions;
    BOOL valid = AXUIElementCopyAttributeValue(element, kAXPositionAttribute, &position) == kAXErrorSuccess &&
        AXUIElementCopyAttributeValue(element, kAXSizeAttribute, &size) == kAXErrorSuccess &&
        CFGetTypeID(position) == AXValueGetTypeID() && CFGetTypeID(size) == AXValueGetTypeID() &&
        AXValueGetType((AXValueRef)position) == kAXValueCGPointType && AXValueGetType((AXValueRef)size) == kAXValueCGSizeType &&
        AXValueGetValue((AXValueRef)position, kAXValueCGPointType, &origin) && AXValueGetValue((AXValueRef)size, kAXValueCGSizeType, &dimensions);
    if (position) CFRelease(position);
    if (size) CFRelease(size);
    if (!valid) return NO;
    *rect = (CGRect){origin, dimensions};
    return usableCaptureRect(*rect);
}

static void visitCaptureElements(AXUIElementRef element, CGPoint point, CGRect clip, NSTimeInterval deadline, NSUInteger depth,
    CFMutableSetRef visited, AXUIElementRef *smallest, CGRect *smallestRect, NSUInteger *smallestDepth, BOOL *incomplete) {
    if (depth >= 32 || CFSetContainsValue(visited, element) || *incomplete) return;
    if (NSProcessInfo.processInfo.systemUptime >= deadline) { *incomplete = YES; return; }
    CFSetAddValue(visited, element); AXUIElementSetMessagingTimeout(element, .15);
    CGRect rect = CGRectNull;
    BOOL hasFrame = captureElementRect(element, &rect);
    if (hasFrame) rect = CGRectIntersection(rect, clip);
    BOOL containsPoint = usableCaptureRect(rect) && CGRectContainsPoint(rect, point);
    // Some accessibility wrappers have no frame but expose children with usable bounds.
    if (depth && hasFrame && !containsPoint) return;
    if (containsPoint) {
        // Geometry breaks equal-area ties, so an AX sibling reorder cannot change the selected frame.
        CGFloat score[] = {rect.size.width * rect.size.height, rect.origin.x, rect.origin.y, rect.size.width, rect.size.height};
        CGFloat previous[] = {smallestRect->size.width * smallestRect->size.height, smallestRect->origin.x, smallestRect->origin.y, smallestRect->size.width, smallestRect->size.height};
        BOOL precedes = CGRectIsNull(*smallestRect);
        for (NSUInteger i = 0; !precedes && i < 5; i++) {
            if (score[i] == previous[i]) continue;
            precedes = score[i] < previous[i]; break;
        }
        if (CGRectEqualToRect(rect, *smallestRect) && depth > *smallestDepth) precedes = YES;
        if (precedes) {
            CFRetain(element); CFRelease(*smallest); *smallest = element; *smallestRect = rect; *smallestDepth = depth;
        }
    }
    CFTypeRef value = NULL;
    AXError error = AXUIElementCopyAttributeValue(element, kAXChildrenAttribute, &value);
    if (error == kAXErrorCannotComplete) *incomplete = YES;
    if (value && CFGetTypeID(value) == CFArrayGetTypeID()) {
        CFArrayRef children = (CFArrayRef)value;
        CFIndex count = MIN(CFArrayGetCount(children), 256);
        for (CFIndex i = 0; i < count && !*incomplete; i++) {
            CFTypeRef child = CFArrayGetValueAtIndex(children, i);
            if (CFGetTypeID(child) == AXUIElementGetTypeID())
                visitCaptureElements((AXUIElementRef)child, point, clip, deadline, depth + 1, visited, smallest, smallestRect, smallestDepth, incomplete);
        }
    }
    if (value) CFRelease(value);
    if (NSProcessInfo.processInfo.systemUptime >= deadline) *incomplete = YES;
}

// Resolve every overlapping branch: the smallest direct child need not contain the smallest descendant.
static AXUIElementRef smallestCaptureElement(AXUIElementRef hit, CGPoint point, CGRect clip, NSTimeInterval deadline, BOOL *incomplete) {
    AXUIElementRef smallest = (AXUIElementRef)CFRetain(hit);
    CGRect rect = CGRectNull;
    NSUInteger depth = 0;
    CFMutableSetRef visited = CFSetCreateMutable(NULL, 0, &kCFTypeSetCallBacks);
    visitCaptureElements(hit, point, clip, deadline, 0, visited, &smallest, &rect, &depth, incomplete);
    CFRelease(visited);
    return smallest;
}

// Query the underlying application directly so our mouse-catching overlay is never the AX target.
static NSArray *captureElementsAtPoint(pid_t pid, CGPoint point, CGRect clip) {
    NSTimeInterval started = NSProcessInfo.processInfo.systemUptime;
    AXUIElementRef application = AXUIElementCreateApplication(pid), element = NULL;
    AXUIElementSetMessagingTimeout(application, .15);
    AXError hitError = AXUIElementCopyElementAtPosition(application, point.x, point.y, &element);
    CFRelease(application);
    if (hitError == kAXErrorCannotComplete) { if (element) CFRelease(element); return nil; }
    NSMutableArray *candidates = [NSMutableArray array];
    if (!element) return candidates;
    BOOL incomplete = NO;
    AXUIElementRef smallest = smallestCaptureElement(element, point, clip, started + .5, &incomplete);
    CFRelease(element); element = smallest;
    if (incomplete) { CFRelease(element); return nil; }
    CFTypeRef role = NULL;
    AXUIElementCopyAttributeValue(element, kAXRoleAttribute, &role);
    BOOL windowFallback = role && (CFEqual(role, kAXWindowRole) || CFEqual(role, kAXApplicationRole));
    if (role) CFRelease(role);
    if (windowFallback) { CFRelease(element); return nil; }
    CGRect previous = CGRectNull;
    // Bound traversal for malformed trees and applications that return a cyclic parent chain.
    for (NSUInteger depth = 0; element && depth < 32 && NSProcessInfo.processInfo.systemUptime - started < .5; depth++) {
        AXUIElementSetMessagingTimeout(element, .15);
        CGRect rect;
        if (captureElementRect(element, &rect)) {
            rect = CGRectIntersection(rect, clip);
            if (usableCaptureRect(rect) && CGRectContainsPoint(rect, point) && !CGRectEqualToRect(rect, previous) &&
                (CGRectIsNull(previous) || CGRectContainsRect(rect, previous))) {
                CFTypeRef role = NULL;
                AXUIElementCopyAttributeValue(element, kAXRoleDescriptionAttribute, &role);
                NSString *label = role && CFGetTypeID(role) == CFStringGetTypeID() ? (NSString *)role : @"元素";
                [candidates addObject:@{@"rect": [NSValue valueWithRect:NSRectFromCGRect(rect)], @"label": label, @"element": (id)element}];
                if (role) CFRelease(role);
                previous = rect;
            }
            if (CGRectEqualToRect(rect, clip)) break;
        }
        CFTypeRef parent = NULL;
        AXUIElementCopyAttributeValue(element, kAXParentAttribute, &parent);
        CFRelease(element);
        element = parent && CFGetTypeID(parent) == AXUIElementGetTypeID() ? (AXUIElementRef)parent : NULL;
        if (parent && !element) CFRelease(parent);
    }
    if (element) CFRelease(element);
    if (!candidates.count && NSProcessInfo.processInfo.systemUptime - started >= .5) return nil;
    return candidates;
}

// Lazy AX trees can briefly hit an ancestor with no exposed children. A still-live descendant
// from the previous hit is stronger evidence than that coarse reply, while the pointer remains inside it.
static NSArray *captureElementsKeepingLeaf(NSArray *elements, NSArray *previous, CGPoint point, CGRect clip) {
    if (!elements.count || !previous.count) return elements;
    NSDictionary *leaf = previous[0], *first = elements[0];
    CGRect oldRect = NSRectToCGRect([leaf[@"rect"] rectValue]), newRect = NSRectToCGRect([first[@"rect"] rectValue]);
    AXUIElementRef oldElement = (AXUIElementRef)leaf[@"element"], ancestor = (AXUIElementRef)first[@"element"];
    if (!oldElement || !ancestor || CGRectEqualToRect(oldRect, newRect) ||
        !CGRectContainsPoint(oldRect, point) || !CGRectContainsRect(newRect, oldRect)) return elements;
    CGRect liveRect;
    AXUIElementSetMessagingTimeout(oldElement, .05);
    if (!captureElementRect(oldElement, &liveRect) || !CGRectEqualToRect(CGRectIntersection(liveRect, clip), oldRect)) return elements;
    AXUIElementRef current = (AXUIElementRef)CFRetain(oldElement);
    NSTimeInterval deadline = NSProcessInfo.processInfo.systemUptime + .15;
    BOOL attached = NO;
    CFMutableSetRef visited = CFSetCreateMutable(NULL, 0, &kCFTypeSetCallBacks);
    for (NSUInteger depth = 0; current && depth < 32 && NSProcessInfo.processInfo.systemUptime < deadline; depth++) {
        if (CFEqual(current, ancestor)) { attached = YES; break; }
        if (CFSetContainsValue(visited, current)) break;
        CFSetAddValue(visited, current); AXUIElementSetMessagingTimeout(current, .05);
        CFTypeRef parent = NULL;
        AXUIElementCopyAttributeValue(current, kAXParentAttribute, &parent);
        CFRelease(current);
        current = parent && CFGetTypeID(parent) == AXUIElementGetTypeID() ? (AXUIElementRef)parent : NULL;
        if (parent && !current) CFRelease(parent);
    }
    if (current) CFRelease(current);
    CFRelease(visited);
    if (!attached) return elements;
    NSMutableArray *resolved = [NSMutableArray arrayWithObject:leaf];
    [resolved addObjectsFromArray:elements];
    return resolved;
}

@class CIIPCapturePicker;
@interface CIIPCaptureSelectionView : NSView {
    CAShapeLayer *_shade, *_outline;
    CALayer *_dimensionPlate;
    CATextLayer *_dimensions;
    CGRect _selectionRect, _surfaceBounds;
    BOOL _configured;
}
@property(nonatomic, assign) CIIPCapturePicker *picker;
@property(nonatomic) BOOL leftPressed, rightPressed, cancelOnRelease;
- (void)updateSelectionAnimated:(BOOL)animated;
- (BOOL)reduceSelectionMotion;
@end

@interface CIIPCaptureSelectionPanel : NSPanel
@end
@implementation CIIPCaptureSelectionPanel
- (BOOL)canBecomeKeyWindow { return YES; }
@end

@interface CIIPCapturePicker : NSObject
@property(nonatomic) uintptr_t token;
@property(nonatomic) BOOL elementMode, finished, pending, querying;
@property(nonatomic) CGFloat desktopTop;
@property(nonatomic) CGPoint point;
@property(nonatomic) CGRect rect;
@property(nonatomic, retain) NSDictionary *targetWindow;
@property(nonatomic, retain) NSArray *elements;
@property(nonatomic) NSUInteger elementIndex;
@property(nonatomic) NSUInteger unresolvedRetries;
@property(nonatomic, retain) NSArray *ancestorProposal;
@property(nonatomic) CGPoint ancestorProposalPoint;
@property(nonatomic) NSTimeInterval ancestorProposalSince;
@property(nonatomic) NSUInteger ancestorProposalGeneration;
@property(nonatomic, retain) NSImage *appIcon;
@property(nonatomic, copy) NSString *appName;
@property(nonatomic, retain) NSMutableArray *panels;
@property(nonatomic, retain) NSTimer *timer;
@property(nonatomic) NSTimeInterval selectionDuration;
@property(nonatomic, retain) CAMediaTimingFunction *selectionCurve;
- (void)sample;
- (void)clearAncestorProposal;
- (BOOL)acceptAncestorProposal;
- (BOOL)deferAncestor:(NSArray *)elements window:(NSDictionary *)window point:(CGPoint)point requestedAt:(NSTimeInterval)requestedAt;
- (void)redraw;
- (void)redrawAnimated:(BOOL)animated;
- (void)confirm;
- (void)finish:(BOOL)accepted;
- (void)keyDown:(NSEvent *)event;
@end

static CIIPCapturePicker *activeCapturePicker;
// A pointer crossing the gap between children should not briefly spotlight their entire ancestor.
// This selection policy also applies when the user reduces visual animation.
static const NSTimeInterval captureAncestorDwell = .12;

@implementation CIIPCaptureSelectionView
- (instancetype)initWithFrame:(NSRect)frame {
    if ((self = [super initWithFrame:frame])) {
        self.wantsLayer = YES;
        // Keep the full-screen input surface alive, including the spotlight hole.
        self.layer.backgroundColor = [NSColor colorWithWhite:0 alpha:.01].CGColor;
        _shade = [CAShapeLayer layer]; _shade.fillRule = kCAFillRuleEvenOdd;
        _shade.fillColor = [NSColor colorWithWhite:0 alpha:.22].CGColor;
        _outline = [CAShapeLayer layer]; _outline.fillColor = NSColor.clearColor.CGColor;
        _dimensionPlate = [CALayer layer]; _dimensionPlate.bounds = CGRectMake(0, 0, 144, 26); _dimensionPlate.cornerRadius = 5; _dimensionPlate.hidden = YES;
        _dimensions = [CATextLayer layer]; _dimensions.frame = CGRectMake(0, 4, 144, 18); _dimensions.alignmentMode = kCAAlignmentCenter;
        [_dimensionPlate addSublayer:_dimensions];
        [self.layer addSublayer:_shade]; [self.layer addSublayer:_outline]; [self.layer addSublayer:_dimensionPlate];
        _selectionRect = CGRectNull; _surfaceBounds = CGRectNull;
    }
    return self;
}
- (BOOL)acceptsFirstResponder { return YES; }
- (BOOL)acceptsFirstMouse:(NSEvent *)event { return YES; }
- (void)resetCursorRects { [self addCursorRect:self.bounds cursor:self.picker.elementMode ? NSCursor.crosshairCursor : captureSelectionCursor(self.picker.appIcon)]; }
- (void)mouseDown:(NSEvent *)event { self.leftPressed = YES; }
- (void)rightMouseDown:(NSEvent *)event { self.rightPressed = YES; self.cancelOnRelease = YES; }
- (void)mouseDragged:(NSEvent *)event {}
- (void)rightMouseDragged:(NSEvent *)event {}
- (void)completeMouseGesture {
    if (self.leftPressed || self.rightPressed) return;
    BOOL cancel = self.cancelOnRelease; self.cancelOnRelease = NO;
    if (cancel) [self.picker finish:NO]; else [self.picker confirm];
}
- (void)mouseUp:(NSEvent *)event {
    if (!self.leftPressed) return;
    self.leftPressed = NO; [self completeMouseGesture];
}
- (void)rightMouseUp:(NSEvent *)event {
    if (!self.rightPressed) return;
    self.rightPressed = NO; [self completeMouseGesture];
}
- (void)keyDown:(NSEvent *)event {
    if (self.leftPressed || self.rightPressed) {
        if (event.keyCode == 53) self.cancelOnRelease = YES;
        return;
    }
    [self.picker keyDown:event];
}
- (BOOL)reduceSelectionMotion { return NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion; }
- (void)layout {
    [super layout];
    if (!CGRectEqualToRect(_surfaceBounds, NSRectToCGRect(self.bounds))) [self updateSelectionAnimated:NO];
}
- (void)updateSelectionAnimated:(BOOL)animated {
    CIIPCapturePicker *picker = self.picker;
    // A new window can still be resolving. Keep the last visual selection without making it confirmable.
    if (picker.elementMode && picker.pending && !usableCaptureRect(picker.rect) && _configured) return;
    CGRect selected = CGRectNull;
    if (usableCaptureRect(picker.rect)) {
        CGRect rect = picker.rect;
        selected = CGRectIntersection(NSRectToCGRect(self.bounds), CGRectMake(rect.origin.x - self.window.frame.origin.x,
            picker.desktopTop - CGRectGetMaxY(rect) - self.window.frame.origin.y, rect.size.width, rect.size.height));
    }
    BOOL valid = usableCaptureRect(selected);
    NSTimeInterval duration = animated && picker.elementMode && valid && usableCaptureRect(_selectionRect) && ![self reduceSelectionMotion] ? picker.selectionDuration : 0;
    [CATransaction begin]; [CATransaction setDisableActions:YES];
    _surfaceBounds = NSRectToCGRect(self.bounds);
    _shade.frame = self.bounds; _outline.frame = self.bounds;
    _outline.strokeColor = NSColor.keyboardFocusIndicatorColor.CGColor;
    _outline.lineWidth = NSWorkspace.sharedWorkspace.accessibilityDisplayShouldIncreaseContrast ? 3 : 2;
    _dimensionPlate.hidden = !picker.elementMode || !valid;
    _dimensionPlate.backgroundColor = NSColor.windowBackgroundColor.CGColor;
    _dimensions.contentsScale = self.window.backingScaleFactor ?: 1;
    _dimensions.string = [[[NSAttributedString alloc] initWithString:captureSelectionDimensions(picker.rect, self.window.backingScaleFactor ?: 1)
        attributes:@{NSFontAttributeName:[NSFont monospacedDigitSystemFontOfSize:12 weight:NSFontWeightMedium], NSForegroundColorAttributeName:NSColor.labelColor}] autorelease];
    if (!_configured || !CGRectEqualToRect(selected, _selectionRect)) {
        CGMutablePathRef shade = CGPathCreateMutable(); CGPathAddRect(shade, NULL, NSRectToCGRect(self.bounds));
        CGMutablePathRef border = CGPathCreateMutable();
        if (valid) {
            CGPathAddRect(shade, NULL, selected);
            CGFloat inset = MIN(1, MIN(selected.size.width, selected.size.height) / 4);
            CGPathAddRect(border, NULL, CGRectInset(selected, inset, inset));
        }
        updateCaptureLayer(_shade, @"path", (id)shade, duration, picker.selectionCurve);
        updateCaptureLayer(_outline, @"path", (id)border, duration, picker.selectionCurve);
        CGPathRelease(shade); CGPathRelease(border);
        if (valid) {
            CGFloat x = MAX(76, MIN(CGRectGetMidX(selected), self.bounds.size.width - 76));
            CGFloat y = CGRectGetMinY(selected) - 18;
            if (y < 18) y = MIN(self.bounds.size.height - 18, CGRectGetMaxY(selected) + 18);
            updateCaptureLayer(_dimensionPlate, @"position", [NSValue valueWithPoint:NSMakePoint(x, y)], duration, picker.selectionCurve);
        }
        _selectionRect = selected; _configured = YES;
    } else if (!animated || [self reduceSelectionMotion]) {
        [_shade removeAllAnimations]; [_outline removeAllAnimations]; [_dimensionPlate removeAllAnimations];
    }
    [CATransaction commit];
}
@end

@implementation CIIPCapturePicker
- (instancetype)init {
    if ((self = [super init])) { _rect = CGRectNull; _point = CGPointMake(INFINITY, INFINITY); _panels = [[NSMutableArray alloc] init]; }
    return self;
}
- (void)dealloc {
    [_targetWindow release]; [_elements release]; [_ancestorProposal release]; [_appIcon release]; [_appName release]; [_panels release]; [_timer release]; [_selectionCurve release];
    [super dealloc];
}
- (void)redraw { [self redrawAnimated:YES]; }
- (void)clearAncestorProposal {
    self.ancestorProposal = nil; self.ancestorProposalSince = 0;
    self.ancestorProposalPoint = CGPointMake(INFINITY, INFINITY); self.ancestorProposalGeneration++;
}
- (BOOL)acceptAncestorProposal {
    if (!self.ancestorProposal.count || self.querying || !CGPointEqualToPoint(self.ancestorProposalPoint, self.point)) return NO;
    CGRect rect = NSRectToCGRect([self.ancestorProposal[0][@"rect"] rectValue]);
    if (!CGRectContainsPoint(rect, self.point)) return NO;
    self.elements = self.ancestorProposal; self.elementIndex = 0; self.rect = rect; self.pending = NO;
    [self clearAncestorProposal]; return YES;
}
- (BOOL)deferAncestor:(NSArray *)elements window:(NSDictionary *)window point:(CGPoint)point requestedAt:(NSTimeInterval)requestedAt {
    CGRect oldRect = self.elements.count ? NSRectToCGRect([self.elements[0][@"rect"] rectValue]) : CGRectNull;
    CGRect rect = elements.count ? NSRectToCGRect([elements[0][@"rect"] rectValue]) : CGRectNull;
    if (!usableCaptureRect(oldRect) || !usableCaptureRect(rect) || CGRectEqualToRect(rect, oldRect) ||
        !CGRectContainsRect(rect, oldRect) || !CGRectContainsRect(rect, self.rect) || CGRectEqualToRect(rect, self.rect)) {
        [self clearAncestorProposal]; return NO;
    }
    BOOL sameProposal = self.ancestorProposal.count && [self.ancestorProposal[0][@"rect"] isEqual:elements[0][@"rect"]];
    NSPoint mouse = NSEvent.mouseLocation;
    CGPoint livePoint = CGPointMake(mouse.x, self.desktopTop - mouse.y);
    if (!CGPointEqualToPoint(point, self.point) || !CGPointEqualToPoint(point, livePoint)) {
        if (!sameProposal) [self clearAncestorProposal];
        self.point = CGPointMake(INFINITY, INFINITY); [self sample]; return YES;
    }
    if (sameProposal && requestedAt >= self.ancestorProposalSince + captureAncestorDwell) {
        [self clearAncestorProposal]; return NO; // A fresh hit after the dwell confirms the ancestor.
    }
    self.ancestorProposal = elements; self.ancestorProposalPoint = point; self.pending = YES;
    if (!sameProposal) {
        self.ancestorProposalSince = NSProcessInfo.processInfo.systemUptime;
        NSUInteger generation = ++self.ancestorProposalGeneration;
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(captureAncestorDwell * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
            if (!self.finished && self.ancestorProposal.count && generation == self.ancestorProposalGeneration && sameCaptureWindow(window, self.targetWindow)) {
                // Read the physical pointer again, including movement between the regular 50ms samples.
                self.point = CGPointMake(INFINITY, INFINITY); [self sample];
            }
        });
    }
    [self redraw];
    if (NSProcessInfo.processInfo.systemUptime >= self.ancestorProposalSince + captureAncestorDwell) {
        self.point = CGPointMake(INFINITY, INFINITY); [self sample];
    }
    return YES;
}
- (void)redrawAnimated:(BOOL)animated {
    NSString *detail = self.elementMode ? (self.elements.count ? self.elements[self.elementIndex][@"label"] : self.pending ? @"正在识别元素" : @"此处没有可识别元素") : self.targetWindow[(id)kCGWindowName];
    NSString *label = [NSString stringWithFormat:@"%@，%@", self.appName ?: (self.elementMode ? @"选择屏幕元素" : @"选择应用窗口"), detail ?: @"移动指针选择目标"];
    for (NSPanel *panel in self.panels) {
        [panel.contentView setAccessibilityLabel:label];
        [(CIIPCaptureSelectionView *)panel.contentView updateSelectionAnimated:animated];
    }
}
- (void)sample {
    if (self.finished) return;
    NSPoint mouse = NSEvent.mouseLocation;
    CGPoint point = CGPointMake(mouse.x, self.desktopTop - mouse.y);
    if (CGPointEqualToPoint(point, self.point)) return;
    if (isfinite(self.point.x)) self.unresolvedRetries = 0;
    self.point = point;
    if (self.ancestorProposal.count && !CGRectContainsPoint(NSRectToCGRect([self.ancestorProposal[0][@"rect"] rectValue]), point))
        [self clearAncestorProposal];
    NSArray *windows = [(NSArray *)CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID) autorelease];
    NSMutableSet *excluded = [NSMutableSet set];
    for (NSPanel *panel in self.panels) [excluded addObject:@(panel.windowNumber)];
    NSDictionary *window = captureWindowAtPoint(windows, point, excluded);
    BOOL sameWindow = sameCaptureWindow(window, self.targetWindow);
    BOOL sameApp = window && [window[(id)kCGWindowOwnerPID] isEqual:self.targetWindow[(id)kCGWindowOwnerPID]];
    // Keep the last resolved frame during AX refresh; clearing it here makes every pointer move blink.
    if (!sameWindow) { [self clearAncestorProposal]; self.rect = CGRectNull; self.elements = nil; self.elementIndex = 0; }
    self.targetWindow = window;
    pid_t pid = [self.targetWindow[(id)kCGWindowOwnerPID] intValue];
    if (!sameApp || !self.appIcon) {
        NSRunningApplication *app = pid ? [NSRunningApplication runningApplicationWithProcessIdentifier:pid] : nil;
        self.appIcon = window ? app.icon ?: [NSImage imageWithSystemSymbolName:@"app" accessibilityDescription:@"应用"] : nil;
        self.appName = app.localizedName ?: self.targetWindow[(id)kCGWindowOwnerName];
        for (NSPanel *panel in self.panels) [panel invalidateCursorRectsForView:panel.contentView];
    }
    CGRect windowRect;
    if (!self.targetWindow || !CGRectMakeWithDictionaryRepresentation((CFDictionaryRef)self.targetWindow[(id)kCGWindowBounds], &windowRect)) {
        self.pending = NO; [self redraw]; return;
    }
    if (!self.elementMode) { self.rect = windowRect; self.pending = NO; [self redraw]; return; }
    self.pending = YES; [self redraw];
    if (self.querying) return;
    self.querying = YES;
    NSArray *previous = sameWindow ? self.elements : nil;
    CGRect clip = windowRect;
    for (NSScreen *screen in NSScreen.screens) if (NSPointInRect(mouse, screen.frame)) {
        clip = CGRectIntersection(clip, CGRectMake(screen.frame.origin.x, self.desktopTop - NSMaxY(screen.frame), screen.frame.size.width, screen.frame.size.height));
        break;
    }
    // AX IPC can block on an unresponsive app. Keep it off AppKit's event thread.
    NSTimeInterval requestedAt = NSProcessInfo.processInfo.systemUptime;
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        @autoreleasepool {
            NSArray *elements = captureElementsKeepingLeaf(captureElementsAtPoint(pid, point, clip), previous, point, clip);
            dispatch_async(dispatch_get_main_queue(), ^{
                self.querying = NO;
                if (self.finished) return;
                BOOL sameLeaf = elements.count && CGRectContainsPoint(NSRectToCGRect([elements[0][@"rect"] rectValue]), self.point);
                if ((!CGPointEqualToPoint(point, self.point) && !sameLeaf) || !sameCaptureWindow(window, self.targetWindow)) {
                    self.point = CGPointMake(INFINITY, INFINITY); [self sample]; return;
                }
                if (!elements) {
                    [self clearAncestorProposal];
                    // Transient AX failures must not turn the previous hole into a full-screen flash.
                    if (self.unresolvedRetries++ >= 2) {
                        self.pending = NO; self.elements = nil; self.rect = CGRectNull; self.elementIndex = 0;
                        [self redraw]; return;
                    }
                    self.pending = YES; [self redraw];
                    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
                        if (!self.finished && self.pending && self.unresolvedRetries > 0 && !self.querying && CGPointEqualToPoint(point, self.point) && sameCaptureWindow(window, self.targetWindow)) {
                            self.point = CGPointMake(INFINITY, INFINITY); [self sample];
                        }
                    });
                    return;
                }
                self.unresolvedRetries = 0;
                if ([self deferAncestor:elements window:window point:point requestedAt:requestedAt]) return;
                NSUInteger index = 0;
                if (self.elements.count && elements.count && [self.elements[0][@"rect"] isEqual:elements[0][@"rect"]]) {
                    for (NSUInteger i = 0; i < elements.count; i++) {
                        if (CGRectEqualToRect(NSRectToCGRect([elements[i][@"rect"] rectValue]), self.rect)) { index = i; break; }
                    }
                }
                self.pending = NO; self.elements = elements; self.elementIndex = index;
                self.rect = elements.count ? NSRectToCGRect([elements[index][@"rect"] rectValue]) : CGRectNull;
                [self redraw];
                // Show useful progress while moving, then resolve the exact latest point before confirmation.
                if (!CGPointEqualToPoint(point, self.point)) {
                    self.point = CGPointMake(INFINITY, INFINITY); [self sample];
                }
            });
        }
    });
}
- (void)confirm {
    [self sample];
    if (self.pending || !usableCaptureRect(self.rect)) { NSBeep(); return; }
    // A closed or moved target must be selected again, never captured using stale bounds.
    CGWindowID windowID = [self.targetWindow[(id)kCGWindowNumber] unsignedIntValue];
    NSArray *current = [(NSArray *)CGWindowListCopyWindowInfo(kCGWindowListOptionIncludingWindow, windowID) autorelease];
    NSDictionary *window = current.firstObject;
    if (!window || [window[(id)kCGWindowNumber] unsignedIntValue] != windowID ||
        ![window[(id)kCGWindowOwnerPID] isEqual:self.targetWindow[(id)kCGWindowOwnerPID]] ||
        ![window[(id)kCGWindowBounds] isEqual:self.targetWindow[(id)kCGWindowBounds]]) {
        self.point = CGPointMake(INFINITY, INFINITY); [self sample]; return;
    }
    [self finish:YES];
}
- (void)keyDown:(NSEvent *)event {
    if (event.keyCode == 53) { [self finish:NO]; return; }
    if (event.keyCode == 36 || event.keyCode == 76) { [self confirm]; return; }
    if (event.keyCode == 126 && self.ancestorProposal.count) {
        [self sample];
        if ([self acceptAncestorProposal]) { [self redrawAnimated:NO]; return; }
    }
    if (!self.elementMode || self.pending || !self.elements.count) return;
    if (event.keyCode == 126 && self.elementIndex + 1 < self.elements.count) self.elementIndex++;
    else if (event.keyCode == 125 && self.elementIndex > 0) self.elementIndex--;
    else return;
    self.rect = NSRectToCGRect([self.elements[self.elementIndex][@"rect"] rectValue]); [self redrawAnimated:NO];
}
- (void)screenChanged:(NSNotification *)notification { [self finish:NO]; }
- (void)finish:(BOOL)accepted {
    if (self.finished) return;
    self.finished = YES; [self.timer invalidate]; self.timer = nil;
    [self clearAncestorProposal];
    [[NSNotificationCenter defaultCenter] removeObserver:self];
    for (NSPanel *panel in self.panels) [panel close];
    [self.panels removeAllObjects];
    CGRect rect = accepted ? self.rect : CGRectZero;
    ciip_go_capture_selection(self.token, accepted ? [self.targetWindow[(id)kCGWindowNumber] unsignedIntValue] : 0,
        rect.origin.x, rect.origin.y, rect.size.width, rect.size.height);
    activeCapturePicker = nil;
    [self autorelease];
}
@end

int ciip_element_permission(void) {
    return AXIsProcessTrustedWithOptions((CFDictionaryRef)@{(id)kAXTrustedCheckOptionPrompt:@YES});
}

int ciip_start_capture_selection(uintptr_t token, int element, double duration, double x1, double y1, double x2, double y2) {
    if (activeCapturePicker || !NSScreen.screens.count) return 0;
    CIIPCapturePicker *picker = [[CIIPCapturePicker alloc] init];
    activeCapturePicker = picker; picker.token = token; picker.elementMode = element != 0;
    picker.selectionDuration = duration;
    picker.selectionCurve = [CAMediaTimingFunction functionWithControlPoints:x1 :y1 :x2 :y2];
    picker.desktopTop = NSMaxY([NSScreen.screens[0] frame]);
    for (NSScreen *screen in NSScreen.screens) {
        NSPanel *panel = [[[CIIPCaptureSelectionPanel alloc] initWithContentRect:screen.frame styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel backing:NSBackingStoreBuffered defer:NO] autorelease];
        panel.releasedWhenClosed = NO; panel.opaque = NO; panel.backgroundColor = NSColor.clearColor;
        panel.hasShadow = NO; panel.hidesOnDeactivate = NO; panel.level = NSScreenSaverWindowLevel;
        panel.title = picker.elementMode ? @"元素截图" : @"窗口截图";
        panel.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary;
        CIIPCaptureSelectionView *view = [[[CIIPCaptureSelectionView alloc] initWithFrame:NSMakeRect(0, 0, screen.frame.size.width, screen.frame.size.height)] autorelease];
        view.picker = picker; panel.contentView = view;
        [view setAccessibilityElement:YES]; [view setAccessibilityRole:NSAccessibilityGroupRole];
        [view setAccessibilityHelp:picker.elementMode ? @"点击或回车截图，方向键上下选择元素层级，Esc 取消" : @"点击或回车截图，Esc 取消"];
        [panel makeFirstResponder:view]; [picker.panels addObject:panel];
        [panel orderFrontRegardless];
        if (NSPointInRect(NSEvent.mouseLocation, screen.frame)) [panel makeKeyWindow];
    }
    [[NSNotificationCenter defaultCenter] addObserver:picker selector:@selector(screenChanged:) name:NSApplicationDidChangeScreenParametersNotification object:nil];
    [picker sample];
    picker.timer = [NSTimer scheduledTimerWithTimeInterval:.05 target:picker selector:@selector(sample) userInfo:nil repeats:YES];
    return 1;
}

void ciip_cancel_capture_selection(uintptr_t token) {
    if (activeCapturePicker.token == token) [activeCapturePicker finish:NO];
}
