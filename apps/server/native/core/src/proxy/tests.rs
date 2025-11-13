#[cfg(test)]
mod tests {
    use super::super::auth::{generate_credentials, validate_basic_auth};
    use super::super::routing::{is_loopback_hostname, rewrite_url_if_needed, Route};
    use super::super::server::{determine_host_override, ProxyServer};
    use http::HeaderMap;
    use http::Uri;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[test]
    fn test_generate_credentials() {
        let (username1, password1) = generate_credentials(123);
        let (username2, password2) = generate_credentials(123);

        // Should be different each time (random)
        assert_ne!(username1, username2);
        assert_ne!(password1, password2);

        // Username should contain web contents ID
        assert!(username1.starts_with("wc-123-"));

        // Password should be 24 chars (12 bytes * 2 hex)
        assert_eq!(password1.len(), 24);
    }

    #[test]
    fn test_validate_basic_auth() {
        let mut headers = HeaderMap::new();

        // Encode "testuser:testpass" as base64
        let encoded = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            "testuser:testpass",
        );
        headers.insert(
            "proxy-authorization",
            format!("Basic {}", encoded).parse().unwrap(),
        );

        assert!(validate_basic_auth(&headers, "testuser", "testpass"));
        assert!(!validate_basic_auth(&headers, "wrong", "testpass"));
        assert!(!validate_basic_auth(&headers, "testuser", "wrong"));
    }

    #[test]
    fn test_is_loopback() {
        assert!(is_loopback_hostname("localhost"));
        assert!(is_loopback_hostname("127.0.0.1"));
        assert!(is_loopback_hostname("127.18.1.5"));
        assert!(is_loopback_hostname("::1"));
        assert!(is_loopback_hostname("[::1]"));

        assert!(!is_loopback_hostname("example.com"));
        assert!(!is_loopback_hostname("192.168.1.1"));
        assert!(!is_loopback_hostname("cmux.app"));
    }

    #[tokio::test]
    async fn test_proxy_server_start() {
        // Test that we can start a server
        let result = ProxyServer::start("127.0.0.1:0".to_string(), false).await;
        assert!(result.is_ok(), "Failed to start proxy server");

        let server = result.unwrap();
        let port = server.port();
        assert!(port > 0, "Port should be assigned");

        // Cleanup
        server.stop();
    }

    #[tokio::test]
    async fn test_proxy_server_create_context() {
        let server = ProxyServer::start("127.0.0.1:0".to_string(), false)
            .await
            .unwrap();

        let route = Route {
            morph_id: "test-id".to_string(),
            scope: "base".to_string(),
            domain_suffix: "cmux.app".to_string(),
            morph_domain_suffix: None,
        };

        let context = server.create_context(123, Some(route));

        assert_eq!(context.web_contents_id, 123);
        assert!(!context.username.is_empty());
        assert!(!context.password.is_empty());
        assert!(!context.id.is_empty());

        // Release context
        server.release_context(&context.id);

        server.stop();
    }

    #[test]
    fn test_rewrite_to_morph_domain_when_suffix_present() {
        let route = Route {
            morph_id: "abc123".to_string(),
            scope: "base".to_string(),
            domain_suffix: "cmux.app".to_string(),
            morph_domain_suffix: Some(".http.cloud.morph.so".to_string()),
        };

        let uri: Uri = "http://127.0.0.1:39379/health".parse().unwrap();
        let rewritten = rewrite_url_if_needed(&uri, Some(&route)).unwrap();

        assert_eq!(
            rewritten.authority().unwrap().to_string(),
            "port-39379-morphvm-abc123.http.cloud.morph.so"
        );
        assert_eq!(rewritten.scheme_str(), Some("https"));
    }

    #[test]
    fn test_rewrite_falls_back_to_cmux_domain() {
        let route = Route {
            morph_id: "abc123".to_string(),
            scope: "worker".to_string(),
            domain_suffix: "cmux.dev".to_string(),
            morph_domain_suffix: None,
        };

        let uri: Uri = "http://127.0.0.1:8101/".parse().unwrap();
        let rewritten = rewrite_url_if_needed(&uri, Some(&route)).unwrap();

        assert_eq!(
            rewritten.authority().unwrap().to_string(),
            "cmux-abc123-worker-8101.cmux.dev"
        );
    }

    #[test]
    fn test_determine_host_override_for_loopback_rewrite() {
        let original: Uri = "http://localhost:5173/".parse().unwrap();
        let rewritten: Uri =
            "https://port-5173-morphvm-abc123.http.cloud.morph.so/".parse().unwrap();

        let result = determine_host_override(&original, &rewritten);
        assert_eq!(result.as_deref(), Some("localhost:5173"));
    }

    #[test]
    fn test_determine_host_override_skips_non_loopback() {
        let original: Uri = "https://example.com/".parse().unwrap();
        let rewritten: Uri = "https://port-5173-morphvm-abc123.http.cloud.morph.so/".parse().unwrap();

        assert!(determine_host_override(&original, &rewritten).is_none());
    }

    #[test]
    fn test_determine_host_override_ignored_for_cmux_host() {
        let original: Uri = "http://localhost:39378/".parse().unwrap();
        let rewritten: Uri = "https://cmux-abc-base-39378.cmux.app/".parse().unwrap();

        assert!(determine_host_override(&original, &rewritten).is_none());
    }

    #[tokio::test]
    async fn test_http1_clients_work_with_http2_enabled() {
        let server = ProxyServer::start("127.0.0.1:0".to_string(), true)
            .await
            .expect("proxy server should start");
        let port = server.port();

        let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .expect("connect to proxy");

        let request = b"GET http://localhost/ HTTP/1.1\r\nHost: localhost\r\n\r\n";
        stream
            .write_all(request)
            .await
            .expect("write HTTP/1 request through proxy");

        let mut buf = vec![0u8; 256];
        let n = stream
            .read(&mut buf)
            .await
            .expect("read proxy response bytes");
        let resp = String::from_utf8_lossy(&buf[..n]);
        assert!(
            resp.starts_with("HTTP/1.1 407") || resp.starts_with("HTTP/1.0 407"),
            "expected proxy auth response, got {resp}"
        );

        server.stop();
    }
}
