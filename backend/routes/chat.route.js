import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { buildFinancialGraph } from '../langgraph/graph.js';
import { redisMemory, vectorStore, eventEmitter } from '../services.js';
import { MarkdownMemory } from '../memory/markdown.memory.js';
import { log } from '../logger.js';

const markdownMemory = new MarkdownMemory();
const financialGraph = buildFinancialGraph();

export const chatRoute = Router();

chatRoute.post('/chat', async (req, res) => {
  const { message, sessionId: incomingSessionId } = req.body;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required' });
  }

  const sessionId = incomingSessionId || uuidv4();
  const reqStart = Date.now();

  log.route(`POST /chat | session: ${sessionId}`);
  log.route(`  message: "${message.slice(0, 100)}${message.length > 100 ? '...' : ''}"`);

  try {
    // 1. Load session memory
    const session = (await redisMemory.getSession(sessionId)) || {};
    const conversationHistory = await redisMemory.getConversationString(sessionId);
    log.route(`  session loaded | existing profile: ${!!session.profile} | history: ${conversationHistory.split('\n').filter(Boolean).length} messages`);

    // 2. RAG retrieval
    log.route('  RAG: searching vector store...');
    const ragContext = await vectorStore.searchAsContext(message);
    log.route(`  RAG: context retrieved (${ragContext.length} chars)`);

    // 3. Markdown context
    const markdownCtx = markdownMemory.read(sessionId);
    log.route(`  Markdown memory: ${markdownCtx.length > 0 ? markdownCtx.length + ' chars' : 'empty (first session)'}`);

    // 4. Save user message
    await redisMemory.appendMessage(sessionId, 'user', message);

    // 5. Emit agent started
    eventEmitter.emitAgentStarted(sessionId, 'planner');

    // 6. Run LangGraph pipeline
    log.route('  LangGraph: invoking pipeline...');
    const graphStart = Date.now();
    const finalState = await financialGraph.invoke({
      message,
      sessionContext: conversationHistory || markdownCtx,
      ragContext,
      memory: markdownCtx,
      profile: session.profile || null,
    });
    log.route(`  LangGraph: pipeline complete (${Date.now() - graphStart}ms)`);

    const { plan, profile, simulation, portfolio, risk, explanation, trace } = finalState;

    // 7. Emit reactive events + persist to Redis
    if (profile) {
      await redisMemory.updateSession(sessionId, { profile });
      eventEmitter.emitProfileUpdated(sessionId, profile);
      log.route('  → profile saved & event emitted');
    }
    if (simulation) {
      await redisMemory.updateSession(sessionId, { simulation });
      eventEmitter.emitSimulationUpdated(sessionId, simulation);
      log.route(`  → simulation saved | can_retire=${simulation.can_retire_at_target} | projected=$${simulation.projected_savings_at_retirement}`);
    }
    if (portfolio) {
      await redisMemory.updateSession(sessionId, { portfolio });
      eventEmitter.emitPortfolioUpdated(sessionId, portfolio);
      log.route(`  → portfolio saved | strategy=${portfolio.strategy} | return=${portfolio.expected_annual_return_percent}%`);
    }
    if (risk) {
      await redisMemory.updateSession(sessionId, { risk });
      eventEmitter.emitRiskUpdated(sessionId, risk);
      log.route(`  → risk saved | score=${risk.overall_risk_score}/10 | level=${risk.risk_level}`);
    }
    if (explanation) {
      eventEmitter.emitExplanationReady(sessionId, explanation);
    }

    // 8. Write markdown + vector snapshot
    if (profile) {
      log.route('  Writing markdown memory snapshot...');
      const md = markdownMemory.write(sessionId, profile, simulation, portfolio, risk);
      log.route(`  Markdown written to data/sessions/${sessionId}.md (${md.length} chars)`);
      await vectorStore.storeSessionSnapshot(sessionId, md);
    }

    // 9. Save assistant reply
    await redisMemory.appendMessage(sessionId, 'assistant', explanation || plan?.intent || '');

    // 10. Trace summary
    if (trace?.length) {
      const total = trace.reduce((s, t) => s + (t.latencyMs || 0), 0);
      log.route(`  Trace: [${trace.map(t => `${t.agent}:${t.latencyMs}ms`).join(' → ')}] total=${total}ms`);
    }

    const totalMs = Date.now() - reqStart;
    log.route(`  Response sent | ui=[${(plan?.ui||[]).map(u=>u.type).join(', ')}] | total=${totalMs}ms`);

    res.json({
      sessionId,
      message: explanation || plan?.intent || 'Processing complete.',
      ui: plan?.ui || [],
      data: { profile, simulation, portfolio, risk },
      trace: trace || [],
    });
  } catch (err) {
    log.error('ChatRoute error:', err.message);
    log.error(err.stack);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

chatRoute.get('/session/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  log.route(`GET /session/${sessionId}`);
  const session = await redisMemory.getSession(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});
