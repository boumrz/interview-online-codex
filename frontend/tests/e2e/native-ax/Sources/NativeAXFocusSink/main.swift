import AppKit

@main
struct NativeAXFocusSink {
  static func main() {
    let app = NSApplication.shared
    app.setActivationPolicy(.regular)
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 320, height: 180),
      styleMask: [.titled, .closable],
      backing: .buffered,
      defer: false
    )
    window.title = "Native AX Focus Sink"
    window.isReleasedWhenClosed = false
    window.center()
    window.makeKeyAndOrderFront(nil)
    app.run()
  }
}
