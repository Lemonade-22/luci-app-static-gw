# luci-app-static-gw

OpenWrt / ImmortalWrt 的 LuCI 插件：给单台设备绑定固定 IPv4，并可单独指定这台设备的网关（DHCP option 3）和 DNS（option 6）。

> 简体中文 | [English](README.en.md)

## 功能

- 复用 `/etc/config/dhcp` 里原生的 `config host` 段，不另造数据格式
- 每台设备的网关 / DNS 通过受管 `config tag` 段实现（前缀 `lsgw_`，标记 `option lsgw_managed '1'`）
- 页头直接显示 LAN 网段与掩码、DHCP 动态池范围、当前生效的默认网关，以及运行中的版本号
- **在线设备**：读取实时 DHCPv4 租约表，一键「设为静态」把租约地址预填成绑定
- 表格展示：主机名 / MAC / 固定 IPv4 / 网关 / 状态
- 弹窗编辑带校验：
  - 单个单播 MAC，自动规范成小写冒号格式
  - IPv4 必须落在 LAN 子网内，且不能和路由器地址、其它绑定、活跃租约、所选网关冲突
  - 每台设备的网关（option 3）：留空表示继承系统网关，填写则必须在 LAN 子网内
  - 只有设置了自定义网关，才会出现「同时作为 DNS 下发」（option 6）
- 与官方页面互通：新增条目会出现在「网络 → DHCP/DNS → 静态地址分配」；官方的高级条目（多 MAC、DUID、IPv6、`match_tag` 等）只读展示，绝不改写
- 走 LuCI 标准的「保存并应用」流程，失败自动回滚
- 简体中文为源语言；英文界面需另装 i18n 包（不装也能用，插件内置了从 `.po` 生成的兜底文案）

## 环境要求

- 仅支持 fw4（nftables），没有支持 fw3 / iptables 的计划
- 一个运行中的 dnsmasq 实例，服务于单一 IPv4 静态子网的 `lan` 接口
- 推荐 `dnsmasq-full`（原版 dnsmasq 在简单场景也能用）

## 安装

### 从源码编译（SDK）

~~~sh
# 在 OpenWrt / ImmortalWrt SDK 里
make package/luci-app-static-gw/compile
~~~

用对应的 SDK 编译时，会同时产出 `.ipk`（24.10 / opkg）和 `.apk`（25+ / apk）。包是 `Architecture: all`。

### 预编译包（GitHub Releases）

每次推送到 `main` 都会构建四个包，并各自发布**独立的 release**（tag 形如 `v<版本>-r<发布号>-<UTC日期>-run<构建号>`），这样每次构建互不覆盖：

| 文件 | 适用 |
| --- | --- |
| `luci-app-static-gw_*_all.ipk` | OpenWrt 24.10 及更早（opkg） |
| `luci-i18n-static-gw-en_*_all.ipk` | 英文界面（opkg） |
| `luci-app-static-gw-*.apk` | OpenWrt snapshot / 25.x（apk） |
| `luci-i18n-static-gw-en-*.apk` | 英文界面（apk） |

四个包都是 `Architecture: all`，只含 LuCI 的 JS/JSON 和翻译，一个文件通吃所有设备。

### opkg 安装（24.10）

~~~sh
opkg install luci-app-static-gw_*_all.ipk
opkg install luci-i18n-static-gw-en_*_all.ipk   # 可选，英文界面
~~~

### apk 安装（snapshot / 25.x）

`.apk` 在构建时由 OpenWrt SDK 签名，那个签名密钥不随仓库分发，所以设备会报：

~~~
ERROR: /tmp/upload.apk: UNTRUSTED signature
~~~

（`apk install` 退出码 99。）

安装时加上放行参数：

~~~sh
apk add --allow-untrusted luci-app-static-gw-*.apk
apk add --allow-untrusted luci-i18n-static-gw-en-*.apk   # 可选
~~~

装完刷新 LuCI（或执行 `luci-reload`）。

## 使用

1. 打开 **网络 → 静态地址绑定**
2. 页头会显示 LAN 网段、DHCP 地址池、当前默认网关策略
3. 点 **添加**
4. 填写：
   - 主机名（新建必填，会置 `dns=1`）
   - MAC（单个单播地址，会从已见主机给出提示）
   - 固定 IPv4（必须在 LAN 子网内）
   - 网关：「继承系统」或填入自定义 IPv4（必须在子网内）
   - 「同时作为 DNS 下发」（仅在填了自定义网关时出现）
   - 租期（留空表示继承地址池）
5. 弹窗里的 **保存** 只是暂存，还要在页面上点 **保存并应用** 才真正生效
6. 客户端侧：释放 / 续租 DHCP 或重连即可。手动配了静态 IP 的客户端不受影响

## UCI 示例

继承系统网关：

~~~
config host
	option name 'pc1'
	option mac '02:11:22:33:44:55'
	option ip '192.168.1.50'
	option leasetime 'infinite'
	option dns '1'
~~~

自定义网关 + DNS（走受管 tag）：

~~~
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
~~~

## 说明与限制（v1）

- 只支持单主机静态绑定，不支持范围规则（`gw_range`）
- 不修改接口的 DHCP 选项、IPv6、RA、防火墙和策略路由
- 高级 host 记录（多 MAC、DUID、IPv6、`ip=ignore`、`match_tag`、`networkid`、`instance`、禁用状态等）只读，请到官方 DHCP 页面修改
- 影响 option 3 / 6 的第三方 tag 会显示为「由其它规则决定」
- tag 复用：只复用完全匹配的受管 tag（`lsgw_managed=1`、单个 option 3、可选的单个 option 6）；重名会加数字后缀
- 不会自动清理没被引用的受管 tag（无害，以后还能复用）
- 手动配置静态 IP 的客户端完全忽略 DHCP 下发的网关
- 如果存在 `option 121`（无类别静态路由），客户端路由行为可能不同
- 把自定义网关同时作为 DNS 下发时，客户端可能失去主路由的本地域名解析

## 出问题了怎么恢复

大多数情况下，LuCI 的「保存并应用」走 UCI delta，失败会自动回滚。

如果页面还能进、但应用后 DHCP 坏了：

1. 回到页面，删掉或改正出问题的那一条，再「保存并应用」
2. 或者用命令行：

   ~~~sh
   uci revert dhcp
   /etc/init.d/dnsmasq restart
   ~~~

3. 重启会恢复最后一次提交的 `/etc/config/dhcp`

## 同时构建 ipk 与 apk（CI / 本地）

本包声明 `LUCI_PKGARCH:=all`，不做架构相关编译。

- OpenWrt 24.10 SDK（或 ImmortalWrt 24.10）→ 产出 `.ipk`
- OpenWrt main / 25.x SDK（apk-tools 3）→ 产出 `.apk`

仓库里的 GitHub Actions 会在推送到 `main` 时把两者都构建出来。

## 许可证

Apache-2.0
