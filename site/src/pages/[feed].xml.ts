import type { APIRoute, GetStaticPaths } from "astro";
import type { FeedKind } from "../lib/content.ts";
import { atomFeedResponse, FEED_KINDS } from "../lib/feed.ts";

type Props = { readonly feed: FeedKind };
export const getStaticPaths: GetStaticPaths = () => FEED_KINDS.map((feed) => ({ params: { feed: feed === "all" ? "feed" : feed }, props: { feed } }));

export const GET: APIRoute<Props> = async ({ props, site }) => {
  return atomFeedResponse(props.feed, site ?? new URL("https://example.invalid"), false);
};
