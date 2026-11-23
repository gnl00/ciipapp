#pragma once

#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>

// The frames are CGImages keyed by display ID. Geometry uses global screen
// points with a top-left origin. The picker has already rounded the selection.
NSData *ciip_crop_desktop_frames(NSDictionary<NSNumber *, id> *frames,
    NSDictionary<NSNumber *, NSValue *> *displayRects, CGRect selection, NSString **error);
