use serde::de::Deserializer;
use serde::{Deserialize, Serialize};

// ─── User Profile ───────────────────────────────────────────────────────────

fn deserialize_id_flexible<'de, D>(deserializer: D) -> Result<i64, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum IdValue {
        Int(i64),
        Str(String),
    }

    match Option::<IdValue>::deserialize(deserializer)? {
        Some(IdValue::Int(i)) => Ok(i),
        Some(IdValue::Str(s)) => s.parse::<i64>().unwrap_or(0).pipe(Ok),
        None => Ok(0),
    }
}

trait Pipe: Sized {
    fn pipe<F, R>(self, f: F) -> R
    where
        F: FnOnce(Self) -> R,
    {
        f(self)
    }
}

impl<T> Pipe for T {}

fn deserialize_avatar_flexible<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum AvatarValue {
        Str(String),
        Obj { src: String },
    }

    match Option::<AvatarValue>::deserialize(deserializer)? {
        Some(AvatarValue::Str(s)) => {
            if s.is_empty() {
                Ok(None)
            } else if s.starts_with("http") {
                Ok(Some(s))
            } else {
                let formatted = s.replace("{size}", "300x300");
                Ok(Some(format!("https://zvuk.com{}", formatted)))
            }
        }
        Some(AvatarValue::Obj { src }) => {
            if src.is_empty() {
                Ok(None)
            } else if src.starts_with("http") {
                Ok(Some(src))
            } else {
                let formatted = src.replace("{size}", "300x300");
                Ok(Some(format!("https://zvuk.com{}", formatted)))
            }
        }
        None => Ok(None),
    }
}

// Raw helper used to deserialize the Zvuk API profile response.
// The actual response has BOTH `name` (display name) and `username` (login like "U12345")
// as separate fields, which would cause a serde alias collision. We capture them
// separately and pick the best one.
#[derive(Debug, Deserialize)]
struct UserProfileRaw {
    #[serde(default, deserialize_with = "deserialize_id_flexible", alias = "user_id", alias = "uid")]
    id: i64,
    // Display name ("Corvych")
    #[serde(default)]
    name: Option<String>,
    // Login name ("U155698601") — less useful
    #[serde(default)]
    username: Option<String>,
    #[serde(default, alias = "display_name", alias = "title")]
    display_name: Option<String>,
    #[serde(default)]
    email: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_avatar_flexible",
        alias = "image",
        alias = "avatar",
        alias = "image_url",
        alias = "picture"
    )]
    avatar_url: Option<String>,
    #[serde(default)]
    is_anonymous: bool,
    #[serde(default)]
    is_registered: bool,
    #[serde(default)]
    subscription: Option<Subscription>,
}

#[derive(Debug, Clone, Serialize)]
pub struct UserProfile {
    pub id: i64,
    /// Best available display name: name > display_name > username
    pub username: Option<String>,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
    pub is_anonymous: bool,
    pub is_registered: bool,
    pub subscription: Option<Subscription>,
}

impl<'de> serde::Deserialize<'de> for UserProfile {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = UserProfileRaw::deserialize(deserializer)?;
        let best_name = raw.name
            .filter(|s| !s.is_empty())
            .or_else(|| raw.display_name.filter(|s| !s.is_empty()))
            .or_else(|| raw.username.clone().filter(|s| !s.is_empty() && !s.starts_with('U')))
            .or(raw.username);
        Ok(UserProfile {
            id: raw.id,
            username: best_name,
            email: raw.email,
            avatar_url: raw.avatar_url,
            is_anonymous: raw.is_anonymous,
            is_registered: raw.is_registered,
            subscription: raw.subscription,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subscription {
    #[serde(default, alias = "isPrime")]
    pub is_prime: bool,
    #[serde(default, alias = "expirationDate")]
    pub expiration_date: Option<String>,
    #[serde(default)]
    pub plan: Option<String>,
    #[serde(default)]
    pub is_active: bool,
    #[serde(default)]
    pub is_hifi: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthSession {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub device_id: Option<String>,
    #[serde(default)]
    pub at: Option<String>,
    #[serde(default)]
    pub rt: Option<String>,
}

// ─── Tracks ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackArtist {
    pub id: i64,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub palette: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Track {
    pub id: i64,
    pub title: String,
    pub duration: u32, // seconds
    pub artist: String,
    pub artist_id: Option<i64>,
    #[serde(default)]
    pub artists: Vec<TrackArtist>,
    pub album: Option<String>,
    pub album_id: Option<i64>,
    pub cover_url: Option<String>,
    pub palette: Option<String>,
    pub release_year: Option<u16>,
    pub is_explicit: bool,
    pub is_liked: Option<bool>,
    pub has_flac: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListeningHistoryItem {
    pub last_listening_dttm: Option<String>,
    pub track: Track,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamInfo {
    pub url: String,
    pub quality: StreamQuality,
    pub codec: String,
    pub bitrate: Option<u32>,
    pub is_drm: bool,
    pub license_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum StreamQuality {
    Low,
    Mid,
    High,
    Flac,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LyricsInfo {
    pub lyrics: String,
    pub is_synced: bool,
    pub translation: Option<String>,
}

// ─── Albums / Releases ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Album {
    pub id: i64,
    pub title: String,
    pub artist: String,
    pub artist_id: Option<i64>,
    #[serde(default)]
    pub artists: Vec<TrackArtist>,
    pub cover_url: Option<String>,
    pub release_year: Option<u16>,
    pub track_count: u32,
    pub tracks: Option<Vec<Track>>,
    pub is_liked: Option<bool>,
}


// ─── Artists ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Artist {
    pub id: i64,
    pub name: String,
    pub avatar_url: Option<String>,
    pub description: Option<String>,
    pub albums: Option<Vec<Album>>,
    pub top_tracks: Option<Vec<Track>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistGenre {
    pub id: String,
    pub name: String,
    pub rname: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistRelease {
    pub id: i64,
    pub title: String,
    pub date: Option<String>,
    pub release_type: Option<String>,
    pub cover_url: Option<String>,
    pub palette: Option<String>,
    pub explicit: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelatedArtist {
    pub id: i64,
    pub title: String,
    pub image_url: Option<String>,
    pub palette: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistDetail {
    pub id: i64,
    pub title: String,
    pub description: Option<String>,
    pub image_url: Option<String>,
    pub palette: Option<String>,
    pub genres: Vec<ArtistGenre>,
    pub likes_count: Option<u64>,
    pub popular_tracks: Vec<Track>,
    pub all_track_ids: Vec<i64>,
    pub actual_release: Option<ArtistRelease>,
    pub releases: Vec<ArtistRelease>,
    pub has_more_releases: bool,
    pub end_cursor: Option<String>,
    pub related_artists: Vec<RelatedArtist>,
}


// ─── Playlists ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Playlist {
    pub id: i64,
    pub title: String,
    pub description: Option<String>,
    pub cover_url: Option<String>,
    pub track_count: u32,
    pub duration: u32, // total seconds
    pub is_editable: bool,
    pub owner: Option<String>,
    pub tracks: Option<Vec<Track>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePlaylistRequest {
    pub title: String,
    pub description: Option<String>,
}

// ─── Search ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResults {
    pub tracks: Vec<Track>,
    pub albums: Vec<Album>,
    pub artists: Vec<Artist>,
    pub playlists: Vec<Playlist>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutocompleteResult {
    pub text: String,
    pub result_type: String, // "track", "artist", "album"
    pub id: Option<i64>,
}

// ─── Sound Energy / Flow / Personal Wave ────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalWaveContentInput {
    pub track_id: String,
    pub track_duration: u32,
    pub play_duration: u32,
    pub is_skipped: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PersonalWaveOptions {
    #[serde(default)]
    pub popular: Option<serde_json::Value>,
    #[serde(default)]
    pub mood: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlowState {
    pub tracks: Vec<Track>,
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TunerSettings {
    /// -1.0 (calm) to 1.0 (energetic)
    pub energy: f32,
    /// -1.0 (familiar) to 1.0 (discovery)
    pub discovery: f32,
    /// -1.0 (sad) to 1.0 (happy)
    pub mood: f32,
    /// -1.0 (niche) to 1.0 (trending)
    pub popularity: f32,
}

impl Default for TunerSettings {
    fn default() -> Self {
        Self {
            energy: 0.0,
            discovery: 0.0,
            mood: 0.0,
            popularity: 0.0,
        }
    }
}

// ─── Favourites / Collection ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionPage<T> {
    pub items: Vec<T>,
    pub total: u32,
    pub has_next: bool,
    pub offset: u32,
}

// ─── Explore / Charts ───────────────────────────────────────────────────────

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Genre {
    pub id: String,
    pub name: String,
    pub cover_url: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChartEntry {
    pub position: u32,
    pub track: Track,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicRecommendationItem {
    pub item_type: String,
    pub id: String,
    pub title: String,
    pub subtitle: Option<String>,
    pub image_url: Option<String>,
    pub palette: Option<String>,
    pub explicit: bool,
    pub track_count: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistRadioResult {
    pub cursor: u32,
    pub tracks: Vec<Track>,
}

