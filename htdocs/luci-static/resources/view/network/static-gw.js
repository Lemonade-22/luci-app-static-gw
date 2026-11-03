'use strict';
'require view';
'require form';
'require rpc';
'require uci';
'require ui';
'require network';
'require validation';

const TAG_PREFIX = 'lsgw_';
const MANAGED_MARK = 'lsgw_managed';

const callHostHints = rpc.declare({
	object: 'luci-rpc',
	method: 'getHostHints',
	expect: { '': {} }
});

const callDHCPLeases = rpc.declare({
	object: 'luci-rpc',
	method: 'getDHCPLeases',
	expect: { '': {} }
});

const callNetworkDevices = rpc.declare({
	object: 'luci-rpc',
	method: 'getNetworkDevices',
	expect: { '': {} }
});

function isValidMAC(s) {
	if (!s) return true;
	const m = String(s).trim().toLowerCase().replace(/-/g, ':');
	if (!m.match(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/)) return _('Expecting a valid MAC address');
	return true;
}

function normalizeMAC(s) {
	if (!s) return null;
	const m = String(s).trim().toLowerCase().replace(/-/g, ':');
	return m.match(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/) ? m : null;
}

function isUnicastMAC(mac) {
	if (!mac) return false;
	const first = parseInt(mac.split(':')[0], 16);
	if (first & 1) return false;           // multicast
	if (mac === '00:00:00:00:00:00') return false;
	if (mac === 'ff:ff:ff:ff:ff:ff') return false;
	return true;
}

function calculateNetwork(addr, mask) {
	const a = validation.parseIPv4(String(addr));
	let m = validation.parseIPv4(String(mask));
	if (!a || !m) return null;
	return [
		[a[0] & (m[0] >>> 0 & 255), a[1] & (m[1] >>> 0 & 255),
		 a[2] & (m[2] >>> 0 & 255), a[3] & (m[3] >>> 0 & 255)].join('.'),
		m.join('.')
	];
}

function ipInSubnet(ip, net, mask) {
	const n = calculateNetwork(ip, mask);
	return n && n[0] === net;
}

function isNetworkOrBroadcast(ip, net, mask) {
	const n = calculateNetwork(ip, mask);
	if (!n) return true;
	const netInt = validation.parseIPv4(n[0]);
	const maskInt = validation.parseIPv4(n[1]);
	const ipInt = validation.parseIPv4(ip);
	if (!netInt || !maskInt || !ipInt) return true;
	const networkAddr = [
		netInt[0] & (maskInt[0] >>> 0 & 255),
		netInt[1] & (maskInt[1] >>> 0 & 255),
		netInt[2] & (maskInt[2] >>> 0 & 255),
		netInt[3] & (maskInt[3] >>> 0 & 255)
	].join('.');
	const bcast = [
		(netInt[0] | ((~maskInt[0]) >>> 0 & 255)),
		(netInt[1] | ((~maskInt[1]) >>> 0 & 255)),
		(netInt[2] | ((~maskInt[2]) >>> 0 & 255)),
		(netInt[3] | ((~maskInt[3]) >>> 0 & 255))
	].join('.');
	return ip === networkAddr || ip === bcast;
}

function tagNameFor(gw, withDns) {
	return TAG_PREFIX + gw.replace(/\./g, '_') + (withDns ? '_dns' : '');
}

function isManagedTag(t) {
	return t && String(t[MANAGED_MARK]) === '1';
}

function tagHasOption(t, code, value) {
	const opts = L.toArray(t && t.dhcp_option);
	const needle = code + ',' + value;
	return opts.some(o => String(o) === needle);
}

function getManagedGatewayFromHost(sid) {
	const tags = L.toArray(uci.get('dhcp', sid, 'tag'));
	let managedGw = null, hasDns = false, hasThirdParty = false;
	for (const tn of tags) {
		const t = uci.get('dhcp', tn);
		if (!t) continue;
		if (isManagedTag(t)) {
			const o3 = L.toArray(t.dhcp_option).find(o => String(o).match(/^3,/));
			if (o3) {
				managedGw = o3.split(',')[1];
				hasDns = !!L.toArray(t.dhcp_option).find(o => String(o).match(/^6,/));
			}
		} else {
			hasThirdParty = true;
		}
	}
	if (managedGw) return { mode: 'custom', gw: managedGw, dns: hasDns };
	if (hasThirdParty) return { mode: 'other' };
	return { mode: 'inherit' };
}

function findReusableTag(gw, withDns) {
	for (const t of uci.sections('dhcp', 'tag')) {
		if (!isManagedTag(t)) continue;
		if (t.force || t.match_tag || t.networkid || t.instance) continue;
		const opts = L.toArray(t.dhcp_option);
		if (withDns) {
			if (opts.length !== 2) continue;
			if (!opts.includes('3,' + gw) || !opts.includes('6,' + gw)) continue;
		} else {
			if (opts.length !== 1) continue;
			if (opts[0] !== '3,' + gw) continue;
		}
		return t['.name'];
	}
	return null;
}

function ensureManagedTag(gw, withDns) {
	let name = findReusableTag(gw, withDns);
	if (name) return name;

	const base = tagNameFor(gw, withDns);
	name = base;
	let suffix = 2;
	while (uci.get('dhcp', name)) {
		name = base + '_' + suffix;
		suffix++;
	}

	const sid = uci.add('dhcp', 'tag', name);
	uci.set('dhcp', name, MANAGED_MARK, '1');
	if (withDns) {
		uci.set('dhcp', name, 'dhcp_option', ['3,' + gw, '6,' + gw]);
	} else {
		uci.set('dhcp', name, 'dhcp_option', '3,' + gw);
	}
	return name;
}

function setHostGateway(sid, gw, withDns) {
	const curTags = L.toArray(uci.get('dhcp', sid, 'tag'));
	const other = curTags.filter(tn => {
		const t = uci.get('dhcp', tn);
		return t && !isManagedTag(t);
	});

	if (gw) {
		const tagName = ensureManagedTag(gw, withDns);
		other.push(tagName);
	}

	if (other.length > 0) {
		uci.set('dhcp', sid, 'tag', other);
	} else {
		uci.unset('dhcp', sid, 'tag');
	}
}

function hostIsEditable(sid) {
	const h = uci.get('dhcp', sid);
	if (!h) return false;
	if (h.ignore === '1' || h.disabled === '1') return false;
	if (h.duid || h.ip6addr || h.ip6prefix || h.hostid) return false;
	if (h.match_tag || h.networkid || h.instance) return false;
	if (h.ip === 'ignore') return false;

	const macs = L.toArray(h.mac);
	if (macs.length > 1) return false;

	const tags = L.toArray(h.tag);
	for (const tn of tags) {
		const t = uci.get('dhcp', tn);
		if (t && !isManagedTag(t)) return false;
	}

	// Only allow simple single-MAC IPv4 records
	return true;
}

function maskToPrefix(mask) {
	const p = validation.parseIPv4(String(mask));
	if (!p) return null;
	let bits = 0;
	for (const octet of p) {
		let n = octet;
		while (n & 0x80) { bits++; n = (n << 1) & 0xff; }
	}
	return bits;
}

function getLanTopology() {
	const lanNet = uci.get('network', 'lan');
	if (!lanNet) {
		return { ready: false, reason: _('LAN interface not found in /etc/config/network') };
	}

	// Static is OpenWrt's default protocol; many configs omit `option proto`.
	const proto = lanNet.proto || 'static';
	if (proto !== 'static') {
		return { ready: false, reason: _('LAN interface is not configured as static IPv4') + ' (' + proto + ')' };
	}

	// `ipaddr` is either "192.168.1.1/24" or a bare address with a separate
	// `netmask` option - accept both forms.
	let lanIp = null, lanMask = null;
	const cidr = L.toArray(lanNet.ipaddr || lanNet.ipaddrs)[0];
	if (cidr) {
		const parts = String(cidr).split('/');
		lanIp = parts[0];
		if (parts.length > 1) {
			lanMask = network.prefixToMask(parseInt(parts[1], 10));
		}
	}
	if (!lanIp) {
		return { ready: false, reason: _('LAN has no IPv4 address configured') };
	}
	lanMask = lanMask || lanNet.netmask || '255.255.255.0';

	const netInfo = calculateNetwork(lanIp, lanMask);
	if (!netInfo) {
		return { ready: false, reason: _('Cannot determine LAN subnet') + ' (' + lanIp + '/' + lanMask + ')' };
	}

	// Locate the dnsmasq DHCPv4 section that serves lan.
	const allDhcp = uci.sections('dhcp', 'dhcp');
	const isLan = s => (s.interface || s['.name']) === 'lan';
	let dhcpSection = allDhcp.find(s => isLan(s) && s.ignore !== '1');
	// A stock anonymous `config dhcp` without `interface` applies to lan.
	if (!dhcpSection) {
		dhcpSection = allDhcp.find(s => !s.interface && s.ignore !== '1' && s['.anonymous'] !== false);
	}
	// Still nothing? Accept an anonymous non-ignored section (single-DHCP LANs).
	if (!dhcpSection) {
		dhcpSection = allDhcp.find(s => !s.interface && s.ignore !== '1');
	}

	const dnsmasqSections = uci.sections('dhcp', 'dnsmasq').filter(s => s.ignore !== '1');
	if (dnsmasqSections.length > 1) {
		return {
			ready: false,
			reason: _('Multiple dnsmasq instances detected') +
				' (' + dnsmasqSections.map(s => s['.name'] || '[anonymous]').join(', ') + ')'
		};
	}

	// Diagnostics for the "why is editing disabled" case.
	const diag = [
		'lan=' + lanIp + '/' + (maskToPrefix(lanMask) ?? '?') + ' proto=' + proto,
		'dhcp sections=' + (allDhcp.length ? allDhcp.map(s => (s['.name'] || '?') + ':' + (s.interface || '-')).join(', ') : 'none'),
		'dnsmasq instances=' + dnsmasqSections.length
	].join('; ');

	return {
		ready: true,
		// When the pool section cannot be identified we still allow editing:
		// this app only writes global `config host` / `config tag` sections,
		// so it does not depend on a specific `config dhcp` block.
		poolKnown: !!dhcpSection,
		diag: diag,
		lanIp,
		lanMask,
		lanPrefix: maskToPrefix(lanMask),
		lanNet: netInfo[0],
		dhcpSection: dhcpSection ? dhcpSection['.name'] : null,
		start: dhcpSection ? dhcpSection.start : null,
		limit: dhcpSection ? dhcpSection.limit : null,
		leasetime: dhcpSection ? dhcpSection.leasetime : null
	};
}

function getEffectiveDefaultGateway(topology) {
	if (!topology.ready) return _('System default (undetermined)');

	const dhcpSection = uci.get('dhcp', topology.dhcpSection);
	if (dhcpSection) {
		const opts = L.toArray(dhcpSection.dhcp_option);
		for (const o of opts) {
			if (String(o).match(/^3,/)) return String(o).split(',')[1];
		}
	}
	// Fallback to LAN address (dnsmasq default)
	return topology.lanIp;
}

function getDynamicPool(topology) {
	if (!topology.ready || !topology.start || !topology.limit) return null;
	const start = parseInt(topology.start);
	const limit = parseInt(topology.limit);
	if (isNaN(start) || isNaN(limit)) return null;
	const first = calculateNetwork(topology.lanIp, topology.lanMask);
	if (!first) return null;
	const base = validation.parseIPv4(first[0]);
	if (!base) return null;
	const firstIp = ((base[0] << 24) | (base[1] << 16) | (base[2] << 8) | base[3]) + start;
	const lastIp = firstIp + limit - 1;
	const toIp = n => [(n>>>24)&255, (n>>>16)&255, (n>>>8)&255, n&255].join('.');
	return toIp(firstIp) + ' – ' + toIp(lastIp);
}

return view.extend({
	load() {
		return Promise.all([
			uci.load('dhcp'),
			uci.load('network'),
			callHostHints(),
			callDHCPLeases(),
			callNetworkDevices(),
			network.getNetworks()
		]);
	},

	render([hosts, leases, devices, nets]) {
		const top = getLanTopology();
		const defaultGw = getEffectiveDefaultGateway(top);
		const pool = getDynamicPool(top);

		let m, s, o;

		m = new form.Map('dhcp', _('Static Address Binding'),
			_('Bind fixed IPv4 addresses to MAC and optionally override gateway (option 3) and DNS (option 6) for individual clients.'));

		if (!top.ready) {
			const note = m.section(form.TypedSection, '_info');
			note.anonymous = true;
			note.cfgsections = () => ['_info'];
			o = note.option(form.DummyValue, '_warn');
			o.rawhtml = true;
			o.default = E('div', { class: 'alert-message warning' }, [
				E('strong', _('Editing disabled: ')), top.reason
			]);
			return m.render();
		}

		const header = m.section(form.TypedSection, '_header');
		header.anonymous = true;
		header.cfgsections = () => ['_header'];
		o = header.option(form.DummyValue, '_info');
		o.rawhtml = true;

		const headerNodes = [
			E('div', { class: 'cbi-section-descr' }, [
				E('strong', _('LAN: ')), top.lanIp + '/' + (top.lanPrefix != null ? top.lanPrefix : '?'),
				E('br'),
				E('strong', _('DHCP pool: ')), pool || _('not detected - inheriting interface configuration'),
				E('br'),
				E('strong', _('Default gateway: ')), defaultGw
			])
		];

		// Editing stays possible without a `config dhcp` block: this app only
		// writes global host/tag sections. Say so instead of silently limiting.
		if (!top.poolKnown) {
			headerNodes.push(E('div', { class: 'alert-message notice' }, [
				E('strong', _('Notice: ')),
				_('No DHCP pool section for LAN could be identified, so the pool range is unknown. Bindings can still be created and edited.'),
				E('br'),
				E('small', { class: 'muted' }, top.diag)
			]));
		}

		o.default = E('div', {}, headerNodes);

		s = m.section(form.GridSection, 'host', _('Static Bindings'));
		s.anonymous = true;
		s.addremove = true;
		s.sortable = true;
		s.nodescriptions = true;
		s.max_cols = 5;
		s.modaltitle = _('Edit static binding');

		// Hostname
		o = s.option(form.Value, 'name', _('Hostname'));
		o.validate = function(section_id, value) {
			if (!value && !this.section.formvalue(section_id, 'mac'))
				return _('Hostname or MAC address is required');
			return true;
		};
		o.write = function(section, value) {
			uci.set('dhcp', section, 'name', value);
			uci.set('dhcp', section, 'dns', '1');
		};
		o.remove = function(section) {
			uci.unset('dhcp', section, 'name');
			uci.unset('dhcp', section, 'dns');
		};

		// MAC (single)
		o = s.option(form.Value, 'mac', _('MAC Address'));
		o.datatype = 'macaddr';
		o.validate = function(section_id, value) {
			const norm = normalizeMAC(value);
			if (!norm) return _('Invalid MAC address');
			if (!isUnicastMAC(norm)) return _('MAC must be a valid unicast address');
			// conflict with other hosts
			for (const h of uci.sections('dhcp', 'host')) {
				if (h['.name'] === section_id) continue;
				const otherMacs = L.toArray(h.mac).map(normalizeMAC);
				if (otherMacs.includes(norm))
					return _('MAC address already used by another binding');
			}
			return true;
		};
		o.cfgvalue = function(section) {
			const v = uci.get('dhcp', section, 'mac');
			return normalizeMAC(L.toArray(v)[0]) || '';
		};
		o.write = function(section, value) {
			const norm = normalizeMAC(value);
			uci.set('dhcp', section, 'mac', norm);
		};

		// Fixed IP
		o = s.option(form.Value, 'ip', _('Fixed IPv4'));
		o.datatype = 'ip4addr';
		o.validate = function(section_id, value) {
			if (!value) return _('Fixed IPv4 address is required');
			if (!ipInSubnet(value, top.lanNet, top.lanMask))
				return _('Address is outside the LAN subnet');
			if (isNetworkOrBroadcast(value, top.lanNet, top.lanMask))
				return _('Cannot use network or broadcast address');
			if (value === top.lanIp)
				return _('Cannot bind the router address itself');

			// conflict with other bindings
			for (const h of uci.sections('dhcp', 'host')) {
				if (h['.name'] === section_id) continue;
				if (h.ip === value)
					return _('IPv4 already used by another binding');
			}

			// check active leases (best effort)
			const leaseList = leases && leases.dhcp_leases ? leases.dhcp_leases : [];
			for (const l of leaseList) {
				if (l.ipaddr === value) {
					const thisMac = normalizeMAC(this.section.formvalue(section_id, 'mac'));
					if (thisMac && normalizeMAC(l.macaddr) !== thisMac)
						return _('Address currently leased to another device');
				}
			}
			return true;
		};

		// Gateway (synthetic)
		o = s.option(form.Value, '__gw', _('Gateway'));
		o.modalonly = false;
		o.cfgvalue = function(section_id) {
			if (!hostIsEditable(section_id)) {
				const info = getManagedGatewayFromHost(section_id);
				if (info.mode === 'custom') return info.gw + (info.dns ? ' (+DNS)' : '');
				if (info.mode === 'other') return _('Decided by other rules');
				return _('Inherit system');
			}
			const info = getManagedGatewayFromHost(section_id);
			if (info.mode === 'custom') return info.gw;
			return '';
		};
		o.write = function(section_id, value) {
			if (!hostIsEditable(section_id)) return;
			const gw = (value && value.trim()) ? value.trim() : null;
			const dnsFlag = this.section.formvalue(section_id, '__gw_dns') === '1';
			setHostGateway(section_id, gw, dnsFlag);
		};
		o.remove = function(section_id) {
			if (!hostIsEditable(section_id)) return;
			setHostGateway(section_id, null, false);
		};
		o.validate = function(section_id, value) {
			if (!value || value === '') return true; // inherit
			if (!ipInSubnet(value, top.lanNet, top.lanMask))
				return _('Gateway must be inside the LAN subnet');
			if (isNetworkOrBroadcast(value, top.lanNet, top.lanMask))
				return _('Gateway cannot be network or broadcast address');
			const fixedIp = this.section.formvalue(section_id, 'ip');
			if (value === fixedIp)
				return _('Gateway cannot be the same as the fixed IP');
			return true;
		};

		// DNS flag (only meaningful with custom gateway)
		o = s.option(form.Flag, '__gw_dns', _('Also send as DNS'));
		o.modalonly = true;
		o.default = '0';
		o.depends('__gw', '', true); // show only when __gw is not empty
		o.write = function() {}; // handled in __gw.write
		o.cfgvalue = function(section_id) {
			const info = getManagedGatewayFromHost(section_id);
			return (info.mode === 'custom' && info.dns) ? '1' : '0';
		};

		// Leasetime
		o = s.option(form.Value, 'leasetime', _('Lease time'));
		o.modalonly = true;
		o.rmempty = true;
		o.placeholder = _('Inherit from pool');
		o.value('5m', _('5 minutes'));
		o.value('30m', _('30 minutes'));
		o.value('1h', _('1 hour'));
		o.value('12h', _('12 hours'));
		o.value('24h', _('24 hours'));
		o.value('7d', _('7 days'));
		o.value('infinite', _('Infinite'));
		o.validate = function(section_id, value) {
			if (!value) return true;
			if (value === 'infinite') return true;
			if (!value.match(/^\d+[smhd]$/)) return _('Invalid lease time format (e.g. 12h, 7d)');
			return true;
		};

		// Read-only status column (for non-editable records)
		o = s.option(form.DummyValue, '__status', _('Status'));
		o.modalonly = false;
		o.cfgvalue = function(section_id) {
			if (hostIsEditable(section_id)) return '';
			return E('em', { class: 'muted' }, _('Read-only (manage in official DHCP page)'));
		};

		// Make non-editable rows visually readonly
		s.cfgvalue = function(section_id) {
			const orig = form.GridSection.prototype.cfgvalue;
			if (!hostIsEditable(section_id)) {
				// disable editing for this row
				this.children.forEach(child => {
					if (child.option !== '__status') child.readonly = true;
				});
			}
			return orig.apply(this, arguments);
		};

		return m.render();
	}
});
