import AppKit
import CoreText

// Run from the project root: swift scripts/render-icon.swift
// The icon keeps the product wordmark; every size is drawn from the same glyph outlines.
let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let resources = root.appendingPathComponent("resources")
let iconset = root.appendingPathComponent("build/ciip.iconset")
try FileManager.default.createDirectory(at: resources, withIntermediateDirectories: true)
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)

func color(_ hex: UInt32, _ alpha: CGFloat = 1) -> CGColor {
    CGColor(srgbRed: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255,
            blue: CGFloat(hex & 255) / 255, alpha: alpha)
}
func gradient(_ colors: [CGColor], locations: [CGFloat]? = nil) -> CGGradient {
    CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: colors as CFArray, locations: locations)!
}
let font = NSFont.systemFont(ofSize: 340, weight: .heavy)
let line = CTLineCreateWithAttributedString(NSAttributedString(string: "ciip", attributes: [.font: font, .kern: -19]))
let lettering = CGMutablePath()
for run in CTLineGetGlyphRuns(line) as! [CTRun] {
    let count = CTRunGetGlyphCount(run)
    var glyphs = [CGGlyph](repeating: 0, count: count)
    var positions = [CGPoint](repeating: .zero, count: count)
    CTRunGetGlyphs(run, CFRange(), &glyphs)
    CTRunGetPositions(run, CFRange(), &positions)
    let runFont = (CTRunGetAttributes(run) as NSDictionary)[kCTFontAttributeName] as! CTFont
    for i in 0..<count {
        if let glyph = CTFontCreatePathForGlyph(runFont, glyphs[i], nil) {
            lettering.addPath(glyph, transform: CGAffineTransform(translationX: positions[i].x, y: positions[i].y))
        }
    }
}
let bounds = lettering.boundingBoxOfPath
let markScale: CGFloat = 589 / bounds.width
let markHeight = bounds.height * markScale
let letterX: CGFloat = 179
let letterY = 512 - markHeight / 2 - bounds.minY * markScale
let wordTransform = CGAffineTransform(a: markScale, b: 0, c: 0, d: markScale, tx: letterX - bounds.minX * markScale, ty: letterY)
let word = CGMutablePath(); word.addPath(lettering, transform: wordTransform)
let dot = CGRect(x: 796, y: letterY + 1, width: 58, height: 58)

func drawIcon(size: Int) throws -> Data {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8,
                                 samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                                 bytesPerRow: 0, bitsPerPixel: 0)!
    let context = NSGraphicsContext(bitmapImageRep: bitmap)!.cgContext
    context.scaleBy(x: CGFloat(size)/1024, y: CGFloat(size)/1024)
    let tile = CGPath(roundedRect: CGRect(x: 90, y: 90, width: 844, height: 844), cornerWidth: 188, cornerHeight: 188, transform: nil)
    context.saveGState()
    context.setShadow(offset: CGSize(width: 0, height: -13), blur: 24, color: color(0x172820, 0.18))
    context.setFillColor(color(0xE5E8E3)); context.addPath(tile); context.fillPath()
    context.restoreGState()
    context.saveGState(); context.addPath(tile); context.clip()
    context.drawLinearGradient(gradient([color(0xF9FAF6), color(0xEEF1EB), color(0xDDE3DC)], locations:[0,0.52,1]),
                               start: CGPoint(x: 360,y: 934), end: CGPoint(x: 700,y: 90), options: [.drawsBeforeStartLocation,.drawsAfterEndLocation])
    context.drawRadialGradient(gradient([color(0xFFFFFF,0.92), color(0xFFFFFF,0)], locations:[0,1]),
                               startCenter: CGPoint(x: 290,y: 820), startRadius: 0,
                               endCenter: CGPoint(x: 290,y: 820), endRadius: 640, options: [])
    context.restoreGState()
    // A soft outer lip, without ornamental rings or a separate badge around the logo.
    context.saveGState(); context.addPath(tile); context.clip()
    context.setLineWidth(3); context.setStrokeColor(color(0xFFFFFF,0.90)); context.addPath(tile); context.strokePath()
    context.restoreGState()
    context.saveGState()
    context.setShadow(offset: CGSize(width: 0, height: -1.5), blur: 0.8, color: color(0xFFFFFF,0.82))
    context.setFillColor(color(0x292D2C)); context.addPath(word); context.fillPath()
    context.restoreGState()
    context.saveGState(); context.addEllipse(in: dot); context.clip()
    context.drawLinearGradient(gradient([color(0xD97449), color(0xC75B32)]), start: CGPoint(x:dot.midX,y:dot.maxY), end:CGPoint(x:dot.midX,y:dot.minY),options:[])
    context.restoreGState()
    return bitmap.representation(using: .png, properties: [:])!
}
let sizes = [("icon_16x16.png",16),("icon_16x16@2x.png",32),("icon_32x32.png",32),("icon_32x32@2x.png",64),
             ("icon_128x128.png",128),("icon_128x128@2x.png",256),("icon_256x256.png",256),("icon_256x256@2x.png",512),
             ("icon_512x512.png",512),("icon_512x512@2x.png",1024)]
for (name,size) in sizes { try drawIcon(size:size).write(to:iconset.appendingPathComponent(name)) }
try drawIcon(size:1024).write(to:resources.appendingPathComponent("icon.png"))
let process=Process();process.executableURL=URL(fileURLWithPath:"/usr/bin/iconutil")
process.arguments=["-c","icns",iconset.path,"-o",resources.appendingPathComponent("ciip.icns").path]
try process.run();process.waitUntilExit()
guard process.terminationStatus == 0 else {
    throw NSError(domain: "ciip.icon", code: Int(process.terminationStatus), userInfo: [NSLocalizedDescriptionKey: "iconutil failed to package the iconset"])
}
print("Generated resources/icon.png and resources/ciip.icns (16–1024 px).")
