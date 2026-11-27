import type { Router } from 'express';

import type { PostsService } from '../services/postsService';
import { createPostRouter } from './posts';

export function createListingsRouter(posts: PostsService): Router {
  return createPostRouter(posts, 'listing');
}
