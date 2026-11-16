use std::collections::HashSet;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::time::Duration;
use tokio::net::{TcpStream, UdpSocket};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::Connector;

use super::client::make_danger_tls_client_config;
use super::proto::{SberDevice, DEFAULT_PORT};

/// Checks if an IPv4 address is a valid private local network address and NOT a virtual TUN/proxy subnet
pub fn is_valid_private_lan(ip: &Ipv4Addr) -> bool {
    if ip.is_loopback() || ip.is_link_local() || ip.is_broadcast() || ip.is_unspecified() {
        return false;
    }
    let octets = ip.octets();
    // Exclude Sing-box / Happ / Husi / Amnezia default TUN subnet (10.6.7.x)
    if octets[0] == 10 && octets[1] == 6 && octets[2] == 7 {
        return false;
    }
    // Exclude Clash / Sing-box / Mihomo fake-ip subnets (198.18.0.0/15)
    if octets[0] == 198 && (octets[1] == 18 || octets[1] == 19) {
        return false;
    }
    // Standard private LAN ranges: 192.168.0.0/16, 172.16.0.0/12, 10.0.0.0/8
    ip.is_private()
}

/// Discovers active physical local IPv4 LAN interfaces (filtering out TUN, TAP, VPN, and virtual adapters)
#[cfg(windows)]
pub fn get_lan_ips() -> Vec<Ipv4Addr> {
    use std::ptr::null_mut;
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GetAdaptersAddresses, GAA_FLAG_INCLUDE_PREFIX, GAA_FLAG_SKIP_ANYCAST,
        GAA_FLAG_SKIP_DNS_SERVER, GAA_FLAG_SKIP_MULTICAST, IP_ADAPTER_ADDRESSES_LH,
    };
    use windows_sys::Win32::Networking::WinSock::{AF_INET, SOCKADDR_IN};

    let mut buf_len = 16384u32;
    let mut buf: Vec<u8> = vec![0; buf_len as usize];
    let flags = GAA_FLAG_SKIP_ANYCAST
        | GAA_FLAG_SKIP_MULTICAST
        | GAA_FLAG_SKIP_DNS_SERVER
        | GAA_FLAG_INCLUDE_PREFIX;

    let res = unsafe {
        GetAdaptersAddresses(
            AF_INET as u32,
            flags,
            null_mut(),
            buf.as_mut_ptr() as *mut IP_ADAPTER_ADDRESSES_LH,
            &mut buf_len,
        )
    };

    if res != 0 {
        if res == 111 {
            // ERROR_BUFFER_OVERFLOW: retry with needed size
            buf.resize(buf_len as usize, 0);
            let res2 = unsafe {
                GetAdaptersAddresses(
                    AF_INET as u32,
                    flags,
                    null_mut(),
                    buf.as_mut_ptr() as *mut IP_ADAPTER_ADDRESSES_LH,
                    &mut buf_len,
                )
            };
            if res2 != 0 {
                return fallback_lan_ips();
            }
        } else {
            return fallback_lan_ips();
        }
    }

    let mut ips = Vec::new();
    let mut current = buf.as_ptr() as *const IP_ADAPTER_ADDRESSES_LH;

    while !current.is_null() {
        let adapter = unsafe { &*current };

        let friendly_name = if !adapter.FriendlyName.is_null() {
            let mut len = 0;
            unsafe {
                while *adapter.FriendlyName.add(len) != 0 {
                    len += 1;
                }
                let slice = std::slice::from_raw_parts(adapter.FriendlyName, len);
                String::from_utf16_lossy(slice).to_lowercase()
            }
        } else {
            String::new()
        };

        let description = if !adapter.Description.is_null() {
            let mut len = 0;
            unsafe {
                while *adapter.Description.add(len) != 0 {
                    len += 1;
                }
                let slice = std::slice::from_raw_parts(adapter.Description, len);
                String::from_utf16_lossy(slice).to_lowercase()
            }
        } else {
            String::new()
        };

        let is_virtual = adapter.IfType == 24 // Loopback
            || adapter.IfType == 131 // Tunnel
            || adapter.IfType == 53 // PropVirtual
            || friendly_name.contains("tun")
            || friendly_name.contains("tap")
            || friendly_name.contains("vpn")
            || friendly_name.contains("sing-box")
            || friendly_name.contains("clash")
            || friendly_name.contains("wireguard")
            || friendly_name.contains("wintun")
            || friendly_name.contains("tailscale")
            || friendly_name.contains("vethernet")
            || friendly_name.contains("virtual")
            || friendly_name.contains("hyper-v")
            || friendly_name.contains("wsl")
            || description.contains("tun")
            || description.contains("tap")
            || description.contains("vpn")
            || description.contains("virtual")
            || description.contains("wintun");

        // OperStatus: 1 = IfOperStatusUp
        if !is_virtual && adapter.OperStatus == 1 {
            let mut unicast = adapter.FirstUnicastAddress;
            while !unicast.is_null() {
                let u = unsafe { &*unicast };
                // Filter out point-to-point /30, /31, /32 interfaces
                if u.OnLinkPrefixLength < 30 {
                    let sockaddr = u.Address.lpSockaddr;
                    if !sockaddr.is_null() && unsafe { (*sockaddr).sa_family } == AF_INET as u16 {
                        let sin = unsafe { &*(sockaddr as *const SOCKADDR_IN) };
                        let ip_bytes = unsafe { sin.sin_addr.S_un.S_un_b };
                        let ip = Ipv4Addr::new(
                            ip_bytes.s_b1,
                            ip_bytes.s_b2,
                            ip_bytes.s_b3,
                            ip_bytes.s_b4,
                        );
                        if is_valid_private_lan(&ip) && !ips.contains(&ip) {
                            ips.push(ip);
                        }
                    }
                }
                unicast = unsafe { (*unicast).Next };
            }
        }

        current = adapter.Next;
    }

    if ips.is_empty() {
        fallback_lan_ips()
    } else {
        ips
    }
}

#[cfg(not(windows))]
pub fn get_lan_ips() -> Vec<Ipv4Addr> {
    fallback_lan_ips()
}

/// Fallback for determining local LAN IPs
fn fallback_lan_ips() -> Vec<Ipv4Addr> {
    let mut ips = Vec::new();
    if let Ok(socket) = std::net::UdpSocket::bind("0.0.0.0:0") {
        if socket.connect("8.8.8.8:80").is_ok() {
            if let Ok(SocketAddr::V4(addr)) = socket.local_addr() {
                let ip = *addr.ip();
                if is_valid_private_lan(&ip) {
                    ips.push(ip);
                }
            }
        }
    }
    ips
}

/// Verifies whether the endpoint is actually a genuine StarOS / SberCast TLS WebSocket server
pub async fn verify_staros_device(ip: Ipv4Addr, port: u16, timeout_ms: u64) -> bool {
    let url_str = format!("wss://{}:{}/", ip, port);
    let request = match url_str.as_str().into_client_request() {
        Ok(mut req) => {
            req.headers_mut().insert(
                tokio_tungstenite::tungstenite::http::header::HOST,
                HeaderValue::from_str(&format!("{}:{}", ip, port))
                    .unwrap_or_else(|_| HeaderValue::from_static("localhost")),
            );
            req
        }
        Err(_) => return false,
    };

    let config = make_danger_tls_client_config();
    let connector = Connector::Rustls(config);

    match tokio::time::timeout(
        Duration::from_millis(timeout_ms),
        tokio_tungstenite::connect_async_tls_with_config(request, None, false, Some(connector)),
    )
    .await
    {
        Ok(Ok((stream, _))) => {
            // Drop stream cleanly
            drop(stream);
            true
        }
        _ => false,
    }
}

/// Builds raw mDNS query for `_staros._tcp.local.`
fn build_mdns_query() -> Vec<u8> {
    let mut packet = Vec::new();
    // Header: ID=0, Flags=0, QDCOUNT=1, ANCOUNT=0, NSCOUNT=0, ARCOUNT=0
    packet.extend_from_slice(&[
        0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    // Question: _staros._tcp.local.
    packet.extend_from_slice(b"\x07_staros\x04_tcp\x05local\x00");
    // QTYPE: PTR (12), QCLASS: IN (1)
    packet.extend_from_slice(&[0x00, 0x0c, 0x00, 0x01]);
    packet
}

/// Sanitizes a device name by trimming whitespace, removing control characters and UTF-8 replacement artifacts
pub fn sanitize_device_name(name: &str) -> String {
    // If the name was corrupted by DNS compression pointers (producing \u{FFFD}0), cut at \u{FFFD}
    let base = if let Some(pos) = name.find('\u{FFFD}') {
        &name[..pos]
    } else {
        name
    };

    base.chars()
        .filter(|c| !c.is_control() && *c != '\u{FFFD}')
        .collect::<String>()
        .trim()
        .to_string()
}

/// Helper to skip a DNS domain name in wire format (handling labels and compression pointers)
fn skip_dns_name(data: &[u8], mut offset: usize) -> Option<usize> {
    let mut steps = 0;
    while offset < data.len() && steps < 128 {
        steps += 1;
        let len = data[offset];
        if len == 0 {
            return Some(offset + 1);
        } else if (len & 0xc0) == 0xc0 {
            // 2-byte DNS compression pointer
            return Some(offset + 2);
        } else {
            let label_len = len as usize;
            offset += 1 + label_len;
        }
    }
    None
}

/// Robust parser for TXT records in mDNS responses according to RFC 1035
fn parse_txt_record(
    data: &[u8],
) -> (
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
) {
    let mut name = None;
    let mut model = None;
    let mut dev_id = None;
    let mut firmware = None;

    // Minimum DNS packet header is 12 bytes
    if data.len() >= 12 {
        let qdcount = u16::from_be_bytes([data[4], data[5]]) as usize;
        let ancount = u16::from_be_bytes([data[6], data[7]]) as usize;
        let nscount = u16::from_be_bytes([data[8], data[9]]) as usize;
        let arcount = u16::from_be_bytes([data[10], data[11]]) as usize;
        let total_records = ancount + nscount + arcount;

        let mut offset = 12;

        // Skip Questions
        for _ in 0..qdcount {
            if let Some(next) = skip_dns_name(data, offset) {
                offset = next + 4; // QTYPE (2) + QCLASS (2)
            } else {
                break;
            }
        }

        // Iterate Resource Records (Answers, Authorities, Additionals)
        for _ in 0..total_records {
            if offset >= data.len() {
                break;
            }
            if let Some(next) = skip_dns_name(data, offset) {
                if next + 10 > data.len() {
                    break;
                }
                let rtype = u16::from_be_bytes([data[next], data[next + 1]]);
                let rdlength = u16::from_be_bytes([data[next + 8], data[next + 9]]) as usize;
                let rdata_start = next + 10;
                let rdata_end = rdata_start + rdlength;

                if rdata_end > data.len() {
                    break;
                }

                if rtype == 16 {
                    // TXT record: sequence of length-prefixed Pascal strings [str_len: u8][bytes of str_len]
                    let mut r_offset = rdata_start;
                    while r_offset < rdata_end {
                        let str_len = data[r_offset] as usize;
                        r_offset += 1;
                        if r_offset + str_len > rdata_end {
                            break;
                        }
                        if let Ok(entry_str) = std::str::from_utf8(&data[r_offset..r_offset + str_len]) {
                            if let Some((k, v)) = entry_str.split_once('=') {
                                let clean_val = sanitize_device_name(v);
                                match k {
                                    "name" => name = Some(clean_val),
                                    "type" => model = Some(clean_val),
                                    "id" => dev_id = Some(clean_val),
                                    "v" => firmware = Some(clean_val),
                                    _ => {}
                                }
                            }
                        }
                        r_offset += str_len;
                    }
                }

                offset = rdata_end;
            } else {
                break;
            }
        }
    }

    // Fallback if structured DNS parse didn't find "name"
    if name.is_none() && model.is_none() {
        for key in &["name=", "type=", "id=", "v="] {
            let key_bytes = key.as_bytes();
            if let Some(pos) = data.windows(key_bytes.len()).position(|w| w == key_bytes) {
                let val_start = pos + key_bytes.len();
                let mut val_end = val_start;

                // Check preceding Pascal length byte
                if pos > 0 {
                    let total_len = data[pos - 1] as usize;
                    if total_len >= key_bytes.len() && (pos - 1) + 1 + total_len <= data.len() {
                        val_end = (pos - 1) + 1 + total_len;
                    }
                }

                // If length byte wasn't valid, stop at first non-printable or control byte
                if val_end == val_start {
                    while val_end < data.len() && data[val_end] >= 32 && data[val_end] < 127 {
                        val_end += 1;
                    }
                }

                if val_end > val_start {
                    if let Ok(val_str) = std::str::from_utf8(&data[val_start..val_end]) {
                        let clean_val = sanitize_device_name(val_str);
                        match *key {
                            "name=" => name = Some(clean_val),
                            "type=" => model = Some(clean_val),
                            "id=" => dev_id = Some(clean_val),
                            "v=" => firmware = Some(clean_val),
                            _ => {}
                        }
                    }
                }
            }
        }
    }

    (name, model, dev_id, firmware)
}

/// Discovers Sber devices via mDNS (UDP 224.0.0.251:5353) across physical LAN interfaces
pub async fn discover_mdns(timeout_secs: u64) -> Vec<SberDevice> {
    let mut devices = Vec::new();
    let mut seen_ips = HashSet::new();

    let lan_ips = get_lan_ips();
    let mdns_addr: SocketAddr = "224.0.0.251:5353".parse().unwrap();
    let query = build_mdns_query();

    let mut sockets = Vec::new();

    // Bind to 0.0.0.0
    if let Ok(s) = UdpSocket::bind("0.0.0.0:0").await {
        let _ = s.set_broadcast(true);
        sockets.push(s);
    }

    // Also bind directly to each physical LAN IP so multicast goes out the physical Wi-Fi/Ethernet NICs
    for ip in &lan_ips {
        if let Ok(s) = UdpSocket::bind(SocketAddr::new(IpAddr::V4(*ip), 0)).await {
            let _ = s.set_broadcast(true);
            sockets.push(s);
        }
    }

    if sockets.is_empty() {
        log::warn!("[SberCast] No UDP sockets could be bound for mDNS");
        return devices;
    }

    // Send query out on all sockets
    for s in &sockets {
        let _ = s.send_to(&query, mdns_addr).await;
    }
    tokio::time::sleep(Duration::from_millis(50)).await;
    for s in &sockets {
        let _ = s.send_to(&query, mdns_addr).await;
    }

    // Listen on all sockets concurrently via mpsc channel
    let (tx, mut rx) = tokio::sync::mpsc::channel::<(Vec<u8>, SocketAddr)>(32);
    for socket in sockets {
        let tx = tx.clone();
        tokio::spawn(async move {
            let mut buf = vec![0u8; 4096];
            while let Ok((len, src)) = socket.recv_from(&mut buf).await {
                if tx.send((buf[..len].to_vec(), src)).await.is_err() {
                    break;
                }
            }
        });
    }
    drop(tx);

    let deadline = tokio::time::Instant::now() + Duration::from_secs(timeout_secs);
    while tokio::time::Instant::now() < deadline {
        let remain = deadline - tokio::time::Instant::now();
        match tokio::time::timeout(remain, rx.recv()).await {
            Ok(Some((packet, src))) => {
                let ip_str = src.ip().to_string();
                if seen_ips.insert(ip_str.clone()) {
                    let (name, model, dev_id, firmware) = parse_txt_record(&packet);
                    let final_name = name.unwrap_or_else(|| {
                        model
                            .clone()
                            .unwrap_or_else(|| format!("Sber Device ({})", ip_str))
                    });

                    devices.push(SberDevice {
                        id: dev_id.unwrap_or_else(|| format!("sber-{}", ip_str.replace('.', "-"))),
                        name: final_name,
                        host: ip_str,
                        port: DEFAULT_PORT,
                        model,
                        firmware,
                        pin_token: None,
                        is_paired: false,
                    });
                }
            }
            _ => break,
        }
    }

    devices
}

/// Probes a single host on port 20000:
/// 1. Fast TCP connection check (120ms)
/// 2. StarOS TLS + WebSocket handshake verification (400ms)
async fn probe_host(ip: Ipv4Addr, port: u16) -> Option<SberDevice> {
    let addr = SocketAddr::new(IpAddr::V4(ip), port);
    // 1. Fast TCP connect
    if tokio::time::timeout(Duration::from_millis(120), TcpStream::connect(addr))
        .await
        .is_err()
    {
        return None;
    }

    // 2. Strict protocol verification: Must successfully complete StarOS TLS + WebSocket upgrade!
    // Virtual TUN proxies intercept TCP connect, but will fail the TLS / WebSocket handshake.
    if !verify_staros_device(ip, port, 400).await {
        return None;
    }

    let ip_str = ip.to_string();
    Some(SberDevice {
        id: format!("sber-{}", ip_str.replace('.', "-")),
        name: format!("SberBoom ({})", ip_str),
        host: ip_str,
        port,
        model: Some("SberBoom".to_string()),
        firmware: None,
        pin_token: None,
        is_paired: false,
    })
}

/// Quick LAN subnet scan on port 20000 for all physical LAN subnets
pub async fn scan_subnet_fallback() -> Vec<SberDevice> {
    let lan_ips = get_lan_ips();
    if lan_ips.is_empty() {
        log::warn!("[SberCast] No valid physical LAN IPv4 interfaces found for subnet scan");
        return Vec::new();
    }

    let mut scanned_subnets = HashSet::new();
    let mut tasks = Vec::new();

    for local_ip in lan_ips {
        let octets = local_ip.octets();
        let subnet_key = (octets[0], octets[1], octets[2]);
        if !scanned_subnets.insert(subnet_key) {
            continue;
        }

        log::info!(
            "[SberCast] Subnet scan on {}.{}.{}.0/24 port {}",
            octets[0],
            octets[1],
            octets[2],
            DEFAULT_PORT
        );

        for i in 1..=254 {
            if i == octets[3] {
                continue; // Skip self
            }
            let target_ip = Ipv4Addr::new(octets[0], octets[1], octets[2], i);
            tasks.push(tokio::spawn(probe_host(target_ip, DEFAULT_PORT)));
        }
    }

    let mut devices = Vec::new();
    for task in tasks {
        if let Ok(Some(device)) = task.await {
            devices.push(device);
        }
    }

    devices
}

/// Probes a specific IP and port (e.g. manually added by user), strictly verifying StarOS TLS WebSocket protocol
pub async fn probe_manual_device(host: &str, port: u16) -> Result<SberDevice, String> {
    if let Ok(ip) = host.parse::<Ipv4Addr>() {
        // If it's a TUN IP, reject right away
        if !is_valid_private_lan(&ip) {
            return Err(format!(
                "IP-адрес {} относится к виртуальной или VPN/TUN сети",
                host
            ));
        }

        if !verify_staros_device(ip, port, 1500).await {
            return Err(format!(
                "Устройство {}:{} не отвечает как колонка Sber / StarOS (TLS WSS)",
                host, port
            ));
        }
    } else {
        let addr = format!("{}:{}", host, port);
        match tokio::time::timeout(Duration::from_millis(1500), TcpStream::connect(&addr)).await {
            Ok(Ok(_)) => {}
            Ok(Err(e)) => return Err(format!("Не удалось подключиться к {}: {}", addr, e)),
            Err(_) => return Err(format!("Таймаут подключения к {}", addr)),
        }
    }

    Ok(SberDevice {
        id: format!("sber-{}", host.replace('.', "-")),
        name: format!("Sber Device ({})", host),
        host: host.to_string(),
        port,
        model: Some("Sber Device".to_string()),
        firmware: None,
        pin_token: None,
        is_paired: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_valid_private_lan() {
        assert!(!is_valid_private_lan(&Ipv4Addr::new(127, 0, 0, 1)));
        assert!(!is_valid_private_lan(&Ipv4Addr::new(10, 6, 7, 1))); // Sing-box TUN
        assert!(!is_valid_private_lan(&Ipv4Addr::new(10, 6, 7, 5))); // Sing-box TUN
        assert!(!is_valid_private_lan(&Ipv4Addr::new(198, 18, 0, 1))); // Clash fake-ip
        assert!(!is_valid_private_lan(&Ipv4Addr::new(169, 254, 1, 1))); // link-local
        assert!(!is_valid_private_lan(&Ipv4Addr::new(8, 8, 8, 8))); // public

        assert!(is_valid_private_lan(&Ipv4Addr::new(192, 168, 1, 50)));
        assert!(is_valid_private_lan(&Ipv4Addr::new(192, 168, 31, 63)));
        assert!(is_valid_private_lan(&Ipv4Addr::new(10, 0, 0, 5)));
    }

    #[test]
    fn test_sanitize_device_name() {
        assert_eq!(sanitize_device_name("SberBoom Home\u{FFFD}0"), "SberBoom Home");
        assert_eq!(sanitize_device_name("SberBoom Mini 2\u{FFFD}0"), "SberBoom Mini 2");
        assert_eq!(sanitize_device_name("SberBoom Mini 2"), "SberBoom Mini 2");
        assert_eq!(sanitize_device_name("  SberBoom Home  "), "SberBoom Home");
    }

    #[test]
    fn test_parse_txt_record_clean() {
        // Mock a TXT record with length prefix
        let mut packet = vec![0u8; 12]; // DNS Header
        // 1 Answer
        packet[6] = 0;
        packet[7] = 1;
        // Answer name: pointer 0xc0 0x0c
        packet.extend_from_slice(&[0xc0, 0x0c]);
        // TYPE: TXT (16)
        packet.extend_from_slice(&[0x00, 0x10]);
        // CLASS: IN (1)
        packet.extend_from_slice(&[0x00, 0x01]);
        // TTL: 120
        packet.extend_from_slice(&[0x00, 0x00, 0x00, 0x78]);

        // RDATA:
        let entry1 = b"name=SberBoom Home";
        let entry2 = b"type=sberboom_home";
        let rdlength = (1 + entry1.len() + 1 + entry2.len()) as u16;
        packet.extend_from_slice(&rdlength.to_be_bytes());
        packet.push(entry1.len() as u8);
        packet.extend_from_slice(entry1);
        packet.push(entry2.len() as u8);
        packet.extend_from_slice(entry2);

        // Next record or pointer right after RDATA (the culprit of \u{FFFD}0)
        packet.extend_from_slice(&[0xc0, 0x30]);

        let (name, model, _, _) = parse_txt_record(&packet);
        assert_eq!(name.as_deref(), Some("SberBoom Home"));
        assert_eq!(model.as_deref(), Some("sberboom_home"));
    }
}
