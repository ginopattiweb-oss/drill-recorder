// Boom Bubble — burbuja de cámara nativa (sin marco, siempre encima, en todos los escritorios).
// La web de Boom se conecta por WebSocket a 127.0.0.1:47811 para mostrarla y recibir los controles.

import AppKit
import AVFoundation
import Network
import ServiceManagement

let PORT: UInt16 = 47811
// Orígenes permitidos: tu servidor local y, si despliegas Boom, tu dominio de producción:
//   defaults write app.boom.bubble extraOrigins -array "https://tu-boom.vercel.app"
let ALLOWED_ORIGINS: Set<String> = Set([
    "http://localhost:3030",
    "http://127.0.0.1:3030",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]).union(UserDefaults.standard.stringArray(forKey: "extraOrigins") ?? [])
let SIZES: [CGFloat] = [150, 220, 320]
let PILL_W: CGFloat = 44
let GAP: CGFloat = 10

// MARK: - WebSocket server

final class BridgeServer {
    private var listener: NWListener?
    private var connections: [ObjectIdentifier: NWConnection] = [:]
    var onMessage: (([String: Any]) -> Void)?
    var onCountChange: ((Int) -> Void)?
    var helloExtra: () -> [String: Any] = { [:] }

    var count: Int { connections.count }

    func start() {
        let ws = NWProtocolWebSocket.Options()
        ws.autoReplyPing = true
        // Solo se aceptan páginas de Boom (evita que cualquier sitio prenda la cámara)
        ws.setClientRequestHandler(.main) { _, headers in
            let origin = headers.first { $0.name.lowercased() == "origin" }?.value ?? ""
            let ok = ALLOWED_ORIGINS.contains(origin)
            return NWProtocolWebSocket.Response(status: ok ? .accept : .reject, subprotocol: nil, additionalHeaders: nil)
        }
        let params = NWParameters.tcp
        params.defaultProtocolStack.applicationProtocols.insert(ws, at: 0)
        params.allowLocalEndpointReuse = true
        params.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: PORT)!)
        do {
            let l = try NWListener(using: params)
            l.newConnectionHandler = { [weak self] c in self?.accept(c) }
            l.stateUpdateHandler = { state in
                if case .failed(let e) = state { NSLog("BoomBubble listener failed: \(e)") }
            }
            l.start(queue: .main)
            listener = l
        } catch {
            NSLog("BoomBubble: no se pudo abrir el puerto \(PORT): \(error)")
        }
    }

    private func accept(_ c: NWConnection) {
        let id = ObjectIdentifier(c)
        c.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready:
                self.connections[id] = c
                self.onCountChange?(self.connections.count)
                self.send(["type": "hello", "version": 1].merging(self.helloExtra()) { a, _ in a }, to: c)
            case .failed, .cancelled:
                if self.connections.removeValue(forKey: id) != nil { self.onCountChange?(self.connections.count) }
            default: break
            }
        }
        c.start(queue: .main)
        receive(c)
    }

    private func receive(_ c: NWConnection) {
        c.receiveMessage { [weak self] data, _, _, error in
            guard let self else { return }
            if let data, !data.isEmpty,
               let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                self.onMessage?(obj)
            }
            if error == nil { self.receive(c) } else { c.cancel() }
        }
    }

    private func send(_ obj: [String: Any], to c: NWConnection) {
        guard let data = try? JSONSerialization.data(withJSONObject: obj) else { return }
        let meta = NWProtocolWebSocket.Metadata(opcode: .text)
        let ctx = NWConnection.ContentContext(identifier: "msg", metadata: [meta])
        c.send(content: data, contentContext: ctx, isComplete: true, completion: .idempotent)
    }

    func broadcast(_ obj: [String: Any]) {
        connections.values.forEach { send(obj, to: $0) }
    }
}

// MARK: - Vistas

final class BubbleView: NSView {
    let preview: AVCaptureVideoPreviewLayer
    private let dim = CALayer()
    private let countText = CATextLayer()
    let sizes = SizeControl()
    private let circle = CAShapeLayer()
    var onDoubleClick: (() -> Void)?
    var onMoved: (() -> Void)?
    var menuProvider: (() -> NSMenu)?

    init(session: AVCaptureSession) {
        preview = AVCaptureVideoPreviewLayer(session: session)
        super.init(frame: .zero)
        // vista "layer-hosting" (layer antes de wantsLayer) para que AppKit no pise el layer
        let root = CALayer()
        root.masksToBounds = true
        root.backgroundColor = NSColor(calibratedWhite: 0.12, alpha: 1).cgColor
        root.mask = circle
        layer = root
        wantsLayer = true
        preview.videoGravity = .resizeAspectFill
        root.addSublayer(preview)
        dim.backgroundColor = NSColor(calibratedWhite: 0, alpha: 0.5).cgColor
        dim.isHidden = true
        root.addSublayer(dim)
        countText.alignmentMode = .center
        countText.foregroundColor = NSColor.white.cgColor
        countText.font = NSFont.systemFont(ofSize: 10, weight: .heavy)
        countText.contentsScale = 2
        countText.isHidden = true
        root.addSublayer(countText)
        sizes.isHidden = true
        addSubview(sizes)
        // .activeAlways: la app es accesoria y casi nunca está activa
        addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
    }

    override func mouseEntered(with event: NSEvent) { setSizesVisible(true) }
    override func mouseExited(with event: NSEvent) { setSizesVisible(false) }

    private func setSizesVisible(_ v: Bool) {
        if v { sizes.alphaValue = 0; sizes.isHidden = false }
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.15
            sizes.animator().alphaValue = v ? 1 : 0
        }, completionHandler: { [weak self] in
            if !v { self?.sizes.isHidden = true }
        })
    }

    required init?(coder: NSCoder) { fatalError() }

    // sin constraints AppKit no siempre llama a layout(): se reacomoda en cada cambio de tamaño
    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        relayout()
    }

    override func layout() {
        super.layout()
        relayout()
    }

    private func relayout() {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        circle.frame = bounds
        circle.path = CGPath(ellipseIn: bounds, transform: nil)
        layer?.cornerRadius = bounds.width / 2
        preview.frame = bounds
        dim.frame = bounds
        let fs = bounds.width * 0.42
        countText.fontSize = fs
        countText.frame = CGRect(x: 0, y: (bounds.height - fs * 1.2) / 2, width: bounds.width, height: fs * 1.2)
        let cs = SizeControl.size
        sizes.frame = NSRect(x: (bounds.width - cs.width) / 2, y: max(10, bounds.height * 0.1), width: cs.width, height: cs.height)
        CATransaction.commit()
        window?.invalidateShadow()
    }

    func setCount(_ n: Int?) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        if let n, n > 0 {
            dim.isHidden = false
            countText.isHidden = false
            countText.string = "\(n)"
        } else {
            dim.isHidden = true
            countText.isHidden = true
        }
        CATransaction.commit()
    }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func mouseDown(with event: NSEvent) {
        if event.clickCount == 2 { onDoubleClick?(); return }
        window?.performDrag(with: event)
        onMoved?()
    }

    override func rightMouseDown(with event: NSEvent) {
        if let menu = menuProvider?() { NSMenu.popUpContextMenu(menu, with: event, for: self) }
    }
}

// Control de 3 tamaños que aparece al pasar el mouse sobre la burbuja (como Loom)
final class SizeControl: NSView {
    var selected = 1 { didSet { needsDisplay = true } }
    var onSelect: ((Int) -> Void)?
    static let dot: CGFloat = 22
    static let size = NSSize(width: dot * 3 + 12, height: dot + 8)

    override func draw(_ dirtyRect: NSRect) {
        NSColor(calibratedWhite: 0, alpha: 0.55).setFill()
        NSBezierPath(roundedRect: bounds, xRadius: bounds.height / 2, yRadius: bounds.height / 2).fill()
        for i in 0..<3 {
            let r = slot(i)
            if i == selected {
                NSColor(calibratedWhite: 1, alpha: 0.22).setFill()
                NSBezierPath(ovalIn: r.insetBy(dx: 1, dy: 1)).fill()
            }
            let d: CGFloat = 6 + CGFloat(i) * 3
            NSColor.white.setFill()
            NSBezierPath(ovalIn: NSRect(x: r.midX - d / 2, y: r.midY - d / 2, width: d, height: d)).fill()
        }
    }

    private func slot(_ i: Int) -> NSRect {
        NSRect(x: 6 + CGFloat(i) * SizeControl.dot, y: 4, width: SizeControl.dot, height: SizeControl.dot)
    }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) {
        let p = convert(event.locationInWindow, from: nil)
        if let i = (0..<3).first(where: { slot($0).insetBy(dx: -2, dy: -4).contains(p) }) { onSelect?(i) }
    }
}

final class StopButton: NSView {
    var action: (() -> Void)?
    override func draw(_ dirtyRect: NSRect) {
        let c = NSColor(calibratedRed: 1.0, green: 0.42, blue: 0.29, alpha: 1)
        c.setFill()
        NSBezierPath(ovalIn: bounds.insetBy(dx: 1, dy: 1)).fill()
        NSColor.white.setFill()
        let s: CGFloat = bounds.width * 0.32
        NSBezierPath(roundedRect: NSRect(x: (bounds.width - s) / 2, y: (bounds.height - s) / 2, width: s, height: s), xRadius: 2, yRadius: 2).fill()
    }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) { action?() }
}

final class PillView: NSView {
    let stop = StopButton()
    let time = NSTextField(labelWithString: "0:00")
    let pause = NSButton()
    let restart = NSButton()
    let trash = NSButton()
    var send: ((String) -> Void)?
    private(set) var paused = false

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = NSColor(calibratedRed: 0.12, green: 0.125, blue: 0.14, alpha: 0.96).cgColor
        layer?.cornerRadius = 14
        stop.action = { [weak self] in self?.send?("stop") }
        time.font = NSFont.monospacedDigitSystemFont(ofSize: 11, weight: .bold)
        time.textColor = .white
        time.alignment = .center
        for (b, sym, act) in [(pause, "pause.fill", "pause"), (restart, "arrow.counterclockwise", "restart"), (trash, "trash", "delete")] {
            b.image = NSImage(systemSymbolName: sym, accessibilityDescription: act)
            b.isBordered = false
            b.contentTintColor = .white
            b.imagePosition = .imageOnly
            b.identifier = NSUserInterfaceItemIdentifier(act)
            b.target = self
            b.action = #selector(tap(_:))
        }
        [stop, time, pause, restart, trash].forEach(addSubview)
    }

    required init?(coder: NSCoder) { fatalError() }

    @objc private func tap(_ b: NSButton) {
        guard let id = b.identifier?.rawValue else { return }
        send?(id == "pause" && paused ? "resume" : id)
    }

    func setPaused(_ p: Bool) {
        paused = p
        pause.image = NSImage(systemSymbolName: p ? "play.fill" : "pause.fill", accessibilityDescription: nil)
    }

    override func layout() {
        super.layout()
        let w = bounds.width
        var y = bounds.height - 8
        func place(_ v: NSView, _ h: CGFloat, _ vw: CGFloat) {
            y -= h
            v.frame = NSRect(x: (w - vw) / 2, y: y, width: vw, height: h)
            y -= 4
        }
        place(stop, 30, 30)
        place(time, 16, w)
        y -= 4
        place(pause, 26, 30)
        place(restart, 26, 30)
        place(trash, 26, 30)
    }

    static let height: CGFloat = 8 + 34 + 20 + 4 + 30 * 3 + 8
}

final class ClearPanel: NSPanel {
    init(rect: NSRect) {
        super.init(contentRect: rect, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        isOpaque = false
        backgroundColor = .clear
        hasShadow = true
        level = .floating
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        isMovableByWindowBackground = false
        hidesOnDeactivate = false
        isReleasedWhenClosed = false
    }
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

// MARK: - App

final class AppDelegate: NSObject, NSApplicationDelegate {
    let session = AVCaptureSession()
    let server = BridgeServer()
    var bubbleWin: ClearPanel!
    var pillWin: ClearPanel!
    var bubble: BubbleView!
    let pill = PillView(frame: .zero)
    var status: NSStatusItem!
    var sizeIndex = UserDefaults.standard.object(forKey: "size") as? Int ?? 1
    var currentCamera = ""
    var visible = false
    var phase = "idle"

    func applicationDidFinishLaunching(_ n: Notification) {
        NSApp.setActivationPolicy(.accessory)
        session.sessionPreset = .hd1280x720

        bubble = BubbleView(session: session)
        bubble.onDoubleClick = { [weak self] in self?.cycleSize() }
        bubble.menuProvider = { [weak self] in self?.contextMenu() ?? NSMenu() }
        bubble.sizes.selected = sizeIndex
        bubble.sizes.onSelect = { [weak self] i in self?.setSize(i) }

        let d = SIZES[sizeIndex]
        bubbleWin = ClearPanel(rect: NSRect(x: 0, y: 0, width: d, height: d))
        bubbleWin.contentView = bubble
        bubbleWin.setFrameOrigin(savedOrigin(size: d))
        NotificationCenter.default.addObserver(forName: NSWindow.didMoveNotification, object: bubbleWin, queue: .main) { [weak self] _ in
            self?.positionPill()
            if let o = self?.bubbleWin.frame.origin { UserDefaults.standard.set([o.x, o.y], forKey: "origin") }
        }

        pillWin = ClearPanel(rect: NSRect(x: 0, y: 0, width: PILL_W, height: PillView.height))
        pillWin.contentView = pill
        pillWin.sharingType = .none // que los controles no salgan en la grabación (si el sistema lo respeta)
        pill.send = { [weak self] action in self?.server.broadcast(["type": "action", "action": action]) }

        setupStatusItem()

        server.onMessage = { [weak self] m in self?.handle(m) }
        server.helloExtra = { [weak self] in ["size": self?.sizeIndex ?? 1] }
        server.onCountChange = { [weak self] count in
            // si se cierra la pestaña de Boom, se apaga la cámara
            if count == 0 { self?.hide(notify: false) }
            self?.updateMenu()
        }
        server.start()

        NSAppleEventManager.shared().setEventHandler(self, andSelector: #selector(handleURL(_:reply:)),
                                                     forEventClass: AEEventClass(kInternetEventClass), andEventID: AEEventID(kAEGetURL))
        if #available(macOS 13.0, *) { try? SMAppService.mainApp.register() } // abrir al iniciar sesión
    }

    @objc func handleURL(_ e: NSAppleEventDescriptor, reply: NSAppleEventDescriptor) {
        // boombubble://open → solo hace falta que la app esté corriendo
    }

    // MARK: mensajes de la web
    func handle(_ m: [String: Any]) {
        switch m["type"] as? String {
        case "show":
            show(camera: m["camera"] as? String ?? "")
        case "hide":
            hide(notify: false)
        case "size":
            if let i = m["index"] as? Int, SIZES.indices.contains(i), i != sizeIndex { setSize(i) }
        case "state":
            phase = m["phase"] as? String ?? "idle"
            let ms = m["elapsedMs"] as? Double ?? 0
            let s = Int(ms / 1000)
            pill.time.stringValue = String(format: "%d:%02d", s / 60, s % 60)
            pill.setPaused(phase == "paused")
            bubble.setCount(phase == "countdown" ? m["count"] as? Int : nil)
            let live = phase == "recording" || phase == "paused" || phase == "countdown"
            if live && visible { pillWin.orderFrontRegardless(); positionPill() } else { pillWin.orderOut(nil) }
        case "ping":
            server.broadcast(["type": "visible", "visible": visible,
                              "camera": AVCaptureDevice.authorizationStatus(for: .video).rawValue])
        default: break
        }
    }

    func show(camera: String) {
        // una app accesoria inactiva no muestra el cartel de permiso: se activa la primera vez
        if AVCaptureDevice.authorizationStatus(for: .video) == .notDetermined {
            NSApp.activate(ignoringOtherApps: true)
        }
        AVCaptureDevice.requestAccess(for: .video) { granted in
            DispatchQueue.main.async {
                guard granted else {
                    // permiso denegado: se avisa a la web y se abre Ajustes en la sección de Cámara
                    self.server.broadcast(["type": "cameraDenied"])
                    if let u = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera") {
                        NSWorkspace.shared.open(u)
                    }
                    return
                }
                self.configureCamera(camera)
                if !self.session.isRunning { self.session.startRunning() }
                self.visible = true
                self.bubbleWin.alphaValue = 0
                self.bubbleWin.orderFrontRegardless()
                NSAnimationContext.runAnimationGroup { ctx in
                    ctx.duration = 0.25
                    self.bubbleWin.animator().alphaValue = 1
                }
                self.server.broadcast(["type": "visible", "visible": true])
                self.updateMenu()
            }
        }
    }

    func hide(notify: Bool) {
        visible = false
        bubbleWin.orderOut(nil)
        pillWin.orderOut(nil)
        if session.isRunning { session.stopRunning() }
        if notify { server.broadcast(["type": "visible", "visible": false]) }
        updateMenu()
    }

    func configureCamera(_ label: String) {
        let types: [AVCaptureDevice.DeviceType]
        if #available(macOS 14.0, *) {
            types = [.builtInWideAngleCamera, .external, .continuityCamera]
        } else {
            types = [.builtInWideAngleCamera, .externalUnknown]
        }
        let devices = AVCaptureDevice.DiscoverySession(deviceTypes: types, mediaType: .video, position: .unspecified).devices
        let device = devices.first { !label.isEmpty && (label.hasPrefix($0.localizedName) || $0.localizedName.hasPrefix(label)) }
            ?? AVCaptureDevice.default(for: .video)
        guard let device, device.uniqueID != currentCamera || session.inputs.isEmpty else { return }
        session.beginConfiguration()
        session.inputs.forEach { session.removeInput($0) }
        if let input = try? AVCaptureDeviceInput(device: device), session.canAddInput(input) {
            session.addInput(input)
            currentCamera = device.uniqueID
        }
        session.commitConfiguration()
        if let conn = bubble.preview.connection, conn.isVideoMirroringSupported {
            conn.automaticallyAdjustsVideoMirroring = false
            conn.isVideoMirrored = true
        }
    }

    // MARK: tamaño / posición
    func savedOrigin(size d: CGFloat) -> NSPoint {
        if let a = UserDefaults.standard.array(forKey: "origin") as? [CGFloat], a.count == 2 {
            let p = NSPoint(x: a[0], y: a[1])
            if NSScreen.screens.contains(where: { $0.frame.insetBy(dx: -20, dy: -20).contains(p) }) { return p }
        }
        let vf = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        return NSPoint(x: vf.minX + 24 + PILL_W + GAP, y: vf.minY + 24)
    }

    func cycleSize() { setSize((sizeIndex + 1) % SIZES.count) }

    func setSize(_ i: Int) {
        sizeIndex = i
        UserDefaults.standard.set(i, forKey: "size")
        bubble.sizes.selected = i
        server.broadcast(["type": "size", "index": i])
        let d = SIZES[i]
        let old = bubbleWin.frame
        let vf = bubbleWin.screen?.visibleFrame ?? NSScreen.main?.visibleFrame ?? old
        // se mantiene fija la esquina más cercana al borde de la pantalla (abajo-izq por defecto)
        var f = NSRect(x: old.minX, y: old.minY, width: d, height: d)
        if old.midX > vf.midX { f.origin.x = old.maxX - d }
        if old.midY > vf.midY { f.origin.y = old.maxY - d }
        f.origin.x = min(max(f.origin.x, vf.minX), vf.maxX - d)
        f.origin.y = min(max(f.origin.y, vf.minY), vf.maxY - d)
        bubbleWin.setFrame(f, display: true, animate: true)
        positionPill()
        updateMenu()
    }

    func positionPill() {
        let f = bubbleWin.frame
        var x = f.minX - GAP - PILL_W
        if let s = bubbleWin.screen, x < s.visibleFrame.minX + 4 { x = f.maxX + GAP }
        pillWin.setFrameOrigin(NSPoint(x: x, y: f.midY - PillView.height / 2))
    }

    // MARK: menús
    func contextMenu() -> NSMenu {
        let m = NSMenu()
        for (i, name) in ["Chica", "Mediana", "Grande"].enumerated() {
            let it = NSMenuItem(title: "Tamaño: \(name)", action: #selector(menuSize(_:)), keyEquivalent: "")
            it.tag = i
            it.target = self
            it.state = i == sizeIndex ? .on : .off
            m.addItem(it)
        }
        m.addItem(.separator())
        let hideItem = NSMenuItem(title: "Ocultar burbuja", action: #selector(menuHide), keyEquivalent: "")
        hideItem.target = self
        m.addItem(hideItem)
        return m
    }

    func setupStatusItem() {
        status = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let b = status.button {
            b.image = NSImage(systemSymbolName: "circle.circle.fill", accessibilityDescription: "Boom Bubble")
            b.image?.isTemplate = true
        }
        updateMenu()
    }

    func updateMenu() {
        let m = NSMenu()
        let title = NSMenuItem(title: server.count > 0 ? "Boom conectado" : "Esperando a Boom…", action: nil, keyEquivalent: "")
        title.isEnabled = false
        m.addItem(title)
        m.addItem(.separator())
        let toggle = NSMenuItem(title: visible ? "Ocultar burbuja" : "Mostrar burbuja", action: #selector(menuToggle), keyEquivalent: "")
        toggle.target = self
        m.addItem(toggle)
        for it in contextMenu().items where it.action == #selector(menuSize(_:)) {
            m.addItem(it.copy() as! NSMenuItem)
        }
        m.addItem(.separator())
        let quit = NSMenuItem(title: "Salir de Boom Bubble", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        m.addItem(quit)
        status?.menu = m
    }

    @objc func menuSize(_ it: NSMenuItem) { setSize(it.tag) }
    @objc func menuHide() { hide(notify: true) }
    @objc func menuToggle() { visible ? hide(notify: true) : show(camera: "") }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
