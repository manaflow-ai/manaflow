use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use http::HeaderMap;

pub fn validate_basic_auth(
    headers: &HeaderMap,
    expected_username: &str,
    expected_password: &str,
) -> bool {
    let auth_header = match headers.get("proxy-authorization") {
        Some(h) => h,
        None => return false,
    };

    let auth_str = match auth_header.to_str() {
        Ok(s) => s,
        Err(_) => return false,
    };

    if !auth_str.starts_with("Basic ") {
        return false;
    }

    let encoded = &auth_str[6..];
    let decoded = match BASE64.decode(encoded) {
        Ok(d) => d,
        Err(_) => return false,
    };

    let decoded_str = match String::from_utf8(decoded) {
        Ok(s) => s,
        Err(_) => return false,
    };

    let parts: Vec<&str> = decoded_str.splitn(2, ':').collect();
    if parts.len() != 2 {
        return false;
    }

    parts[0] == expected_username && parts[1] == expected_password
}

pub fn generate_credentials(web_contents_id: u32) -> (String, String) {
    use rand::Rng;
    let mut rng = rand::thread_rng();

    let random_suffix: String = (0..4).map(|_| format!("{:02x}", rng.gen::<u8>())).collect();

    let username = format!("wc-{}-{}", web_contents_id, random_suffix);

    let password: String = (0..12)
        .map(|_| format!("{:02x}", rng.gen::<u8>()))
        .collect();

    (username, password)
}
