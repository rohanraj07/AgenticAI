import { RunnableSequence } from '@langchain/core/runnables';
import { StringOutputParser, JsonOutputParser } from '@langchain/core/output_parsers';
import { llm } from './llm.js';
import {
  plannerPrompt,
  profilePrompt,
  simulationPrompt,
  portfolioPrompt,
  riskPrompt,
  explanationPrompt,
} from './prompts.js';

const jsonParser = new JsonOutputParser();
const stringParser = new StringOutputParser();

export const plannerChain = RunnableSequence.from([
  plannerPrompt,
  llm,
  jsonParser,
]);

export const profileChain = RunnableSequence.from([
  profilePrompt,
  llm,
  jsonParser,
]);

export const simulationChain = RunnableSequence.from([
  simulationPrompt,
  llm,
  jsonParser,
]);

export const portfolioChain = RunnableSequence.from([
  portfolioPrompt,
  llm,
  jsonParser,
]);

export const riskChain = RunnableSequence.from([
  riskPrompt,
  llm,
  jsonParser,
]);

export const explanationChain = RunnableSequence.from([
  explanationPrompt,
  llm,
  stringParser,
]);
