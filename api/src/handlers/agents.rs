//! Agent self-registration and public metadata.
//!
//! Registration is open and confers **zero access** — an agent is inert until a
//! customer grants it a mandate (`handlers/mandates.rs`); consent is the gate,
//! not registration. The `agent_secret` is generated server-side, returned
//! exactly once, and stored only as a SHA-256 hash (the refresh-token pattern —
//! high-entropy random, so a fast hash is fine; argon2id stays for passwords).

use std::net::SocketAddr;

use axum::{
    extract::{ConnectInfo, Path, State},
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use uuid::Uuid;
use validator::Validate;

use crate::errors::AppError;
use crate::handlers::auth::generate_opaque_secret;
use crate::handlers::AppState;
use crate::models::agent::{AgentPublic, RegisterAgentRequest, RegisterAgentResponse};

pub fn agent_routes() -> Router<AppState> {
    Router::new()
        .route("/", post(register_agent))
        .route("/:id", get(get_agent))
}

/// Register an agent. Public by design (a registered agent can do nothing
/// until mandated); returns the secret exactly once.
///
/// Open, but no longer unmetered. Registration is an unauthenticated write that
/// shares its connection pool with every money endpoint, so one address gets
/// `max_agent_registrations` per `agent_registration_window` seconds and then a
/// 429 — the same windowed-count shape as the login lockout. Deliberately a
/// throttle rather than an authentication requirement: the consent UI already
/// registers while logged in, but the demo seeding paths
/// (`agent/mandate_gateway.py`, `mcp/setup_demo.py`) register anonymously and
/// should keep working.
async fn register_agent(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(req): Json<RegisterAgentRequest>,
) -> Result<(StatusCode, Json<RegisterAgentResponse>), AppError> {
    req.validate()?;

    let ip = addr.ip().to_string();
    let recent: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM agents \
         WHERE registered_ip = $1::inet \
           AND created_at > now() - ($2 * interval '1 second')",
    )
    .bind(&ip)
    .bind(state.settings.security.agent_registration_window as i64)
    .fetch_one(&state.pool)
    .await
    .map_err(AppError::Database)?;

    if recent >= state.settings.security.max_agent_registrations as i64 {
        return Err(AppError::RateLimit(
            "Too many agent registrations; try again later".to_string(),
        ));
    }

    let secret = generate_opaque_secret();
    let (agent_id, kind, status): (Uuid, String, String) = sqlx::query_as(
        "INSERT INTO agents (display_name, description, secret_hash, registered_ip) \
         VALUES ($1, $2, encode(digest($3, 'sha256'), 'hex'), $4::inet) \
         RETURNING agent_id, kind, status",
    )
    .bind(&req.display_name)
    .bind(req.description.as_deref())
    .bind(&secret)
    .bind(&ip)
    .fetch_one(&state.pool)
    .await
    .map_err(AppError::Database)?;

    tracing::info!(agent_id = %agent_id, name = %req.display_name, "🤖 agent registered");

    Ok((
        StatusCode::CREATED,
        Json(RegisterAgentResponse {
            agent_id,
            agent_secret: secret,
            display_name: req.display_name,
            kind,
            status,
        }),
    ))
}

/// Public agent metadata — lets a user inspect an agent before mandating it.
/// Never exposes the secret (or its hash).
async fn get_agent(
    State(state): State<AppState>,
    Path(agent_id): Path<Uuid>,
) -> Result<Json<AgentPublic>, AppError> {
    let agent = sqlx::query_as::<_, AgentPublic>(
        "SELECT agent_id, display_name, description, kind, status, created_at \
         FROM agents WHERE agent_id = $1",
    )
    .bind(agent_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(AppError::Database)?
    .ok_or_else(|| AppError::NotFound("agent not found".to_string()))?;

    Ok(Json(agent))
}
