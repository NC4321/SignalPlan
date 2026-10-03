# SignalPlan scan for Windows (D81). Paste into PowerShell and press Enter.
# It asks Windows for every Wi-Fi network it can hear, with signal in dBm
# and channel width, copies the result for SignalPlan, and sends nothing
# anywhere. Needs Location on: Settings > Privacy & security > Location.
if (-not ('SignalPlanScan' -as [type])) {
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class SignalPlanScan {
  [DllImport("wlanapi.dll")]
  static extern int WlanOpenHandle(uint version, IntPtr reserved, out uint negotiated, out IntPtr handle);
  [DllImport("wlanapi.dll")]
  static extern int WlanCloseHandle(IntPtr handle, IntPtr reserved);
  [DllImport("wlanapi.dll")]
  static extern int WlanEnumInterfaces(IntPtr handle, IntPtr reserved, out IntPtr list);
  [DllImport("wlanapi.dll")]
  static extern int WlanScan(IntPtr handle, ref Guid iface, IntPtr ssid, IntPtr ie, IntPtr reserved);
  [DllImport("wlanapi.dll")]
  static extern int WlanGetNetworkBssList(IntPtr handle, ref Guid iface, IntPtr ssid, int bssType, bool secure, IntPtr reserved, out IntPtr list);
  [DllImport("wlanapi.dll")]
  static extern void WlanFreeMemory(IntPtr memory);

  // Sizes and offsets from wlanapi.h: WLAN_INTERFACE_INFO is 532 bytes,
  // WLAN_BSS_ENTRY 360, and both lists start their items 8 bytes in.
  const int InterfaceSize = 532;
  const int EntrySize = 360;

  public static string Run() {
    uint negotiated;
    IntPtr handle;
    Check(WlanOpenHandle(2, IntPtr.Zero, out negotiated, out handle), "open the Wi-Fi service");
    try {
      List<Guid> interfaces = Interfaces(handle);
      if (interfaces.Count == 0) throw new Exception("This PC has no Wi-Fi adapter.");
      foreach (Guid g in interfaces) {
        Guid id = g;
        WlanScan(handle, ref id, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
      }
      // A scan takes up to 4 seconds; the list is the latest results.
      System.Threading.Thread.Sleep(4000);
      StringBuilder json = new StringBuilder("{\"signalplanScan\":1,\"source\":\"windows-wlanapi\",\"networks\":[");
      bool first = true;
      foreach (Guid g in interfaces) {
        Guid id = g;
        IntPtr list;
        Check(WlanGetNetworkBssList(handle, ref id, IntPtr.Zero, 3, false, IntPtr.Zero, out list), "list networks");
        try {
          int count = Marshal.ReadInt32(list, 4);
          for (int i = 0; i < count; i++) {
            IntPtr entry = IntPtr.Add(list, 8 + i * EntrySize);
            if (!first) json.Append(',');
            first = false;
            AppendEntry(json, entry);
          }
        } finally {
          WlanFreeMemory(list);
        }
      }
      return json.Append("]}").ToString();
    } finally {
      WlanCloseHandle(handle, IntPtr.Zero);
    }
  }

  static List<Guid> Interfaces(IntPtr handle) {
    IntPtr list;
    Check(WlanEnumInterfaces(handle, IntPtr.Zero, out list), "find the Wi-Fi adapter");
    try {
      int count = Marshal.ReadInt32(list, 0);
      List<Guid> result = new List<Guid>();
      for (int i = 0; i < count; i++) {
        byte[] guid = new byte[16];
        Marshal.Copy(IntPtr.Add(list, 8 + i * InterfaceSize), guid, 0, 16);
        result.Add(new Guid(guid));
      }
      return result;
    } finally {
      WlanFreeMemory(list);
    }
  }

  static void AppendEntry(StringBuilder json, IntPtr entry) {
    int ssidLength = Math.Max(0, Math.Min(32, Marshal.ReadInt32(entry, 0)));
    byte[] ssid = new byte[ssidLength];
    Marshal.Copy(IntPtr.Add(entry, 4), ssid, 0, ssidLength);
    byte[] mac = new byte[6];
    Marshal.Copy(IntPtr.Add(entry, 40), mac, 0, 6);
    int rssi = Marshal.ReadInt32(entry, 56);
    long kHz = (uint)Marshal.ReadInt32(entry, 92);
    int ieOffset = Marshal.ReadInt32(entry, 352);
    int ieSize = Math.Max(0, Marshal.ReadInt32(entry, 356));
    byte[] ie = new byte[ieSize];
    if (ieSize > 0) Marshal.Copy(IntPtr.Add(entry, ieOffset), ie, 0, ieSize);

    json.Append("{\"bssid\":\"").Append(BitConverter.ToString(mac).Replace('-', ':').ToLowerInvariant()).Append('"');
    json.Append(",\"ssid\":\"").Append(Escape(Encoding.UTF8.GetString(ssid))).Append('"');
    json.Append(",\"frequencyMHz\":").Append(kHz / 1000);
    int width = Width(ie);
    if (width > 0) json.Append(",\"widthMHz\":").Append(width);
    json.Append(",\"dbm\":").Append(rssi).Append('}');
  }

  // The channel width from the beacon's information elements (IEEE
  // 802.11): HE Operation's 6 GHz information, else VHT Operation (80 or
  // 160 MHz), else HT Operation (40 MHz with a secondary channel, else 20).
  public static int Width(byte[] ie) {
    if (ie.Length == 0) return 0;
    int ht = 20, vht = -1, vhtSegment1 = 0, he6 = 0;
    int i = 0;
    while (i + 2 <= ie.Length) {
      int id = ie[i], length = ie[i + 1], data = i + 2;
      if (data + length > ie.Length) break;
      if (id == 61 && length >= 2) {
        bool secondary = (ie[data + 1] & 3) != 0;
        bool any = (ie[data + 1] & 4) != 0;
        ht = secondary && any ? 40 : 20;
      } else if (id == 192 && length >= 3) {
        vht = ie[data];
        vhtSegment1 = ie[data + 2];
      } else if (id == 255 && length >= 7 && ie[data] == 36) {
        int parameters = ie[data + 1] | (ie[data + 2] << 8) | (ie[data + 3] << 16);
        int at = data + 7;
        if ((parameters & (1 << 14)) != 0) at += 3;
        if ((parameters & (1 << 15)) != 0) at += 1;
        if ((parameters & (1 << 17)) != 0 && at + 1 < data + length) {
          int control = ie[at + 1] & 3;
          he6 = control == 0 ? 20 : control == 1 ? 40 : control == 2 ? 80 : 160;
        }
      }
      i = data + length;
    }
    if (he6 > 0) return he6;
    if (vht == 1) return vhtSegment1 != 0 ? 160 : 80;
    if (vht == 2 || vht == 3) return 160;
    return ht;
  }

  static string Escape(string text) {
    StringBuilder result = new StringBuilder();
    foreach (char c in text) {
      if (c == '"' || c == '\\') result.Append('\\').Append(c);
      else if (c < ' ') result.Append("\\u").Append(((int)c).ToString("x4"));
      else result.Append(c);
    }
    return result.ToString();
  }

  static void Check(int error, string what) {
    if (error == 0) return;
    if (error == 5) throw new Exception("Windows wouldn't let this " + what + ": turn on Location, and Let desktop apps access your location, in Settings > Privacy & security > Location, then run it again.");
    throw new Exception("Couldn't " + what + " (error " + error + ").");
  }
}
'@
}
$scan = [SignalPlanScan]::Run()
$scan | Set-Clipboard
Write-Host "Copied the scan. Paste it into SignalPlan's Scan your network."
