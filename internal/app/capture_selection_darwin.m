//go:build darwin && cgo

#import <Cocoa/Cocoa.h>
#import <ApplicationServices/ApplicationServices.h>
#import <QuartzCore/QuartzCore.h>
#include <stdint.h>
#include <math.h>
#import "capture_measurement_darwin.h"
#import "capture_adjustment_darwin.h"
#import "quick_material_darwin.h"
#import "capture_snapshot_darwin.h"
#import "capture_snapshot_crop_darwin.h"

extern void ciip_go_capture_selection(uintptr_t, uint32_t, double, double, double, double, int);
extern void ciip_go_capture_area_image(uintptr_t, double, double, double, double, int, const void *, size_t, const char *);

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

static BOOL closeCaptureRects(CGRect a, CGRect b, CGFloat tolerance) {
    return usableCaptureRect(a) && usableCaptureRect(b) && fabs(a.origin.x - b.origin.x) <= tolerance &&
        fabs(a.origin.y - b.origin.y) <= tolerance && fabs(a.size.width - b.size.width) <= tolerance && fabs(a.size.height - b.size.height) <= tolerance;
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

#import "capture_layout_ax_darwin.h"

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
static NSArray *captureElementsAtPoint(pid_t pid, CGPoint point, CGRect clip, NSMutableDictionary *applications) {
    NSTimeInterval started = NSProcessInfo.processInfo.systemUptime;
    AXUIElementRef application = (AXUIElementRef)applications[@(pid)], element = NULL;
    BOOL created = !application;
    if (created) {
        application = AXUIElementCreateApplication(pid); AXUIElementSetMessagingTimeout(application, .15);
        if (applications) applications[@(pid)] = (id)application;
    }
    AXError hitError = AXUIElementCopyElementAtPosition(application, point.x, point.y, &element);
    if (created) CFRelease(application);
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
        CGRect frame;
        if (captureElementRect(element, &frame)) {
            CGRect rect = CGRectIntersection(frame, clip);
            if (usableCaptureRect(rect) && CGRectContainsPoint(rect, point) && !CGRectEqualToRect(rect, previous) &&
                (CGRectIsNull(previous) || CGRectContainsRect(rect, previous))) {
                CFTypeRef role = NULL;
                AXUIElementCopyAttributeValue(element, kAXRoleDescriptionAttribute, &role);
                NSString *label = role && CFGetTypeID(role) == CFStringGetTypeID() ? (NSString *)role : @"元素";
                [candidates addObject:@{@"rect": [NSValue valueWithRect:NSRectFromCGRect(rect)],
                    @"frame": [NSValue valueWithRect:NSRectFromCGRect(frame)], @"label": label, @"element": (id)element}];
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
    CGRect liveFrame;
    AXUIElementSetMessagingTimeout(oldElement, .05);
    if (!captureElementRect(oldElement, &liveFrame)) return elements;
    CGRect liveRect = CGRectIntersection(liveFrame, clip);
    if (!closeCaptureRects(liveRect, oldRect, .75) || !CGRectContainsPoint(liveRect, point)) return elements;
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
    NSMutableDictionary *liveLeaf = [[leaf mutableCopy] autorelease];
    liveLeaf[@"rect"] = [NSValue valueWithRect:NSRectFromCGRect(liveRect)];
    liveLeaf[@"frame"] = [NSValue valueWithRect:NSRectFromCGRect(liveFrame)];
    NSMutableArray *resolved = [NSMutableArray arrayWithObject:liveLeaf];
    [resolved addObjectsFromArray:elements];
    return resolved;
}

@class CIIPCapturePicker;
@interface CIIPCaptureSelectionView : NSView {
    CAShapeLayer *_shade, *_outline;
    CALayer *_dimensionPlate;
    CATextLayer *_dimensions;
    CALayer *_measurement, *_measurementStatus, *_measurementLabels[4];
    CAShapeLayer *_measurementReference, *_measurementLines;
    CALayer *_layoutOverlay, *_layoutBadges;
    CAShapeLayer *_layoutBoxes, *_layoutLines;
    CAShapeLayer *_adjustmentHandles;
    NSVisualEffectView *_adjustmentControls;
    NSCursor *_adjustmentCursor;
    NSArray *_drawnLayout;
    CGRect _drawnLayoutBounds;
    BOOL _drawnLayoutOnPointerDisplay;
    CGFloat _drawnLayoutScale;
    CGRect _selectionRect, _displayedSelection, _surfaceBounds;
    id _selectionClock;
    NSTrackingArea *_pointerTrackingArea;
    CFTimeInterval _selectionTickTime;
    BOOL _configured;
}
@property(nonatomic, assign) CIIPCapturePicker *picker;
@property(nonatomic, readonly) BOOL leftPressed, rightPressed;
- (void)updateSelectionAnimated:(BOOL)animated;
- (BOOL)reduceSelectionMotion;
- (void)stopSelectionAnimation;
- (void)setFrozenImage:(CGImageRef)image;
@end

@interface CIIPCaptureSelectionPanel : NSPanel
@end
@implementation CIIPCaptureSelectionPanel
- (BOOL)canBecomeKeyWindow { return YES; }
@end

@interface CIIPCapturePicker : NSObject
@property(nonatomic) uintptr_t token;
@property(nonatomic) BOOL elementMode, measurementMode, areaMode, adjusting, copyOnly, finished, pending, querying;
@property(nonatomic) BOOL trackingSelection, draggingSelection;
@property(nonatomic) NSUInteger pressedMouseButtons;
@property(nonatomic) BOOL cancelOnMouseRelease, selectionReleasePending;
@property(nonatomic) CGPoint dragStart, dragPoint;
@property(nonatomic) CGRect adjustmentStartRect;
@property(nonatomic) CIIPCaptureEdge adjustmentEdges;
@property(nonatomic) CGFloat desktopTop;
@property(nonatomic) CGPoint point;
@property(nonatomic) CGRect rect;
@property(nonatomic, retain) NSDictionary *targetWindow;
@property(nonatomic, retain) NSArray *elements;
@property(nonatomic, retain) NSArray *measurementReference;
@property(nonatomic, retain) NSDictionary *measurementLayoutTarget;
@property(nonatomic, retain) NSArray *measurementLayoutChildren;
@property(nonatomic) BOOL measurementLayoutQuerying;
@property(nonatomic, retain) NSMutableDictionary *applications;
@property(nonatomic) NSUInteger elementIndex;
@property(nonatomic) NSUInteger unresolvedRetries;
@property(nonatomic, retain) NSArray *ancestorProposal;
@property(nonatomic) CGPoint ancestorProposalPoint;
@property(nonatomic) NSTimeInterval ancestorProposalSince;
@property(nonatomic) NSUInteger ancestorProposalGeneration;
@property(nonatomic, retain) NSImage *appIcon;
@property(nonatomic, copy) NSString *appName;
@property(nonatomic, retain) NSMutableArray *panels;
@property(nonatomic, retain) NSDictionary<NSNumber *, id> *frozenFrames;
@property(nonatomic, retain) NSDictionary<NSNumber *, NSValue *> *frozenDisplayRects;
@property(nonatomic, retain) NSTimer *timer;
@property(nonatomic, retain) NSWindow *quickToolbar;
@property(nonatomic) NSInteger quickToolbarLevel;
@property(nonatomic) NSWindowCollectionBehavior quickToolbarBehavior;
@property(nonatomic) BOOL quickToolbarAcceptedMouseMoves;
@property(nonatomic, assign) id quickToolbarMouseMonitor;
@property(nonatomic) NSTimeInterval selectionDuration;
- (void)sample;
- (void)clearAncestorProposal;
- (BOOL)acceptAncestorProposal;
- (BOOL)deferAncestor:(NSArray *)elements window:(NSDictionary *)window point:(CGPoint)point requestedAt:(NSTimeInterval)requestedAt;
- (void)redraw;
- (void)redrawAnimated:(BOOL)animated;
- (void)beginSelectionAtPoint:(CGPoint)point;
- (void)updateSelectionAtPoint:(CGPoint)point;
- (void)completeSelectionGesture;
- (void)completeAdjustment:(BOOL)copyOnly;
- (NSPanel *)adjustmentControlsPanel;
- (void)positionQuickToolbar;
- (void)updateQuickToolbarCursorForWindow:(NSWindow *)window;
- (CGRect)measurementFrame;
- (NSUInteger)measurementGuides:(CIIPMeasurementGuide *)guides;
- (void)confirm;
- (void)finish:(BOOL)accepted;
- (void)showSelectionPanels:(NSArray<NSScreen *> *)screens;
- (void)keyDown:(NSEvent *)event;
@end

static CIIPCapturePicker *activeCapturePicker;
// A pointer crossing the gap between children should not briefly spotlight their entire ancestor.
// This selection policy also applies when the user reduces visual animation.
static const NSTimeInterval captureAncestorDwell = .12;

static CGRect capturePanelRect(NSPanel *panel, CGFloat desktopTop) {
    NSRect frame = panel.frame;
    return CGRectMake(NSMinX(frame), desktopTop - NSMaxY(frame), NSWidth(frame), NSHeight(frame));
}

static NSCursor *captureAdjustmentCursor(CIIPCaptureEdge edges, BOOL inside, BOOL dragging) {
    if (!edges) return inside ? (dragging ? NSCursor.closedHandCursor : NSCursor.openHandCursor) : NSCursor.crosshairCursor;
    BOOL horizontal = edges & (CIIPCaptureEdgeLeft | CIIPCaptureEdgeRight);
    BOOL vertical = edges & (CIIPCaptureEdgeTop | CIIPCaptureEdgeBottom);
    if (@available(macOS 15.0, *)) {
        NSUInteger position = 0;
        if (edges & CIIPCaptureEdgeLeft) position |= NSCursorFrameResizePositionLeft;
        if (edges & CIIPCaptureEdgeRight) position |= NSCursorFrameResizePositionRight;
        if (edges & CIIPCaptureEdgeTop) position |= NSCursorFrameResizePositionTop;
        if (edges & CIIPCaptureEdgeBottom) position |= NSCursorFrameResizePositionBottom;
        return [NSCursor frameResizeCursorFromPosition:(NSCursorFrameResizePosition)position inDirections:NSCursorFrameResizeDirectionsAll];
    }
    if (!vertical) return NSCursor.resizeLeftRightCursor;
    if (!horizontal) return NSCursor.resizeUpDownCursor;
    BOOL descending = !!(edges & CIIPCaptureEdgeLeft) == !!(edges & CIIPCaptureEdgeTop);
    static NSCursor *corners[2];
    if (!corners[descending]) {
        NSImage *image = [NSImage imageWithSize:NSMakeSize(20, 20) flipped:NO drawingHandler:^BOOL(NSRect rect) {
            CGFloat first = descending ? 16 : 4, last = 20 - first;
            NSBezierPath *path = [NSBezierPath bezierPath];
            path.lineCapStyle = NSLineCapStyleRound; path.lineJoinStyle = NSLineJoinStyleRound;
            [path moveToPoint:NSMakePoint(4, first)]; [path lineToPoint:NSMakePoint(16, last)];
            [path moveToPoint:NSMakePoint(9, first)]; [path lineToPoint:NSMakePoint(4, first)];
            [path lineToPoint:NSMakePoint(4, first + (descending ? -5 : 5))];
            [path moveToPoint:NSMakePoint(11, last)]; [path lineToPoint:NSMakePoint(16, last)];
            [path lineToPoint:NSMakePoint(16, last + (descending ? 5 : -5))];
            [NSColor.whiteColor setStroke]; path.lineWidth = 3.5; [path stroke];
            [NSColor.blackColor setStroke]; path.lineWidth = 1.5; [path stroke];
            return YES;
        }];
        corners[descending] = [[NSCursor alloc] initWithImage:image hotSpot:NSMakePoint(10, 10)];
    }
    return corners[descending];
}

static NSString *measurementNumber(CGFloat points) {
    return [NSNumberFormatter localizedStringFromNumber:@(points) numberStyle:NSNumberFormatterDecimalStyle];
}

static NSString *measurementDimensions(CGRect rect) {
    return [NSString stringWithFormat:@"%@ × %@ pt", measurementNumber(rect.size.width), measurementNumber(rect.size.height)];
}

static void appendMeasurementGuide(CGMutablePathRef path, CGPoint start, CGPoint end) {
    CGFloat dx = start.y == end.y ? 0 : 3, dy = start.y == end.y ? 3 : 0;
    CGPathMoveToPoint(path, NULL, start.x, start.y); CGPathAddLineToPoint(path, NULL, end.x, end.y);
    CGPathMoveToPoint(path, NULL, start.x - dx, start.y - dy); CGPathAddLineToPoint(path, NULL, start.x + dx, start.y + dy);
    CGPathMoveToPoint(path, NULL, end.x - dx, end.y - dy); CGPathAddLineToPoint(path, NULL, end.x + dx, end.y + dy);
}

static CALayer *measurementBadge(CALayer *parent) {
    CALayer *plate = [CALayer layer]; plate.cornerRadius = 5; plate.hidden = YES;
    CATextLayer *label = [CATextLayer layer]; label.alignmentMode = kCAAlignmentCenter;
    [plate addSublayer:label]; [parent addSublayer:plate];
    return plate;
}

static CGPoint measurementBadgeCenter(CGPoint center, CGSize size, CGRect bounds) {
    CGFloat x = size.width / 2 + 4, y = size.height / 2 + 4;
    return CGPointMake(MAX(x, MIN(center.x, CGRectGetMaxX(bounds) - x)), MAX(y, MIN(center.y, CGRectGetMaxY(bounds) - y)));
}

static void positionMeasurementBadge(CALayer *plate, NSString *text, CGPoint center, CGRect bounds, CGFloat scale, BOOL compact) {
    NSAttributedString *value = [[[NSAttributedString alloc] initWithString:text
        attributes:@{NSFontAttributeName:[NSFont monospacedDigitSystemFontOfSize:compact ? 10 : 12 weight:NSFontWeightMedium],
            NSForegroundColorAttributeName:NSColor.labelColor}] autorelease];
    CGFloat width = ceil(value.size.width) + (compact ? 8 : 14), height = compact ? 17 : 24;
    plate.bounds = CGRectMake(0, 0, width, height);
    plate.position = measurementBadgeCenter(center, plate.bounds.size, bounds);
    plate.backgroundColor = NSColor.windowBackgroundColor.CGColor; plate.hidden = NO;
    CATextLayer *label = (CATextLayer *)plate.sublayers.firstObject;
    label.frame = CGRectMake(0, compact ? 1 : 3, width, compact ? 14 : 18);
    label.contentsScale = scale; label.string = value;
}

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
        _selectionRect = _displayedSelection = CGRectNull; _surfaceBounds = CGRectNull;
    }
    return self;
}
- (void)setFrozenImage:(CGImageRef)image {
    self.layer.backgroundColor = NSColor.blackColor.CGColor;
    CALayer *snapshot = [CALayer layer];
    snapshot.frame = self.bounds;
    snapshot.contents = (id)image;
    snapshot.contentsGravity = kCAGravityResize;
    snapshot.autoresizingMask = kCALayerWidthSizable | kCALayerHeightSizable;
    [self.layer insertSublayer:snapshot below:_shade];
}
- (BOOL)acceptsFirstResponder { return YES; }
- (BOOL)acceptsFirstMouse:(NSEvent *)event { return YES; }
- (BOOL)mouseDownCanMoveWindow { return NO; }
- (void)resetCursorRects {
    if (self.picker.adjusting) return;
    [self addCursorRect:self.bounds cursor:self.picker.elementMode || self.picker.areaMode ? NSCursor.crosshairCursor : captureSelectionCursor(self.picker.appIcon)];
}
- (void)updateTrackingAreas {
    if (_pointerTrackingArea) { [self removeTrackingArea:_pointerTrackingArea]; [_pointerTrackingArea release]; }
    _pointerTrackingArea = [[NSTrackingArea alloc] initWithRect:NSZeroRect options:NSTrackingMouseMoved | NSTrackingMouseEnteredAndExited | NSTrackingActiveAlways | NSTrackingInVisibleRect owner:self userInfo:nil];
    [self addTrackingArea:_pointerTrackingArea]; [super updateTrackingAreas];
}
- (void)showAdjustmentCursor:(NSCursor *)cursor {
    if (_adjustmentCursor != cursor) {
        [_adjustmentCursor release]; _adjustmentCursor = [cursor retain];
    }
    [cursor set];
}
- (void)handoffAdjustmentCursor {
    if (_adjustmentCursor && NSCursor.currentCursor == _adjustmentCursor) [NSCursor.arrowCursor set];
    [_adjustmentCursor release]; _adjustmentCursor = nil;
}
- (BOOL)pointIsOverQuickToolbar:(CGPoint)point {
    NSWindow *toolbar = self.picker.quickToolbar;
    return toolbar.isVisible && NSPointInRect(NSMakePoint(point.x, self.picker.desktopTop - point.y), toolbar.frame);
}
- (void)mouseMoved:(NSEvent *)event {
    if (!self.picker.adjusting) { [self.picker sample]; return; }
    CGPoint point = [self capturePointForEvent:event];
    if ([self pointIsOverQuickToolbar:point] || [self pointIsOverQuickToolbar:[self capturePointForEvent:nil]]) {
        [self handoffAdjustmentCursor]; return;
    }
    if (_adjustmentControls && !_adjustmentControls.hidden &&
        NSPointInRect([self convertPoint:event.locationInWindow fromView:nil], _adjustmentControls.frame)) {
        [NSCursor.arrowCursor set]; return;
    }
    CGRect rect = self.picker.rect;
    CIIPCaptureEdge edges = captureAdjustmentEdge(rect, point, 7);
    [self showAdjustmentCursor:captureAdjustmentCursor(edges, CGRectContainsPoint(rect, point), NO)];
}
- (void)mouseEntered:(NSEvent *)event { [self mouseMoved:event]; }
- (void)mouseExited:(NSEvent *)event {
    if (self.picker.adjusting) {
        // The exit location can still be on the overlay when the toolbar takes over.
        if (!self.picker.trackingSelection) [self handoffAdjustmentCursor];
    } else [self.picker sample];
}
- (CGPoint)capturePointForEvent:(NSEvent *)event {
    NSPoint point = event && self.window ? [self.window convertPointToScreen:event.locationInWindow] : NSEvent.mouseLocation;
    return CGPointMake(point.x, self.picker.desktopTop - point.y);
}
- (BOOL)leftPressed { return (self.picker.pressedMouseButtons & 1) != 0; }
- (BOOL)rightPressed { return (self.picker.pressedMouseButtons & 2) != 0; }
- (void)mouseDown:(NSEvent *)event {
    CIIPCapturePicker *picker = self.picker;
    picker.pressedMouseButtons |= 1;
    if (picker.cancelOnMouseRelease) return;
    [picker beginSelectionAtPoint:[self capturePointForEvent:event]];
    if (picker.adjusting) {
        if (!self.window.isKeyWindow) [self.window makeKeyWindow];
        [self showAdjustmentCursor:captureAdjustmentCursor(picker.adjustmentEdges, CGRectContainsPoint(picker.adjustmentStartRect, picker.dragStart), YES)];
    }
}
- (void)rightMouseDown:(NSEvent *)event {
    self.picker.pressedMouseButtons |= 2;
    self.picker.cancelOnMouseRelease = YES;
}
- (void)mouseDragged:(NSEvent *)event {
    CIIPCapturePicker *picker = self.picker;
    if (!self.leftPressed || picker.cancelOnMouseRelease) return;
    [picker updateSelectionAtPoint:[self capturePointForEvent:event]];
    if (picker.adjusting)
        [self showAdjustmentCursor:captureAdjustmentCursor(picker.adjustmentEdges, CGRectContainsPoint(picker.adjustmentStartRect, picker.dragStart), YES)];
}
- (void)rightMouseDragged:(NSEvent *)event {}
- (void)completeMouseGesture {
    CIIPCapturePicker *picker = self.picker;
    if (picker.pressedMouseButtons) return;
    BOOL cancel = picker.cancelOnMouseRelease, confirm = picker.selectionReleasePending;
    picker.cancelOnMouseRelease = NO;
    picker.selectionReleasePending = NO;
    if (cancel) [picker finish:NO];
    else if (confirm) [picker completeSelectionGesture];
}
- (void)mouseUp:(NSEvent *)event {
    if (!self.leftPressed) return;
    CIIPCapturePicker *picker = self.picker;
    if (!picker.cancelOnMouseRelease) [picker updateSelectionAtPoint:[self capturePointForEvent:event]];
    picker.pressedMouseButtons &= ~(NSUInteger)1;
    picker.selectionReleasePending = YES;
    [self completeMouseGesture];
    if (picker.adjusting && !picker.finished) [self mouseMoved:event];
}
- (void)rightMouseUp:(NSEvent *)event {
    if (!self.rightPressed) return;
    self.picker.pressedMouseButtons &= ~(NSUInteger)2;
    [self completeMouseGesture];
}
- (void)otherMouseDown:(NSEvent *)event {
    NSInteger button = event.buttonNumber;
    if (button >= 2 && button < (NSInteger)(sizeof(NSUInteger) * 8))
        self.picker.pressedMouseButtons |= (NSUInteger)1 << button;
}
- (void)otherMouseDragged:(NSEvent *)event {}
- (void)otherMouseUp:(NSEvent *)event {
    NSInteger button = event.buttonNumber;
    if (button >= 2 && button < (NSInteger)(sizeof(NSUInteger) * 8))
        self.picker.pressedMouseButtons &= ~((NSUInteger)1 << button);
    [self completeMouseGesture];
}
// Consume wheel, gesture and pressure events here instead of forwarding them.
- (void)scrollWheel:(NSEvent *)event {}
- (void)magnifyWithEvent:(NSEvent *)event {}
- (void)smartMagnifyWithEvent:(NSEvent *)event {}
- (void)rotateWithEvent:(NSEvent *)event {}
- (void)swipeWithEvent:(NSEvent *)event {}
- (void)beginGestureWithEvent:(NSEvent *)event {}
- (void)endGestureWithEvent:(NSEvent *)event {}
- (void)pressureChangeWithEvent:(NSEvent *)event {}
- (void)keyDown:(NSEvent *)event {
    if (self.picker.pressedMouseButtons) {
        if (event.keyCode == 53) self.picker.cancelOnMouseRelease = YES;
        return;
    }
    [self.picker keyDown:event];
}
- (BOOL)reduceSelectionMotion { return NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion; }
- (void)layout {
    [super layout];
    if (!CGRectEqualToRect(_surfaceBounds, NSRectToCGRect(self.bounds))) [self updateSelectionAnimated:NO];
}
- (void)stopSelectionAnimation {
    [_selectionClock invalidate]; [_selectionClock release]; _selectionClock = nil;
}
- (void)viewWillMoveToWindow:(NSWindow *)newWindow {
    if (!newWindow) { [self stopSelectionAnimation]; [self handoffAdjustmentCursor]; }
    [super viewWillMoveToWindow:newWindow];
}
- (void)dealloc { [self stopSelectionAnimation]; [_adjustmentCursor release]; [_pointerTrackingArea release]; [_drawnLayout release]; [super dealloc]; }
- (CGPoint)measurementPointInView:(CGPoint)point {
    NSRect window = self.window.frame;
    return CGPointMake(point.x - NSMinX(window), self.picker.desktopTop - point.y - NSMinY(window));
}
- (CGRect)measurementRectInView:(CGRect)rect {
    return (CGRect){[self measurementPointInView:CGPointMake(CGRectGetMinX(rect), CGRectGetMaxY(rect))], rect.size};
}
- (void)copyAdjustment:(id)sender { [self.picker completeAdjustment:YES]; }
- (void)confirmAdjustment:(id)sender { [self.picker completeAdjustment:NO]; }
- (void)positionAdjustmentControls:(CGRect)selected {
    CIIPCapturePicker *picker = self.picker;
    BOOL show = !picker.quickToolbar && picker.adjusting && !picker.draggingSelection && usableCaptureRect(selected) &&
        [picker adjustmentControlsPanel] == self.window;
    if (!show) { _adjustmentControls.hidden = YES; return; }
    if (!_adjustmentControls) {
        _adjustmentControls = [[[NSVisualEffectView alloc] initWithFrame:NSMakeRect(0, 0, 112, 36)] autorelease];
        _adjustmentControls.material = NSVisualEffectMaterialPopover;
        _adjustmentControls.blendingMode = NSVisualEffectBlendingModeBehindWindow;
        _adjustmentControls.state = NSVisualEffectStateActive;
        _adjustmentControls.wantsLayer = YES; _adjustmentControls.layer.cornerRadius = 8;
        _adjustmentControls.layer.masksToBounds = YES;
        NSImage *copyImage = [NSImage imageWithSystemSymbolName:@"doc.on.doc" accessibilityDescription:nil];
        NSButton *copy = [NSButton buttonWithTitle:@"复制" image:copyImage target:self action:@selector(copyAdjustment:)];
        copy.frame = NSMakeRect(5, 5, 65, 26); copy.identifier = @"capture-copy";
        copy.toolTip = @"复制选区并关闭";
        [copy setAccessibilityLabel:copy.toolTip];
        NSImage *check = [NSImage imageWithSystemSymbolName:@"checkmark" accessibilityDescription:nil];
        NSButton *confirm = [NSButton buttonWithImage:check target:self action:@selector(confirmAdjustment:)];
        confirm.frame = NSMakeRect(74, 5, 33, 26); confirm.identifier = @"capture-confirm";
        confirm.toolTip = @"截图 · Return";
        [confirm setAccessibilityLabel:@"确认截图"];
        [_adjustmentControls addSubview:copy]; [_adjustmentControls addSubview:confirm];
        [self addSubview:_adjustmentControls];
    }
    NSRect frame = _adjustmentControls.frame;
    CGFloat x = NSMaxX(selected) - NSWidth(frame);
    CGFloat y = NSMinY(selected) - NSHeight(frame) - 8;
    if (y < 6) y = NSMaxY(selected) + 8;
    if (y + NSHeight(frame) > NSHeight(self.bounds) - 6) y = NSMinY(selected) + 8;
    frame.origin.x = MAX(6, MIN(x, NSWidth(self.bounds) - NSWidth(frame) - 6));
    frame.origin.y = MAX(6, MIN(y, NSHeight(self.bounds) - NSHeight(frame) - 6));
    _adjustmentControls.frame = frame;
    _adjustmentControls.hidden = NO;
}
- (void)drawAdjustmentHandles:(CGRect)rect {
    if (!_adjustmentHandles) {
        _adjustmentHandles = [CAShapeLayer layer];
        [self.layer insertSublayer:_adjustmentHandles above:_outline];
    }
    _adjustmentHandles.frame = self.bounds;
    _adjustmentHandles.fillColor = NSColor.windowBackgroundColor.CGColor;
    _adjustmentHandles.strokeColor = NSColor.keyboardFocusIndicatorColor.CGColor;
    _adjustmentHandles.lineWidth = 1;
    CGMutablePathRef path = CGPathCreateMutable();
    CGFloat xs[] = {CGRectGetMinX(rect), CGRectGetMidX(rect), CGRectGetMaxX(rect)};
    CGFloat ys[] = {CGRectGetMinY(rect), CGRectGetMidY(rect), CGRectGetMaxY(rect)};
    for (NSUInteger x = 0; x < 3; x++) for (NSUInteger y = 0; y < 3; y++) {
        if (x == 1 && y == 1) continue;
        CGPathAddRoundedRect(path, NULL, CGRectMake(xs[x] - 3, ys[y] - 3, 6, 6), 1, 1);
    }
    _adjustmentHandles.path = path; CGPathRelease(path);
}
- (void)drawMeasurementLayout:(CGRect)bounds scale:(CGFloat)scale pointerHere:(BOOL)pointerHere {
    NSArray *children = self.picker.measurementLayoutChildren;
    if (_drawnLayout == children && CGRectEqualToRect(_drawnLayoutBounds, bounds) &&
        _drawnLayoutOnPointerDisplay == pointerHere && _drawnLayoutScale == scale) return;
    [_drawnLayout release]; _drawnLayout = [children retain];
    _drawnLayoutBounds = bounds; _drawnLayoutOnPointerDisplay = pointerHere; _drawnLayoutScale = scale;
    _layoutOverlay.frame = _layoutBoxes.frame = _layoutLines.frame = _layoutBadges.frame = bounds;
    NSColor *accent = NSColor.keyboardFocusIndicatorColor;
    BOOL contrast = NSWorkspace.sharedWorkspace.accessibilityDisplayShouldIncreaseContrast;
    _layoutBoxes.strokeColor = [accent colorWithAlphaComponent:contrast ? 1 : .8].CGColor;
    _layoutBoxes.fillColor = [accent colorWithAlphaComponent:.15].CGColor;
    _layoutBoxes.lineWidth = contrast ? 2 : 1;
    _layoutLines.strokeColor = accent.CGColor;
    _layoutLines.lineWidth = contrast ? 2 : 1;
    _layoutBadges.sublayers = nil;
    NSMutableArray<CALayer *> *occupied = [NSMutableArray array];
    if (!_measurementStatus.hidden) [occupied addObject:_measurementStatus];
    if (!_dimensionPlate.hidden) [occupied addObject:_dimensionPlate];
    CGMutablePathRef boxes = CGPathCreateMutable(), lines = CGPathCreateMutable();
    CGRect frames[captureLayoutChildLimit];
    NSUInteger count = MIN(children.count, captureLayoutChildLimit);
    for (NSUInteger i = 0; i < count; i++) {
        frames[i] = NSRectToCGRect([children[i] rectValue]);
        CGPathAddRect(boxes, NULL, [self measurementRectInView:frames[i]]);
    }
    CIIPMeasurementGuide guides[24];
    CGRect container = NSRectToCGRect([self.picker.measurementLayoutTarget[@"frame"] rectValue]);
    NSUInteger guideCount = captureLayoutGuides(container, frames, count, guides, sizeof(guides) / sizeof(*guides));
    for (NSUInteger i = 0; i < guideCount + count; i++) {
        BOOL gap = i < guideCount;
        BOOL horizontal = NO;
        CGPoint center;
        NSString *text;
        if (gap) {
            CGPoint start = [self measurementPointInView:guides[i].start], end = [self measurementPointInView:guides[i].end];
            horizontal = start.y == end.y;
            appendMeasurementGuide(lines, start, end);
            center = CGPointMake((start.x + end.x) / 2, (start.y + end.y) / 2);
            text = [NSString stringWithFormat:@"%@ pt", measurementNumber(hypot(end.x - start.x, end.y - start.y))];
        } else {
            CGRect child = frames[i - guideCount], local = [self measurementRectInView:child];
            center = CGPointMake(CGRectGetMidX(local), CGRectGetMidY(local));
            text = measurementDimensions(child);
        }
        if (!CGRectContainsPoint(bounds, center)) continue;
        CALayer *plate = measurementBadge(_layoutBadges);
        positionMeasurementBadge(plate, text, center, bounds, scale, YES);
        CGFloat dx = gap && !horizontal ? CGRectGetWidth(plate.bounds) / 2 + 4 : 0;
        CGFloat dy = gap ? (horizontal ? CGRectGetHeight(plate.bounds) / 2 + 4 : 0) : CGRectGetHeight(plate.bounds);
        CGPoint candidates[] = {CGPointMake(center.x + dx, center.y + dy), CGPointMake(center.x - dx, center.y - dy), center};
        for (NSUInteger attempt = 0; attempt < 3; attempt++) {
            NSUInteger index = gap ? attempt : (attempt + 2) % 3;
            plate.position = measurementBadgeCenter(candidates[index], plate.bounds.size, bounds);
            CGRect frame = CGRectInset(plate.frame, -2, -2);
            BOOL overlap = NO;
            for (CALayer *other in occupied) {
                if (CGRectIntersectsRect(frame, other.frame)) { overlap = YES; break; }
            }
            plate.hidden = overlap;
            if (!overlap) { [occupied addObject:plate]; break; }
        }
    }
    _layoutBoxes.path = boxes; CGPathRelease(boxes);
    _layoutLines.path = lines; CGPathRelease(lines);
}
- (void)drawMeasurement {
    CIIPCapturePicker *picker = self.picker;
    if (!_measurement) {
        _measurement = [CALayer layer]; _measurement.masksToBounds = YES;
        _measurementReference = [CAShapeLayer layer]; _measurementReference.fillColor = NSColor.clearColor.CGColor;
        _measurementReference.lineDashPattern = @[@5, @3];
        _measurementLines = [CAShapeLayer layer]; _measurementLines.fillColor = NSColor.clearColor.CGColor;
        [_measurement addSublayer:_measurementReference]; [_measurement addSublayer:_measurementLines];
        for (NSUInteger i = 0; i < 4; i++) _measurementLabels[i] = measurementBadge(_measurement);
        _measurementStatus = measurementBadge(_measurement);
        _layoutOverlay = [CALayer layer];
        _layoutBoxes = [CAShapeLayer layer]; [_layoutOverlay addSublayer:_layoutBoxes];
        _layoutLines = [CAShapeLayer layer]; _layoutLines.fillColor = NSColor.clearColor.CGColor; [_layoutOverlay addSublayer:_layoutLines];
        _layoutBadges = [CALayer layer]; [_layoutOverlay addSublayer:_layoutBadges];
        [_measurement insertSublayer:_layoutOverlay below:_measurementStatus];
        [self.layer insertSublayer:_measurement below:_dimensionPlate];
    }
    CGRect bounds = NSRectToCGRect(self.bounds);
    CGFloat scale = self.window.backingScaleFactor ?: 1;
    _measurement.frame = _measurementReference.frame = _measurementLines.frame = bounds;
    CGColorRef accent = NSColor.keyboardFocusIndicatorColor.CGColor;
    _measurementReference.strokeColor = _measurementLines.strokeColor = accent;
    _measurementReference.lineWidth = _measurementLines.lineWidth = NSWorkspace.sharedWorkspace.accessibilityDisplayShouldIncreaseContrast ? 3 : 2;

    CGRect reference = picker.measurementReference.count ? NSRectToCGRect([picker.measurementReference[0][@"frame"] rectValue]) : CGRectNull;
    CGMutablePathRef referencePath = CGPathCreateMutable();
    if (usableCaptureRect(reference)) {
        CGPathAddRect(referencePath, NULL, [self measurementRectInView:reference]);
    }
    _measurementReference.path = referencePath; CGPathRelease(referencePath);

    BOOL pointerHere = CGRectContainsPoint(bounds, [self measurementPointInView:picker.point]);
    _measurementStatus.hidden = !pointerHere;
    if (pointerHere) {
        NSString *action = picker.measurementReference.count ? @"点击更换参照" : @"点击锁定参照";
        if (!usableCaptureRect([picker measurementFrame])) action = picker.pending ? @"正在识别元素" : @"此处没有可识别元素";
        NSString *hint = [action stringByAppendingString:@"  ·  ↑ 查看外层布局  ·  ↓ 返回内层  ·  Esc 退出"];
        positionMeasurementBadge(_measurementStatus, hint, CGPointMake(CGRectGetMidX(bounds), CGRectGetMaxY(bounds) - 42), bounds, scale, NO);
    }

    CIIPMeasurementGuide guides[4];
    NSUInteger count = _selectionClock ? 0 : [picker measurementGuides:guides];
    _layoutOverlay.hidden = _selectionClock || count || !picker.measurementLayoutChildren.count;
    if (!_layoutOverlay.hidden) [self drawMeasurementLayout:bounds scale:scale pointerHere:pointerHere];
    CGMutablePathRef path = CGPathCreateMutable();
    for (NSUInteger i = 0; i < 4; i++) {
        _measurementLabels[i].hidden = YES;
        if (i >= count) continue;
        CGPoint start = [self measurementPointInView:guides[i].start], end = [self measurementPointInView:guides[i].end];
        BOOL horizontal = start.y == end.y;
        appendMeasurementGuide(path, start, end);
        CGPoint center = CGPointMake((start.x + end.x) / 2, (start.y + end.y) / 2);
        if (!CGRectContainsPoint(bounds, center)) {
            if (!pointerHere) continue;
            NSPoint screenPoint = NSMakePoint(center.x + NSMinX(self.window.frame), center.y + NSMinY(self.window.frame));
            BOOL visibleOnOtherDisplay = NO;
            for (NSPanel *panel in picker.panels) {
                if (panel != self.window && NSPointInRect(screenPoint, panel.frame)) { visibleOnOtherDisplay = YES; break; }
            }
            if (visibleOnOtherDisplay) continue;
        }
        NSString *text = [NSString stringWithFormat:@"%@ pt", measurementNumber(hypot(end.x - start.x, end.y - start.y))];
        CALayer *plate = _measurementLabels[i];
        positionMeasurementBadge(plate, text, center, bounds, scale, NO);
        CGFloat side = CGRectGetWidth(plate.bounds) / 2 + 6, rise = CGRectGetHeight(plate.bounds) / 2 + 6;
        CGPoint positions[] = {CGPointMake(center.x, center.y + rise), CGPointMake(center.x, center.y - rise),
            CGPointMake(center.x + side, center.y), CGPointMake(center.x - side, center.y)};
        CGPoint best = plate.position;
        NSUInteger fewestOverlaps = NSUIntegerMax;
        for (NSUInteger attempt = 0; attempt < 4; attempt++) {
            NSUInteger index = horizontal ? attempt : (attempt + 2) % 4;
            plate.position = measurementBadgeCenter(positions[index], plate.bounds.size, bounds);
            CGRect frame = CGRectInset(plate.frame, -2, -2);
            NSUInteger overlaps = (!_dimensionPlate.hidden && CGRectIntersectsRect(frame, _dimensionPlate.frame)) +
                (!_measurementStatus.hidden && CGRectIntersectsRect(frame, _measurementStatus.frame));
            for (NSUInteger j = 0; j < i; j++)
                overlaps += !_measurementLabels[j].hidden && CGRectIntersectsRect(frame, _measurementLabels[j].frame);
            if (overlaps < fewestOverlaps) { best = plate.position; fewestOverlaps = overlaps; }
            if (!overlaps) break;
        }
        plate.position = best;
    }
    _measurementLines.path = path; CGPathRelease(path);
}
- (void)drawSelectionRect:(CGRect)selected updateDecorations:(BOOL)updateDecorations {
    CIIPCapturePicker *picker = self.picker;
    BOOL valid = usableCaptureRect(selected);
    [CATransaction begin]; [CATransaction setDisableActions:YES];
    CGMutablePathRef shade = CGPathCreateMutable(); CGPathAddRect(shade, NULL, NSRectToCGRect(self.bounds));
    CGMutablePathRef border = CGPathCreateMutable();
    if (valid) {
        CGPathAddRect(shade, NULL, selected);
        CGRect outline = selected;
        if (picker.adjusting) outline = [self measurementRectInView:picker.rect];
        else if (picker.measurementMode && !_selectionClock) outline = [self measurementRectInView:[picker measurementFrame]];
        CGFloat inset = MIN(1, MIN(outline.size.width, outline.size.height) / 4);
        CGPathAddRect(border, NULL, CGRectInset(outline, inset, inset));
    }
    _shade.path = shade; _outline.path = border;
    _outline.lineDashPattern = picker.adjusting ? @[@5, @3] : nil;
    CGPathRelease(shade); CGPathRelease(border);
    if (picker.adjusting && valid) [self drawAdjustmentHandles:[self measurementRectInView:picker.rect]];
    _adjustmentHandles.hidden = !picker.adjusting || !valid;
    _dimensionPlate.hidden = (!picker.elementMode && !picker.areaMode) || !valid ||
        (picker.measurementMode && !NSPointInRect([self measurementPointInView:picker.point], self.bounds)) ||
        (picker.adjusting && [picker adjustmentControlsPanel] != self.window);
    if (valid) {
        CGFloat margin = CGRectGetWidth(_dimensionPlate.bounds) / 2 + 4;
        CGFloat x = MAX(margin, MIN(CGRectGetMidX(selected), self.bounds.size.width - margin));
        CGFloat y = CGRectGetMinY(selected) - 18;
        BOOL putAbove = NO;
        if (picker.adjusting) {
            putAbove = CGRectGetMaxY(selected) + 32 <= self.bounds.size.height;
        } else if (picker.measurementMode && picker.measurementReference.count) {
            CGRect reference = NSRectToCGRect([self.picker.measurementReference[0][@"frame"] rectValue]);
            putAbove = CGRectGetMaxY([self.picker measurementFrame]) <= CGRectGetMinY(reference) && CGRectGetMaxY(selected) + 36 <= self.bounds.size.height;
        }
        if (putAbove || y < 18) y = MIN(self.bounds.size.height - 18, CGRectGetMaxY(selected) + 18);
        _dimensionPlate.position = CGPointMake(x, y);
    }
    if (picker.measurementMode && (updateDecorations || !_selectionClock)) [self drawMeasurement];
    [CATransaction commit];
    if (picker.adjusting) [self positionAdjustmentControls:selected];
}
- (void)selectionTick:(id)sender {
    if (!self.window || self.picker.finished) { [self stopSelectionAnimation]; return; }
    CFTimeInterval now = CACurrentMediaTime();
    NSTimeInterval elapsed = MIN(MAX(0, now - _selectionTickTime), 1.0 / 30);
    _selectionTickTime = now;
    CGFloat amount = self.picker.selectionDuration > 0 ? -expm1(-3 * elapsed / self.picker.selectionDuration) : 1;
    if ([self reduceSelectionMotion]) amount = 1;
    CGRect from = _displayedSelection, to = _selectionRect;
    _displayedSelection = CGRectMake(from.origin.x + (to.origin.x - from.origin.x) * amount,
        from.origin.y + (to.origin.y - from.origin.y) * amount,
        from.size.width + (to.size.width - from.size.width) * amount,
        from.size.height + (to.size.height - from.size.height) * amount);
    if (closeCaptureRects(_displayedSelection, to, .25)) {
        _displayedSelection = to; [self stopSelectionAnimation];
    }
    [self drawSelectionRect:_displayedSelection updateDecorations:NO];
}
- (void)startSelectionAnimation {
    if (_selectionClock) return;
    _selectionTickTime = CACurrentMediaTime();
    if (@available(macOS 14.0, *)) {
        CADisplayLink *link = [self displayLinkWithTarget:self selector:@selector(selectionTick:)];
        _selectionClock = [link retain];
        [link addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
    } else {
        NSTimer *timer = [NSTimer timerWithTimeInterval:1.0 / 60 target:self selector:@selector(selectionTick:) userInfo:nil repeats:YES];
        _selectionClock = [timer retain];
        [NSRunLoop.mainRunLoop addTimer:timer forMode:NSRunLoopCommonModes];
    }
}
- (void)updateSelectionAnimated:(BOOL)animated {
    CIIPCapturePicker *picker = self.picker;
    if (picker.elementMode && picker.pending && !usableCaptureRect(picker.rect) && _configured) return;
    CGRect selected = CGRectNull;
    CGRect rect = picker.measurementMode ? [picker measurementFrame] : picker.rect;
    if (usableCaptureRect(rect)) {
        selected = CGRectIntersection(NSRectToCGRect(self.bounds), CGRectMake(rect.origin.x - self.window.frame.origin.x,
            picker.desktopTop - CGRectGetMaxY(rect) - self.window.frame.origin.y, rect.size.width, rect.size.height));
    }
    BOOL follow = animated && picker.elementMode && !picker.adjusting && usableCaptureRect(selected) && usableCaptureRect(_displayedSelection) &&
        picker.selectionDuration > 0 && ![self reduceSelectionMotion];
    // AX providers can move a stationary frame by fractions of a point. Keep the visual target stable;
    // the picker's semantic rectangle and its pixel dimensions continue to use the exact current bounds.
    if (follow && closeCaptureRects(selected, _selectionRect, .75)) selected = _selectionRect;
    [CATransaction begin]; [CATransaction setDisableActions:YES];
    _surfaceBounds = NSRectToCGRect(self.bounds);
    _shade.frame = self.bounds; _outline.frame = self.bounds;
    _outline.strokeColor = NSColor.keyboardFocusIndicatorColor.CGColor;
    _outline.lineWidth = NSWorkspace.sharedWorkspace.accessibilityDisplayShouldIncreaseContrast ? 3 : 2;
    _dimensionPlate.backgroundColor = NSColor.windowBackgroundColor.CGColor;
    _dimensions.contentsScale = self.window.backingScaleFactor ?: 1;
    BOOL spansDisplays = picker.adjusting && !CGRectContainsRect(capturePanelRect((NSPanel *)self.window, picker.desktopTop), rect);
    NSString *dimensions = (picker.measurementMode || spansDisplays) && usableCaptureRect(rect) ? measurementDimensions(rect) :
        captureSelectionDimensions(rect, self.window.backingScaleFactor ?: 1);
    NSAttributedString *dimensionText = [[[NSAttributedString alloc] initWithString:dimensions
        attributes:@{NSFontAttributeName:[NSFont monospacedDigitSystemFontOfSize:12 weight:NSFontWeightMedium], NSForegroundColorAttributeName:NSColor.labelColor}] autorelease];
    _dimensions.string = dimensionText;
    if (picker.measurementMode) {
        CGFloat width = ceil(dimensionText.size.width) + 14;
        _dimensionPlate.bounds = CGRectMake(0, 0, width, 26);
        _dimensions.frame = CGRectMake(0, 4, width, 18);
    }
    [CATransaction commit];
    _selectionRect = selected; _configured = YES;
    if (!follow) {
        [self stopSelectionAnimation]; _displayedSelection = selected;
    } else if (!CGRectEqualToRect(_displayedSelection, selected)) {
        [self startSelectionAnimation];
    }
    [self drawSelectionRect:_displayedSelection updateDecorations:YES];
}
@end

@implementation CIIPCapturePicker
- (instancetype)init {
    if ((self = [super init])) { _rect = CGRectNull; _point = CGPointMake(INFINITY, INFINITY); _panels = [[NSMutableArray alloc] init]; _applications = [[NSMutableDictionary alloc] init]; }
    return self;
}
- (void)dealloc {
    [_targetWindow release]; [_elements release]; [_measurementReference release]; [_measurementLayoutTarget release];
    [_measurementLayoutChildren release]; [_applications release]; [_ancestorProposal release]; [_appIcon release]; [_appName release]; [_panels release]; [_timer release]; [_quickToolbar release];
    [_frozenFrames release]; [_frozenDisplayRects release];
    [super dealloc];
}
- (void)redraw { [self redrawAnimated:YES]; }
- (NSPanel *)adjustmentControlsPanel {
    NSPanel *best = nil;
    CGFloat largest = 0;
    for (NSPanel *panel in self.panels) {
        CGRect visible = CGRectIntersection(self.rect, capturePanelRect(panel, self.desktopTop));
        if (!usableCaptureRect(visible)) continue;
        CGFloat area = CGRectGetWidth(visible) * CGRectGetHeight(visible);
        if (area > largest) { largest = area; best = panel; }
    }
    return best;
}
- (void)positionQuickToolbar {
    NSWindow *toolbar = self.quickToolbar;
    if (!toolbar) return;
    NSPanel *panel = self.adjusting && !self.draggingSelection ? [self adjustmentControlsPanel] : nil;
    if (!panel) {
        if (toolbar.isVisible) [toolbar orderOut:nil];
        return;
    }
    NSRect bounds = panel.frame;
    NSRect selected = NSIntersectionRect(bounds, NSMakeRect(CGRectGetMinX(self.rect), self.desktopTop - CGRectGetMaxY(self.rect),
        CGRectGetWidth(self.rect), CGRectGetHeight(self.rect)));
    CGFloat width = MIN(704, NSWidth(bounds) - 12), height = 90;
    CGFloat x = NSMidX(selected) - width / 2;
    CGFloat y = NSMinY(selected) - height - 8;
    if (y < NSMinY(bounds) + 6) y = NSMaxY(selected) + 8;
    if (y + height > NSMaxY(bounds) - 6) y = NSMinY(selected) + 8;
    NSRect frame = NSMakeRect(MAX(NSMinX(bounds) + 6, MIN(x, NSMaxX(bounds) - width - 6)),
        MAX(NSMinY(bounds) + 6, MIN(y, NSMaxY(bounds) - height - 6)), width, height);
    if (!NSEqualRects(frame, toolbar.frame)) [toolbar setFrame:frame display:YES];
    setQuickToolbarMaterial(toolbar, NSMakeRect(4, 3, MAX(0, width - 8), height - 6), NSViewNotSizable);
    NSInteger level = panel.level + 1;
    toolbar.acceptsMouseMovedEvents = YES;
    if (!toolbar.isVisible || toolbar.level != level) {
        toolbar.collectionBehavior = panel.collectionBehavior;
        toolbar.level = level;
        [toolbar orderFrontRegardless];
    }
}
- (void)updateQuickToolbarCursorForWindow:(NSWindow *)window {
    NSWindow *toolbar = self.quickToolbar;
    if (window != toolbar || !toolbar.isVisible || toolbar.isKeyWindow) return;
    // The event's window is authoritative. The live pointer can be ahead of the event.
    // WebKit can leave the overlay cursor in place while this window is non-key.
    NSCursor *cursor = NSCursor.currentCursor;
    if (cursor != NSCursor.arrowCursor && cursor != NSCursor.pointingHandCursor) [NSCursor.arrowCursor set];
}
- (void)enterAdjustment {
    if (!usableCaptureRect(self.rect) || ![self adjustmentControlsPanel]) return;
    self.adjusting = YES; self.pending = NO; self.draggingSelection = NO;
    self.elements = nil; self.elementIndex = 0; self.targetWindow = nil;
    [self clearAncestorProposal];
    [self.timer invalidate]; self.timer = nil;
    for (NSPanel *panel in self.panels) [panel invalidateCursorRectsForView:panel.contentView];
    [self redrawAnimated:NO];
}
- (void)beginSelectionAtPoint:(CGPoint)point {
    if ((!self.elementMode && !self.areaMode) || self.finished) return;
    self.trackingSelection = YES; self.draggingSelection = NO;
    self.dragStart = point; self.dragPoint = point;
    if (self.adjusting) {
        self.adjustmentStartRect = self.rect;
        self.adjustmentEdges = captureAdjustmentEdge(self.rect, point, 7);
    }
}
- (void)updateSelectionAtPoint:(CGPoint)point {
    if (!self.trackingSelection || self.finished || !isfinite(point.x) || !isfinite(point.y)) return;
    self.dragPoint = point;
    if (self.measurementMode) return;
    BOOL transform = self.adjusting && (self.adjustmentEdges || CGRectContainsPoint(self.adjustmentStartRect, self.dragStart));
    if (!self.draggingSelection && hypot(point.x - self.dragStart.x, point.y - self.dragStart.y) < (transform ? 1 : 4)) return;
    if (!self.draggingSelection) {
        self.draggingSelection = YES; self.pending = NO; self.elements = nil; self.elementIndex = 0;
        self.targetWindow = nil; [self clearAncestorProposal];
    }
    CGRect bounds = CGRectNull;
    for (NSPanel *panel in self.panels) {
        CGRect frame = capturePanelRect(panel, self.desktopTop);
        if (usableCaptureRect(frame)) bounds = CGRectUnion(bounds, frame);
    }
    CGRect rect = CGRectMake(MIN(self.dragStart.x, point.x), MIN(self.dragStart.y, point.y),
        fabs(point.x - self.dragStart.x), fabs(point.y - self.dragStart.y));
    if (transform) rect = captureAdjustedRect(self.adjustmentStartRect, self.dragStart, point, bounds, self.adjustmentEdges);
    else rect = CGRectIntersection(rect, bounds);
    self.rect = rect; self.point = point;
    [self redrawAnimated:NO];
}
- (void)completeSelectionGesture {
    self.trackingSelection = NO;
    if (self.adjusting) {
        if (self.draggingSelection && ![self adjustmentControlsPanel]) self.rect = self.adjustmentStartRect;
        self.draggingSelection = NO; [self redrawAnimated:NO];
        return;
    }
    if (self.draggingSelection) {
        [self enterAdjustment];
        if (!self.adjusting) {
            self.draggingSelection = NO; self.rect = CGRectNull;
            if (self.areaMode) [self redrawAnimated:NO];
            else { self.point = CGPointMake(INFINITY, INFINITY); [self sample]; }
        }
        return;
    }
    if (self.areaMode) return;
    if (!self.elementMode) { [self confirm]; return; }
    // Sub-threshold hand movement is still a click on the highlighted element.
    if (!self.pending && usableCaptureRect(self.rect) && CGRectContainsPoint(self.rect, self.dragPoint)) self.point = self.dragPoint;
    else if (self.pending && !self.querying) self.point = CGPointMake(INFINITY, INFINITY);
    [self confirm];
}
- (void)completeAdjustment:(BOOL)copyOnly {
    if (!self.adjusting || self.trackingSelection || ![self adjustmentControlsPanel]) return;
    self.copyOnly = copyOnly;
    [self finish:YES];
}
- (CGRect)measurementFrame {
    if (!self.elements.count) return CGRectNull;
    NSValue *frame = self.elements[self.elementIndex][@"frame"];
    return frame ? NSRectToCGRect(frame.rectValue) : CGRectNull;
}
- (NSUInteger)measurementGuides:(CIIPMeasurementGuide *)guides {
    CGRect frame = [self measurementFrame];
    if (!self.measurementReference.count || !usableCaptureRect(frame)) return 0;
    NSDictionary *reference = self.measurementReference[0], *current = self.elements[self.elementIndex];
    if ([reference[@"element"] isEqual:current[@"element"]]) return 0;
    BOOL nested = NO;
    for (NSUInteger i = self.elementIndex + 1; i < self.elements.count && !nested; i++)
        nested = [self.elements[i][@"element"] isEqual:reference[@"element"]];
    for (NSUInteger i = 1; i < self.measurementReference.count && !nested; i++)
        nested = [self.measurementReference[i][@"element"] isEqual:current[@"element"]];
    return captureMeasurementGuides(NSRectToCGRect([reference[@"frame"] rectValue]), frame, nested, guides);
}
- (void)refreshMeasurementLayout {
    if (self.pending) return;
    CGRect frame = [self measurementFrame], clip;
    if (!usableCaptureRect(frame) || !self.targetWindow ||
        !CGRectMakeWithDictionaryRepresentation((CFDictionaryRef)self.targetWindow[(id)kCGWindowBounds], &clip)) {
        self.measurementLayoutTarget = nil; self.measurementLayoutChildren = nil;
        return;
    }
    NSDictionary *current = self.elements[self.elementIndex], *previous = self.measurementLayoutTarget;
    if (!previous || ![current[@"element"] isEqual:previous[@"element"]] ||
        !closeCaptureRects(frame, NSRectToCGRect([previous[@"frame"] rectValue]), .25) ||
        !closeCaptureRects(self.rect, NSRectToCGRect([previous[@"rect"] rectValue]), .25)) {
        self.measurementLayoutTarget = current;
        self.measurementLayoutChildren = nil;
    }
    if (self.measurementLayoutChildren || self.measurementLayoutQuerying) return;
    NSDictionary *target = self.measurementLayoutTarget, *window = self.targetWindow;
    self.measurementLayoutQuerying = YES;
    // Layout is supplementary. A slow AX children provider must never delay the pointer hit test.
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        @autoreleasepool {
            NSArray *children = captureLayoutChildren((AXUIElementRef)target[@"element"], frame, clip);
            dispatch_async(dispatch_get_main_queue(), ^{
                self.measurementLayoutQuerying = NO;
                if (self.finished) return;
                if (target == self.measurementLayoutTarget && sameCaptureWindow(window, self.targetWindow))
                    self.measurementLayoutChildren = children;
                [self redraw];
            });
        }
    });
}
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
    if (!usableCaptureRect(oldRect) || !usableCaptureRect(rect) || closeCaptureRects(rect, oldRect, .75) ||
        !CGRectContainsRect(rect, oldRect) || !CGRectContainsRect(rect, self.rect) || closeCaptureRects(rect, self.rect, .75)) {
        [self clearAncestorProposal]; return NO;
    }
    BOOL sameProposal = self.ancestorProposal.count && closeCaptureRects(NSRectToCGRect([self.ancestorProposal[0][@"rect"] rectValue]), rect, .75);
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
                // Read the physical pointer again, including movement between tracking events.
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
    if (self.areaMode) label = @"拖动框选截图区域";
    if (self.adjusting) label = @"调整截图选区，拖动移动，拖动边角调整大小，框外拖动重新框选。按回车截图，Esc 取消。";
    if (self.measurementMode) {
        [self refreshMeasurementLayout];
        CGRect frame = [self measurementFrame];
        if (usableCaptureRect(frame)) {
            label = [label stringByAppendingFormat:@"，宽 %@ pt，高 %@ pt", measurementNumber(frame.size.width), measurementNumber(frame.size.height)];
            if (self.measurementLayoutChildren.count)
                label = [label stringByAppendingFormat:@"，%lu 个可测量子元素", (unsigned long)self.measurementLayoutChildren.count];
            CIIPMeasurementGuide guides[4];
            NSUInteger count = [self measurementGuides:guides];
            for (NSUInteger i = 0; i < count; i++) {
                CGPoint start = guides[i].start, end = guides[i].end;
                label = [label stringByAppendingFormat:@"，%@间距 %@ pt", start.y == end.y ? @"水平" : @"垂直",
                    measurementNumber(hypot(end.x - start.x, end.y - start.y))];
            }
        } else label = self.pending ? @"正在识别元素" : @"此处没有可识别元素";
    }
    for (NSPanel *panel in self.panels) {
        [panel.contentView setAccessibilityLabel:label];
        [(CIIPCaptureSelectionView *)panel.contentView updateSelectionAnimated:animated];
    }
    [self positionQuickToolbar];
}
- (void)sample {
    if (self.finished || self.trackingSelection || self.areaMode || self.adjusting) return;
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
    self.pending = YES;
    if (self.querying) return;
    [self redraw];
    self.querying = YES;
    NSArray *previous = sameWindow ? self.elements : nil;
    // Only one background query runs at a time; the session cache stays on that worker path.
    NSMutableDictionary *applications = self.applications;
    CGRect clip = windowRect;
    for (NSScreen *screen in NSScreen.screens) if (NSPointInRect(mouse, screen.frame)) {
        clip = CGRectIntersection(clip, CGRectMake(screen.frame.origin.x, self.desktopTop - NSMaxY(screen.frame), screen.frame.size.width, screen.frame.size.height));
        break;
    }
    // AX IPC can block on an unresponsive app. Keep it off AppKit's event thread.
    NSTimeInterval requestedAt = NSProcessInfo.processInfo.systemUptime;
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        @autoreleasepool {
            NSArray *elements = captureElementsKeepingLeaf(captureElementsAtPoint(pid, point, clip, applications), previous, point, clip);
            dispatch_async(dispatch_get_main_queue(), ^{
                self.querying = NO;
                if (self.finished || self.draggingSelection || self.adjusting) return;
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
                if (self.elements.count && elements.count && closeCaptureRects(NSRectToCGRect([self.elements[0][@"rect"] rectValue]), NSRectToCGRect([elements[0][@"rect"] rectValue]), .75) &&
                    CFEqual((CFTypeRef)self.elements[0][@"element"], (CFTypeRef)elements[0][@"element"])) {
                    for (NSUInteger i = 0; i < elements.count; i++) {
                        if (closeCaptureRects(NSRectToCGRect([elements[i][@"rect"] rectValue]), self.rect, .75)) { index = i; break; }
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
    if (self.finished) return;
    if (self.adjusting) { [self completeAdjustment:NO]; return; }
    if (self.areaMode) return;
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
    if (self.measurementMode) {
        if (!usableCaptureRect([self measurementFrame])) { NSBeep(); return; }
        self.measurementReference = [self.elements subarrayWithRange:NSMakeRange(self.elementIndex, self.elements.count - self.elementIndex)];
        [self redrawAnimated:NO];
    } else if (self.elementMode) [self enterAdjustment];
    else [self finish:YES];
}
- (void)keyDown:(NSEvent *)event {
    if (event.keyCode == 53) { [self finish:NO]; return; }
    if (self.adjusting && (event.modifierFlags & NSEventModifierFlagCommand) &&
        [event.charactersIgnoringModifiers.lowercaseString isEqualToString:@"c"]) {
        if (!event.isARepeat) [self completeAdjustment:YES];
        return;
    }
    if (event.keyCode == 36 || event.keyCode == 76) {
        if (!event.isARepeat) [self confirm];
        return;
    }
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
    [self finish:accepted error:nil];
}
- (void)finish:(BOOL)accepted error:(NSString *)failure {
    if (self.finished) return;
    self.finished = YES; [self.timer invalidate]; self.timer = nil;
    [self clearAncestorProposal];
    [[NSNotificationCenter defaultCenter] removeObserver:self];
    if (self.quickToolbarMouseMonitor) {
        [NSEvent removeMonitor:self.quickToolbarMouseMonitor]; self.quickToolbarMouseMonitor = nil;
    }
    [self.quickToolbar orderOut:nil];
    self.quickToolbar.level = self.quickToolbarLevel;
    self.quickToolbar.collectionBehavior = self.quickToolbarBehavior;
    self.quickToolbar.acceptsMouseMovedEvents = self.quickToolbarAcceptedMouseMoves;
    for (NSPanel *panel in self.panels) {
        [(CIIPCaptureSelectionView *)panel.contentView stopSelectionAnimation];
        [panel close];
    }
    [self.panels removeAllObjects];
    accepted = accepted && !self.measurementMode;
    CGRect rect = accepted ? self.rect : CGRectZero;
    activeCapturePicker = nil;
    if (failure) {
        ciip_go_capture_area_image(self.token, 0, 0, 0, 0, 0, NULL, 0, failure.UTF8String);
    } else if (accepted && self.frozenFrames) {
        NSDictionary *frames = self.frozenFrames, *displayRects = self.frozenDisplayRects;
        uintptr_t token = self.token;
        BOOL copyOnly = self.copyOnly;
        CGRect crop = CGRectIntegral(rect);
        dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
            @autoreleasepool {
                NSString *error = nil;
                NSData *png = ciip_crop_desktop_frames(frames, displayRects, crop, &error);
                ciip_go_capture_area_image(token, crop.origin.x, crop.origin.y, crop.size.width, crop.size.height,
                    copyOnly, png.bytes, png.length, error.UTF8String);
            }
        });
        self.frozenFrames = nil; self.frozenDisplayRects = nil;
    } else {
        ciip_go_capture_selection(self.token, accepted ? [self.targetWindow[(id)kCGWindowNumber] unsignedIntValue] : 0,
            rect.origin.x, rect.origin.y, rect.size.width, rect.size.height, accepted && self.copyOnly);
    }
    [self autorelease];
}
- (void)showSelectionPanels:(NSArray<NSScreen *> *)screens {
    for (NSScreen *screen in screens) {
        NSPanel *panel = [[[CIIPCaptureSelectionPanel alloc] initWithContentRect:screen.frame styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel backing:NSBackingStoreBuffered defer:NO] autorelease];
        NSNumber *number = screen.deviceDescription[@"NSScreenNumber"];
        CGImageRef frozenImage = number ? (CGImageRef)self.frozenFrames[number] : NULL;
        panel.releasedWhenClosed = NO; panel.opaque = frozenImage != NULL;
        panel.backgroundColor = frozenImage ? NSColor.blackColor : NSColor.clearColor;
        panel.hasShadow = NO; panel.hidesOnDeactivate = NO; panel.level = NSScreenSaverWindowLevel;
        panel.acceptsMouseMovedEvents = YES; panel.ignoresMouseEvents = NO;
        panel.movable = NO; panel.movableByWindowBackground = NO;
        panel.title = self.measurementMode ? @"元素测量" : self.elementMode ? @"元素截图" : self.areaMode ? @"区域截图" : @"窗口截图";
        panel.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary;
        CIIPCaptureSelectionView *view = [[[CIIPCaptureSelectionView alloc] initWithFrame:NSMakeRect(0, 0, screen.frame.size.width, screen.frame.size.height)] autorelease];
        view.picker = self; panel.contentView = view;
        if (frozenImage) [view setFrozenImage:frozenImage];
        [view setAccessibilityElement:YES]; [view setAccessibilityRole:NSAccessibilityGroupRole];
        [view setAccessibilityHelp:self.measurementMode ? @"悬停查看元素和子元素布局，方向键上下选择层级，点击或回车锁定对比参照，Esc 退出" :
            self.elementMode ? @"点击或回车选定元素，拖动框选区域，方向键上下选择元素层级，Esc 取消" :
            self.areaMode ? @"拖动框选区域，Esc 取消" : @"点击或回车截图，Esc 取消"];
        [panel makeFirstResponder:view]; [self.panels addObject:panel];
    }
    if (self.areaMode) [self redrawAnimated:NO];
    for (NSPanel *panel in self.panels) {
        [panel orderFrontRegardless];
        if (NSPointInRect(NSEvent.mouseLocation, panel.frame)) [panel makeKeyWindow];
    }
    if (!self.areaMode) {
        [self sample];
        self.timer = [NSTimer scheduledTimerWithTimeInterval:.2 target:self selector:@selector(sample) userInfo:nil repeats:YES];
    }
}
@end

static NSDictionary<NSNumber *, NSValue *> *captureDisplayRects(NSArray<NSScreen *> *screens, CGFloat desktopTop) {
    NSMutableDictionary *rects = [NSMutableDictionary dictionaryWithCapacity:screens.count];
    for (NSScreen *screen in screens) {
        NSNumber *number = screen.deviceDescription[@"NSScreenNumber"];
        NSRect frame = screen.frame;
        if (number)
            rects[number] = [NSValue valueWithRect:NSMakeRect(NSMinX(frame), desktopTop - NSMaxY(frame), NSWidth(frame), NSHeight(frame))];
    }
    return rects;
}

int ciip_element_permission(void) {
    return AXIsProcessTrustedWithOptions((CFDictionaryRef)@{(id)kAXTrustedCheckOptionPrompt:@YES});
}

int ciip_start_capture_selection(uintptr_t token, int mode, double duration, uintptr_t toolbarHandle) {
    NSArray<NSScreen *> *screens = NSScreen.screens;
    if (activeCapturePicker || !screens.count) return 0;
    CIIPCapturePicker *picker = [[CIIPCapturePicker alloc] init];
    activeCapturePicker = picker; picker.token = token;
    picker.elementMode = mode == 1 || mode == 2; picker.measurementMode = mode == 2; picker.areaMode = mode == 3;
    picker.selectionDuration = duration;
    picker.quickToolbar = (NSWindow *)toolbarHandle;
    picker.quickToolbarLevel = picker.quickToolbar.level;
    picker.quickToolbarBehavior = picker.quickToolbar.collectionBehavior;
    picker.quickToolbarAcceptedMouseMoves = picker.quickToolbar.acceptsMouseMovedEvents;
    if (picker.quickToolbar) {
        [[NSNotificationCenter defaultCenter] addObserver:picker selector:@selector(screenChanged:) name:NSWindowWillCloseNotification object:picker.quickToolbar];
        picker.quickToolbarMouseMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskMouseMoved handler:^NSEvent *(NSEvent *event) {
            [picker updateQuickToolbarCursorForWindow:event.window];
            return event;
        }];
    }
    picker.desktopTop = NSMaxY(screens.firstObject.frame);
    [[NSNotificationCenter defaultCenter] addObserver:picker selector:@selector(screenChanged:) name:NSApplicationDidChangeScreenParametersNotification object:nil];
    if (picker.areaMode) {
        NSDictionary *rects = captureDisplayRects(screens, picker.desktopTop);
        [CATransaction flush];
        ciip_capture_desktop_frames(rects.allKeys, ^(NSDictionary<NSNumber *, id> *frames, NSString *error) {
            if (picker.finished || activeCapturePicker != picker) return;
            NSArray<NSScreen *> *current = NSScreen.screens;
            if (rects.count != screens.count || ![rects isEqualToDictionary:captureDisplayRects(current, NSMaxY(current.firstObject.frame))])
                error = @"显示器已变化，请重新截图";
            if (error || ![[NSSet setWithArray:frames.allKeys ?: @[]] isEqualToSet:[NSSet setWithArray:rects.allKeys]]) {
                [picker finish:NO error:error ?: @"无法冻结屏幕画面"];
                return;
            }
            picker.frozenFrames = frames; picker.frozenDisplayRects = rects;
            [picker showSelectionPanels:current];
        });
    } else [picker showSelectionPanels:screens];
    return 1;
}

void ciip_cancel_capture_selection(uintptr_t token) {
    if (activeCapturePicker.token == token) [activeCapturePicker finish:NO];
}

BOOL ciip_area_selection_accepts_input(void) {
    return activeCapturePicker.areaMode && activeCapturePicker.panels.count > 0;
}

int ciip_submit_capture_toolbar(uintptr_t toolbarHandle, int action) {
    CIIPCapturePicker *picker = activeCapturePicker;
    if (!picker.adjusting || picker.finished || picker.trackingSelection || picker.pressedMouseButtons || !toolbarHandle ||
        picker.quickToolbar != (NSWindow *)toolbarHandle || action < 0 || action > 2 || ![picker adjustmentControlsPanel]) return 0;
    if (action == 2) [picker finish:NO];
    else [picker completeAdjustment:action == 1];
    return 1;
}
