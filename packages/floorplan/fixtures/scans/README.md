# Scan samples

Outputs of the scan commands in Scan your network (D77), for `scanImport.test.ts`.

The `-handmade` files are written by hand from each tool's documented or reported format, not captured on a real machine. Each is replaced by a real capture, named with its OS and version (for example `netsh-windows-11-24h2.txt`), as one comes in (#141). `signalplan-scan-example.json` is SignalPlan's own format, so it's an example rather than a capture.

| File                            | Tool                                                    | Captured on |
| ------------------------------- | ------------------------------------------------------- | ----------- |
| `netsh-handmade.txt`            | `netsh wlan show networks mode=bssid` (English)         | not yet     |
| `netsh-handmade-de.txt`         | the same, in German                                     | not yet     |
| `nmcli-handmade.txt`            | `nmcli -t -f BSSID,SSID,CHAN,FREQ,SIGNAL dev wifi list` | not yet     |
| `iw-handmade.txt`               | `sudo iw dev <interface> scan`                          | not yet     |
| `system-profiler-handmade.json` | `system_profiler SPAirPortDataType -json`               | not yet     |
| `wifi-analyzer-handmade.csv`    | WiFi Analyzer's export                                  | not yet     |
| `signalplan-scan-example.json`  | SignalPlan's scan scripts                               | —           |
