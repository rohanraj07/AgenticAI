/**
 * Shared service singletons — imported by routes and index.js alike.
 * Avoids circular dependency between index.js ↔ routes.
 */
import { RedisMemory }    from './memory/redis.memory.js';
import { VectorStore }    from './vector/vector.store.js';
import { AppEventEmitter } from './events/event.emitter.js';
import { StateManager }   from './engine/state.manager.js';
import { ReactiveEngine } from './engine/reactive.engine.js';

export const redisMemory  = new RedisMemory();
export const vectorStore  = new VectorStore();
export const eventEmitter = new AppEventEmitter();
export const stateManager = new StateManager();

// ReactiveEngine wires together stateManager + eventEmitter + redisMemory.
// It attaches event listeners immediately and begins monitoring upstream events.
export const reactiveEngine = new ReactiveEngine(stateManager, eventEmitter, redisMemory);
