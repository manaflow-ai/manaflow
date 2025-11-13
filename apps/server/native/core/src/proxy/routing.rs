use http::Uri;

#[allow(dead_code)]
const CMUX_DOMAINS: &[&str] = &[
    "cmux.app",
    "cmux.sh",
    "cmux.dev",
    "cmux.local",
    "cmux.localhost",
    "autobuild.app",
];

#[derive(Clone, Debug)]
pub struct Route {
    pub morph_id: String,
    pub scope: String,
    pub domain_suffix: String,
    pub morph_domain_suffix: Option<String>,
}

pub fn is_loopback_hostname(hostname: &str) -> bool {
    let lower = hostname.to_lowercase();
    lower == "localhost"
        || lower == "127.0.0.1"
        || lower.starts_with("127.")
        || lower == "[::1]"
        || lower == "::1"
}

pub fn rewrite_url_if_needed(
    uri: &Uri,
    route: Option<&Route>,
) -> Result<Uri, Box<dyn std::error::Error + Send + Sync>> {
    let hostname = uri.host().unwrap_or("");

    if let Some(route) = route {
        if is_loopback_hostname(hostname) {
            let port = determine_port(uri);
            let new_host = route
                .morph_domain_suffix
                .as_ref()
                .map(|suffix| build_morph_host(route, suffix, port))
                .unwrap_or_else(|| build_cmux_host(route, port));

            let mut parts = uri.clone().into_parts();
            parts.scheme = Some(http::uri::Scheme::HTTPS);

            let authority = http::uri::Authority::from_maybe_shared(new_host)?;
            parts.authority = Some(authority);

            return Ok(Uri::from_parts(parts)?);
        }
    }

    Ok(uri.clone())
}

fn determine_port(uri: &Uri) -> u16 {
    if let Some(port) = uri.port_u16() {
        return port;
    }

    match uri.scheme_str() {
        Some("https") | Some("wss") => 443,
        _ => 80,
    }
}

fn build_cmux_host(route: &Route, port: u16) -> String {
    format!(
        "cmux-{}-{}-{}.{}",
        route.morph_id, route.scope, port, route.domain_suffix
    )
}

fn build_morph_host(route: &Route, suffix: &str, port: u16) -> String {
    format!("port-{}-morphvm-{}{}", port, route.morph_id, suffix)
}
