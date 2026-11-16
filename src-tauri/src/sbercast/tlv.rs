#![allow(dead_code)]
use std::collections::HashMap;

/// Wire types in Google Protobuf / StarOS TLV
pub const WIRE_VARINT: u8 = 0;
pub const WIRE_LENGTH_DELIMITED: u8 = 2;
pub const WIRE_FIXED32: u8 = 5;

#[derive(Debug, Clone, PartialEq)]
pub enum TlvValue {
    Varint(u64),
    LengthDelimited(Vec<u8>),
    Fixed32(f32),
}

impl TlvValue {
    pub fn as_str(&self) -> Option<&str> {
        match self {
            TlvValue::LengthDelimited(bytes) => std::str::from_utf8(bytes).ok(),
            _ => None,
        }
    }

    pub fn as_string(&self) -> Option<String> {
        self.as_str().map(|s| s.to_string())
    }

    pub fn as_u64(&self) -> Option<u64> {
        match self {
            TlvValue::Varint(v) => Some(*v),
            _ => None,
        }
    }

    pub fn as_f32(&self) -> Option<f32> {
        match self {
            TlvValue::Fixed32(f) => Some(*f),
            TlvValue::Varint(v) => Some(*v as f32),
            _ => None,
        }
    }

    pub fn as_nested(&self) -> Option<HashMap<u32, Vec<TlvValue>>> {
        match self {
            TlvValue::LengthDelimited(bytes) => decode_tlv_repeated(bytes).ok(),
            _ => None,
        }
    }
}

pub fn encode_varint(mut n: u64) -> Vec<u8> {
    let mut out = Vec::new();
    while n > 0x7f {
        out.push(((n & 0x7f) as u8) | 0x80);
        n >>= 7;
    }
    out.push((n & 0x7f) as u8);
    out
}

pub fn decode_varint(data: &[u8], pos: &mut usize) -> Result<u64, &'static str> {
    let mut value: u64 = 0;
    let mut shift: u32 = 0;
    let n = data.len();

    while *pos < n {
        let b = data[*pos];
        *pos += 1;
        value |= ((b & 0x7f) as u64) << shift;
        if (b & 0x80) == 0 {
            return Ok(value);
        }
        shift += 7;
        if shift >= 64 {
            return Err("varint overflow");
        }
    }
    Err("truncated varint")
}

pub fn encode_field_varint(tag: u32, value: u64) -> Vec<u8> {
    let key = ((tag as u64) << 3) | (WIRE_VARINT as u64);
    let mut out = encode_varint(key);
    out.extend(encode_varint(value));
    out
}

pub fn encode_field_bytes(tag: u32, payload: &[u8]) -> Vec<u8> {
    let key = ((tag as u64) << 3) | (WIRE_LENGTH_DELIMITED as u64);
    let mut out = encode_varint(key);
    out.extend(encode_varint(payload.len() as u64));
    out.extend_from_slice(payload);
    out
}

pub fn encode_field_fixed32(tag: u32, value: f32) -> Vec<u8> {
    let key = ((tag as u64) << 3) | (WIRE_FIXED32 as u64);
    let mut out = encode_varint(key);
    out.extend_from_slice(&value.to_le_bytes());
    out
}

/// Decodes binary TLV data into repeated fields per tag
pub fn decode_tlv_repeated(data: &[u8]) -> Result<HashMap<u32, Vec<TlvValue>>, &'static str> {
    let mut out: HashMap<u32, Vec<TlvValue>> = HashMap::new();
    let mut pos = 0;
    let n = data.len();

    while pos < n {
        let key = match decode_varint(data, &mut pos) {
            Ok(k) => k,
            Err(_) => break, // Truncated or finished
        };
        let tag = (key >> 3) as u32;
        let wire_type = (key & 0x7) as u8;

        match wire_type {
            WIRE_VARINT => {
                if let Ok(v) = decode_varint(data, &mut pos) {
                    out.entry(tag).or_default().push(TlvValue::Varint(v));
                } else {
                    break;
                }
            }
            WIRE_LENGTH_DELIMITED => {
                let len = match decode_varint(data, &mut pos) {
                    Ok(l) => l as usize,
                    Err(_) => break,
                };
                if pos + len > n {
                    break; // Truncated payload
                }
                let payload = data[pos..pos + len].to_vec();
                pos += len;
                out.entry(tag).or_default().push(TlvValue::LengthDelimited(payload));
            }
            WIRE_FIXED32 => {
                if pos + 4 > n {
                    break;
                }
                let bytes = [data[pos], data[pos + 1], data[pos + 2], data[pos + 3]];
                pos += 4;
                let val = f32::from_le_bytes(bytes);
                out.entry(tag).or_default().push(TlvValue::Fixed32(val));
            }
            _ => {
                // Unsupported wire type, stop decoding
                break;
            }
        }
    }

    Ok(out)
}

/// Helper to get the first value of a tag
pub fn get_single<'a>(map: &'a HashMap<u32, Vec<TlvValue>>, tag: u32) -> Option<&'a TlvValue> {
    map.get(&tag).and_then(|list| list.first())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_varint_roundtrip() {
        let values = [0, 1, 127, 128, 300, 16384, 1000000];
        for v in values {
            let encoded = encode_varint(v);
            let mut pos = 0;
            let decoded = decode_varint(&encoded, &mut pos).unwrap();
            assert_eq!(v, decoded);
            assert_eq!(pos, encoded.len());
        }
    }

    #[test]
    fn test_field_encode_decode() {
        let mut msg = Vec::new();
        msg.extend(encode_field_varint(1, 2));
        msg.extend(encode_field_bytes(2, b"test-id"));
        msg.extend(encode_field_fixed32(23, 1.5));

        let decoded = decode_tlv_repeated(&msg).unwrap();
        assert_eq!(get_single(&decoded, 1), Some(&TlvValue::Varint(2)));
        assert_eq!(get_single(&decoded, 2).and_then(|v| v.as_str()), Some("test-id"));
        assert_eq!(get_single(&decoded, 23), Some(&TlvValue::Fixed32(1.5)));
    }
}
