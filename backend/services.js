/**
 * Shared service singletons — imported by routes and index.js alike.
 * Avoids circular dependency between index.js ↔ routes.
 */
import { RedisMemory } from './memory/redis.memory.js';
import { VectorStore } from './vector/vector.store.js';
import { AppEventEmitter } from './events/event.emitter.js';

export const redisMemory = new RedisMemory();
export const vectorStore = new VectorStore();
export const eventEmitter = new AppEventEmitter();
