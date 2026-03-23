import { RunnableSequence } from '@langchain/core/runnables';
import { StringOutputParser, JsonOutputParser } from '@langchain/core/output_parsers';
import { llm } from './llm.js';
import {
  plannerPrompt,
  profilePrompt,
  simulationPrompt,
  portfolioRationalePrompt,
  riskNarrativePrompt,
  explanationPrompt,
  documentIngestionPrompt,
  taxPrompt,
  cashflowPrompt,
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

// Rationale-only chain — LLM writes plain text, not JSON
export const portfolioRationaleChain = RunnableSequence.from([
  portfolioRationalePrompt,
  llm,
  stringParser,
]);

// Narrative-only chain — LLM writes factor descriptions + mitigation steps JSON
export const riskNarrativeChain = RunnableSequence.from([
  riskNarrativePrompt,
  llm,
  jsonParser,
]);

export const explanationChain = RunnableSequence.from([
  explanationPrompt,
  llm,
  stringParser,
]);

export const documentIngestionChain = RunnableSequence.from([
  documentIngestionPrompt,
  llm,
  jsonParser,
]);

export const taxChain = RunnableSequence.from([
  taxPrompt,
  llm,
  jsonParser,
]);

export const cashflowChain = RunnableSequence.from([
  cashflowPrompt,
  llm,
  jsonParser,
]);
