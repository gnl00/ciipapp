//go:build darwin && cgo

#import <Foundation/Foundation.h>
#import <Vision/Vision.h>
#include <stdlib.h>
#include <string.h>

static char *ocr_error(NSString *message, char **error) {
    *error = strdup([message UTF8String]);
    return NULL;
}

char *ciip_recognize_text(const unsigned char *bytes, size_t length, int fast, char **error) {
    @autoreleasepool {
        @try {
            if (@available(macOS 13.0, *)) {
                NSData *data = [NSData dataWithBytes:bytes length:length];
                VNRecognizeTextRequest *request = [[[VNRecognizeTextRequest alloc] init] autorelease];
                request.revision = VNRecognizeTextRequestRevision3;
                request.recognitionLevel = fast ? VNRequestTextRecognitionLevelFast : VNRequestTextRecognitionLevelAccurate;
                request.usesLanguageCorrection = YES;
                request.automaticallyDetectsLanguage = YES;
                NSError *failure = nil;
                NSArray<NSString *> *supported = [request supportedRecognitionLanguagesAndReturnError:&failure];
                if (!supported) return ocr_error(failure.localizedDescription ?: @"无法载入系统识别语言", error);
                NSMutableArray<NSString *> *languages = [NSMutableArray array];
                for (NSString *language in @[@"zh-Hans", @"zh-Hant", @"en-US"]) {
                    if ([supported containsObject:language]) [languages addObject:language];
                }
                if (languages.count == 0) return ocr_error(@"系统没有可用的中文或英文识别语言", error);
                request.recognitionLanguages = languages;
                VNImageRequestHandler *handler = [[[VNImageRequestHandler alloc] initWithData:data orientation:kCGImagePropertyOrientationUp options:@{}] autorelease];
                if (![handler performRequests:@[request] error:&failure]) {
                    return ocr_error(failure.localizedDescription ?: @"Apple Vision 无法识别这张图片", error);
                }
                NSMutableArray *lines = [NSMutableArray array];
                for (VNRecognizedTextObservation *observation in request.results) {
                    VNRecognizedText *candidate = [[observation topCandidates:1] firstObject];
                    if (!candidate || candidate.string.length == 0) continue;
                    CGRect box = observation.boundingBox;
                    [lines addObject:@{@"text": candidate.string, @"x": @(box.origin.x), @"y": @(box.origin.y), @"w": @(box.size.width), @"h": @(box.size.height)}];
                }
                NSData *json = [NSJSONSerialization dataWithJSONObject:lines options:0 error:&failure];
                if (!json) return ocr_error(failure.localizedDescription ?: @"无法编码识别结果", error);
                return strndup(json.bytes, json.length);
            }
            return ocr_error(@"离线文字识别需要 macOS 13 或更新版本", error);
        } @catch (NSException *exception) {
            return ocr_error(exception.reason ?: @"Apple Vision 发生异常", error);
        }
    }
}
