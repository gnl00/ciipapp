#pragma once

#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>

typedef struct {
    CGPoint start, end;
} CIIPMeasurementGuide;

// Inputs are resolved AX frames in the global top-left coordinate space.
static inline NSUInteger captureMeasurementGuides(CGRect reference, CGRect target, BOOL nested, CIIPMeasurementGuide guides[4]) {
    if (CGRectIsEmpty(reference) || CGRectIsEmpty(target)) return 0;

    NSUInteger count = 0;
    if (nested && (CGRectContainsRect(reference, target) || CGRectContainsRect(target, reference))) {
        BOOL referenceContainsTarget = CGRectContainsRect(reference, target);
        CGRect parent = referenceContainsTarget ? reference : target;
        CGRect child = referenceContainsTarget ? target : reference;
        CGFloat x = CGRectGetMidX(child), y = CGRectGetMidY(child);
        CIIPMeasurementGuide insets[] = {
            {CGPointMake(CGRectGetMinX(parent), y), CGPointMake(CGRectGetMinX(child), y)},
            {CGPointMake(CGRectGetMaxX(parent), y), CGPointMake(CGRectGetMaxX(child), y)},
            {CGPointMake(x, CGRectGetMinY(parent)), CGPointMake(x, CGRectGetMinY(child))},
            {CGPointMake(x, CGRectGetMaxY(parent)), CGPointMake(x, CGRectGetMaxY(child))},
        };
        for (NSUInteger i = 0; i < 4; i++) {
            if (!CGPointEqualToPoint(insets[i].start, insets[i].end)) guides[count++] = insets[i];
        }
        return count;
    }

    CGFloat left = MAX(CGRectGetMinX(reference), CGRectGetMinX(target));
    CGFloat right = MIN(CGRectGetMaxX(reference), CGRectGetMaxX(target));
    CGFloat top = MAX(CGRectGetMinY(reference), CGRectGetMinY(target));
    CGFloat bottom = MIN(CGRectGetMaxY(reference), CGRectGetMaxY(target));
    CGFloat startX = (left + right) / 2, endX = startX;
    CGFloat startY = (top + bottom) / 2, endY = startY;
    if (left > right) {
        BOOL referenceOnLeft = CGRectGetMinX(reference) < CGRectGetMinX(target);
        startX = referenceOnLeft ? right : left;
        endX = referenceOnLeft ? left : right;
    }
    if (top > bottom) {
        BOOL referenceAbove = CGRectGetMinY(reference) < CGRectGetMinY(target);
        startY = referenceAbove ? bottom : top;
        endY = referenceAbove ? top : bottom;
    }
    // When both axes are separated, connect the facing corners with an elbow.
    CGPoint corner = CGPointMake(endX, startY);
    if (left > right) guides[count++] = (CIIPMeasurementGuide){CGPointMake(startX, startY), corner};
    if (top > bottom) guides[count++] = (CIIPMeasurementGuide){corner, CGPointMake(endX, endY)};
    return count;
}

static inline CGRect captureLayoutAxisFrame(CGRect rect, BOOL vertical) {
    return vertical ? CGRectMake(rect.origin.y, rect.origin.x, rect.size.height, rect.size.width) : rect;
}

static inline NSUInteger captureLayoutGuides(CGRect container, const CGRect *children, NSUInteger count,
    CIIPMeasurementGuide *guides, NSUInteger capacity) {
    if (CGRectIsEmpty(container) || !capacity) return 0;

    CGRect left = CGRectNull, right = CGRectNull, top = CGRectNull, bottom = CGRectNull;
    for (NSUInteger i = 0; i < count; i++) {
        CGRect child = children[i];
        if (CGRectIsEmpty(child) || !CGRectContainsRect(container, child)) continue;
        if (CGRectIsNull(left) || CGRectGetMinX(child) < CGRectGetMinX(left)) left = child;
        if (CGRectIsNull(right) || CGRectGetMaxX(child) > CGRectGetMaxX(right)) right = child;
        if (CGRectIsNull(top) || CGRectGetMinY(child) < CGRectGetMinY(top)) top = child;
        if (CGRectIsNull(bottom) || CGRectGetMaxY(child) > CGRectGetMaxY(bottom)) bottom = child;
    }
    if (CGRectIsNull(left)) return 0;

    CIIPMeasurementGuide insets[] = {
        {CGPointMake(CGRectGetMinX(container), CGRectGetMidY(left)), CGPointMake(CGRectGetMinX(left), CGRectGetMidY(left))},
        {CGPointMake(CGRectGetMaxX(container), CGRectGetMidY(right)), CGPointMake(CGRectGetMaxX(right), CGRectGetMidY(right))},
        {CGPointMake(CGRectGetMidX(top), CGRectGetMinY(container)), CGPointMake(CGRectGetMidX(top), CGRectGetMinY(top))},
        {CGPointMake(CGRectGetMidX(bottom), CGRectGetMaxY(container)), CGPointMake(CGRectGetMidX(bottom), CGRectGetMaxY(bottom))},
    };
    NSUInteger written = 0;
    for (NSUInteger i = 0; i < 4 && written < capacity; i++) {
        if (!CGPointEqualToPoint(insets[i].start, insets[i].end)) guides[written++] = insets[i];
    }

    // Look right and below from each child so the same sibling pair is considered once per axis.
    for (NSUInteger i = 0; i < count && written < capacity; i++) {
        if (CGRectIsEmpty(children[i]) || !CGRectContainsRect(container, children[i])) continue;
        for (NSUInteger axis = 0; axis < 2 && written < capacity; axis++) {
            BOOL vertical = axis == 1;
            CGRect child = captureLayoutAxisFrame(children[i], vertical);
            CGFloat start = CGRectGetMaxX(child), end = CGFLOAT_MAX, cross = 0, bestOverlap = 0;
            for (NSUInteger j = 0; j < count; j++) {
                if (CGRectIsEmpty(children[j]) || !CGRectContainsRect(container, children[j])) continue;
                CGRect sibling = captureLayoutAxisFrame(children[j], vertical);
                CGFloat edge = CGRectGetMinX(sibling);
                if (edge < start || edge > end) continue;
                CGFloat lower = MAX(CGRectGetMinY(child), CGRectGetMinY(sibling));
                CGFloat upper = MIN(CGRectGetMaxY(child), CGRectGetMaxY(sibling));
                CGFloat overlap = upper - lower, midpoint = (lower + upper) / 2;
                if (overlap <= 0 || (edge == end && (overlap < bestOverlap || (overlap == bestOverlap && midpoint >= cross)))) continue;
                end = edge; cross = midpoint; bestOverlap = overlap;
            }
            if (!bestOverlap || end == start) continue;

            BOOL blocked = NO;
            for (NSUInteger j = 0; j < count && !blocked; j++) {
                if (CGRectIsEmpty(children[j]) || !CGRectContainsRect(container, children[j])) continue;
                CGRect sibling = captureLayoutAxisFrame(children[j], vertical);
                blocked = CGRectGetMinX(sibling) < end && CGRectGetMaxX(sibling) > start &&
                    CGRectGetMinY(sibling) <= cross && cross <= CGRectGetMaxY(sibling);
            }
            if (blocked) continue;
            CIIPMeasurementGuide guide = vertical ? (CIIPMeasurementGuide){CGPointMake(cross, start), CGPointMake(cross, end)} :
                (CIIPMeasurementGuide){CGPointMake(start, cross), CGPointMake(end, cross)};
            BOOL duplicate = NO;
            for (NSUInteger j = 0; j < written && !duplicate; j++)
                duplicate = CGPointEqualToPoint(guide.start, guides[j].start) && CGPointEqualToPoint(guide.end, guides[j].end);
            if (!duplicate) guides[written++] = guide;
        }
    }
    return written;
}
