import schema from '../res/netgen-conf-schema';
import djv from 'djv';

var NetGen = (function () {
    const r_ipv4 = /^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/;
    const r_cidr = /^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])(\/([0-9]|[1-2][0-9]|3[0-2]))$/;

    var use_tap = false;

    /* Printer: code print helper with indentation */
    var Printer = function () {
        var buffer = [];
        var indent = 0;

        return {
            indent: function() {
                indent += 4;
            },
            unindent: function() {
                if (indent >= 4) indent -= 4;
            },
            print: function(line) {
                buffer.push((indent > 0 ? ' '.repeat(indent) : '') + line);
            },
            get: function() {
                return buffer;
            }
        }
    };

    /* Includes: header manager */
    var Includes = function () {
        var inc = [];

        return {
            add: function (header, global) {
                var line = `#include ${global ? `<${header}>` : `"${header}`}"`;
                if (inc.includes(line)) return false;
                else return inc.push(line);
            },
            install: function (printer) {
                inc.forEach(i => printer.print(i));
            }
        };
    };

    /* MAC address allocator */
    var EUI48AddressGenerator = function () {
        var counter = 1;
        return function () {
            return ('00'.repeat(6) + (counter++).toString(16)).slice(-12).match(/../g).join(':');
        };
    };

    const djv_env = new djv();
    djv_env.addSchema('netgen-conf', schema);

    /* preprocess: checking / metadata collect */
    var preprocess = function (conf) {
        var includes = new Includes();

        var err = djv_env.validate('netgen-conf', conf);
        if (typeof err !== 'undefined') {
            return {ok: false, errors: [`pre-check failed: ${JSON.stringify(err)}`]}
        }

        var errors = [];
        var nets = [];
        var instances = [];
        var ghosts = [];
        var socketpair_names = [];

        if (conf.networks) {
            conf.networks.forEach ((network, n) => {
                includes.add('ns3/csma-module.h');
                var path = `conf.networks[${n}]`;

                if (nets.includes(network.id)) errors.push(`Dulipicated network id "${network.id}" at ${path}.`);
                else nets.push(network.id);

                if (network.tap && network.tap.mode) {
                    use_tap = true;
                    includes.add('ns3/tap-bridge-module.h');
                    if(!r_cidr.test(network.tap.address)) 
                        errors.push(`Invalid TAP address "${network.tap.address}" at ${path}.tap.`); 
                }

                if (instances.every(id => id != network.instance_id))
                    instances.push(network.instance_id);
            })
        }

        if (conf.routers) {
            conf.routers.forEach ((router, n) => {
                var path = `conf.routers[${n}]`;
                var devs = [];

                if (!r_ipv4.test(router.router_id)) {
                    errors.push(`Invalid BGP ID "${router.router_id}" at ${path}.`);
                }

                if (router.devices) {
                    router.devices.forEach((device, n) => {
                        var _path = `${path}.devices[${n}]`;
                        if (devs.includes(device.id)) errors.push(`Dulipicated device id "${device.id}" at ${_path}.`);
                        else devs.push(device.id);
                        if (device.type == 'default') {
                            includes.add('ns3/csma-module.h');
                            if (!nets.includes(device.network)) errors.push(`Unknow network id "${device.network}" at ${_path}.`);
                            else {
                                var net_instance = conf.networks.filter(net => net.id == device.network)[0].instance_id;
                                if (net_instance != router.instance_id) {
                                    includes.add('ns3/fd-net-device-module.h');
                                    includes.add('ns3/bridge-module.h');
                                    // HERE
                                    var name = `${router.id}_${device.id}`;
                                    var conn_name = `cil_${name}`;
                                    device.xnet = true;
                                    device.fd = `${conn_name}[0]`;
                                    ghosts.push({'instance_id': net_instance, 'network': device.network, fd: `${conn_name}[1]`, name});
                                    socketpair_names.push(conn_name);
                                }
                            }
                            if (device.addresses.length <= 0) errors.push(`No addresses provided for "${device.id}" at ${_path}.`);
                            device.addresses.forEach((address, n) => {
                                var __path = `${_path}.addresses[${n}]`;
                                if (!r_cidr.test(address))
                                errors.push(`Invalid address "${address}" for "${device.id}" at ${__path}.`); 
                            });
                        }
                        if (device.type == 'p2p') {
                            /* p2p device configured by peer, skip */
                            if (device.set_by_peer) return;

                            var peers = conf.routers.filter(router => router.id == device.peer);
                            if (peers.length < 1) errors.push(`Unknow peer '${device.peer}' at ${_path}.`);
                            if (peers.length > 1) errors.push(`More then one peer with id '${device.peer}' at ${_path}.`);
                            if (peers.length != 1) return;

                            var peer = peers[0];
                            if (router.id == device.peer) errors.push(`p2p peer is self at ${_path}.`);

                            var peer_devs = peer.devices.filter(device => device.type == 'p2p' && device.peer == router.id);
                            if (peer_devs.length < 1) errors.push(`peer '${device.peer}' does not have a p2p link with this node at ${_path}.`);
                            if (peer_devs.length > 1) errors.push(`peer '${device.peer}' has more then one p2p link with this node at ${_path}.`);
                            if (peer_devs.length != 1) return;

                            /* configure both self and peer device */
                            var peer_dev = peer_devs[0];
                            peer_dev.set_by_peer = true;
                            var name = `${router.id}_${device.peer}`;
                            var conn_name = `p2p_${name}`;

                            if (router.instance_id != peer.instance_id) {
                                includes.add('ns3/fd-net-device-module.h');
                                peer_dev.xnet = true;
                                device.xnet = true;
                                peer_dev.fd = `${conn_name}[1]`;
                                device.fd = `${conn_name}[0]`;
                                socketpair_names.push(conn_name);
                            } else {
                                includes.add('ns3/point-to-point-module.h');
                                device.p2p_channel = conn_name;
                                peer_dev.p2p_channel = conn_name;
                            }

                        }
                    })
                }

                if (router.routes) {
                    router.routes.forEach((route, n) => {
                        var _path = `${path}.routes[${n}]`;
                        if (!r_cidr.test(route.prefix)) // FIXME: a valid CIDR may not be a valid prefix.
                            errors.push(`Invalid prefix "${route.prefix}" at ${_path}.`);
                        if (!r_ipv4.test(route.nexthop))
                            errors.push(`Invalid nexthop "${route.nexthop}" at ${_path}.`);
                    });
                }

                if (router.peers) {
                    router.peers.forEach((peer, n) => {
                        var _path = `${path}.peers[${n}]`;
                        if (!r_ipv4.test(peer.address))
                            errors.push(`Invalid peer address "${peer.address}" at ${_path}.`);
                        if (peer.in_filter && peer.in_filter.filter) {
                            peer.in_filter.filter.forEach((filter, n) => {
                                var __path = `${_path}.in_filter.filter[${n}]`;
                                if (!r_cidr.test(filter.prefix))
                                errors.push(`Invalid prefix "${filter.prefix}" at ${__path}.`);
                            });
                        }
                        if (peer.out_filter && peer.out_filter.filter) {
                            peer.out_filter.filter.forEach((filter, n) => {
                                var __path = `${_path}.out_filter.filter[${n}]`;
                                if (!r_cidr.test(filter.prefix))
                                errors.push(`Invalid prefix "${filter.prefix}" at ${__path}.`);
                            });
                        }
                    })
                }

                if (router.applications) {
                    router.applications.forEach((app, n) => {
                        var _path = `${path}.applications[${n}]`;
                        switch (app.type) {
                            case 'ping':
                                includes.add('ns3/internet-apps-module.h');
                                if (!r_ipv4.test(app.remote)) errors.push(`Invalid ping remote address "${app.remote}" at ${_path}.`);
                        }
                    });
                }

                if (instances.every(id => id != router.instance_id))
                    instances.push(router.instance_id);
            });
        }

        if (errors.length > 0) return {ok: false, errors};
        else return {ok: true, instances, ghosts, socketpair_names, configuration: conf, includes};

    };

    var generate = function (conf) {
        var preprocess_rslt = preprocess(conf);
        if (!preprocess_rslt.ok) return preprocess_rslt;

        var code = new Printer();
        var eui48 = EUI48AddressGenerator();
        var {instances, ghosts, socketpair_names, includes} = preprocess_rslt;

        var generate_dev_config = function(network, node, device, addrs, type) {
            var device_name = `dev_${node}_${device}`;
            code.print(`// begin netdevice config for ${node}, device ${device}.`);
            if (type == 'csma') code.print(`Ptr<CsmaNetDevice> ${device_name} = CreateObject<CsmaNetDevice> ();`);
            if (type == 'fd') {
                code.print(`Ptr<FdNetDevice> ${device_name} = CreateObject<FdNetDevice> ();`);
                code.print(`${device_name}->SetFileDescriptor (${network});`);
            }
            if (type == 'p2p') {
                code.print(`Ptr<PointToPointNetDevice> ${device_name} = CreateObject<PointToPointNetDevice> ();`);
                code.print(`${device_name}->SetDataRate (DataRate (0xffffffff));`);
            }
            code.print(`${device_name}->SetAddress (Mac48Address ("${eui48()}"));`);
            code.print(`${node}->AddDevice(${device_name});`);
            if (type == 'csma' || type == 'p2p') {
                code.print(`${device_name}->SetQueue (CreateObject<DropTailQueue<Packet>> ());`);
                code.print(`${device_name}->Attach (${network});`);
            }
            code.print(`int32_t devid_${device_name} = ipv4_${node}->AddInterface (${device_name});`);
            addrs.forEach(addr => {
                var [address, netmask] = addr.split('/');
                code.print(`ipv4_${node}->AddAddress(devid_${device_name}, Ipv4InterfaceAddress (Ipv4Address ("${address}"), Ipv4Mask ("/${netmask}")));`);
            });
            code.print(`ipv4_${node}->SetMetric (devid_${device_name}, 1);`);
            code.print(`ipv4_${node}->SetUp (devid_${device_name});`);
            code.print(`// end netdevice config for ${node}, device ${device}.`);
            return {friendly_name: device, real_name: device_name, interface_id: `devid_${device_name}`};
        };

        code.print('#include <sys/socket.h>');
        code.print('#include <sys/wait.h>');
        code.print('#include <errno.h>');
        code.print('#include <unistd.h>');
        code.print('#include "ns3/core-module.h"');
        //code.print('#include "ns3/csma-module.h"');
        code.print('#include "ns3/internet-module.h"');
        code.print('#include "ns3/bgp-helper.h"');
        code.print('#include "ns3/ipv4-address.h"');
        code.print('#include "ns3/drop-tail-queue.h"');
        //code.print('#include "ns3/fd-net-device-module.h"');
        //code.print('#include "ns3/bridge-module.h"');
        //code.print('#include "ns3/point-to-point-module.h"');
        //code.print('#include "ns3/internet-apps-module.h"');
        includes.install(code);
        code.print('using namespace ns3;');
        code.print('int main (void) {');
        code.indent();
        code.print('GlobalValue::Bind ("SimulatorImplementationType", StringValue ("ns3::RealtimeSimulatorImpl"));');
        code.print('GlobalValue::Bind ("ChecksumEnabled", BooleanValue (true));');

        if (conf.options && conf.options.log_components) {
            conf.options.log_components.forEach(component => {
                code.print(`LogComponentEnable("${component}", LOG_LEVEL_ALL);`);
            });
        }

        code.print('// begin socketpairs init.');
        socketpair_names.forEach(name => {
            code.print(`int ${name}[2];`);
            code.print(`if (socketpair (AF_UNIX, SOCK_DGRAM, 0, ${name}) < 0) {`);
            code.indent();
            code.print('fprintf(stderr, "socketpair() failed: %s\\n", strerror(errno));');
            code.print('return 1;');
            code.unindent();
            code.print('}');
        });
        code.print('// end socketpairs init.');

        code.print('InternetStackHelper internet;');
        if (use_tap) code.print('TapBridgeHelper tapBridge;')
        code.print('pid_t pid;');

        instances.forEach(instance => {
            code.print('pid = fork();');
            code.print('if (pid < 0) {');
            code.indent();
            code.print('fprintf(stderr, "fork() failed: %s\\n", strerror(errno));');
            code.print('return 1;');
            code.unindent();
            code.print('}');

            code.print('if (pid > 0)');
            code.indent();
            code.print(`fprintf(stderr, "started instance ${instance}, pid: %d.\\n", pid);`);
            code.unindent();

            code.print(`// begin instance ${instance} setup.`);
            code.print('if (pid == 0) {');
            code.indent();

            code.print('// begin nets setup.');
            if (conf.networks) conf.networks.filter(net => net.instance_id == instance).forEach(net => {
                code.print(`Ptr<CsmaChannel> net_${net.id} = CreateObject<CsmaChannel> ();`);
                if (net.tap && net.tap.mode) {
                    var tap_name = `tap_${net.id}`;

                    code.print(`// begin tap for net ${net.id}.`);
                    code.print(`Ptr<Node> ${tap_name} = CreateObject<Node> ();`);
                    code.print(`internet.Install(${tap_name});`);
                    code.print(`Ptr<Ipv4> ipv4_${tap_name} = ${tap_name}->GetObject<Ipv4> ();`);
                    var dev_info = generate_dev_config(`net_${net.id}`, tap_name, tap_name, [net.tap.address], 'csma');
                    code.print(`tapBridge.SetAttribute ("DeviceName", StringValue ("${net.tap.name}"));`);
                    code.print(`tapBridge.SetAttribute ("Mode", StringValue ("${net.tap.mode}"));`);
                    code.print(`tapBridge.Install (${tap_name}, ${dev_info.real_name});`);
                    code.print(`// end tap for net ${net.id}.`);
                }
            });
            code.print('// end nets.');

            var p2p_channels = [];
            code.print('// begin routers.');
            if (conf.routers) conf.routers.filter(router => router.instance_id == instance).forEach(router => {
                code.print(`// begin router ${router.id} setup.`);
                var router_name = `router_${router.id}`;
                code.print(`Ptr<Node> ${router_name} = CreateObject<Node> ();`);
                code.print(`internet.Install(${router_name});`);
                code.print(`Ptr<Ipv4> ipv4_${router_name} = ${router_name}->GetObject<Ipv4> ();`);

                code.print(`// begin router ${router.id} device setup.`);
                var devices_info = [];
                if (router.devices) {
                    router.devices.forEach(device => {
                        var dev_info = {};
                        if (device.xnet) 
                            dev_info = generate_dev_config(device.fd, router_name, device.id, device.addresses, 'fd');

                        if (device.type == 'p2p' && !device.xnet) {
                            if (!p2p_channels.includes(device.p2p_channel)) {
                                code.print(`Ptr<PointToPointChannel> ${device.p2p_channel} = CreateObject<PointToPointChannel> ();`);
                                p2p_channels.push(device.p2p_channel);
                            }

                            dev_info = generate_dev_config(device.p2p_channel, router_name, device.id, device.addresses, 'p2p');
                        }
                            

                        if (device.type == 'default' && !device.xnet) 
                            dev_info = generate_dev_config(`net_${device.network}`, router_name, device.id, device.addresses, 'csma');

                        devices_info.push(dev_info);
                    });
                }
                code.print(`// end router ${router.id} device setup.`);

                code.print(`// begin router ${router.id} bgp setup.`);
                var bgp_app = `bgp_${router_name}`;
                code.print(`Ptr<Bgp> ${bgp_app} = CreateObject<Bgp>();`);
                code.print(`${bgp_app}->SetAttribute("RouterID", Ipv4AddressValue("${router.router_id}"));`);
                code.print(`${bgp_app}->SetAttribute("LibbgpLogLevel", EnumValue(libbgp::${router.libbgp_loglevel}));`);

                code.print(`// begin router ${router.id} bgp peer setup.`);
                if (router.peers) {
                    router.peers.forEach((peer, peer_id) => {
                        var peer_name = `${bgp_app}_peer_${peer_id}`;
                        code.print(`Peer ${peer_name};`);
                        code.print(`${peer_name}.peer_address = "${peer.address}";`);
                        code.print(`${peer_name}.peer_asn = ${peer.asn};`);
                        code.print(`${peer_name}.local_asn = ${peer.local_asn};`);
                        code.print(`${peer_name}.passive = ${peer.passive ? "true" : "false"};`);
                        
                        if (peer.in_filters) {
                            var def_act = peer.in_filters.default_action;
                            if (def_act) code.print(`${peer_name}.ingress_rules = libbgp::BgpFilterRules(libbgp::${def_act.toUpperCase()});`);

                            var filters = peer.in_filters.filters;
                            if (filters) filters.forEach(filter => {
                                var [address, netmask] = filter.prefix.split('/');
                                code.print(`${peer_name}.ingress_rules.append(libbgp::BgpFilterRule(libbgp::${filter.match_type.toUpperCase()}, libbgp::${filter.action.toUpperCase()}, "${address}", ${netmask}));`);
                            });
                        }
                        if (peer.out_filters) {
                            var def_act = peer.out_filters.default_action;
                            if (def_act) code.print(`${peer_name}.egress_rules = libbgp::BgpFilterRules(libbgp::${def_act.toUpperCase()});`);

                            var filters = peer.out_filters.filters;
                            if (filters) filters.forEach(filter => {
                                var [address, netmask] = filter.prefix.split('/');
                                code.print(`${peer_name}.egress_rules.append(libbgp::BgpFilterRule(libbgp::${filter.match_type.toUpperCase()}, libbgp::${filter.action.toUpperCase()}, "${address}", ${netmask}));`);
                            });
                        }

                        code.print(`${bgp_app}->AddPeer(${peer_name});`);
                    });
                }
                code.print(`// end router ${router.id} bgp peer setup.`);

                code.print(`// begin router ${router.id} bgp nlri setup.`);
                if (router.routes) {
                    router.routes.forEach(route => {
                        var [address, netmask] = route.prefix.split('/');
                        code.print(`${bgp_app}->AddRoute("${address}", Ipv4Mask("/${netmask}"), "${route.nexthop}");`);
                    });
                }
                code.print(`// end router ${router.id} bgp nlri setup.`);

                code.print(`${router_name}->AddApplication(${bgp_app});`);
                code.print(`// end router ${router.id} bgp setup.`);
                code.print(`// begin router ${router.id} app setup.`);
                if (router.applications) {
                    router.applications.forEach((app, appid) => {
                        switch (app.type) {
                            case 'ping':
                                if (!app.interval) app.interval = 1000;
                                if (!app.size) app.size = 56;
                                var appname = `app_${router.id}_${appid} `;
                                code.print(`Ptr<V4Ping> ${appname} = CreateObject<V4Ping> ();`);
                                code.print(`${appname}->SetAttribute ("Remote", Ipv4AddressValue (Ipv4Address("${app.remote}")));`);
                                code.print(`${appname}->SetAttribute ("Verbose", BooleanValue (true));`);
                                code.print(`${appname}->SetAttribute ("Interval", TimeValue (MilliSeconds(${app.interval})));`);
                                code.print(`${appname}->SetAttribute ("Size", UintegerValue (${app.size}));`);  
                                code.print(`${router_name}->AddApplication(${appname});`); 
                        }
                    });
                }
                code.print(`// end router ${router.id} app setup.`);
                code.print(`// end router ${router.id} setup.`);
            });
            code.print('// end routers.');

            code.print(`// setting up ghost for instance ${instance}`);
            var ghost_node = `ghost_${instance}`;
            code.print(`Ptr<Node> ${ghost_node} = CreateObject<Node> ();`);
            code.print(`internet.Install(${ghost_node});`);
            code.print(`// setting up ghost bridges for instance ${instance}`);
            ghosts.filter(ghost => ghost.instance_id == instance)
                .map(ghost => ghost.network)
                .filter((v, i, s) => s.indexOf(v) == i)
                .forEach(net => {
                    var ghost_dev_br = `br_${net}`;
                    code.print(`Ptr<BridgeNetDevice> ${ghost_dev_br} = CreateObject<BridgeNetDevice> ();`);
                    code.print(`${ghost_node}->AddDevice(${ghost_dev_br});`);
                    
                    var ghost_dev_csma = `dev_${net}_csma`;
                    code.print(`Ptr<CsmaNetDevice> ${ghost_dev_csma} = CreateObject<CsmaNetDevice> ();`);
                    code.print(`${ghost_node}->AddDevice(${ghost_dev_csma});`);
                    code.print(`${ghost_dev_csma}->SetQueue(CreateObject<DropTailQueue<Packet>> ());`);
                    code.print(`${ghost_dev_csma}->Attach(net_${net});`);
                    code.print(`${ghost_dev_br}->AddBridgePort(${ghost_dev_csma});`);
                });
            code.print(`// end ghost bridges setup for instance ${instance}`);
            code.print(`// setting up fd <--> csma connection for instance ${instance}`);
            ghosts.filter(ghost => ghost.instance_id == instance).forEach(ghost => {
                var ghost_dev_fd = `dev_${ghost.name}_fd`;
                var ghost_dev_br = `br_${ghost.network}`;
                code.print(`Ptr<FdNetDevice> ${ghost_dev_fd} = CreateObject<FdNetDevice> ();`);
                code.print(`${ghost_dev_fd}->SetFileDescriptor(${ghost.fd});`);
                code.print(`${ghost_node}->AddDevice(${ghost_dev_fd});`);
                code.print(`${ghost_dev_br}->AddBridgePort(${ghost_dev_fd});`);
            });
            code.print(`// end fd <--> csma connection setup for instance ${instance}`);

            code.print('Simulator::Run();');
            code.print('return 0;');
            code.unindent();
            code.print('}');
            code.print(`// end instance ${instance}.`);
        });

        code.print(`fprintf(stderr, "Simulation ready. Instances started: ${instances.join(', ')} (${instances.length})\\n");`);
        code.print('wait(NULL);');
        code.print('return 0;');
        code.unindent();
        code.print('}');
        return {ok: true, code: code.get().join('\n')};
    };

    return {
        check: preprocess, generate
    };
})();

export default NetGen;