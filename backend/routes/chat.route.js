import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { buildFinancialGraph } from '../langgraph/graph.js';
import { redisMemory, vectorStore, eventEmitter, reactiveEngine } from '../services.js';
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
  const reqStart  = Date.now();

  log.route(`POST /chat | session: ${sessionId}`);
  log.route(`  message: "${message.slice(0, 100)}${message.length > 100 ? '...' : ''}"`);

  try {
    // 1. Load session memory + seed reactive engine state
    const session = (await redisMemory.getSession(sessionId)) || {};
    reactiveEngine.seedFromSession(sessionId, session);
    const conversationHistory = await redisMemory.getConversationString(sessionId);
    const docInsights = session.documentInsights || {};
    log.route(`  session loaded | profile: ${!!session.profile} | docInsights: [${Object.keys(docInsights).join(', ')||'none'}] | history: ${conversationHistory.split('\n').filter(Boolean).length} msgs`);

    // 2. RAG retrieval — scoped to this session
    const ragContext = await vectorStore.searchAsContext(message, sessionId);
    log.route(`  RAG: ${ragContext.length} chars`);

    // 3. Markdown context
    const markdownCtx = markdownMemory.read(sessionId);

    // 4. Save user message
    await redisMemory.appendMessage(sessionId, 'user', message);

    // 5. Emit planner started
    eventEmitter.emitAgentStarted(sessionId, 'planner');

    // 6. Run LangGraph pipeline
    log.route('  LangGraph: invoking pipeline...');
    const graphStart = Date.now();

    const finalState = await financialGraph.invoke({
      message,
      sessionContext: conversationHistory || markdownCtx,
      ragContext,
      memory:         markdownCtx,
      profile:        session.profile     || null,
      _sessionId:     sessionId,
      // Reload document insights from session so tax/cashflow agents can run
      // if the planner routes to them (e.g. "tell me more about my taxes")
      taxInsights:        docInsights.tax        || null,
      cashflowInsights:   docInsights.cashflow   || null,
      portfolioInsights:  docInsights.portfolio  || null,
      debtInsights:       docInsights.debt       || null,
      // plannerContext: session-awareness hints so planner doesn't re-run profile needlessly
      plannerContext: {
        profileExists:        !!session.profile,
        simulationExists:     !!session.simulation,
      },
    });

    log.route(`  LangGraph: complete (${Date.now() - graphStart}ms)`);

    const { plan, profile, simulation, portfolio, risk, tax, cashflow, explanation, trace } = finalState;

    // 7. Persist to Redis + emit reactive events
    if (profile) {
      await redisMemory.updateSession(sessionId, { profile });
      eventEmitter.emitProfileUpdated(sessionId, profile);
      log.route('  → profile saved');
    }
    if (simulation) {
      await redisMemory.updateSession(sessionId, { simulation });
      eventEmitter.emitSimulationUpdated(sessionId, simulation);
      log.route(`  → simulation saved | can_retire=${simulation.can_retire_at_target}`);
    }
    if (portfolio) {
      await redisMemory.updateSession(sessionId, { portfolio });
      eventEmitter.emitPortfolioUpdated(sessionId, portfolio);
      log.route(`  → portfolio saved | strategy=${portfolio.strategy}`);
    }
    if (risk) {
      await redisMemory.updateSession(sessionId, { risk });
      eventEmitter.emitRiskUpdated(sessionId, risk);
      log.route(`  → risk saved | score=${risk.overall_risk_score}/10`);
    }
    if (tax) {
      await redisMemory.updateSession(sessionId, { tax });
      eventEmitter.emitTaxUpdated(sessionId, tax);
      log.route(`  → tax saved | efficiency=${tax.tax_efficiency_score}/10`);
    }
    if (cashflow) {
      await redisMemory.updateSession(sessionId, { cashflow });
      eventEmitter.emitCashflowUpdated(sessionId, cashflow);
      log.route(`  → cashflow saved | budget=${cashflow.budget_health}`);
    }
    if (explanation) {
      eventEmitter.emitExplanationReady(sessionId, explanation);
    }

    // 8. Write markdown + vector snapshot
    if (profile) {
      const md = markdownMemory.write(sessionId, profile, simulation, portfolio, risk);
      log.route(`  Markdown written (${md.length} chars)`);
      await vectorStore.storeSessionSnapshot(sessionId, md);
    }

    // 9. Save assistant reply
    await redisMemory.appendMessage(sessionId, 'assistant', explanation || plan?.intent || '');

    // 10. Trace summary
    if (trace?.length) {
      const total = trace.reduce((s, t) => s + (t.latencyMs || 0), 0);
      log.route(`  Trace: [${trace.map((t) => `${t.agent}:${t.latencyMs}ms`).join(' → ')}] total=${total}ms`);
    }

    const totalMs = Date.now() - reqStart;
    log.route(`  Response sent | ui=[${(plan?.ui || []).map((u) => u.type).join(', ')}] | total=${totalMs}ms`);

    res.json({
      sessionId,
      message: explanation || plan?.intent || 'Processing complete.',
      ui:      plan?.ui || [],
      data:    { profile, simulation, portfolio, risk, tax, cashflow },
      meta: {
        intent:             plan?.intent,
        confidence:         plan?.confidence,
        decision_rationale: plan?.decision_rationale,
        missing_data:       plan?.missing_data || [],
      },
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
