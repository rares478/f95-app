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
    #[serde(default)]
    pub donations: Option<String>,
    #[serde(rename = "userBanners", default)]
    pub user_banners: Vec<ProfileBadge>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(rename = "profilePosts", default)]
    pub profile_posts: Vec<ProfilePostItem>,
    #[serde(rename = "extraStats", default)]
    pub extra_stats: BTreeMap<String, String>,
    #[serde(default)]
    pub activity: Vec<ActivityItem>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProfileBadge {
    pub label: String,
    pub variant: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProfilePostItem {
    #[serde(rename = "authorName")]
    pub author_name: String,
    #[serde(rename = "authorAvatarUrl")]
    pub author_avatar_url: Option<String>,
    #[serde(rename = "messageHtml")]
    pub message_html: Option<String>,
    #[serde(rename = "messageText")]
    pub message_text: String,
    pub date: Option<String>,
    pub url: Option<String>,
}
