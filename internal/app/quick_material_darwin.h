#pragma once

#import <Cocoa/Cocoa.h>
#import <QuartzCore/QuartzCore.h>
#import <objc/runtime.h>

static inline void setQuickToolbarMaterial(NSWindow *window, NSRect frame, NSAutoresizingMaskOptions autoresizing) {
    NSView *root = window.contentView;
    if (!root) return;
    SEL key = sel_registerName("ciipQuickToolbarMaterial");
    NSVisualEffectView *material = objc_getAssociatedObject(window, key);
    if (!material) {
        material = [[[NSVisualEffectView alloc] initWithFrame:frame] autorelease];
        material.material = NSVisualEffectMaterialPopover;
        material.blendingMode = NSVisualEffectBlendingModeBehindWindow;
        material.state = NSVisualEffectStateActive;
        material.wantsLayer = YES;
        material.layer.cornerRadius = 13;
        material.layer.cornerCurve = kCACornerCurveContinuous;
        material.layer.masksToBounds = YES;
        [root addSubview:material positioned:NSWindowBelow relativeTo:nil];
        objc_setAssociatedObject(window, key, material, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    }
    material.autoresizingMask = autoresizing;
    if (!NSEqualRects(material.frame, frame)) material.frame = frame;
}
