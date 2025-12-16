pub mod pty;
pub mod session;

use std::{path::PathBuf, sync::Arc};

use axum::extract::ws::{WebSocket, WebSocketUpgrade};
use axum::{
    extract::{Path, State},
    http::{Method, StatusCode, Uri},
    response::{Html, IntoResponse},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tower_http::{cors::CorsLayer, services::ServeDir, trace::TraceLayer};
use uuid::Uuid;

use crate::session::{AppState, Session};

const INDEX_HTML: &str = include_str!("../static/index.html");

#[derive(Debug, Deserialize)]
pub struct CreateTabRequest {
    pub cmd: Option<String>,
    pub args: Option<Vec<String>>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
}

#[derive(Debug, Serialize)]
pub struct CreateTabResponse {
    pub id: Uuid,
    pub ws_url: String,
}

pub fn build_router(state: Arc<AppState>, static_dir: Option<PathBuf>) -> Router {
    let cors = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::OPTIONS])
        .allow_headers([http::header::CONTENT_TYPE])
        .allow_origin(axum::http::HeaderValue::from_static("*"));

    let app = Router::new()
        .route("/", get(index_handler))
        .route("/index.html", get(index_handler))
        .route("/api/tabs", post(create_tab).get(list_tabs))
        .route("/api/tabs/:id", axum::routing::delete(delete_tab))
        .route("/ws/:id", get(ws_handler))
        .with_state(state)
        .layer(TraceLayer::new_for_http())
        .layer(cors);

    if let Some(dir) = static_dir {
        let serve = ServeDir::new(dir.clone()).not_found_service(handle_index(dir));
        app.fallback_service(serve)
    } else {
        app
    }
}

fn handle_index(dir: PathBuf) -> Router {
    Router::new().fallback(|_uri: Uri| async move {
        let index_path = dir.join("index.html");
        match tokio::fs::read_to_string(index_path).await {
            Ok(contents) => Html(contents).into_response(),
            Err(_) => (StatusCode::NOT_FOUND, "Not Found").into_response(),
        }
    })
}

async fn create_tab(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CreateTabRequest>,
) -> Result<Json<CreateTabResponse>, (StatusCode, String)> {
    let cols = payload.cols.unwrap_or(80);
    let rows = payload.rows.unwrap_or(24);
    let created_order = state.next_sequence();
    let (id, _session) = Session::spawn(
        created_order,
        payload.cmd.as_deref(),
        payload.args.unwrap_or_default(),
        cols,
        rows,
    )
    .map_err(internal_err)?;
    state.sessions.insert(id, _session);
    let ws_url = format!("/ws/{}", id);
    Ok(Json(CreateTabResponse { id, ws_url }))
}

async fn list_tabs(State(state): State<Arc<AppState>>) -> Json<Vec<Uuid>> {
    let mut sessions: Vec<_> = state
        .sessions
        .iter()
        .map(|entry| {
            let session = entry.value();
            (session.created_at, session.created_order, *entry.key())
        })
        .collect();
    sessions.sort_by_key(|(_, order, _)| *order);
    let ids = sessions.into_iter().map(|(_, _, id)| id).collect();
    Json(ids)
}

async fn delete_tab(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, String)> {
    if let Some((_, sess)) = state.sessions.remove(&id) {
        sess.terminate().await;
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err((StatusCode::NOT_FOUND, "tab not found".into()))
    }
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    if !state.sessions.contains_key(&id) {
        return Err((StatusCode::NOT_FOUND, "tab not found".to_string()));
    }
    Ok(ws.on_upgrade(move |socket| handle_socket(state, id, socket)))
}

async fn handle_socket(state: Arc<AppState>, id: Uuid, socket: WebSocket) {
    let Some(sess) = state.sessions.get(&id).map(|r| r.clone()) else {
        return;
    };
    sess.attach_socket(socket).await;
}

fn internal_err<E: std::fmt::Display>(e: E) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
}

async fn index_handler() -> Html<&'static str> {
    Html(INDEX_HTML)
}
