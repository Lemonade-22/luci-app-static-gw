include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-static-gw
PKG_VERSION:=1.0.0
PKG_RELEASE:=1

LUCI_TITLE:=Static Address Binding (per-host gateway/DNS)
LUCI_DEPENDS:=+luci-base +rpcd-mod-luci
LUCI_PKGARCH:=all

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=Lemonade-22

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
