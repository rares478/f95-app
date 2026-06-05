use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Serialize, Deserialize)]
pub struct ActivityItem {
    #[serde(rename = "avatarUrl")]
    pub avatar_url: Option<String>,
    pub title: String,
    pub snippet: Option<String>,
    pub date: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProfileDto {
    pub username: String,
    #[serde(rename = "avatarUrl")]
    pub avatar_url: Option<String>,
    pub alerts: u32,
    pub conversations: u32,
    #[serde(rename = "userId")]
    pub user_id: Option<String>,
    #[serde(rename = "profileUrl", default)]
    pub profile_url: Option<String>,
    #[serde(rename = "userBanner", default)]
    pub user_banner: Option<String>,
    #[serde(rename = "customTitle", default)]
    pub custom_title: Option<String>,
    #[serde(rename = "joinedAt", default)]
    pub joined_at: Option<String>,
    #[serde(rename = "lastSeen", default)]
    pub last_seen: Option<String>,
    #[serde(rename = "messagesCount", default)]
    pub messages_count: Option<i64>,
    #[serde(rename = "reactionScore", default)]
    pub reaction_score: Option<i64>,
    #[serde(rename = "trophyPoints", default)]
    pub trophy_points: Option<i64>,
    #[serde(default)]
    pub points: Option<i64>,
    #[serde(rename = "ratingsReceived", default)]
    pub ratings_received: Option<i64>,
    #[serde(rename = "extraStats", default)]
    pub extra_stats: BTreeMap<String, String>,
    #[serde(default)]
    pub activity: Vec<ActivityItem>,
}
