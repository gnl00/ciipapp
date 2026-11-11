#pragma once

static const NSUInteger captureLayoutChildLimit = 24;

static void collectCaptureLayoutChildren(AXUIElementRef element, CGRect container, CGRect clip, NSTimeInterval deadline,
    NSUInteger depth, NSUInteger *remaining, CFMutableSetRef visited, NSMutableOrderedSet<NSValue *> *frames) {
    if (!*remaining || depth >= 8 || frames.count >= captureLayoutChildLimit ||
        NSProcessInfo.processInfo.systemUptime >= deadline) return;

    CFArrayRef children = NULL;
    // Request only the remaining visit budget from providers with large tables or lists.
    AXError error = AXUIElementCopyAttributeValues(element, kAXVisibleChildrenAttribute, 0, (CFIndex)*remaining, &children);
    if (error != kAXErrorSuccess && error != kAXErrorCannotComplete && NSProcessInfo.processInfo.systemUptime < deadline) {
        if (children) { CFRelease(children); children = NULL; }
        error = AXUIElementCopyAttributeValues(element, kAXChildrenAttribute, 0, (CFIndex)*remaining, &children);
    }
    if (error == kAXErrorSuccess && children && CFGetTypeID(children) == CFArrayGetTypeID()) {
        CFIndex count = CFArrayGetCount(children);
        for (CFIndex i = 0; i < count && *remaining && frames.count < captureLayoutChildLimit &&
            NSProcessInfo.processInfo.systemUptime < deadline; i++) {
            (*remaining)--;
            CFTypeRef value = CFArrayGetValueAtIndex(children, i);
            if (CFGetTypeID(value) != AXUIElementGetTypeID() || CFSetContainsValue(visited, value)) continue;
            CFSetAddValue(visited, value);
            AXUIElementRef child = (AXUIElementRef)value;
            AXUIElementSetMessagingTimeout(child, .05);
            CGRect frame;
            if (!captureElementRect(child, &frame) || CGRectEqualToRect(frame, container)) {
                // Structural wrappers contribute their children at the same visual level.
                collectCaptureLayoutChildren(child, container, clip, deadline, depth + 1, remaining, visited, frames);
            } else if (CGRectContainsRect(container, frame) && usableCaptureRect(CGRectIntersection(frame, clip))) {
                [frames addObject:[NSValue valueWithRect:NSRectFromCGRect(frame)]];
            }
        }
    }
    if (children) CFRelease(children);
}

static NSArray<NSValue *> *captureLayoutChildren(AXUIElementRef element, CGRect container, CGRect clip) {
    if (!element || !usableCaptureRect(container) || !usableCaptureRect(clip)) return @[];

    NSMutableOrderedSet<NSValue *> *frames = [NSMutableOrderedSet orderedSet];
    CFMutableSetRef visited = CFSetCreateMutable(NULL, 0, &kCFTypeSetCallBacks);
    CFSetAddValue(visited, element);
    NSUInteger remaining = 96;
    collectCaptureLayoutChildren(element, container, clip, NSProcessInfo.processInfo.systemUptime + .24, 0, &remaining, visited, frames);
    CFRelease(visited);
    return frames.array;
}
