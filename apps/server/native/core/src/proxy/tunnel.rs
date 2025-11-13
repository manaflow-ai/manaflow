use tokio::io::{copy_bidirectional, AsyncRead, AsyncWrite};

/// Tunnel bytes bidirectionally between client and upstream
/// Used for WebSocket and CONNECT tunneling
#[allow(dead_code)]
pub async fn tunnel<C, U>(mut client: C, mut upstream: U) -> Result<(), std::io::Error>
where
    C: AsyncRead + AsyncWrite + Unpin,
    U: AsyncRead + AsyncWrite + Unpin,
{
    copy_bidirectional(&mut client, &mut upstream).await?;
    Ok(())
}
