use tokio::net::TcpStream;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};
use tracing::debug;

pub fn try_set_ws_nodelay(ws: &WebSocketStream<MaybeTlsStream<TcpStream>>) {
    match ws.get_ref() {
        MaybeTlsStream::Plain(stream) => {
            if let Err(err) = stream.set_nodelay(true) {
                debug!(error = %err, "Failed to enable TCP_NODELAY for WebSocket upstream");
            } else {
                debug!("Enabled TCP_NODELAY for WebSocket upstream");
            }
        }
        _ => {
            debug!("Skipping TCP_NODELAY for TLS WebSocket upstream");
        }
    }
}
