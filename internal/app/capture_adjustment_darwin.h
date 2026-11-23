#pragma once

#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>
#include <math.h>

typedef NS_OPTIONS(NSUInteger, CIIPCaptureEdge) {
    CIIPCaptureEdgeNone = 0,
    CIIPCaptureEdgeLeft = 1 << 0,
    CIIPCaptureEdgeRight = 1 << 1,
    CIIPCaptureEdgeTop = 1 << 2,
    CIIPCaptureEdgeBottom = 1 << 3,
};

static inline CIIPCaptureEdge captureAdjustmentEdge(CGRect rect, CGPoint point, CGFloat tolerance) {
    if (CGRectIsEmpty(rect) || tolerance < 0) return CIIPCaptureEdgeNone;
    CGFloat left = CGRectGetMinX(rect), right = CGRectGetMaxX(rect);
    CGFloat top = CGRectGetMinY(rect), bottom = CGRectGetMaxY(rect);
    if (point.x < left - tolerance || point.x > right + tolerance ||
        point.y < top - tolerance || point.y > bottom + tolerance) return CIIPCaptureEdgeNone;

    // Keep an interior move target even for selections smaller than two hit bands.
    CGFloat xTolerance = point.x >= left && point.x <= right ? MIN(tolerance, CGRectGetWidth(rect) / 3) : tolerance;
    CGFloat yTolerance = point.y >= top && point.y <= bottom ? MIN(tolerance, CGRectGetHeight(rect) / 3) : tolerance;
    CIIPCaptureEdge edges = CIIPCaptureEdgeNone;
    if (point.x <= CGRectGetMidX(rect)) {
        if (fabs(point.x - left) <= xTolerance) edges |= CIIPCaptureEdgeLeft;
    } else if (fabs(point.x - right) <= xTolerance) edges |= CIIPCaptureEdgeRight;
    if (point.y <= CGRectGetMidY(rect)) {
        if (fabs(point.y - top) <= yTolerance) edges |= CIIPCaptureEdgeTop;
    } else if (fabs(point.y - bottom) <= yTolerance) edges |= CIIPCaptureEdgeBottom;
    return edges;
}

static inline CGRect captureAdjustedRect(CGRect initial, CGPoint start, CGPoint current, CGRect bounds, CIIPCaptureEdge edges) {
    initial = CGRectIntersection(initial, bounds);
    if (CGRectIsEmpty(initial)) return CGRectNull;
    CGFloat dx = current.x - start.x, dy = current.y - start.y;
    CGFloat left = CGRectGetMinX(initial), right = CGRectGetMaxX(initial);
    CGFloat top = CGRectGetMinY(initial), bottom = CGRectGetMaxY(initial);
    if (edges == CIIPCaptureEdgeNone) {
        dx = MIN(MAX(dx, CGRectGetMinX(bounds) - left), CGRectGetMaxX(bounds) - right);
        dy = MIN(MAX(dy, CGRectGetMinY(bounds) - top), CGRectGetMaxY(bounds) - bottom);
        return CGRectOffset(initial, dx, dy);
    }

    CGFloat minWidth = MIN(1, CGRectGetWidth(initial)), minHeight = MIN(1, CGRectGetHeight(initial));
    if (edges & CIIPCaptureEdgeLeft) left = MIN(MAX(left + dx, CGRectGetMinX(bounds)), right - minWidth);
    else if (edges & CIIPCaptureEdgeRight) right = MAX(MIN(right + dx, CGRectGetMaxX(bounds)), left + minWidth);
    if (edges & CIIPCaptureEdgeTop) top = MIN(MAX(top + dy, CGRectGetMinY(bounds)), bottom - minHeight);
    else if (edges & CIIPCaptureEdgeBottom) bottom = MAX(MIN(bottom + dy, CGRectGetMaxY(bounds)), top + minHeight);
    return CGRectMake(left, top, right - left, bottom - top);
}
