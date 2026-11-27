import type { Router } from 'express';

import type { PostsService } from '../services/postsService';
import { createPostRouter } from './posts';

export function createRequestsRouter(posts: PostsService): Router {
  return createPostRouter(posts, 'request');
}
