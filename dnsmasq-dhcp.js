const address = document.getElementById("address");
const output = document.getElementById("output");
const result = document.getElementById("result");
const button = document.getElementById("query");

var leases_file;
var lease_id = 0;
var hostfiles = {};

	//"dhcp-hostsdir": "/etc/dnsmasq/hosts.d",
var dnsmasq_config = {
	"dhcp-leasedb": "/var/lib/dnsmasq/dhcp_leases.db",
	"dhcp-leasefile": "/var/lib/dnsmasq/dnsmasq.leases",
	"locale": "en-US"
};


function dnsmasq_parse_config(text) {
	let configRE = new RegExp('^\s*([^#\n]+.*)$', 'mg');
	let matches = text.match(configRE);
	matches.forEach(function (line) {
		var key, value, items;
		items = line.split("=", 2);
		if(items.length > 1) {
			[key,value] = items;
		}else {
			[key] = items;
			value = true;
		}

		dnsmasq_config[key] = value;
	});
}

function populate_config() {
	var q1,q2,q3,q4;
	var m1,m2,m3,m4;
	var s1,s2,s3,s4;
	var c1,c2,c3,c4;
	var dhcp_subnet, dhcp_mask, dhcp_range_start, dhcp_range_end, dhcp_lease_time, dhcp_cidr;
	[dhcp_range_start,dhcp_range_end,dhcp_mask,dhcp_lease_time] = dnsmasq_config["dhcp-range"].split(",");

	[q1,q2,q3,q4] = dhcp_range_start.split('.');
	[m1,m2,m3,m4] = dhcp_mask.split('.');

	s1 = parseInt(q1) & parseInt(m1);
	s2 = parseInt(q2) & parseInt(m2);
	s3 = parseInt(q3) & parseInt(m3);
	s4 = parseInt(q4) & parseInt(m4);
	dhcp_subnet = s1 + "." + s2 + "." + s3 + "." + s4;

	c1 = parseInt(m1).toString(2);
	c2 = parseInt(m2).toString(2);
	c3 = parseInt(m3).toString(2);
	c4 = parseInt(m4).toString(2);
	dhcp_cidr = [c1,c2,c3,c4].join('').match(/1/g).length;

	$("#dhcp-subnet").text(dhcp_subnet+"/"+dhcp_cidr);
	$("#dhcp-range-start").text(dhcp_range_start);
	$("#dhcp-range-end").text(dhcp_range_end);
	$("#dhcp-lease-time").text(dhcp_lease_time);
	$("#dhcp-lease-max").text(dnsmasq_config["dhcp-lease-max"]);
	cockpit.file(dnsmasq_config["resolv-file"]).read().then(function(text) {
		var matches = text.matchAll(/nameserver ([^\s]+)/g);
		for(let match of matches){
			$("#dns-servers").append($("<p>").text(match[1]));
		}
	});
}


function dnsmasq_run_query() {
    cockpit.spawn(["sqlite3", "-csv", dnsmasq_config["dhcp-leasedb"], "SELECT ipaddr,mac,hostname,expire FROM leases"])
        .then(update_leases)
        .catch(update_failed);
}

function update_failed(data) {
}

function read_hostfiles() {
	return cockpit.script("sed -s '' "+dnsmasq_config["dhcp-hostsdir"]+"/*").then(parse_hostfiles).catch(update_failed);
}
function read_config() {
	return cockpit.file("/etc/dnsmasq.conf").read().then(dnsmasq_parse_config);
}

function parse_hostfiles(data) {
	data.split("\n").forEach(function(line) {
		var id = lease_id++;
		var hostname,ipaddr,mac;
		[mac,ipaddr,hostname] = line.split(",");
		add_reservation(hostname,ipaddr,mac,id);
	});
}

function add_reservation(hostname,ipaddr,mac,id) {
	var resv_tbody = $('#dnsmasq-resv tbody');
	var row = $('<tr id="resv_'+id+'">').append($('<td>').append($('<span class="hostname">').text(hostname)),
				$('<td>').append($('<span class="ipaddr">').text(ipaddr)),
				$('<td>').append($('<span class="mac">').text(mac)),
				$('<td>').append($('<i class="fa fa-trash text-secondary"></i>')).click(function() {remove_lease(hostname);})
		);
	resv_tbody.append(row);
	row.click(function() { $("input.resv_hostname").val(hostname);
				$("input.resv_ipaddr").val(ipaddr);
				$("input.resv_mac").val(mac);
	});
	hostfiles[hostname] = {"hostname": hostname, "mac": mac, "ipaddr": ipaddr,"id":id};
}

function save_lease() {
	var id; 
	var hostname, mac, ipaddr;
	hostname = $("input.resv_hostname").val();
	ipaddr = $("input.resv_ipaddr").val();
	mac = $("input.resv_mac").val();

	if(hostname in hostfiles) {
		id = hostfiles[hostname].id;
		$("#resv_"+id).remove();
	} else {
		id = lease_id++;
	};

	add_reservation(hostname,ipaddr,mac,id);
	cockpit.file(dnsmasq_config["dhcp-hostsdir"]+"/"+hostname, {superuser:"require"}).replace(mac+","+ipaddr+","+hostname).then(dnsmasq_run_query);
}

function remove_lease(hostname) {
	id = hostfiles[hostname].id;
	$("#resv_"+id).remove();
	delete hostfiles[hostname];
	cockpit.file(dnsmasq_config["dhcp-hostsdir"]+"/"+hostname, {superuser:"require"}).replace(null).then(dnsmasq_run_query);
}

function update_leases(data) {
	var lease_tbody;
	
	lease_tbody = $('#dnsmasq-leases tbody');
	lease_tbody.empty();

	data.split("\n").forEach(async function (line) {
		if(line == "") return;
		var [ipaddr, mac, hostname, expiretime] = line.split(",");
		var expire  = new Date(expiretime*1000).toLocaleString(dnsmasq_config["locale"]);
		var row = $('<tr>').append($('<td>').append($('<span class="hostname">').text(hostname)),
					$('<td>').append($('<span class="ipaddr">').text(ipaddr)),
					$('<td>').append($('<span class="mac">').text(mac)),
					$('<td>').text(expire)
				);
		
		lease_tbody.append(row);

		row.click(function() { $("input.resv_hostname").val(hostname);
					$("input.resv_ipaddr").val(ipaddr);
					$("input.resv_mac").val(mac);
		});

	});

}





$(document).ready(function() {
	$(".save_resv").click(function() {save_lease();})
	read_config().then(populate_config).then(read_hostfiles).then(function() {
		leases_file = cockpit.file(dnsmasq_config["dhcp-leasefile"]).watch(dnsmasq_run_query)
	});
});

// Send a 'init' message.  This tells integration tests that we are ready to go
cockpit.transport.wait(function() { });
