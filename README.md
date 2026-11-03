# luci-app-static-gw

LuCI application for per-host static IPv4 binding with optional custom gateway (DHCP option 3) and DNS (option 6).

## Features (v1)

- Reuses the stock `config host` sections in `/etc/config/dhcp`.
- Uses managed `config tag` sections (prefix `lsgw_`, marker `option lsgw_managed '1'`) to set per-host gateway/DNS.
- Shows LAN address/mask, dynamic pool range, and the effective default gateway (plus the running app version).
- **Online devices**: reads the live DHCPv4 lease table and offers a one-click **Make static** action that stages a binding for the leased address.
- Grid table: Hostname / MAC / Fixed IPv4 / Gateway / Status.
- Modal editing with validation:
  - Single unicast MAC (normalized to lowercase colon format).
  - IPv4 inside the LAN subnet, not conflicting with router IP, other bindings, active leases (best-effort), or the chosen gateway.
  - **Per-host gateway** (DHCP option 3): leave empty to inherit the system gateway, or enter an address in the LAN subnet.
  - Optional "also send as DNS" (option 6) only when a custom gateway is set.
- Official page interoperability: new entries appear in "Network → DHCP/DNS → Static Leases"; official advanced entries (multi-MAC, DUID, IPv6, match_tag, etc.) are shown read-only and are never written.
- Standard LuCI save & apply flow with rollback.
- English + Simplified Chinese (Chinese also works without the separate i18n package, via a built-in fallback generated from the `.po` file).

## Requirements

- fw4 only (nftables). No fw3/iptables support planned.
- One active dnsmasq instance serving a static single-IPv4-subnet `lan` interface.
- `dnsmasq-full` recommended (stock dnsmasq also works for basic cases).

## Installation

### From source (SDK build)

```sh
# In OpenWrt/ImmortalWrt SDK
make package/luci-app-static-gw/compile
```

Both `.ipk` (24.10/opkg) and `.apk` (25+/apk) are produced when built with the matching SDK. The package is `Architecture: all`.

### Prebuilt packages (GitHub Releases)

Every push to `main` builds all four packages and publishes them as **its own
release** (tag `v<version>-r<release>-<UTC date>-run<number>`), so each build
is kept separate instead of sharing one moving tag:

| File | Target |
| --- | --- |
| `luci-app-static-gw_*_all.ipk` | OpenWrt 24.10 and older (opkg) |
| `luci-i18n-static-gw-zh-cn_*_all.ipk` | Simplified Chinese UI (opkg) |
| `luci-app-static-gw-*.apk` | OpenWrt snapshot / 25.x (apk) |
| `luci-i18n-static-gw-zh-cn-*.apk` | Simplified Chinese UI (apk) |

Both packages are `Architecture: all` — they contain only LuCI JS/JSON and
translations, so one file serves every device.

### Install on opkg (24.10)

```sh
opkg install luci-app-static-gw_*_all.ipk
opkg install luci-i18n-static-gw-zh-cn_*_all.ipk   # optional, Chinese UI
```

### Install on apk (snapshot / 25.x)

The `.apk` is signed by the OpenWrt SDK during the build. That signing key is
not distributed here, so a device reports:

```
ERROR: /tmp/upload.apk: UNTRUSTED signature
```
(`apk install` exits with code 99.)

Install with:

```sh
apk add --allow-untrusted luci-app-static-gw-*.apk
apk add --allow-untrusted luci-i18n-static-gw-zh-cn-*.apk   # optional
```

Then refresh LuCI (or `luci-reload`).

## Usage

1. Go to **Network → Static Address Binding**.
2. The header shows LAN subnet, DHCP pool, and current default gateway behavior.
3. Click **Add** to create a binding.
4. Fill:
   - Hostname (required on create, sets `dns=1`).
   - MAC (single unicast, hints from seen hosts).
   - Fixed IPv4 (must be in LAN subnet).
   - Gateway: "Inherit system" or enter custom IPv4 (must be in subnet).
   - "Also send as DNS" (only visible with custom gateway).
   - Lease time (empty = inherit pool).
5. **Save** in the modal only stages the change. Click **Save & Apply** on the page to commit.
6. On the client: release/renew DHCP (or reconnect). Static-IP clients are unaffected.

## UCI Examples

Inherit gateway (system default):

```
config host
	option name 'pc1'
	option mac '02:11:22:33:44:55'
	option ip '192.168.1.50'
	option leasetime 'infinite'
	option dns '1'
```

Custom gateway + DNS (uses a managed tag):

```
config tag 'lsgw_192_168_1_254'
	option lsgw_managed '1'
	list dhcp_option '3,192.168.1.254'
	list dhcp_option '6,192.168.1.254'

config host
	option name 'pc2'
	option mac '02:aa:bb:cc:dd:ee'
	option ip '192.168.1.60'
	option leasetime 'infinite'
	option dns '1'
	list tag 'lsgw_192_168_1_254'
```

## Notes & Limitations (v1)

- Only single-host static bindings. No range/gw_range rules.
- No modification of interface DHCP options, IPv6, RA, firewall, or policy routing.
- Advanced host records (multi-MAC, DUID, IPv6, `ip=ignore`, `match_tag`, `networkid`, `instance`, disabled, etc.) are read-only; edit them on the official DHCP page.
- Third-party tags that affect option 3/6 are reported as "decided by other rules".
- Tag reuse: only exact-matching managed tags (`lsgw_managed=1`, single option 3, optional single option 6) are reused. Name collisions get numeric suffixes.
- No automatic cleanup of unreferenced managed tags (harmless; they can be reused later).
- Hand-configured static IP clients ignore DHCP gateway entirely.
- If `option 121` (classless static routes) is present, client routing behavior may differ.
- When using custom gateway as DNS, the client may lose the main router's local name resolution.

## Recovery

Standard LuCI "Save & Apply" uses UCI delta + rollback on failure for most cases.

If the page is still reachable but DHCP is broken after apply:
1. Go to the page and remove or correct the offending entry, then Save & Apply.
2. Or from shell:
   ```sh
   uci revert dhcp
   /etc/init.d/dnsmasq restart
   ```
3. Reboot restores the last committed `/etc/config/dhcp`.

## Building both ipk and apk (CI / local)

This package declares `LUCI_PKGARCH:=all`. No architecture-specific compilation is performed.

- OpenWrt 24.10 SDK (or ImmortalWrt 24.10) → produces `.ipk`
- OpenWrt main / 25.x SDK (apk-tools 3) → produces `.apk`

GitHub Actions in this repo builds both on push to `main`.

## License

Apache-2.0
