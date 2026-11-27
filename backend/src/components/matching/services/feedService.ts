import { ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors';
import type { Listing } from '../../posts/models/listing';
import type { BuyerRequest } from '../../posts/models/request';
import type { PostFilter, PostKind, PostOf, PostsService } from '../../posts/services/postsService';
import { distanceKm } from './distance';
import { DEFAULT_WEIGHTS, asPair, isRequest, rank, type Post } from './rank';
import { satisfies } from './satisfies';
import { DEFAULT_TRAVEL_MODE, travelTimes } from './travelTime';

function price(post: Listing | BuyerRequest): number | undefined {
  if ('price' in post) {
    return post.price;
  }
  const budget = post.requestFields.find((field) => field.key === 'price')?.value;
  return typeof budget === 'number' ? budget : undefined;
}

// The same rule as MongoPostCollection.listOpen, for posts already loaded. A request
// with no budget fails any price filter, as it does in MongoDB.
export function passesFilter(post: Listing | BuyerRequest, filter: PostFilter): boolean {
  const { category, minPrice, maxPrice, near } = filter;
  const postPrice = price(post);
  return (
    (category === undefined || post.category === category) &&
    (minPrice === undefined || (postPrice !== undefined && postPrice >= minPrice)) &&
    (maxPrice === undefined || (postPrice !== undefined && postPrice <= maxPrice)) &&
    (near === undefined ||
      distanceKm({ type: 'Point', coordinates: [near.lng, near.lat] }, post.location) <= near.radiusKm)
  );
}

export class FeedService {
  constructor(private readonly posts: PostsService) {}

  // The ranked feed for one of the caller's open posts: listings that match a request, or requests
  // that match a listing, best first, narrowed by any feed filters. The first page carries travel
  // times. nextCursor is the `cursor` for the next page, or null on the last page.
  async recommendations(me: string, postId: string, limit: number, offset: number, filter: PostFilter) {
    const source = await this.findPost(postId);
    if (source === null) {
      throw new NotFoundError();
    }
    if (source.ownerId !== me) {
      throw new ForbiddenError();
    }
    if (source.status === 'closed') {
      throw new ConflictError('Closed posts have no feed');
    }

    const candidates: Post[] = isRequest(source)
      ? await this.posts.listOpenInCategory('listing', source.category, me)
      : await this.posts.listOpenInCategory('request', source.category, me);
    const matching = candidates.filter((candidate) => {
      const { request, listing } = asPair(source, candidate);
      return satisfies(request, listing) && passesFilter(candidate, filter);
    });
    // Every match is ranked before paging, since any of them could come first.
    const ranked = rank(source, matching, DEFAULT_WEIGHTS);
    const end = offset + limit;
    const page = ranked.slice(offset, end);
    // Only the first page asks for travel times, to stay within the routing service's
    // daily cap. If it fails, the feed is still returned, without them.
    const minutes =
      offset === 0 ? await travelTimes(source.location, page.map((match) => match.post.location), DEFAULT_TRAVEL_MODE) : [];
    // When travel times are available, a null travelMinutes means there is no route to that post.
    const travelTimesAvailable = page.length > 0 && minutes.length === page.length;
    return {
      matches: page.map((match, index) => ({ ...match, travelMinutes: minutes.at(index) ?? null })),
      travelMode: DEFAULT_TRAVEL_MODE,
      travelTimesAvailable,
      nextCursor: end < ranked.length ? String(end) : null,
    };
  }

  // Other users' open posts, newest first. nextCursor is the `before` for the next page, or null on the last page.
  async browse<K extends PostKind>(
    kind: K,
    me: string,
    limit: number,
    before: string | undefined,
    filter: PostFilter,
  ): Promise<{ page: PostOf<K>[]; nextCursor: string | null }> {
    // One extra post tells whether another page follows.
    const found = await this.posts.listOpen(kind, me, limit + 1, { ...filter, before });
    const page = found.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor = found.length > limit && last !== undefined ? last.id : null;
    return { page, nextCursor };
  }

  // One post, open or closed, to any signed-in user.
  async one<K extends PostKind>(kind: K, id: string): Promise<PostOf<K>> {
    const post = await this.posts.findById(kind, id);
    if (post === null) {
      throw new NotFoundError();
    }
    return post;
  }

  private async findPost(id: string): Promise<Post | null> {
    return (await this.posts.findById('request', id)) ?? (await this.posts.findById('listing', id));
  }
}
