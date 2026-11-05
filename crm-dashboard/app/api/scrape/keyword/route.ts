import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

type YouTubeItem = {
  id?: { channelId?: string; videoId?: string };
  snippet?: {
    channelId?: string;
    title?: string;
    description?: string;
  };
};

type SearchType = "channel" | "video";
type Campaign = {
  id: string;
  keywords: string[];
  search_types: SearchType[];
  max_results: number;
  status: "running" | "complete";
  completed_keywords: string[];
};

type YouTubeChannel = {
  id?: string;
  snippet?: {
    title?: string;
    description?: string;
    customUrl?: string;
    country?: string;
    thumbnails?: { high?: { url?: string } };
  };
  statistics?: {
    subscriberCount?: string;
    hiddenSubscriberCount?: boolean;
    viewCount?: string;
    videoCount?: string;
  };
};

const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profileError || profile?.role !== "admin") {
    return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "YouTube search is not configured yet. Add YOUTUBE_API_KEY to the Vercel Production environment variables." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const input = body as { campaignId?: unknown; keyword?: unknown };
  if (
    typeof input.campaignId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.campaignId) ||
    typeof input.keyword !== "string" ||
    input.keyword.trim().length < 1 ||
    input.keyword.trim().length > 200
  ) {
    return NextResponse.json({ error: "Enter a valid campaign and search phrase." }, { status: 400 });
  }

  const { data: campaignData, error: campaignError } = await supabase
    .from("scrape_campaigns")
    .select("id, keywords, search_types, max_results, status, completed_keywords")
    .eq("id", input.campaignId)
    .eq("created_by", user.id)
    .single();

  if (campaignError || !campaignData || !isCampaign(campaignData)) {
    return NextResponse.json({ error: "This scrape campaign has invalid or unavailable settings." }, { status: 404 });
  }
  const campaign = campaignData;
  if (campaign.status !== "running") {
    return NextResponse.json({ error: "This campaign is unavailable or already complete." }, { status: 404 });
  }

  const keyword = input.keyword.trim();
  if (!campaign.keywords.includes(keyword) || campaign.completed_keywords.includes(keyword)) {
    return NextResponse.json({ error: "This phrase is not pending in the campaign." }, { status: 409 });
  }

  try {
    const searchResults = await Promise.all(campaign.search_types.map(async (searchType) => {
      const params = new URLSearchParams({
        part: "snippet",
        q: keyword,
        type: searchType,
        maxResults: String(campaign.max_results),
        regionCode: "US",
        relevanceLanguage: "en",
        safeSearch: "none",
        order: "relevance",
        fields: "items(id(channelId,videoId),snippet(title,description,channelId))",
        key: apiKey,
      });
      return youtubeRequest<{ items?: YouTubeItem[] }>(
        `${YOUTUBE_API}/search?${params.toString()}`,
      );
    }));
    const items = searchResults.flatMap((result) => result.items ?? []);

    const channels = new Map<string, { titles: Set<string>; descriptions: Set<string> }>();
    for (const item of items) {
      const channelId = item.snippet?.channelId || item.id?.channelId;
      if (!channelId) continue;
      const found = channels.get(channelId) ?? { titles: new Set<string>(), descriptions: new Set<string>() };
      if (item.snippet?.title) found.titles.add(item.snippet.title);
      if (item.snippet?.description) found.descriptions.add(item.snippet.description);
      channels.set(channelId, found);
    }

    const channelIds = [...channels.keys()];
    const metadata = channelIds.length
      ? await youtubeRequest<{ items?: YouTubeChannel[] }>(
          `${YOUTUBE_API}/channels?${new URLSearchParams({
            part: "snippet,statistics",
            id: channelIds.join(","),
            maxResults: "50",
            fields: "items(id,snippet(title,description,customUrl,country,thumbnails(high(url))),statistics(subscriberCount,hiddenSubscriberCount,viewCount,videoCount))",
            key: apiKey,
          }).toString()}`,
        )
      : { items: [] };

    const keywordLeads = (metadata.items ?? []).flatMap((channel) => {
      const channelId = channel.id;
      if (!channelId) return [];
      const snippet = channel.snippet ?? {};
      const statistics = channel.statistics ?? {};
      const description = snippet.description ?? "";
      const emails = [...new Set(description.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [])]
        .map((email) => email.toLowerCase());
      const matched = channels.get(channelId);
      const subscriberCount = toSafeInteger(statistics.subscriberCount);
      const data: Record<string, string> = {
        channel_description: description,
        source_keywords_all: keyword,
        source_types_all: campaign.search_types.join(", "),
        matched_titles_all: [...(matched?.titles ?? [])].join(" | "),
        matched_descriptions_all: [...(matched?.descriptions ?? [])].join(" | "),
        country: snippet.country ?? "",
        channel_custom_url: snippet.customUrl ?? "",
        thumbnail_url: snippet.thumbnails?.high?.url ?? "",
        video_count: statistics.videoCount ?? "",
        view_count: statistics.viewCount ?? "",
        hidden_subscriber_count: String(statistics.hiddenSubscriberCount ?? false),
      };

      return [{
        channel_id: channelId,
        channel_name: snippet.title ?? "",
        channel_url: snippet.customUrl
          ? `https://www.youtube.com/${snippet.customUrl}`
          : `https://www.youtube.com/channel/${channelId}`,
        public_email: emails.join(", "),
        subscriber_count: subscriberCount,
        lead_score: scoreLead(snippet.title ?? "", description, keyword, subscriberCount, emails.length > 0),
        data,
      }];
    });

    const { data: result, error: saveError } = await supabase.rpc("record_scrape_keyword", {
      p_campaign_id: campaign.id,
      p_keyword: keyword,
      p_leads: keywordLeads,
    });
    if (saveError) {
      return NextResponse.json({ error: `Could not save search results: ${saveError.message}` }, { status: 500 });
    }
    if (
      !isRecord(result) ||
      typeof result.new_leads !== "number" ||
      !Number.isInteger(result.new_leads) ||
      typeof result.duplicates !== "number" ||
      !Number.isInteger(result.duplicates)
    ) {
      return NextResponse.json({ error: "Search results were saved, but the campaign summary was invalid." }, { status: 500 });
    }

    return NextResponse.json({
      keyword,
      found: keywordLeads.length,
      newLeads: result.new_leads,
      duplicates: result.duplicates,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The YouTube search failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

function isCampaign(value: unknown): value is Campaign {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    isStringArray(value.keywords) &&
    isSearchTypeArray(value.search_types) &&
    typeof value.max_results === "number" &&
    Number.isInteger(value.max_results) &&
    value.max_results >= 1 &&
    value.max_results <= 25 &&
    (value.status === "running" || value.status === "complete") &&
    isStringArray(value.completed_keywords)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === "string");
}

function isSearchTypeArray(value: unknown): value is SearchType[] {
  return Array.isArray(value) && value.every((item: unknown) => item === "channel" || item === "video");
}

async function youtubeRequest<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  const payload = await response.json() as { error?: { message?: string; errors?: { reason?: string }[] } } & T;
  if (!response.ok) {
    const reason = payload.error?.errors?.[0]?.reason;
    const detail = reason === "quotaExceeded" || reason === "dailyLimitExceeded"
      ? "YouTube API quota exceeded for today."
      : payload.error?.message ?? `YouTube API returned HTTP ${response.status}.`;
    throw new Error(detail);
  }
  return payload;
}

function toSafeInteger(value?: string) {
  if (!value) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function scoreLead(name: string, description: string, keyword: string, subscribers: number | null, hasEmail: boolean) {
  const text = `${name} ${description} ${keyword}`.toLowerCase();
  const terms = ["onlyfans", "creator", "content", "subscription", "marketing", "promotion", "business", "audience"];
  const termScore = terms.reduce((score, term) => score + (text.includes(term) ? 8 : 0), 0);
  const subscriberScore = subscribers === null ? 0 : subscribers >= 100_000 ? 20 : subscribers >= 25_000 ? 15 : subscribers >= 5_000 ? 10 : subscribers >= 1_000 ? 5 : 0;
  return termScore + subscriberScore + (hasEmail ? 25 : 0);
}
