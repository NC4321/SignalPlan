// SignalPlan scan for macOS (D81). Asks macOS for every Wi-Fi network it
// can hear, with signal in dBm and channel width, and prints it for
// SignalPlan. Sends nothing anywhere. Needs the Xcode command-line tools.
import CoreLocation
import CoreWLAN
import Foundation

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

// macOS shows BSSIDs only to apps allowed to use Location.
let location = CLLocationManager()
location.requestWhenInUseAuthorization()
RunLoop.current.run(until: Date().addingTimeInterval(1))

guard let interface = CWWiFiClient.shared().interface() else {
    fail("This Mac has no Wi-Fi interface.")
}
let found: Set<CWNetwork>
do {
    found = try interface.scanForNetworks(withName: nil)
} catch {
    fail("The scan failed: \(error.localizedDescription)")
}

/// A BSSID as two hex digits per byte, lower case: macOS may drop zeros.
func normalised(_ bssid: String) -> String {
    bssid.lowercased().split(separator: ":").map {
        $0.count == 1 ? "0" + $0 : String($0)
    }.joined(separator: ":")
}

var networks: [[String: Any]] = []
var hidden = 0
for network in found {
    guard let bssid = network.bssid else {
        hidden += 1
        continue
    }
    var entry: [String: Any] = [
        "bssid": normalised(bssid),
        "dbm": network.rssiValue,
    ]
    if let ssid = network.ssid { entry["ssid"] = ssid }
    if let channel = network.wlanChannel {
        entry["channel"] = channel.channelNumber
        switch channel.channelBand {
        case .band2GHz: entry["band"] = "2.4"
        case .band5GHz: entry["band"] = "5"
        case .band6GHz: entry["band"] = "6"
        default: break
        }
        switch channel.channelWidth {
        case .width20MHz: entry["widthMHz"] = 20
        case .width40MHz: entry["widthMHz"] = 40
        case .width80MHz: entry["widthMHz"] = 80
        case .width160MHz: entry["widthMHz"] = 160
        default: break
        }
    }
    networks.append(entry)
}
if hidden > 0 {
    FileHandle.standardError.write(Data((
        "macOS hid the BSSID of \(hidden) network(s). Allow Location for Terminal in "
        + "System Settings > Privacy & Security > Location Services, then run this again.\n"
    ).utf8))
}
let scan: [String: Any] = [
    "signalplanScan": 1,
    "source": "macos-corewlan",
    "networks": networks,
]
let data = try JSONSerialization.data(withJSONObject: scan)
print(String(decoding: data, as: UTF8.self))
