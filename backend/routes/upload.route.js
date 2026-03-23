import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { DocumentIngestionAgent } from '../agents/document.ingestion.agent.js';
import { buildFinancialGraph } from '../langgraph/graph.js';
import { redisMemory, vectorStore, eventEmitter, reactiveEngine } from '../services.js';
import { MarkdownMemory } from '../memory/markdown.memory.js';
import { log } from '../logger.js';

/**
 * TRUST-BY-DESIGN — Upload Route
 *
 * Files are received in-memory (memoryStorage) and NEVER written to disk.
 * Only abstracted signals extracted by DocumentIngestionAgent are persisted.
 * The raw document is discarded immediately after processing.
 */
const storage = multer.memoryStorage();  // No disk persistence
const upload  = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },  // 5 MB max
  fileFilter: (_req, file, cb) => {
    const allowed = ['text/plain', 'application/json', 'text/csv', 'application/pdf'];
    if (allowed.includes(file.mimetype) || file.originalname.endsWith('.txt') || file.originalname.endsWith('.json')) {
      cb(null, true);
    } else {
      cb(new Error('Only .txt, .json, and .csv files supported in this POC'));
    }
  },
});

const documentIngestionAgent = new DocumentIngestionAgent();
const markdownMemory         = new MarkdownMemory();
const financialGraph         = buildFinancialGraph();

export const uploadRoute = Router();

/**
 * POST /api/upload
 * Accepts: multipart/form-data with field "document" + optional "sessionId"
 *
 * Pipeline:
 *  1. Receive file in-memory (never written to disk)
 *  2. DocumentIngestionAgent: classify + extract abstracted signals
 *  3. Discard raw document
 *  4. Run appropriate agents via LangGraph (routed by ROUTING_MAP)
 *  5. Return UI components + sanitized data
 */
uploadRoute.post('/upload', upload.single('document'), async (req, res) => {
  const reqStart = Date.now();

  if (!req.file) {
    return res.status(400).json({ error: 'No document uploaded. Use field name "document".' });
  }

  const { sessionId: incomingSessionId } = req.body;
  const sessionId = incomingSessionId || uuidv4();
  const fileName  = req.file.originalname;
  const fileSize  = req.file.size;

  log.route(`POST /upload | session: ${sessionId} | file: "${fileName}" (${fileSize} bytes)`);
  log.route('  ⚠️  TRUST-BY-DESIGN: File received in-memory. Will NOT be written to disk.');

  try {
    // 1. Read file content as text (transient — never persisted)
    const documentText = req.file.buffer.toString('utf-8');
    log.route(`  Document text: ${documentText.length} chars — raw content in transient memory only`);

    // 2. Load existing session + RAG context
    const session    = (await redisMemory.getSession(sessionId)) || {};
    reactiveEngine.seedFromSession(sessionId, session);
    const ragContext = await vectorStore.searchAsContext(`financial document ${fileName}`, sessionId);

    // 3. Run DocumentIngestionAgent — classify, extract abstractions, discard raw
    log.route('  Running DocumentIngestionAgent...');
    eventEmitter.emitAgentStarted(sessionId, 'document_ingestion');

    const ingestion = await documentIngestionAgent.run(documentText, fileName);

    log.route(`  Classified: ${ingestion.document_type} (${ingestion.confidence} confidence)`);
    log.route(`  PII stored: ${ingestion.pii_stored} | Raw doc stored: ${ingestion.raw_document_stored}`);
    log.route('  Raw document text discarded ✓');

    // 4. Build synthetic message + pre-seeded plan from ROUTING_MAP output
    const syntheticMessage = `I've uploaded a ${ingestion.document_type.replace('_', ' ')} called "${fileName}". ` +
      `Key insight: ${ingestion.abstracted_signals?.primary_insight || 'please analyze this document'}.`;

    // ROUTING_MAP already includes profile, simulation, explanation — deduplicate
    const agents = [...new Set([...ingestion.suggested_agents, 'simulation', 'explanation'])];

    // Deduplicate UI types (routing map already adds all needed panels)
    const seen = new Set();
    const ui = [
      ...(ingestion.suggested_ui.length ? ingestion.suggested_ui : [{ type: 'explanation_panel' }]),
      { type: 'simulation_chart' },
      { type: 'explanation_panel' },
    ].filter((u) => { if (seen.has(u.type)) return false; seen.add(u.type); return true; });

    const syntheticPlan = {
      intent:   `Analyze uploaded ${ingestion.document_type}`,
      agents,
      ui,
      params:   {},
      confidence: 'high',
      decision_rationale: `Document type "${ingestion.document_type}" maps to agents: [${agents.join(', ')}]`,
    };

    log.route(`  Plan: agents=[${agents.join(', ')}] | ui=[${syntheticPlan.ui.map((u) => u.type).join(', ')}]`);

    // 5. Run LangGraph — plan pre-seeded so node_planner is skipped
    log.route('  LangGraph: invoking pipeline...');
    const graphStart = Date.now();

    const finalState = await financialGraph.invoke({
      message:          syntheticMessage,
      sessionContext:   markdownMemory.read(sessionId),
      ragContext,
      memory:           markdownMemory.read(sessionId),
      profile:          session.profile || null,
      _sessionId:       sessionId,
      // Pre-seeded plan → node_planner is skipped
      plan:             syntheticPlan,
      // Insight channels — only the relevant one is non-null
      taxInsights:      ingestion.taxInsights       || null,
      cashflowInsights: ingestion.cashflowInsights  || null,
      portfolioInsights: ingestion.portfolioInsights || null,
      debtInsights:     ingestion.debtInsights       || null,
    });

    log.route(`  LangGraph: complete (${Date.now() - graphStart}ms)`);

    const { profile, simulation, portfolio, risk, tax, cashflow, explanation, trace } = finalState;

    // 6. Persist sanitized data to Redis + emit events
    if (profile)    { await redisMemory.updateSession(sessionId, { profile });    eventEmitter.emitProfileUpdated(sessionId, profile); }
    if (simulation) { await redisMemory.updateSession(sessionId, { simulation }); eventEmitter.emitSimulationUpdated(sessionId, simulation); }
    if (portfolio)  { await redisMemory.updateSession(sessionId, { portfolio });  eventEmitter.emitPortfolioUpdated(sessionId, portfolio); }
    if (risk)       { await redisMemory.updateSession(sessionId, { risk });       eventEmitter.emitRiskUpdated(sessionId, risk); }
    if (tax)        { await redisMemory.updateSession(sessionId, { tax });        eventEmitter.emitTaxUpdated(sessionId, tax); }
    if (cashflow)   { await redisMemory.updateSession(sessionId, { cashflow });   eventEmitter.emitCashflowUpdated(sessionId, cashflow); }
    if (explanation) { eventEmitter.emitExplanationReady(sessionId, explanation); }

    // 6b. Save document insights to session so chat route can reuse them
    //     (these are already-sanitized signals — safe to persist)
    const documentInsights = {};
    if (ingestion.taxInsights)        documentInsights.tax        = ingestion.taxInsights;
    if (ingestion.cashflowInsights)   documentInsights.cashflow   = ingestion.cashflowInsights;
    if (ingestion.portfolioInsights)  documentInsights.portfolio  = ingestion.portfolioInsights;
    if (ingestion.debtInsights)       documentInsights.debt       = ingestion.debtInsights;
    if (Object.keys(documentInsights).length) {
      await redisMemory.updateSession(sessionId, { documentInsights });
      log.route(`  → documentInsights saved to session (keys: ${Object.keys(documentInsights).join(', ')})`);
    }

    // 7. Write PII-safe markdown snapshot
    const md = markdownMemory.write(
      sessionId, profile, simulation, portfolio, risk,
      ingestion.taxInsights, ingestion.cashflowInsights,
    );
    log.route(`  Markdown snapshot written (${md.length} chars) — abstractions only`);

    // Store only anonymized insight summary in vector store
    const vectorSummary = `Document analysis for session ${sessionId}: ${ingestion.abstracted_signals?.primary_insight || ''} ` +
      (ingestion.abstracted_signals?.key_signals || []).join('. ');
    await vectorStore.storeSessionSnapshot(sessionId, vectorSummary);
    log.route('  Vector store: anonymized insight summary stored (NOT raw document)');

    // 8. Save assistant reply
    await redisMemory.appendMessage(sessionId, 'assistant', explanation || syntheticPlan.intent);

    const totalMs = Date.now() - reqStart;
    log.route(`  Upload complete | ui=[${syntheticPlan.ui.map((u) => u.type).join(', ')}] | total=${totalMs}ms`);

    res.json({
      sessionId,
      message:      explanation || `Document analyzed: ${ingestion.abstracted_signals?.primary_insight}`,
      documentType: ingestion.document_type,
      confidence:   ingestion.confidence,
      ui:           syntheticPlan.ui,
      data:         { profile, simulation, portfolio, risk, tax, cashflow },
      ingestion: {
        document_type:       ingestion.document_type,
        abstracted_signals:  ingestion.abstracted_signals,
        pii_stored:          false,
        raw_document_stored: false,
      },
      meta: {
        decision_rationale: syntheticPlan.decision_rationale,
      },
      trace: trace || [],
    });

  } catch (err) {
    log.error('UploadRoute error:', err.message);
    log.error(err.stack);
    res.status(500).json({ error: 'Upload processing failed', details: err.message });
  }
});
