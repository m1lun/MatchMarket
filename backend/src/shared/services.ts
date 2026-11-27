import { DealsService } from '../components/deals/services/dealsService';
import { FeedService } from '../components/matching/services/feedService';
import { MessagingService, type EventPublisher } from '../components/messaging/services/messagingService';
import { PostsService } from '../components/posts/services/postsService';
import { UsersService } from '../components/users/services/usersService';
import type { Store } from './store/types';

export interface Services {
  users: UsersService;
  posts: PostsService;
  deals: DealsService;
  feed: FeedService;
  messaging: MessagingService;
}

export function createServices(store: Store, events: EventPublisher): Services {
  const users = new UsersService(store.users);
  const posts = new PostsService(store);
  const deals = new DealsService(store, posts, users);
  const feed = new FeedService(posts);
  const messaging = new MessagingService(store, posts, users, deals, events);
  return { users, posts, deals, feed, messaging };
}
