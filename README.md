ns3-bgp-netgen-ng
---

`ns3-bgp-netgen-ng` is the successor of `ns3-bgp-netgen`. `ns3-bgp-netgen-ng` use JSON-based configuration to generate ns3 script. JSON schema for the configuration is available [here](https://raw.githubusercontent.com/Nat-Lab/ns3-bgp-netgen-ng/master/res/netgen-conf-schema.json).

`ns3-bgp-netgen-ng` has a [web-based UI](https://lab.nat.moe/ns3-bgp-netgen-ng/) that allows the user to generate BGP networks with a few clicks. One could also choose to write the configuration by hand if they want to.

`ns3-bgp-netgen-ng` has added process-based multi-instance support that allows the user to speed up the simulation by running multiple ns3 instances with each instance running only a part of the simulated network. You will notice that now every network and router in configuration file has an `instance_id` associated with them, indicating which ns3 instance that the router or network should be running on.

Routers/Network with the same `instance_id` will be put into the same process. A process will be created for every `instance_id`. Routers can have devices that connect to a network or peer in a different instance. When this happens, a UNIX socket pair will be created (with `socketpair(2)`) to handle communication between different instances.

### License

MIT
