#pragma once

#import <Foundation/Foundation.h>

// Must be started before the capture panels are visible. Completion runs once
// on the main queue. Each dictionary value retains a CGImageRef for that display.
void ciip_capture_desktop_frames(NSArray<NSNumber *> *displayIDs,
    void (^completion)(NSDictionary<NSNumber *, id> *frames, NSString *error));
