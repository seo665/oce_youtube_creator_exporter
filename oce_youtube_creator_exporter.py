"""
Online CE Credits - YouTube Creator Lead Exporter

What it does:
1. Searches YouTube for channels/videos around Online CE Credits niche keywords.
2. Deduplicates creators by channel_id.
3. Fetches public channel metadata.
4. Extracts public emails from channel descriptions only.
5. Marks rows with no public email as "manual_entry_required".
6. Exports CSV files.

Important:
- This uses the official YouTube Data API.
- It does NOT bypass YouTube's hidden "View email address" flow.
- It only extracts emails creators publicly typed into their channel descriptions.

Setup:
pip install requests pandas python-dotenv

Create a .env file:
YOUTUBE_API_KEY=your_api_key_here

Run:
python oce_youtube_creator_exporter.py
"""

import os
import re
import time
import html
import hashlib
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
from typing import Dict, List, Any, Iterable, Optional, Tuple

import requests
import pandas as pd
from dotenv import load_dotenv


load_dotenv()

YOUTUBE_API_KEY = os.getenv("YOUTUBE_API_KEY")

if not YOUTUBE_API_KEY:
    raise RuntimeError("Missing YOUTUBE_API_KEY. Add it to a .env file or environment variable.")


SEARCH_URL = "https://www.googleapis.com/youtube/v3/search"
CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels"
VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos"

OUTPUT_DIR = "exports"

# Keep this conservative for first run.
# Each search request uses the search quota bucket.
# Use 25 per request so each keyword returns 25 channel + 25 video results.
MAX_PAGES_PER_QUERY = 1
MAX_RESULTS_PER_PAGE = 25
SLEEP_BETWEEN_REQUESTS = 1.0  # Increased from 0.15s to throttle API calls
MAX_RETRIES = 3  # Retry failed requests up to 3 times with exponential backoff

# Keyword batch 4 for onlinececredits.com - 50 diverse keywords across coaching, wellness, and specialized modalities.
KEYWORDS = [
    "life coaching certification",
    "executive coaching training",
    "wellness coaching certification",
    "health coaching continuing education",
    "business coaching online",
    "leadership development training",
    "communication skills workshop",
    "conflict resolution training",
    "yoga teacher certification",
    "meditation instructor training",
    "reiki master training",
    "energy healing certification",
    "crystal healing workshop",
    "acupuncture continuing education",
    "massage therapy license",
    "pilates instructor certification",
    "fitness coach certification",
    "nutrition counseling training",
    "dance therapy CE credits",
    "music therapy certification",
    "creative writing workshop",
    "spiritual coaching training",
    "life purpose coaching",
    "divorce counseling training",
    "financial therapy certification",
    "career coaching training",
    "relationship coaching CE",
    "parent coaching certification",
    "substance abuse treatment",
    "eating disorder treatment training",
    "bipolar disorder therapy",
    "schizophrenia treatment training",
    "OCD treatment CE",
    "anxiety management training",
    "stress management workshop",
    "burnout prevention training",
    "wellness retreat facilitator",
    "group facilitation training",
    "team building workshop",
    "organizational development training",
    "human resources training",
    "project management training",
    "customer service training",
    "sales training workshop",
    "public speaking coaching",
    "presentation skills training",
    "mindset coaching certification",
    "habit coaching training",
    "goal setting workshop",
    "personal development training",
]

REGION_CODES = ["US"]  # Using US only to reduce quota usage.
RELEVANCE_LANGUAGES = ["en"]

# Search modes:
# - channel search finds obvious channel matches.
# - video search finds creators ranking videos for the niche even if their channel bio does not match.
SEARCH_TYPES = ["channel", "video"]

# Exclude obvious bad-fit channel patterns.
EXCLUDE_NAME_PATTERNS = [
    r"\bfull movie\b",
    r"\bmusic\b",
    r"\bkaraoke\b",
    r"\blyrics\b",
    r"\bASMR\b",
]

# Higher score = more likely useful for OCE outreach.
OCE_FIT_TERMS = [
    "therapist", "therapy", "counselor", "counselling", "counseling",
    "psychologist", "psychotherapy", "social worker", "lcsw", "lmft",
    "lpc", "mft", "mental health", "trauma", "emdr", "cbt", "dbt",
    "somatic", "play therapy", "clinical", "supervision", "ce credits",
    "continuing education", "ceu", "ceus"
]


def request_get(url: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """Make API request with exponential backoff on rate limit errors."""
    params["key"] = YOUTUBE_API_KEY
    
    for attempt in range(MAX_RETRIES):
        try:
            r = requests.get(url, params=params, timeout=30)
            
            # Check for rate limit error (429)
            if r.status_code == 429:
                if attempt < MAX_RETRIES - 1:
                    # Exponential backoff: 2s, 4s, 8s
                    wait_time = 2 ** (attempt + 1)
                    print(f"    Rate limited. Waiting {wait_time}s before retry (attempt {attempt + 1}/{MAX_RETRIES})...")
                    time.sleep(wait_time)
                    continue
                else:
                    # Max retries exceeded
                    raise RuntimeError(f"API error {r.status_code}: Quota exceeded after {MAX_RETRIES} retries")
            
            # Check for other errors
            if not r.ok:
                raise RuntimeError(f"API error {r.status_code}: {r.text[:1000]}")
            
            # Success - wait before returning
            time.sleep(SLEEP_BETWEEN_REQUESTS)
            return r.json()
            
        except requests.exceptions.RequestException as e:
            if attempt < MAX_RETRIES - 1:
                wait_time = 2 ** (attempt + 1)
                print(f"    Request failed: {e}. Waiting {wait_time}s before retry...")
                time.sleep(wait_time)
                continue
            else:
                raise RuntimeError(f"Request failed after {MAX_RETRIES} retries: {e}")
    
    raise RuntimeError("Unexpected error in request_get")


def clean_text(value: Optional[str]) -> str:
    if not value:
        return ""
    value = html.unescape(value)
    value = value.replace("\r", "\n")
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def normalize_obfuscated_email_text(text: str) -> str:
    """
    Converts common human-readable email obfuscations into a regex-detectable form.
    Examples:
    hello [at] site [dot] com -> hello@site.com
    hello at site dot com -> hello@site.com
    """
    if not text:
        return ""

    normalized = text

    replacements = [
        (r"\s*\[\s*at\s*\]\s*", "@"),
        (r"\s*\(\s*at\s*\)\s*", "@"),
        (r"\s+at\s+", "@"),
        (r"\s*\[\s*dot\s*\]\s*", "."),
        (r"\s*\(\s*dot\s*\)\s*", "."),
        (r"\s+dot\s+", "."),
    ]

    for pattern, repl in replacements:
        normalized = re.sub(pattern, repl, normalized, flags=re.IGNORECASE)

    return normalized


def extract_emails(text: str) -> Tuple[List[str], str]:
    """
    Extracts emails from public description text.
    Returns unique emails + confidence.
    """
    original = text or ""
    normalized = normalize_obfuscated_email_text(original)

    # Conservative email regex.
    email_regex = re.compile(
        r"\b[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}\b",
        re.IGNORECASE,
    )

    found = email_regex.findall(normalized)

    cleaned = []
    for email in found:
        e = email.strip(".,;:()[]{}<>").lower()
        # Remove www. from domain part if present
        e = re.sub(r"@www\.", "@", e)
        if len(e) > 5 and not e.endswith((".png", ".jpg", ".jpeg", ".webp")):
            cleaned.append(e)

    unique = sorted(set(cleaned))

    if not unique:
        return [], "none"

    # If it came from normalized obfuscation rather than the original exact text, call it medium.
    confidence = "high" if any(e in original.lower() for e in unique) else "medium"
    return unique, confidence


def extract_links(text: str) -> List[str]:
    if not text:
        return []
    url_regex = re.compile(r"https?://[^\s\]\)\}<>\"']+", re.IGNORECASE)
    links = []
    for url in url_regex.findall(text):
        url = url.strip(".,;:()[]{}<>\"'")
        links.append(url)
    return sorted(set(links))


def is_excluded_channel_name(name: str) -> bool:
    for pattern in EXCLUDE_NAME_PATTERNS:
        if re.search(pattern, name or "", flags=re.IGNORECASE):
            return True
    return False


def search_youtube(keyword: str, search_type: str, region_code: str, relevance_language: str) -> List[Dict[str, Any]]:
    rows = []
    page_token = None

    for page in range(MAX_PAGES_PER_QUERY):
        params = {
            "part": "snippet",
            "q": keyword,
            "type": search_type,
            "maxResults": MAX_RESULTS_PER_PAGE,
            "regionCode": region_code,
            "relevanceLanguage": relevance_language,
            "safeSearch": "none",
            "order": "relevance",
            "fields": "items(id,snippet(title,description,publishedAt,channelId)),nextPageToken",
        }

        if page_token:
            params["pageToken"] = page_token

        try:
            data = request_get(SEARCH_URL, params)
        except Exception as exc:
            print(f"    WARN: search failed for '{keyword}' | {search_type} | {region_code} | {relevance_language} page {page + 1}: {exc}")
            break

        items = data.get("items", [])

        for item in items:
            snippet = item.get("snippet", {})
            item_id = item.get("id", {})
            channel_id = snippet.get("channelId")

            # In type=channel result, channel id may be item["id"]["channelId"].
            if search_type == "channel":
                channel_id = item_id.get("channelId") or channel_id

            if not channel_id:
                continue

            rows.append({
                "channel_id": channel_id,
                "source_keyword": keyword,
                "source_type": search_type,
                "region_code": region_code,
                "relevance_language": relevance_language,
                "video_id": item_id.get("videoId", ""),
                "matched_title": clean_text(snippet.get("title")),
                "matched_description": clean_text(snippet.get("description")),
                "matched_published_at": snippet.get("publishedAt", ""),
            })

        page_token = data.get("nextPageToken")
        if not page_token:
            break

    return rows


def chunked(items: List[str], size: int) -> Iterable[List[str]]:
    for i in range(0, len(items), size):
        yield items[i:i + size]


def fetch_channels(channel_ids: List[str]) -> List[Dict[str, Any]]:
    output = []

    # YouTube channels.list accepts comma-separated IDs. Keep chunks at 50.
    for ids in chunked(channel_ids, 50):
        params = {
            "part": "snippet,statistics",
            "id": ",".join(ids),
            "maxResults": 50,
            "fields": "items(id,snippet(title,description,customUrl,publishedAt,country,thumbnails),statistics(subscriberCount,hiddenSubscriberCount,viewCount,videoCount))",
        }
        try:
            data = request_get(CHANNELS_URL, params)
        except Exception as exc:
            print(f"    WARN: channels fetch failed for {len(ids)} channels: {exc}")
            continue

        for item in data.get("items", []):
            snippet = item.get("snippet", {})
            stats = item.get("statistics", {})

            output.append({
                "channel_id": item.get("id", ""),
                "channel_name": clean_text(snippet.get("title")),
                "channel_description": clean_text(snippet.get("description")),
                "custom_url": snippet.get("customUrl", ""),
                "channel_published_at": snippet.get("publishedAt", ""),
                "country": snippet.get("country", ""),
                "subscriber_count": int(stats.get("subscriberCount", 0)) if stats.get("subscriberCount") else None,
                "hidden_subscriber_count": stats.get("hiddenSubscriberCount", False),
                "view_count": int(stats.get("viewCount", 0)) if stats.get("viewCount") else None,
                "video_count": int(stats.get("videoCount", 0)) if stats.get("videoCount") else None,
                "thumbnail_url": snippet.get("thumbnails", {}).get("high", {}).get("url", ""),
            })

    return output


def score_oce_fit(row: Dict[str, Any]) -> int:
    blob = " ".join([
        row.get("channel_name", ""),
        row.get("channel_description", ""),
        row.get("source_keywords_all", ""),
        row.get("matched_titles_all", ""),
    ]).lower()

    score = 0

    for term in OCE_FIT_TERMS:
        if term in blob:
            score += 8

    subscribers = row.get("subscriber_count")
    if isinstance(subscribers, int):
        if subscribers >= 100000:
            score += 20
        elif subscribers >= 25000:
            score += 15
        elif subscribers >= 5000:
            score += 10
        elif subscribers >= 1000:
            score += 5

    video_count = row.get("video_count")
    if isinstance(video_count, int):
        if video_count >= 100:
            score += 10
        elif video_count >= 25:
            score += 5

    if row.get("public_email"):
        score += 25

    # Slight penalty for less-aligned adjacent niches.
    lower_keywords = row.get("source_keywords_all", "").lower()
    if "esthetician" in lower_keywords and not any(t in blob for t in ["therapy", "mental health", "counselor", "clinical"]):
        score -= 10

    return max(score, 0)


def make_channel_url(channel_id: str, custom_url: str = "") -> str:
    if custom_url:
        handle = custom_url if custom_url.startswith("@") else custom_url
        return f"https://www.youtube.com/{handle}"
    return f"https://www.youtube.com/channel/{channel_id}"


def main() -> None:
    Path(OUTPUT_DIR).mkdir(exist_ok=True)

    raw_results = []

    print("Searching YouTube...")
    for keyword in KEYWORDS:
        for search_type in SEARCH_TYPES:
            for region in REGION_CODES:
                for lang in RELEVANCE_LANGUAGES:
                    print(f"  - {keyword} | {search_type} | {region} | {lang}")
                    try:
                        raw_results.extend(search_youtube(keyword, search_type, region, lang))
                    except Exception as e:
                        print(f"    ERROR: {e}")

    raw_df = pd.DataFrame(raw_results)
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H-%M-%S")

    raw_path = f"{OUTPUT_DIR}/oce_youtube_raw_search_{timestamp}.csv"
    raw_df.to_csv(raw_path, index=False)

    if raw_df.empty:
        print("No results found.")
        return

    # Aggregate source keywords/titles per channel.
    agg = raw_df.groupby("channel_id").agg({
        "source_keyword": lambda x: ", ".join(sorted(set(x))),
        "source_type": lambda x: ", ".join(sorted(set(x))),
        "region_code": lambda x: ", ".join(sorted(set(x))),
        "matched_title": lambda x: " | ".join(list(dict.fromkeys([v for v in x if v]))[:10]),
        "matched_description": lambda x: " | ".join(list(dict.fromkeys([v for v in x if v]))[:5]),
    }).reset_index()

    agg = agg.rename(columns={
        "source_keyword": "source_keywords_all",
        "source_type": "source_types_all",
        "region_code": "region_codes_all",
        "matched_title": "matched_titles_all",
        "matched_description": "matched_descriptions_all",
    })

    channel_ids = agg["channel_id"].dropna().unique().tolist()

    print(f"Unique channels found: {len(channel_ids)}")
    print("Fetching channel metadata...")

    channel_rows = fetch_channels(channel_ids)
    channel_df = pd.DataFrame(channel_rows)

    merged = agg.merge(channel_df, on="channel_id", how="left")

    final_rows = []
    for _, r in merged.iterrows():
        row = r.to_dict()

        channel_name = row.get("channel_name", "") or ""
        description = row.get("channel_description", "") or ""

        if is_excluded_channel_name(channel_name):
            continue

        emails, confidence = extract_emails(description)
        links = extract_links(description)

        public_email = ", ".join(emails)
        email_status = "email_found" if emails else "manual_entry_required"
        manual_reason = "" if emails else "no public email in YouTube channel description"

        row["channel_url"] = make_channel_url(row.get("channel_id", ""), row.get("custom_url", ""))
        row["public_email"] = public_email
        row["email_status"] = email_status
        row["email_confidence"] = confidence
        row["manual_reason"] = manual_reason
        row["manual_next_step"] = "" if emails else "Check About tab manually, then creator website, Instagram, Linktree, or professional site."
        row["website_or_social_links_found"] = ", ".join(links)
        row["lead_score"] = score_oce_fit(row)
        row["date_scraped_utc"] = datetime.now(timezone.utc).isoformat()

        final_rows.append(row)

    final_df = pd.DataFrame(final_rows)

    preferred_cols = [
        "lead_score",
        "channel_name",
        "channel_url",
        "channel_id",
        "public_email",
        "email_status",
        "email_confidence",
        "manual_reason",
        "manual_next_step",
        "subscriber_count",
        "view_count",
        "video_count",
        "country",
        "source_keywords_all",
        "source_types_all",
        "region_codes_all",
        "custom_url",
        "channel_published_at",
        "channel_description",
        "website_or_social_links_found",
        "matched_titles_all",
        "matched_descriptions_all",
        "thumbnail_url",
        "date_scraped_utc",
    ]

    existing_cols = [c for c in preferred_cols if c in final_df.columns]
    final_df = final_df[existing_cols].sort_values(
        by=["email_status", "lead_score", "subscriber_count"],
        ascending=[True, False, False],
        na_position="last"
    )

    final_path = f"{OUTPUT_DIR}/oce_youtube_creator_leads_{timestamp}.csv"
    emails_path = f"{OUTPUT_DIR}/oce_youtube_email_found_{timestamp}.csv"
    manual_path = f"{OUTPUT_DIR}/oce_youtube_manual_entry_required_{timestamp}.csv"

    final_df.to_csv(final_path, index=False)
    final_df[final_df["email_status"] == "email_found"].to_csv(emails_path, index=False)
    final_df[final_df["email_status"] == "manual_entry_required"].to_csv(manual_path, index=False)

    print("\nDone.")
    print(f"Raw search export: {raw_path}")
    print(f"Final lead export: {final_path}")
    print(f"Emails found export: {emails_path}")
    print(f"Manual entry export: {manual_path}")
    print(f"Total final leads: {len(final_df)}")
    print(f"Emails found: {(final_df['email_status'] == 'email_found').sum()}")
    print(f"Manual needed: {(final_df['email_status'] == 'manual_entry_required').sum()}")


if __name__ == "__main__":
    main()
